// lib/db.js — Turso HTTP client + movie CRUD + detail→movie conversion + cache.
// Zero external dependencies; uses global fetch() available in all Workers runtimes.
//
// Design notes:
//   • Uses Turso v2 HTTP API directly (POST /v2/turso/stmts) instead of
//     @libsql/client, to avoid any bundling issues on EdgeOne Makers Workers.
//   • Turso connection params come from EdgeOne Makers env vars TURSO_URL /
//     TURSO_TOKEN, passed in via context.env.
//   • Movies are stored as a full JSON blob in the `data` column, with a few
//     indexed columns (id, name, imported_at) for filtering.
//   • parse_api result cache is per-module (per EdgeOne instance, in-process
//     Map). EdgeOne instances are long-lived, so the cache persists.

export const VERSION = "0.2.0";

// ---------------------------------------------------------------------------
// Turso HTTP client
// ---------------------------------------------------------------------------

export function getDb(env) {
  const url = (env.TURSO_URL || "").trim().replace(/\/$/, "");
  const token = (env.TURSO_TOKEN || "").trim();
  if (!url || !token) {
    return { error: "TURSO_URL / TURSO_TOKEN env vars missing" };
  }
  return { url, token };
}

export async function execute(db, sql, params = []) {
  const body = JSON.stringify([
    { sql, params: params.map((v) => ({ value: v })) },
  ]);
  const res = await fetch(`${db.url}/v2/turso/stmts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${db.token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turso HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const stmt = data.statements && data.statements[0];
  if (!stmt) throw new Error("Turso: no statement in response");
  return {
    columns: stmt.columns || [],
    rows: stmt.rows || [],
    last_insert_rowid: stmt.last_insert_rowid || 0,
    changes: stmt.changes || 0,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS movies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  data        TEXT NOT NULL
)`;

export async function ensureSchema(db) {
  await execute(db, SCHEMA_SQL);
}

// ---------------------------------------------------------------------------
// Movie CRUD
// ---------------------------------------------------------------------------

function rowToMovie(r) {
  const [id, name, imported_at, data] = r;
  let parsed = {};
  try { parsed = JSON.parse(data); } catch {}
  return { id, name, imported_at, ...parsed };
}

export async function getAllMovies(db) {
  const { rows } = await execute(
    db,
    "SELECT id, name, imported_at, data FROM movies ORDER BY imported_at DESC"
  );
  return rows.map(rowToMovie);
}

export async function getMovie(db, id) {
  const { rows } = await execute(
    db,
    "SELECT id, name, imported_at, data FROM movies WHERE id = ?",
    [id]
  );
  return rows.length ? rowToMovie(rows[0]) : null;
}

export async function upsertMovie(db, movie) {
  await execute(
    db,
    `INSERT INTO movies (id, name, imported_at, data)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name        = excluded.name,
       imported_at = excluded.imported_at,
       data        = excluded.data`,
    [
      movie.id,
      movie.name || "",
      movie.imported_at || new Date().toISOString(),
      JSON.stringify(movie),
    ]
  );
}

export async function deleteMovie(db, id) {
  const { changes } = await execute(
    db,
    "DELETE FROM movies WHERE id = ?",
    [id]
  );
  return changes > 0;
}

export async function countMovies(db) {
  const { rows } = await execute(db, "SELECT COUNT(*) FROM movies");
  return (rows[0] && rows[0][0]) || 0;
}

// ---------------------------------------------------------------------------
// Detail response → movie record conversion
// ---------------------------------------------------------------------------

export function buildMovieFromDetail(payload) {
  const p = payload && payload.data ? payload.data : payload;
  const vodInfo = p.vod_info || {};
  if (!vodInfo || Object.keys(vodInfo).length === 0) throw new Error("payload missing vod_info");

  const sources = {};
  for (const entry of p.vod_url_with_player || []) {
    const code = entry.code || entry.name;
    if (!code) continue;
    sources[String(code)] = {
      name: entry.name || code,
      parse_api: entry.parse_api || "",
      headers: extractHeaders(entry.headers),
      core_params: entry.core_params || [],
      episodes: parseEpisodeUrl(entry.url || ""),
    };
  }

  const vodId = p.vod_id || vodInfo.vod_id;
  const name = vodInfo.vod_name || p.vod_name || "";
  const id = vodId != null ? `vod-${vodId}` : (slugify(name) || "movie");

  return {
    id,
    vod_id: vodId,
    name,
    vod_pic: vodInfo.vod_pic || p.vod_pic || "",
    type_id: vodInfo.type_id || p.type_id,
    vod_remarks: vodInfo.vod_remarks || p.vod_remarks || "",
    vod_info: vodInfo,
    sources,
    imported_at: new Date().toISOString(),
  };
}

function extractHeaders(hField) {
  if (!hField) return {};
  if (typeof hField === "object" && !Array.isArray(hField)) {
    const out = {};
    for (const [k, v] of Object.entries(hField)) out[String(k)] = String(v);
    return out;
  }
  if (typeof hField === "string") {
    const out = {};
    for (const line of hField.split(";")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return out;
  }
  return {};
}

function parseEpisodeUrl(urlField) {
  const episodes = {};
  for (const pair of urlField.split("#")) {
    const idx = pair.indexOf("$");
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    const token = pair.slice(idx + 1).trim();
    if (!token) continue;
    const m = /(\d+)/.exec(name);
    const k = m ? String(parseInt(m[1], 10)) : "0";
    episodes[k] = token;
  }
  return episodes;
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// parse_api helpers (used by /api/play)
// ---------------------------------------------------------------------------

export function buildParseUrl(parseApi, token) {
  const tok = encodeURIComponent(token);
  if (parseApi.endsWith("url=")) return parseApi + tok;
  if (parseApi.includes("?")) return `${parseApi}&url=${tok}`;
  return `${parseApi}?url=${tok}`;
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract a URL from non-JSON response.
    const m = /https?:\/\/[^\s"'<>]+/.exec(text || "");
    if (m) {
      return { code: 200, msg: "raw extract (upstream non-JSON)", url: m[0], type: "unknown" };
    }
    return { code: -1, msg: `non-JSON response: ${(text || "").slice(0, 200)}` };
  }
}

// ---------------------------------------------------------------------------
// In-process parse_api result cache (per EdgeOne instance, long-lived)
// ---------------------------------------------------------------------------

const CACHE_TTL = 60_000; // 60s
const _cache = new Map(); // key → { value, expires }

export function cacheGet(key) {
  const v = _cache.get(key);
  if (!v) return null;
  if (Date.now() > v.expires) {
    _cache.delete(key);
    return null;
  }
  return v.value;
}

export function cacheSet(key, value) {
  _cache.set(key, { value, expires: Date.now() + CACHE_TTL });
}

export function cacheSize() {
  return _cache.size;
}

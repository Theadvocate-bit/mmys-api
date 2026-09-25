// edge-functions/lib/db.js — Turso client (HANA pipeline protocol)
// + movie CRUD + parse cache + 3-level fallback
// (Turso → in-memory overlay → embedded catalog_data.js).
// Zero external dependencies; uses global fetch() + DecompressionStream.

export const VERSION = "0.4.0";

import { EMBEDDED_CATALOG } from "./catalog_data.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function getDb(env) {
  const rawUrl = (env.TURSO_DATABASE_URL || "").trim();
  const token = (env.TURSO_AUTH_TOKEN || "").trim();
  if (!rawUrl || !token) {
    return {
      error: "TURSO_DATABASE_URL/TURSO_AUTH_TOKEN env vars missing",
    };
  }
  let url = rawUrl;
  if (url.startsWith("libsql://")) url = "https://" + url.slice(9);
  else if (url.startsWith("turso://")) url = "https://" + url.slice(8);
  url = url.replace(/\/$/, "");
  return { url, token };
}

export function getConfig(env) {
  return {
    parseTimeout: parseInt(env.MYS_PARSE_TIMEOUT || "20000", 10),
    streamTimeout: parseInt(env.MYS_STREAM_TIMEOUT || "30000", 10),
    cacheTtl: parseInt(env.MYS_CACHE_TTL || "1800", 10), // seconds
    uaApp: env.MYS_UA_APP || "Dart/3.13 (dart:io)",
    uaPlayer: env.MYS_UA_PLAYER || "dart",
  };
}

// ---------------------------------------------------------------------------
// HANA protocol: typed args + value decoding
// ---------------------------------------------------------------------------

function encodeArg(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "boolean")
    return { type: "int", value: String(v ? 1 : 0) };
  if (typeof v === "number")
    return Number.isInteger(v)
      ? { type: "int", value: String(v) }
      : { type: "float", value: v };
  if (typeof v === "string") return { type: "str", value: v };
  if (v instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < v.length; i++) bin += String.fromCharCode(v[i]);
    return { type: "blob", base64: btoa(bin) };
  }
  return { type: "str", value: String(v) };
}

function decodeVal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || !v.type) return v;
  const t = v.type;
  if (t === "null") return null;
  if (t === "blob") {
    const bin = atob(v.base64 || "");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const val = v.value;
  if (t === "int" && typeof val === "string") {
    const n = parseInt(val, 10);
    return isNaN(n) ? val : n;
  }
  if (t === "float" && typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? val : n;
  }
  return val;
}

// ---------------------------------------------------------------------------
// Turso errors + backoff
// ---------------------------------------------------------------------------

export class TursoError extends Error {}

let _DOWN_UNTIL = 0;
let _SCHEMA_OK = false;

function _backoff() {
  _DOWN_UNTIL = Date.now() + 60_000;
}

function tursoAvailable() {
  return Date.now() >= _DOWN_UNTIL;
}

async function _withBackoff(fn) {
  if (!tursoAvailable()) throw new TursoError("Turso in backoff");
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TursoError) _backoff();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// HTTP pipeline
// ---------------------------------------------------------------------------

async function httpPipeline(db, requests, timeout = 15_000) {
  const payload = JSON.stringify({
    requests: [...requests, { type: "close" }],
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${db.url}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${db.token}`,
        "Content-Type": "application/json",
      },
      body: payload,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TursoError(
        `Turso HTTP ${res.status}: ${text.slice(0, 200)}`
      );
    }
    const d = await res.json();
    const results = [];
    for (const r of d.results || []) {
      if (r.type === "error") {
        throw new TursoError(
          `Turso error: ${JSON.stringify(r.error).slice(0, 200)}`
        );
      }
      const resp = r.response || {};
      if (resp.type === "error") {
        throw new TursoError(
          `Turso error: ${JSON.stringify(resp.error).slice(0, 200)}`
        );
      }
      results.push(resp.result);
    }
    return results;
  } catch (e) {
    if (e instanceof TursoError) throw e;
    throw new TursoError(`Turso connection failed: ${e.message}`);
  } finally {
    clearTimeout(t);
  }
}

function _stmt(sql, params = []) {
  const s = { type: "execute", stmt: { sql } };
  if (params.length) s.stmt.args = params.map(encodeArg);
  return s;
}

export async function execute(db, sql, params = []) {
  const results = await httpPipeline(db, [_stmt(sql, params)]);
  const r = results[0];
  if (!r) return { columns: [], rows: [], last_insert_rowid: 0, changes: 0 };
  return {
    columns: (r.columns || []).map((c) => c.name),
    rows: (r.rows || []).map((row) => row.map(decodeVal)),
    last_insert_rowid: r.last_insert_rowid || 0,
    changes: r.affected_row_count || 0,
  };
}

export async function executeMany(db, sqlArgsList) {
  const reqs = sqlArgsList.map(([sql, args]) => _stmt(sql, args || []));
  return httpPipeline(db, reqs);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS movies (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS parse_cache (
    cache_key   TEXT PRIMARY KEY,
    created_at  REAL NOT NULL DEFAULT 0,
    value       TEXT NOT NULL DEFAULT ''
  )`,
];

export async function ensureSchema(db) {
  if (_SCHEMA_OK) return;
  await executeMany(db, SCHEMA_SQL.map((s) => [s, []]));
  _SCHEMA_OK = true;
}

// ---------------------------------------------------------------------------
// Movies CRUD — direct Turso access
// ---------------------------------------------------------------------------

function rowToMovie(r) {
  const [id, name, imported_at, data] = r;
  let parsed = {};
  try {
    parsed = JSON.parse(data);
  } catch {}
  return { id, name, imported_at, ...parsed };
}

export async function getAllMoviesFromDb(db) {
  const { rows } = await execute(
    db,
    "SELECT id, name, imported_at, data FROM movies ORDER BY imported_at DESC"
  );
  return rows.map(rowToMovie);
}

export async function getMovieFromDb(db, id) {
  const { rows } = await execute(
    db,
    "SELECT id, name, imported_at, data FROM movies WHERE id = ?",
    [id]
  );
  return rows.length ? rowToMovie(rows[0]) : null;
}

export async function upsertMovieInDb(db, movie) {
  await execute(
    db,
    `INSERT INTO movies (id, name, imported_at, data) VALUES (?, ?, ?, ?)
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

export async function deleteMovieFromDb(db, id) {
  const { changes } = await execute(db, "DELETE FROM movies WHERE id = ?", [
    id,
  ]);
  return changes > 0;
}

export async function countMoviesInDb(db) {
  const { rows } = await execute(db, "SELECT COUNT(*) FROM movies");
  return (rows[0] && rows[0][0]) || 0;
}

// ---------------------------------------------------------------------------
// Parse cache — direct Turso access
// ---------------------------------------------------------------------------

export async function cacheGetFromDb(db, key, ttl) {
  try {
    const { rows } = await execute(
      db,
      "SELECT created_at, value FROM parse_cache WHERE cache_key = ?",
      [key]
    );
    if (!rows.length) return null;
    const [createdAt, value] = rows[0];
    if (Date.now() / 1000 - createdAt >= ttl) return null;
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function cacheSetInDb(db, key, value) {
  try {
    await execute(
      db,
      `INSERT INTO parse_cache (cache_key, created_at, value) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         created_at = excluded.created_at,
         value      = excluded.value`,
      [key, Date.now() / 1000, JSON.stringify(value)]
    );
  } catch {}
}

export async function cacheClearInDb(db) {
  try {
    await execute(db, "DELETE FROM parse_cache");
  } catch {}
}

// ---------------------------------------------------------------------------
// Embedded fallback catalog (imported at top of file)
// ---------------------------------------------------------------------------

const _overlay = new Map(); // runtime movie imports (when Turso is down)
const _memCache = new Map(); // runtime parse cache (when Turso is down)

// ---------------------------------------------------------------------------
// Fallback-aware API (used by routes)
// ---------------------------------------------------------------------------

export async function getMovie(env, id) {
  // 1) Turso
  try {
    const db = getDb(env);
    if (!db.error) {
      await ensureSchema(db);
      const v = await _withBackoff(() => getMovieFromDb(db, id));
      if (v) return v;
    }
  } catch {}
  // 2) In-memory overlay
  if (_overlay.has(id)) return _overlay.get(id);
  // 3) Embedded fallback (try raw id, then vod-${id})
  const cat = EMBEDDED_CATALOG.vods || {};
  if (cat[id]) return cat[id];
  if (!id.startsWith("vod-") && cat[`vod-${id}`]) return cat[`vod-${id}`];
  return null;
}

export async function getAllMovies(env) {
  try {
    const db = getDb(env);
    if (!db.error) {
      await ensureSchema(db);
      return await _withBackoff(() => getAllMoviesFromDb(db));
    }
  } catch {}
  const merged = { ...(EMBEDDED_CATALOG.vods || {}) };
  for (const [id, m] of _overlay) merged[id] = m;
  return Object.values(merged);
}

export async function upsertMovie(env, movie) {
  let persisted = true;
  let note = "";
  try {
    const db = getDb(env);
    if (db.error) {
      persisted = false;
      note = db.error;
    } else {
      await ensureSchema(db);
      await _withBackoff(() => upsertMovieInDb(db, movie));
    }
  } catch (e) {
    persisted = false;
    note = e.message;
  }
  _overlay.set(movie.id, movie);
  return { persisted, note };
}

export async function deleteMovie(env, id) {
  let persisted = true;
  try {
    const db = getDb(env);
    if (db.error) {
      persisted = false;
    } else {
      await ensureSchema(db);
      await _withBackoff(() => deleteMovieFromDb(db, id));
    }
  } catch {
    persisted = false;
  }
  _overlay.delete(id);
  return persisted;
}

export async function parseCacheGet(env, key, ttl) {
  const tt = ttl || 1800;
  try {
    const db = getDb(env);
    if (!db.error) {
      await ensureSchema(db);
      const hit = await _withBackoff(() => cacheGetFromDb(db, key, tt));
      if (hit) return hit;
    }
  } catch {}
  const m = _memCache.get(key);
  if (m && Date.now() - m.t < tt * 1000) return m.data;
  return null;
}

export async function parseCacheSet(env, key, value, ttl) {
  const tt = ttl || 1800;
  try {
    const db = getDb(env);
    if (!db.error) {
      await ensureSchema(db);
      await _withBackoff(() => cacheSetInDb(db, key, value));
    }
  } catch {}
  _memCache.set(key, { t: Date.now(), data: value });
}

export async function parseCacheClear(env) {
  try {
    const db = getDb(env);
    if (!db.error) {
      await ensureSchema(db);
      await _withBackoff(() => cacheClearInDb(db));
    }
  } catch {}
  _memCache.clear();
}

// ---------------------------------------------------------------------------
// Store health
// ---------------------------------------------------------------------------

export async function storeStatus(env) {
  const db = getDb(env);
  if (db.error) {
    return { turso: false, reason: db.error, mem_cache: _memCache.size };
  }
  try {
    await ensureSchema(db);
    const n = await _withBackoff(() => countMoviesInDb(db));
    return {
      turso: true,
      url: db.url,
      movies_in_db: n,
      mem_cache: _memCache.size,
      backoff: !tursoAvailable(),
    };
  } catch (e) {
    return { turso: false, reason: e.message, mem_cache: _memCache.size };
  }
}

export function cacheSize() {
  return _memCache.size;
}

// ---------------------------------------------------------------------------
// Detail response → movie record
// ---------------------------------------------------------------------------

export function buildMovieFromDetail(payload) {
  const p = payload && payload.data ? payload.data : payload;
  const vodInfo = p.vod_info || {};
  if (!vodInfo || Object.keys(vodInfo).length === 0)
    throw new Error("payload missing vod_info");

  const sources = {};
  let raw = p.vod_url_with_player || [];
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  for (const entry of raw || []) {
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
  const id = vodId != null ? `vod-${vodId}` : slugify(name) || "movie";

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
// parse_api helpers
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
    const m = /https?:\/\/[^\s"'<>]+/.exec(text || "");
    if (m) {
      return {
        code: 200,
        msg: "raw extract (upstream non-JSON)",
        url: m[0],
        type: "unknown",
      };
    }
    return {
      code: -1,
      msg: `non-JSON response: ${(text || "").slice(0, 200)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// gzip decompression (parse_api sometimes returns gzip'd body)
// ---------------------------------------------------------------------------

export async function decompressIfGzip(buf) {
  if (buf.length < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;
  if (typeof DecompressionStream === "undefined") return buf;
  try {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(new Uint8Array(buf));
    await writer.close();
    const chunks = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  } catch {
    return buf;
  }
}

export function decodeUtf8(buf) {
  return new TextDecoder("utf-8").decode(buf);
}

// ---------------------------------------------------------------------------
// Base64 URL-safe helpers
// ---------------------------------------------------------------------------

export function b64u(s) {
  const b = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDec(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(out);
}

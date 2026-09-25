// edge-functions/api/play.js — GET /api/play
// Core relay: movie+source+episode → token → parse_api → fresh direct link.
import {
  getDb,
  ensureSchema,
  getMovie,
  buildParseUrl,
  safeJsonParse,
  cacheGet,
  cacheSet,
} from "../../../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

  const url = new URL(request.url);
  const movieId = url.searchParams.get("movie") || "";
  const sourceCode = url.searchParams.get("source") || "";
  const epStr = url.searchParams.get("episode") || "";
  const wantRedirect = url.searchParams.get("redirect") === "1"
    || url.searchParams.get("redirect") === "true"
    || url.searchParams.get("redirect") === "yes";

  if (!movieId || !sourceCode || !epStr) {
    return json({ error: "missing movie/source/episode" }, 400);
  }

  const episode = parseInt(epStr, 10);
  if (isNaN(episode) || episode < 0) {
    return json({ error: "episode must be non-negative integer" }, 400);
  }

  try {
    const db = getDb(env);
    if (db.error) return json({ error: db.error }, 500);
    await ensureSchema(db);

    const movie = await getMovie(db, movieId);
    if (!movie) return json({ error: `movie '${movieId}' not found` }, 404);

    const source = (movie.sources || {})[sourceCode];
    if (!source) {
      const available = Object.keys(movie.sources || {});
      return json({
        error: `source '${sourceCode}' not found; available: ${available.join(", ")}`,
      }, 404);
    }

    const token = (source.episodes || {})[String(episode)];
    if (!token) {
      const eps = Object.keys(source.episodes || {});
      return json({
        error: `episode ${episode} not in source '${sourceCode}' (${eps.length} episodes: ${eps.sort().join(", ")})`,
      }, 404);
    }

    if (!source.parse_api) {
      return json({
        error: `source '${sourceCode}' has no parse_api configured`,
      }, 500);
    }

    // Check parse_api result cache.
    const cacheKey = `${source.parse_api}|${token}`;
    let result = cacheGet(cacheKey);

    if (!result) {
      const parseUrl = buildParseUrl(source.parse_api, token);
      const reqHeaders = { "User-Agent": "dart" };
      if (source.headers) {
        for (const [k, v] of Object.entries(source.headers)) {
          reqHeaders[k] = String(v);
        }
      }

      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const resp = await fetch(parseUrl, {
          method: "GET",
          headers: reqHeaders,
          signal: ctrl.signal,
        });
        const body = await resp.text();
        result = safeJsonParse(body);
        cacheSet(cacheKey, result);
      } finally {
        clearTimeout(t);
      }
    }

    if (!result.url) {
      return json({
        movie: movieId,
        source: sourceCode,
        episode,
        code: result.code,
        msg: result.msg,
        error: "upstream returned no url",
      }, 502);
    }

    if (wantRedirect) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: result.url,
          ...CORS,
        },
      });
    }

    return json({
      movie: movieId,
      source: sourceCode,
      source_name: source.name,
      episode,
      url: result.url,
      type: result.type,
      ...result,
    });
  } catch (e) {
    return json({ error: `upstream failed: ${e.message}` }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

// edge-functions/api/play.js — GET /api/play
// movie+source+episode → token → parse_api → fresh direct link → proxy or 302.
//
// Query params:
//   movie, source, episode (required)
//   raw=1       → 302 to original direct link (saves function traffic)
//   redirect=1  → alias for raw=1
//   refresh=1   → skip cache, force re-parse
//
// Default behavior:
//   • m3u8 → fetch & rewrite all segment URLs to go through /api/seg
//   • mp4/direct → 302 to /api/seg?url=<b64> (proxy with dart UA + Range)

import {
  getDb,
  getConfig,
  getMovie,
  buildParseUrl,
  safeJsonParse,
  parseCacheGet,
  parseCacheSet,
  decompressIfGzip,
  decodeUtf8,
  b64u,
} from "../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, Authorization",
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const movieId = url.searchParams.get("movie") || "";
  const sourceCode = url.searchParams.get("source") || "";
  const epStr = url.searchParams.get("episode") || "";
  const wantRaw = url.searchParams.get("raw") === "1";
  const wantRedirect = url.searchParams.get("redirect") === "1";
  const forceRefresh = url.searchParams.get("refresh") === "1";

  if (!movieId || !sourceCode || !epStr) {
    return json({ error: "missing movie/source/episode" }, 400);
  }

  const episode = parseInt(epStr, 10);
  if (isNaN(episode) || episode < 1) {
    return json({ error: "episode must be positive integer" }, 400);
  }

  try {
    const cfg = getConfig(env);
    const origin = new URL(request.url).origin;

    const movie = await getMovie(env, movieId);
    if (!movie) {
      return json({ error: `movie '${movieId}' not found` }, 404);
    }

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

    // Resolve token → direct link (with cache)
    const cacheKey = `${source.parse_api}|${token}`;
    let result = forceRefresh ? null : await parseCacheGet(env, cacheKey, cfg.cacheTtl);

    if (!result) {
      const parseUrl = buildParseUrl(source.parse_api, token);
      const reqHeaders = {
        "User-Agent": cfg.uaApp,
        "Accept-Encoding": "identity",
      };
      if (source.headers) {
        for (const [k, v] of Object.entries(source.headers)) {
          reqHeaders[k] = String(v);
        }
      }

      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), cfg.parseTimeout);
      try {
        const resp = await fetch(parseUrl, {
          method: "GET",
          headers: reqHeaders,
          signal: ctrl.signal,
        });
        const buf = new Uint8Array(await resp.arrayBuffer());
        const decoded = await decompressIfGzip(buf);
        const body = decodeUtf8(decoded);
        result = safeJsonParse(body);
      } finally {
        clearTimeout(t);
      }
      await parseCacheSet(env, cacheKey, result, cfg.cacheTtl);
    }

    if (!result.url) {
      return json(
        {
          movie: movieId,
          source: sourceCode,
          episode,
          code: result.code,
          msg: result.msg,
          error: "upstream returned no url",
        },
        502
      );
    }

    // Return mode selection
    if (wantRaw || wantRedirect) {
      return new Response(null, {
        status: 302,
        headers: { Location: result.url, ...CORS },
      });
    }

    // Default: proxy via /api/seg
    const typ = (result.type || "").toLowerCase();
    if (typ.includes("m3u8") || result.url.includes(".m3u8")) {
      // m3u8: fetch, rewrite segment URLs to go through /api/seg
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), cfg.streamTimeout);
      try {
        const resp = await fetch(result.url, {
          method: "GET",
          headers: {
            "User-Agent": cfg.uaPlayer,
            "Accept-Encoding": "identity",
          },
          signal: ctrl.signal,
        });
        const text = await resp.text();
        const base = resp.url;
        const lines = text.split(/\r?\n/);
        const segPrefix = `${origin}/api/seg?url=`;
        const out = lines.map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return line;
          const abs = new URL(trimmed, base).toString();
          return segPrefix + b64u(abs);
        });
        return new Response(out.join("\n") + "\n", {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
            ...CORS,
          },
        });
      } finally {
        clearTimeout(t);
      }
    }

    // mp4 / direct link: 302 to proxy
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${origin}/api/seg?url=${b64u(result.url)}`,
        ...CORS,
      },
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

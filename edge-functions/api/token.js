// edge-functions/api/token.js — GET /api/token (debug: return raw token)
import { getDb, getMovie } from "../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

  if (!movieId || !sourceCode || !epStr) {
    return json({ error: "missing movie/source/episode" }, 400);
  }

  const episode = parseInt(epStr, 10);
  if (isNaN(episode) || episode < 1) {
    return json({ error: "episode must be positive integer" }, 400);
  }

  try {
    const movie = await getMovie(env, movieId);
    if (!movie) return json({ error: `movie '${movieId}' not found` }, 404);

    const source = (movie.sources || {})[sourceCode];
    if (!source) {
      const available = Object.keys(movie.sources || {});
      return json(
        {
          error: `source '${sourceCode}' not found; available: ${available.join(", ")}`,
        },
        404
      );
    }

    const token = (source.episodes || {})[String(episode)];
    if (!token) {
      return json(
        { error: `episode ${episode} not in source '${sourceCode}'` },
        404
      );
    }

    return json({
      movie: movieId,
      source: sourceCode,
      source_name: source.name,
      episode,
      token,
      parse_api: source.parse_api,
      core_params: source.core_params,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
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

// edge-functions/api/add-movie.js — POST /api/add-movie
// Import a maomao.php detail dump into Turso (or in-memory overlay if Turso is down).
import { getDb, upsertMovie, buildMovieFromDetail } from "../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  try {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    // Support nested payloads: {data: {vod_info, ...}} or {vod_info, ...}
    let info = payload;
    if (payload && payload.data && payload.data.vod_info) info = payload.data;
    else if (payload && payload.vod_info) info = payload;

    const movie = buildMovieFromDetail(info);
    const overrideSlug = typeof payload._as === "string" ? payload._as : null;
    if (overrideSlug) movie.id = overrideSlug;

    const { persisted, note } = await upsertMovie(env, movie);
    return json(
      {
        success: true,
        persisted,
        note,
        movie: { id: movie.id, name: movie.name, vod_id: movie.vod_id },
      },
      201
    );
  } catch (e) {
    return json({ error: e.message }, 400);
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

// edge-functions/api/add-movie.js — POST /api/add-movie
// Import a maomao.php detail dump into Turso.
import {
  getDb,
  ensureSchema,
  upsertMovie,
  buildMovieFromDetail,
} from "../../../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const db = getDb(env);
    if (db.error) return json({ error: db.error }, 500);
    await ensureSchema(db);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    // Allow an optional `--as` style override via the body: { _as: "my-slug", ...detail }
    const overrideSlug = typeof payload._as === "string" ? payload._as : null;

    const movie = buildMovieFromDetail(payload);
    if (overrideSlug) movie.id = overrideSlug;
    await upsertMovie(db, movie);

    return json({ success: true, movie }, 201);
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

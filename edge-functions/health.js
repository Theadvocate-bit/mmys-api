// edge-functions/health.js — GET /health
import { getDb, ensureSchema, countMovies, cacheSize, VERSION } from "../../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

  try {
    const db = getDb(env);
    if (db.error) return json({ error: db.error }, 500);
    await ensureSchema(db);
    const movies = await countMovies(db);
    return json({
      status: "ok",
      version: VERSION,
      movies,
      cache_size: cacheSize(),
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

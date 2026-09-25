// edge-functions/health.js — GET /health
import { getDb, storeStatus, cacheSize, VERSION } from "./lib/db.js";

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

  try {
    const store = await storeStatus(env);
    return json({
      status: "ok",
      version: VERSION,
      movies: store.movies_in_db || 0,
      turso: store.turso,
      cache_size: cacheSize(),
      ...store,
    });
  } catch (e) {
    return json(
      { status: "error", version: VERSION, error: e.message },
      500
    );
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

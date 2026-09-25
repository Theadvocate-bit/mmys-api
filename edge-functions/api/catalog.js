// edge-functions/api/catalog.js — GET /api/catalog
import { getDb, ensureSchema, getAllMovies } from "../../../lib/db.js";

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

    const all = await getAllMovies(db);
    const movies = all.map((m) => ({
      id: m.id,
      vod_id: m.vod_id,
      name: m.name,
      type_id: m.type_id,
      vod_pic: m.vod_pic,
      vod_remarks: m.vod_remarks,
      sources: Object.entries(m.sources || {}).map(([code, s]) => ({
        code,
        name: s.name,
        episodes: Object.keys(s.episodes || {}).length,
      })),
    }));

    return json({ count: movies.length, movies });
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

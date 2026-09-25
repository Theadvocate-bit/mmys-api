// edge-functions/api/search.js — GET /api/search?q=keyword
import { getDb, getAllMovies } from "../../../lib/db.js";

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
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const all = await getAllMovies(env);
    const matches = all.filter((m) => {
      if (!q) return false;
      return (
        (m.name || "").toLowerCase().includes(q) ||
        (m.vod_remarks || "").toLowerCase().includes(q) ||
        (m.vod_class || "").toLowerCase().includes(q)
      );
    });
    return json({
      q,
      total: matches.length,
      data: matches.map((m) => ({
        id: m.id,
        vod_id: m.vod_id,
        name: m.name,
        vod_remarks: m.vod_remarks,
      })),
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

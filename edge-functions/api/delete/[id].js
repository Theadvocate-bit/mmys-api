// edge-functions/api/delete/[id].js — DELETE/POST /api/delete/:id
// Delete a movie from Turso (and in-memory overlay).
import { getDb, deleteMovie } from "../../../../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "DELETE" && request.method !== "POST") {
    return json({ error: "method not allowed (use DELETE or POST)" }, 405);
  }

  try {
    const persisted = await deleteMovie(env, id);
    return json({
      success: true,
      id,
      persisted,
      msg: persisted
        ? `deleted from Turso: ${id}`
        : `removed from runtime overlay: ${id} (Turso unavailable)`,
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

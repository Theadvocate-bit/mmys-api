// edge-functions/api/movie/[id].js — GET /api/movie/:id  +  DELETE /api/movie/:id
import { getDb, ensureSchema, getMovie, deleteMovie } from "../../../../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;

  if (request.method === "GET") {
    try {
      const db = getDb(env);
      if (db.error) return json({ error: db.error }, 500);
      await ensureSchema(db);

      const movie = await getMovie(db, id);
      if (!movie) return json({ error: `movie '${id}' not found` }, 404);
      return json({ movie });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (request.method === "DELETE") {
    try {
      const db = getDb(env);
      if (db.error) return json({ error: db.error }, 500);
      await ensureSchema(db);

      const ok = await deleteMovie(db, id);
      if (!ok) return json({ error: `movie '${id}' not found` }, 404);
      return json({ success: true, id });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: "method not allowed" }, 405);
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

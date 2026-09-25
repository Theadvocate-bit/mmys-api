// edge-functions/api/movie/[id].js — GET/DELETE /api/movie/:id
import { getDb, getMovie, deleteMovie } from "../../../../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === "GET") {
    try {
      const movie = await getMovie(env, id);
      if (!movie) return json({ error: `movie '${id}' not found` }, 404);

      // Build absolute play URLs
      const origin = new URL(request.url).origin;
      const data = {
        id: movie.id,
        vod_id: movie.vod_id,
        name: movie.name,
        vod_pic: movie.vod_pic,
        vod_remarks: movie.vod_remarks,
        vod_info: movie.vod_info,
        sources: Object.entries(movie.sources || {}).map(([code, s]) => {
          const eps = Object.entries(s.episodes || {}).map(([ep, _token]) => ({
            episode: parseInt(ep, 10),
            play_url: `${origin}/api/play?movie=${encodeURIComponent(id)}&source=${encodeURIComponent(code)}&episode=${ep}`,
          }));
          return { code, name: s.name, episodes: eps };
        }),
      };
      return json({ data });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (request.method === "DELETE") {
    try {
      const persisted = await deleteMovie(env, id);
      return json({ success: true, id, persisted });
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

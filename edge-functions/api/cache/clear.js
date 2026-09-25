// edge-functions/api/cache/clear.js — POST/GET /api/cache/clear
// Clear parse_api result cache (Turso + in-memory).
import { getDb, parseCacheClear } from "../../../../lib/db.js";

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
  if (request.method !== "POST" && request.method !== "GET") {
    return json({ error: "method not allowed (use POST or GET)" }, 405);
  }

  try {
    await parseCacheClear(env);
    return json({ success: true, msg: "parse cache cleared (Turso + in-memory)" });
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

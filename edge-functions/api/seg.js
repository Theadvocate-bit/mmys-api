// edge-functions/api/seg.js — GET /api/seg?url=<b64>
// Media proxy: fetch upstream with Range passthrough, force dart UA, stream back.
// Used by /api/play for mp4/direct links and m3u8 segment rewriting.

import { getConfig, b64uDec } from "../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, Authorization",
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const u = url.searchParams.get("url") || "";
  if (!u) return json({ error: "missing url param" }, 400);

  let target;
  try {
    target = b64uDec(u);
  } catch {
    return json({ error: "url param decode failed" }, 400);
  }
  if (!target.startsWith("http")) {
    return json({ error: "invalid url" }, 400);
  }

  const cfg = getConfig(env);
  const headers = {
    "User-Agent": cfg.uaPlayer,
    "Accept-Encoding": "identity",
  };
  const range = request.headers.get("Range");
  if (range) headers["Range"] = range;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.streamTimeout);
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      signal: ctrl.signal,
    });

    const respHeaders = {};
    for (const k of [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges",
      "Content-Disposition",
    ]) {
      const v = upstream.headers.get(k);
      if (v) respHeaders[k] = v;
    }
    respHeaders["Access-Control-Allow-Origin"] = "*";
    respHeaders["Cache-Control"] = "no-store";

    if (request.method === "HEAD") {
      return new Response(null, { status: upstream.status, headers: respHeaders });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (e) {
    return json({ error: `upstream failed: ${e.message}` }, 502);
  } finally {
    clearTimeout(t);
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

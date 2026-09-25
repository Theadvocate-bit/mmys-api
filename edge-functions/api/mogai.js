// edge-functions/api/mogai.js — GET /api/mogai
// 魔改 API (TVBox/Mogai) 格式 — 片库列表 / 详情 / 搜索
//
//   GET /api/mogai              → 片库列表
//   GET /api/mogai?ids=305048   → 单片详情
//   GET /api/mogai?wd=关键字     → 搜索

import { getDb, getAllMovies, getMovie } from "../../../lib/db.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function vodToMogai(vod, origin) {
  const sources = vod.sources || {};
  const sourceCodes = Object.keys(sources);

  // vod_play_from: source names separated by ###
  const playFrom = sourceCodes
    .map((code) => sources[code].name || code)
    .join("###");

  // vod_play_url: source playlists separated by ###
  //   each playlist: episodes separated by $$$
  //   each episode:  name$url
  const playUrls = sourceCodes.map((code) => {
    const s = sources[code];
    const episodes = s.episodes || {};
    const epKeys = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
    return epKeys
      .map((ep) => `第${pad2(ep)}集${origin}/api/play?movie=${encodeURIComponent(vod.id)}&source=${encodeURIComponent(code)}&episode=${ep}`)
      .join("$$$");
  });
  const playUrl = playUrls.join("###");

  const vodInfo = vod.vod_info || {};

  return {
    vod_id: vod.vod_id,
    vod_name: vod.name || "",
    vod_pic: vod.vod_pic || "",
    type: String(vod.type_id || vod.vod_class || ""),
    remarks: vod.vod_remarks || "",
    vod_remarks: vod.vod_remarks || "",
    vod_class: vod.vod_class || "",
    vod_actor: vodInfo.vod_actor || "",
    vod_director: vodInfo.vod_director || "",
    vod_content: vodInfo.vod_content || "",
    vod_play_from: playFrom,
    vod_play_url: playUrl,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET") {
    return json({ code: -1, msg: "method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  const wd = (url.searchParams.get("wd") || "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));

  try {
    let all = await getAllMovies(env);

    // Search filter
    if (wd) {
      const q = wd.toLowerCase();
      all = all.filter(
        (m) =>
          (m.name || "").toLowerCase().includes(q) ||
          (m.vod_remarks || "").toLowerCase().includes(q) ||
          (m.vod_class || "").toLowerCase().includes(q)
      );
    }

    // Detail mode: ?ids=305048
    if (idsParam) {
      const id = String(idsParam);
      const vod = await getMovie(env, id.startsWith("vod-") ? id : `vod-${id}`);
      if (!vod) return json({ code: -1, msg: "not found" }, 404);
      const origin = new URL(request.url).origin;
      return json({
        code: 1,
        msg: "success",
        data: vodToMogai(vod, origin),
      });
    }

    // List mode
    const total = all.length;
    const start = (page - 1) * limit;
    const paged = all.slice(start, start + limit);
    const pagecount = Math.ceil(total / limit);
    const origin = new URL(request.url).origin;
    const list = paged.map((m) => vodToMogai(m, origin));

    return json({
      code: 1,
      msg: "success",
      page,
      pagecount,
      limit,
      total,
      list,
    });
  } catch (e) {
    return json({ code: -1, msg: e.message }, 500);
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

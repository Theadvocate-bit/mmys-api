// edge-functions/api/appcms.js — GET /api/appcms
// 苹果 CMS V10 API 格式 — 完全兼容标准资源搜索 API
//
// 用法:
//   GET /api/appcms                    → 片库列表（分页）
//   GET /api/appcms?ids=305048         → 单片详情
//   GET /api/appcms?wd=关键字          → 搜索
//   GET /api/appcms?class_id=1         → 按分类筛选
//   GET /api/appcms?categories=1       → 分类列表
//   GET /api/appcms?page=1&limit=20    → 分页参数
//
// 格式说明:
//   vod_play_from: 源名称用 ### 分隔
//   vod_play_url:  源用 ### 分隔，源内集用 $$$ 分隔，每集格式 名称$URL

import { getDb, getAllMovies, getMovie } from "../lib/db.js";
import {
  vodToAppCms,
  filterByClass,
  getAllCategories,
} from "../lib/appcms_format.js";

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
    return json({ code: -1, msg: "method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  const wd = (url.searchParams.get("wd") || "").trim();
  const classId = url.searchParams.get("class_id") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
  const showCats = url.searchParams.get("categories") === "1";

  try {
    let all = await getAllMovies(env);
    const origin = new URL(request.url).origin;

    // 分类列表模式
    if (showCats) {
      const categories = getAllCategories(all);
      return json({
        code: 1,
        msg: "success",
        categories,
      });
    }

    // 搜索过滤
    if (wd) {
      const q = wd.toLowerCase();
      all = all.filter(
        (m) =>
          (m.name || "").toLowerCase().includes(q) ||
          (m.vod_remarks || "").toLowerCase().includes(q) ||
          (m.vod_class || "").toLowerCase().includes(q)
      );
    }

    // 分类过滤
    if (classId) {
      all = filterByClass(all, classId);
    }

    // 详情模式: ?ids=305048
    if (idsParam) {
      const id = String(idsParam);
      const vod = await getMovie(env, id.startsWith("vod-") ? id : `vod-${id}`);
      if (!vod) return json({ code: -1, msg: "not found" }, 404);
      return json({
        code: 1,
        msg: "success",
        data: vodToAppCms(vod, origin),
      });
    }

    // 列表模式
    const total = all.length;
    const start = (page - 1) * limit;
    const paged = all.slice(start, start + limit);
    const pagecount = Math.ceil(total / limit) || 1;
    const list = paged.map((m) => vodToAppCms(m, origin));

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

// edge-functions/api/appcms.js — GET /api/appcms
// 苹果 CMS V10 API 格式，严格对齐 /api.php/provide/vod 规范
// （参考：hongniuzy2 / bfzy / dyttzy 三家标准源）
//
// 用法:
//   GET /api/appcms                    → 精简列表（8 字段/项）
//   GET /api/appcms?page=2&limit=20    → 分页
//   GET /api/appcms?wd=关键字          → 按名称/简介/分类搜索
//   GET /api/appcms?class_id=1         → 按分类过滤（也接受 type_id=1）
//   GET /api/appcms?ids=305048         → 按 id 查（默认返回精简列表）
//   GET /api/appcms?ac=detail&ids=...  → 详情模式（83 字段/项）
//   GET /api/appcms?text=xxx           → wd 的别名
//
// 响应格式：
//   { code, msg, page, pagecount, limit, total, list, class }
//   • class: [{type_id, type_name}, ...] 始终附带
//   • list 项：默认 8 字段；?ac=detail 时为完整 83 字段
//   • vod_play_from 分隔：list 用 ','；detail 用 '$$$'
//   • vod_play_url  分隔：源间 '$$$'，源内集 '#', 每集 'name$url'

import { getDb, getAllMovies, getMovie } from "../lib/db.js";
import {
  vodToListItem,
  vodToDetail,
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
  const q = url.searchParams;

  // 参数解析（同时支持多别名）
  const idsParam = (q.get("ids") || "").trim();
  const wd = (q.get("wd") || q.get("text") || "").trim();
  // class_id 优先，type_id 兼容
  const classId = (q.get("class_id") || q.get("type_id") || "").trim();
  const page = Math.max(1, parseInt(q.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(q.get("limit") || "20", 10)));
  const ac = (q.get("ac") || "").toLowerCase();
  const wantDetail = ac === "detail";

  try {
    const all = await getAllMovies(env);
    const origin = new URL(request.url).origin;
    const classList = getAllCategories(all);

    // 搜索过滤
    let filtered = all;
    if (wd) {
      const terms = wd.toLowerCase();
      filtered = filtered.filter((m) => {
        const hay = [
          m.name,
          m.vod_remarks,
          m.vod_class,
          m.vod_content,
          m.vod_actor,
          m.vod_director,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(terms);
      });
    }

    // 分类过滤
    if (classId) {
      filtered = filterByClass(filtered, classId);
    }

    // ids 过滤（可与 ac=detail 组合）
    if (idsParam) {
      const wanted = idsParam
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      filtered = filtered.filter((m) => {
        const key = String(m.vod_id);
        return wanted.includes(key) || wanted.includes(m.id);
      });
    }

    // 分页
    const total = filtered.length;
    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);
    const pagecount = Math.ceil(total / limit) || 1;

    // 序列化：详情或精简
    const list = wantDetail
      ? paged.map((m) => vodToDetail(m, origin))
      : paged.map(vodToListItem);

    return json({
      code: 1,
      msg: wantDetail ? "数据详情" : "数据列表",
      page,
      pagecount,
      limit,
      total,
      list,
      class: classList,
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

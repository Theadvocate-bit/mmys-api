// edge-functions/api/appcms.js — GET /api/appcms
// 苹果 CMS V10 API 格式，严格对齐 mmys.app 官方客户端规范
// （抓包来源：cos.hxx2023.cc/maomao.php/v7/logs → "导航列表" / "搜索" 响应）
//
// 用法:
//   GET /api/appcms                    → 精简列表（8 字段/项）
//   GET /api/appcms?page=2&limit=20    → 分页
//   GET /api/appcms?wd=关键字          → 按名称/演员/地区搜索（不含 vod_content 长文本）
//   GET /api/appcms?wd=19067           → 按 vod_id 精确查
//   GET /api/appcms?class_id=1         → 按分类过滤（也接受 type_id=1）
//   GET /api/appcms?ids=305048         → 按 id 查（默认返回精简列表）
//   GET /api/appcms?ac=detail&ids=...  → 详情模式（83 字段/项）
//   GET /api/appcms?text=xxx           → wd 的别名
//
// 在线数据源（减少 Turso 依赖）：
//   订阅系统：base58 编码的 JSON 配置，包含 18 个苹果 CMS V10 采集源
//   默认订阅：https://text.nalinali.qzz.io/api/get?key=moontvsub
//   默认源：mmys（猫猫影视，mmys.app 兼容 8 类导航）
//
// 环境变量：
//   MYS_SUBSCRIPTION_URL  订阅链接（默认 https://text.nalinali.qzz.io/api/get?key=moontvsub）
//   MYS_DEFAULT_SOURCE    默认采集源 key（默认 mmys）
//   MYS_SEARCH_UPSTREAM   直接指定上游 URL（覆盖订阅配置）
//
// 行为：
//   获取上游 URL → 透传全部请求 → 失败/空结果回落本地
//   播放链接差异：上游详情返回上游自己的 vod_play_url（需二次解析）
//   type_id 差异：上游返回上游自己的编号，class 数组保持 mmys.app 8 类
//
// 搜索字段（本地兜底策略，名称优先）：
//   主：vod_name（名称）/ vod_en（拼音）
//   辅：vod_id / vod_remarks / vod_class / vod_actor / vod_director /
//       vod_area / vod_lang
//   排除 vod_content（长文本，单字/短词会误伤）
//
// 响应格式：
//   { code, msg, page, pagecount, limit, total, list, class }
//   • class: [{type_id, type_pid, type_name}, ...] 全量 8 类顶级导航
//     （1 电影 / 2 剧集 / 3 综艺 / 4 动漫 / 58 直播 / 62 少儿 / 63 短剧 / 64 漫剧）
//     全部 type_pid=0（mmys.app 单级导航）
//   • list 项：默认 8 字段；?ac=detail 时为完整 83 字段
//   • 详情字段 type_id_1 = 顶级 id（= type_id，mmys.app 无二级分类编号）
//   • vod_play_from 分隔：list 用 ','；detail 用 '$$$'
//   • vod_play_url  分隔：源间 '$$$'，源内集 '#', 每集 'name$url'
//   • vod_play_server 每源占位 "no"（与 mmys.app 一致）

import { getDb, getConfig, getAllMovies, getMovie, getUpstreamUrl } from "../lib/db.js";
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

// ---------------------------------------------------------------------------
// 在线上游搜索（wd 有值且配置了 MYS_SEARCH_UPSTREAM 时优先透传）
// ---------------------------------------------------------------------------
// 返回 { ok, data, source }：
//   ok=false  → 上游不可用，调用方回落到本地搜索
//   ok=true   → data 为上游 { code, msg, list, pagecount, total }，source 记录上游 URL
//
// 苹果 CMS V10 采集源规范：GET <upstream>?wd=xxx&page=N&limit=N 返回
//   { code: 1, msg, page, pagecount, limit, total, list: [...], class: [...] }
// list 项字段集与本项目列表项一致（8 字段精简格式），可直接透传。
async function fetchFromUpstream(env, upstreamUrl, params, timeoutMs = 8000) {
  if (!upstreamUrl) return { ok: false };
  try {
    const u = new URL(upstreamUrl);
    // 透传关键参数（wd / page / limit / class_id / ids / ac）
    for (const k of ["wd", "page", "limit", "class_id", "type_id", "ids", "ac", "text"]) {
      const v = params.get(k);
      if (v !== null) u.searchParams.set(k, v);
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(u.toString(), {
      method: "GET",
      signal: ctrl.signal,
      headers: { "User-Agent": "mmys-api/0.4", "Accept": "application/json" },
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false };
    const j = await res.json();
    if (!j || !Array.isArray(j.list)) return { ok: false };
    if (j.list.length === 0) return { ok: false }; // 空结果也回落本地
    return {
      ok: true,
      data: {
        code: 1,
        msg: "数据列表",
        page: j.page || 1,
        pagecount: j.pagecount || 1,
        limit: j.limit || params.get("limit") || "20",
        total: j.total || j.list.length,
        list: j.list,
        upstream: u.toString(),
      },
    };
  } catch {
    return { ok: false };
  }
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
    const origin = new URL(request.url).origin;

    // ---- 在线数据源优先：获取上游 URL（订阅配置或环境变量）----
    // 透传 wd / ac / ids / class_id / page / limit 等所有参数。
    // 上游失败/空结果 → 静默回落本地。
    {
      const upstreamUrl = await getUpstreamUrl(env);
      if (upstreamUrl) {
        const up = await fetchFromUpstream(env, upstreamUrl, q);
        if (up.ok) {
          // class 数组保持本项目的 mmys.app 8 类导航（不采用上游的 31 类）
          const all = await getAllMovies(env);
          const classList = getAllCategories(all);
          return json({
            code: 1,
            msg: wantDetail ? "数据详情" : "数据列表",
            page: up.data.page,
            pagecount: up.data.pagecount,
            limit: Number(up.data.limit) || limit,
            total: up.data.total,
            list: up.data.list,
            class: classList,
            upstream: up.data.upstream,
          });
        }
        // 上游失败/空结果 → 继续走本地
      }
    }

    const all = await getAllMovies(env);
    const classList = getAllCategories(all);

    let filtered = all;
    // 搜索过滤（名称优先，对齐 mmys.app 官方 "搜索" 响应行为）
    //   • 主字段：vod_name（名称匹配，主要意图）
    //   • 次字段：vod_id / vod_en / vod_remarks / vod_class / vod_actor /
    //            vod_director / vod_area / vod_lang
    //   • 排除 vod_content（长文本会导致单字/短词误伤，如 wd=爱 匹配到含"爱人如潮水"的简介）
    if (wd) {
      const terms = wd.toLowerCase();
      filtered = filtered.filter((m) => {
        // 主字段：名称（含 vod_en 拼音别名）
        const name = (m.name || "").toLowerCase();
        const en = (m.vod_en || "").toLowerCase();
        if (name.includes(terms) || en.includes(terms)) return true;
        // vod_id 精确匹配（"19067" 或 "vod-19067"）
        if (String(m.vod_id) === wd || String(m.id) === wd) return true;
        // 次字段：片名以外的元信息（不含 vod_content 长文本）
        const hay = [
          m.vod_remarks,
          m.vod_class,
          m.vod_actor,
          m.vod_director,
          m.vod_area,
          m.vod_lang,
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

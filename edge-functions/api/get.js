// edge-functions/api/get.js — GET /api/get?key=xxx
// TVBox 配置端点 — 返回 base58 编码的 TVBox 资源站配置。
//
// 用法:
//   在 TVBox 中填入: https://<域名>/api/get?key=xxx
//   TVBox 会自动读取 base58 解码后的 JSON 配置
//
// 环境变量:
//   MYS_API_KEY  — 访问密钥（默认 "mmysapi"）
//   MYS_CACHE_TIME — 缓存时间（秒，默认 7200）
//   MYS_API_NAME  — 资源站名称（默认 "mmys_api 资源"）

import { getDb, getAllMovies } from "../lib/db.js";
import { b58Encode } from "../lib/base58.js";

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
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const expectedKey = env.MYS_API_KEY || "mmysapi";

  if (key !== expectedKey) {
    return new Response("invalid key", {
      status: 403,
      headers: { ...CORS, "Content-Type": "text/plain" },
    });
  }

  const origin = new URL(request.url).origin;
  const cacheTime = parseInt(env.MYS_CACHE_TIME || "7200", 10);
  const apiName = env.MYS_API_NAME || "mmys_api 资源";

  // Build TVBox config
  const config = {
    cache_time: cacheTime,
    api_site: {
      mmys: {
        name: apiName,
        api: `${origin}/api/mogai`,
        detail: `${origin}/api/mogai`,
      },
    },
  };

  // Base58 encode the JSON
  const jsonString = JSON.stringify(config);
  const encoded = b58Encode(jsonString);

  return new Response(encoded, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

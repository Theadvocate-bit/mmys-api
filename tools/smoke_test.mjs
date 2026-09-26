#!/usr/bin/env node
// tools/smoke_test.mjs — Smoke tests for the JS EdgeOne deployment.
//
// Tests lib/db.js functions in isolation (no real Turso needed).
// Run: node tools/smoke_test.mjs

import {
  VERSION,
  getDb,
  getConfig,
  buildMovieFromDetail,
  buildParseUrl,
  safeJsonParse,
  b64u,
  b64uDec,
  decompressIfGzip,
  decodeUtf8,
} from "../edge-functions/lib/db.js";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

console.log(`\n=== mmys_api smoke tests (v${VERSION}) ===\n`);

// --- getDb ---
console.log("getDb:");
assert(getDb({}).error, "missing env vars returns error");
assert(getDb({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "tok" }).url, "valid env vars");
assert(!getDb({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "tok" }).error, "no error with valid vars");

// URL prefix auto-conversion
let db = getDb({ TURSO_DATABASE_URL: "libsql://x.turso.io", TURSO_AUTH_TOKEN: "tok" });
assertEq(db.url, "https://x.turso.io", "libsql:// prefix converted to https://");
db = getDb({ TURSO_DATABASE_URL: "turso://x.turso.io", TURSO_AUTH_TOKEN: "tok" });
assertEq(db.url, "https://x.turso.io", "turso:// prefix converted to https://");
db = getDb({ TURSO_DATABASE_URL: "https://x.turso.io/", TURSO_AUTH_TOKEN: "tok" });
assertEq(db.url, "https://x.turso.io", "trailing slash stripped");

// Legacy env var names are no longer accepted
db = getDb({ URL: "https://x.turso.io", TOKEN: "tok" });
assert(db.error, "unknown env var names rejected");

// --- getConfig ---
console.log("getConfig:");
let cfg = getConfig({});
assertEq(cfg.parseTimeout, 20000, "default parse timeout");
assertEq(cfg.cacheTtl, 1800, "default cache TTL");
assertEq(cfg.uaPlayer, "dart", "default player UA");
cfg = getConfig({ MYS_CACHE_TTL: "3600", MYS_UA_PLAYER: "custom" });
assertEq(cfg.cacheTtl, 3600, "custom cache TTL");
assertEq(cfg.uaPlayer, "custom", "custom player UA");

// --- buildParseUrl ---
console.log("buildParseUrl:");
assertEq(
  buildParseUrl("http://x/api?url=", "abc"),
  "http://x/api?url=abc",
  "ends with url="
);
assertEq(
  buildParseUrl("http://x/api?foo=bar", "abc"),
  "http://x/api?foo=bar&url=abc",
  "has ? already"
);
assertEq(
  buildParseUrl("http://x/api", "abc"),
  "http://x/api?url=abc",
  "no query"
);
assertEq(
  buildParseUrl("http://x/api?url=", "a b"),
  "http://x/api?url=a%20b",
  "URL-encodes token"
);

// --- safeJsonParse ---
console.log("safeJsonParse:");
assertEq(safeJsonParse('{"code":200,"url":"http://x"}'), { code: 200, url: "http://x" }, "valid JSON");
assert(safeJsonParse("not json").code === -1, "invalid JSON returns code -1");
assert(safeJsonParse("check http://foo.com/bar").url === "http://foo.com/bar", "extracts URL from text");

// --- b64u / b64uDec ---
console.log("b64u/b64uDec:");
assertEq(b64u("hello"), "aGVsbG8", "base64u encode");
assertEq(b64uDec("aGVsbG8"), "hello", "base64u decode roundtrip");
assertEq(b64uDec(b64u("http://example.com/path?q=1&r=2")), "http://example.com/path?q=1&r=2", "URL roundtrip");
assertEq(b64u("test+data/special=chars"), b64u("test+data/special=chars"), "handles special chars");
assertEq(b64uDec(b64u("中文测试")), "中文测试", "handles UTF-8");

// --- decompressIfGzip ---
console.log("decompressIfGzip:");
// Non-gzip data passes through unchanged
const plainText = "hello world";
const plainBuf = new TextEncoder().encode(plainText);
const result = await decompressIfGzip(plainBuf);
assertEq(decodeUtf8(result), plainText, "non-gzip data passes through");

// --- buildMovieFromDetail ---
console.log("buildMovieFromDetail:");
const detail = {
  vod_id: 12345,
  vod_name: "Test Movie",
  vod_info: { vod_id: 12345, vod_name: "Test Movie", vod_pic: "http://pic.jpg" },
  vod_url_with_player: [
    {
      code: "source1",
      name: "Source 1",
      parse_api: "http://api.example.com/parse?url=",
      headers: "User-Agent: dart",
      url: "第01集$token1#第02集$token2#第03集$token3",
    },
  ],
};
const movie = buildMovieFromDetail(detail);
assertEq(movie.id, "vod-12345", "movie id from vod_id");
assertEq(movie.vod_id, 12345, "vod_id preserved");
assertEq(movie.name, "Test Movie", "name from vod_info");
assertEq(movie.vod_pic, "http://pic.jpg", "vod_pic from vod_info");
assert(Object.keys(movie.sources).length === 1, "one source");
assertEq(Object.keys(movie.sources.source1.episodes).length, 3, "3 episodes");
assert(movie.sources.source1.episodes["1"] === "token1", "episode 1 token");
assert(movie.sources.source1.episodes["2"] === "token2", "episode 2 token");
assert(movie.sources.source1.headers["User-Agent"] === "dart", "headers parsed");
assert(movie.imported_at, "imported_at set");

// Nested payload format
const nested = { data: detail };
const movie2 = buildMovieFromDetail(nested);
assertEq(movie2.id, "vod-12345", "nested payload works");

// String vod_url_with_player
const strPayload = { ...detail, vod_url_with_player: JSON.stringify(detail.vod_url_with_player) };
const movie3 = buildMovieFromDetail(strPayload);
assert(Object.keys(movie3.sources).length === 1, "string vod_url_with_player parsed");

// Missing vod_info
let threw = false;
try { buildMovieFromDetail({}); } catch { threw = true; }
assert(threw, "missing vod_info throws");

// New HAR format: vod_url_with_player nested inside vod_info (2026-09-26 HAR)
const nestedSources = {
  data: {
    vod_id: 19067,
    vod_info: {
      vod_id: 19067,
      vod_name: "师兄太稳健",
      vod_pic: "http://pic.jpg",
      vod_remarks: "30集全",
      vod_class: "奇幻,古装,电视,连续",
      vod_url_with_player: [
        {
          code: "BBA",
          name: "自建1",
          parse_api: "http://202.189.6.83:12991/xx/bt.php?url=",
          url: "第01集$TOKEN1#第02集$TOKEN2",
        },
        {
          code: "youku",
          name: "纯享3",
          parse_api: "http://202.189.6.83:12991/xx/gf2.php?url=",
          url: "1$https://v.youku.com/x.html#2$https://v.youku.com/y.html",
        },
        {
          code: "qsvip",
          name: "自建4",
          parse_api: "http://202.189.6.83:12991/xx/xd.php?url=",
          url: "01$QSVIP1#02$QSVIP2",
        },
      ],
    },
  },
};
const movieN = buildMovieFromDetail(nestedSources);
assertEq(movieN.id, "vod-19067", "nested source format: id");
assertEq(movieN.name, "师兄太稳健", "nested source format: name");
assertEq(Object.keys(movieN.sources).length, 3, "nested source format: 3 sources");
assert(movieN.sources.BBA.episodes["1"] === "TOKEN1", "BBA nested parse");
assert(movieN.sources.youku.episodes["1"] === "https://v.youku.com/x.html", "youku nested parse");
// episode_names preserves source-native labels
assertEq(movieN.sources.BBA.episode_names["1"], "第01集", "BBA episode name kept");
assertEq(movieN.sources.youku.episode_names["1"], "1", "youku bare number kept");
assertEq(movieN.sources.qsvip.episode_names["1"], "01", "qsvip zero-padded kept");

// --- Embedded catalog ---
// --- Import embedded catalog ---
console.log("EMBEDDED_CATALOG:");
const { EMBEDDED_CATALOG } = await import("../edge-functions/lib/catalog_data.js");
assert(Object.keys(EMBEDDED_CATALOG.vods).length >= 2, "embedded catalog has vods");
assert(EMBEDDED_CATALOG.vods["305048"], "vod 305048 present");
assert(EMBEDDED_CATALOG.vods["308179"], "vod 308179 present");
assert(EMBEDDED_CATALOG.vods["19067"], "vod 19067 present (new HAR)");
assert(EMBEDDED_CATALOG.vods["305048"].id === "vod-305048", "id format vod-${vod_id}");
assert(Object.keys(EMBEDDED_CATALOG.vods["305048"].sources).length >= 4, "305048 has sources");
assert(Object.keys(EMBEDDED_CATALOG.vods["19067"].sources).length === 10, "19067 has 10 sources");
assert(EMBEDDED_CATALOG.vods["19067"].sources.youku, "19067 youku source (new)");
assert(EMBEDDED_CATALOG.vods["19067"].sources.qiyi, "19067 qiyi source (new)");
assert(EMBEDDED_CATALOG.vods["19067"].sources.qingshan, "19067 qingshan source (new)");
assert(EMBEDDED_CATALOG.vods["19067"].sources.BBA.episode_names["1"] === "第01集", "19067 BBA episode name preserved");

// --- AppCMS V10 Format (standard /api.php/provide/vod spec) ---
console.log("AppCMS V10 Format:");
const {
  vodToListItem,
  vodToDetail,
  filterByClass,
  getAllCategories,
} = await import("../edge-functions/lib/appcms_format.js");

const testVod = {
  id: "vod-12345",
  vod_id: "12345",
  name: "Test Movie",
  vod_pic: "http://pic.jpg",
  vod_remarks: "更新至第10集",
  vod_class: "剧情,动作,冒险",
  vod_content: "This is a test movie description.",
  vod_actor: "Actor A, Actor B",
  vod_director: "Director X",
  vod_area: "中国",
  vod_year: "2024",
  vod_info: {
    vod_name: "Test Movie",
    vod_pic: "http://pic.jpg",
    vod_remarks: "更新至第10集",
    vod_class: "剧情,动作,冒险",
    vod_content: "This is a test movie description.",
    vod_actor: "Actor A, Actor B",
    vod_director: "Director X",
    vod_area: "中国",
    vod_year: "2024",
    vod_score: "8.5",
  },
  sources: {
    source1: {
      name: "Source 1",
      parse_api: "http://api/test?url=",
      episodes: { "1": "token1", "2": "token2", "3": "token3" },
      episode_names: { "1": "第01集", "2": "第02集", "3": "第03集" },
    },
    source2: {
      name: "Source 2",
      parse_api: "http://api/test2?url=",
      episodes: { "1": "token4" },
      episode_names: { "1": "1" },
    },
  },
};

const origin = "https://test.example.com";

// --- vodToListItem: 精简 8 字段（列表默认） ---
const listItem = vodToListItem(testVod);
assertEq(listItem.vod_id, 12345, "list vod_id numeric");
assertEq(listItem.vod_name, "Test Movie", "list vod_name");
assert(typeof listItem.type_id === "number", "list type_id numeric");
assertEq(listItem.type_name, "剧情", "list type_name from vod_class[0]");
assertEq(listItem.vod_time, "", "list vod_time empty when absent");
assertEq(listItem.vod_remarks, "更新至第10集", "list vod_remarks");
// vod_play_from: 逗号分隔（列表格式）
assertEq(listItem.vod_play_from, "source1,source2", "list vod_play_from comma-separated");
assertEq(Object.keys(listItem).length, 8, "list item exactly 8 fields");

// --- vodToDetail: 83 字段 ---
const cmsResult = vodToDetail(testVod, origin);
assertEq(cmsResult.vod_id, 12345, "detail vod_id numeric");
assertEq(cmsResult.vod_name, "Test Movie", "detail vod_name");
assertEq(cmsResult.vod_pic, "http://pic.jpg", "detail vod_pic");
assertEq(cmsResult.vod_remarks, "更新至第10集", "detail vod_remarks");
assertEq(cmsResult.vod_class, "剧情,动作,冒险", "detail vod_class");
assertEq(cmsResult.vod_content, "This is a test movie description.", "detail vod_content");
assertEq(cmsResult.vod_actor, "Actor A, Actor B", "detail vod_actor");
assertEq(cmsResult.vod_director, "Director X", "detail vod_director");
assertEq(cmsResult.vod_area, "中国", "detail vod_area");
assertEq(cmsResult.vod_year, "2024", "detail vod_year");
assertEq(cmsResult.vod_score, "8.5", "detail vod_score");

// vod_play_from: $$$ 分隔（详情格式）
assertEq(cmsResult.vod_play_from, "source1$$$source2", "detail vod_play_from $$$-separated");

// vod_play_url: 源 $$$，集 #，集名$url
assert(cmsResult.vod_play_url.includes("$$$"), "detail vod_play_url has source sep $$$");
assert(cmsResult.vod_play_url.includes("#"), "detail vod_play_url has episode sep #");
assert(!cmsResult.vod_play_url.includes("###"), "detail vod_play_url no legacy ###");
assert(cmsResult.vod_play_url.includes("第01集$"), "detail vod_play_url uses source-native ep name");
assert(cmsResult.vod_play_url.includes("/api/play?"), "detail vod_play_url points to play API");
assert(cmsResult.vod_play_url.includes("movie=vod-12345"), "detail vod_play_url carries vod id");
// Episode name preserved from source
assert(cmsResult.vod_play_url.includes("1$"), "detail vod_play_url preserves bare '1' name (source2)");

// Type-name derivation
assertEq(cmsResult.type_name, "剧情", "detail type_name from vod_class[0]");

// --- filterByClass: 按 type_id 过滤（多 id 用逗号） ---
const testMovies = [
  { id: "vod-1", name: "A", type_id: "1" },
  { id: "vod-2", name: "B", type_id: "2" },
  { id: "vod-3", name: "C", type_id: "1" },
  { id: "vod-4", name: "D", type_id: "3" },
];
assertEq(filterByClass(testMovies, "1").length, 2, "filterByClass single id");
assertEq(filterByClass(testMovies, "1,2").length, 3, "filterByClass multi id");
assertEq(filterByClass(testMovies, "99").length, 0, "filterByClass no match");
assertEq(filterByClass(testMovies, "").length, 4, "filterByClass empty filter = all");

// --- getAllCategories ---
const cats = getAllCategories(testMovies);
assert(cats.length === 8, "getAllCategories returns all 8 mmys.app top-level categories");
assert(cats[0].type_id, "category has type_id");
assert(typeof cats[0].type_name === "string", "category has type_name");
assert(typeof cats[0].type_pid === "number", "category has type_pid");
// mmys.app 单级导航：全部 type_pid=0
const topLevels = cats.filter((c) => c.type_pid === 0);
assertEq(topLevels.length, 8, "all 8 categories are top-level (mmys.app single-tier nav)");
assertEq(topLevels[0].type_name, "电影", "top-level 1 = 电影 (mmys.app naming)");
// mmys.app 8 类完整清单
const expectedTypes = [
  [1, "电影"], [2, "剧集"], [3, "综艺"], [4, "动漫"],
  [58, "直播"], [62, "少儿"], [63, "短剧"], [64, "漫剧"],
];
for (const [id, name] of expectedTypes) {
  const c = cats.find((x) => x.type_id === id);
  assert(c, `category ${id} present`);
  if (c) assertEq(c.type_name, name, `category ${id} = ${name}`);
}
// sorted by type_id
for (let i = 1; i < cats.length; i++) {
  assert(Number(cats[i].type_id) >= Number(cats[i - 1].type_id), "categories sorted");
}

// Test with real embedded catalog data
console.log("AppCMS with real catalog:");
const realVod = EMBEDDED_CATALOG.vods["305048"];
const realListItem = vodToListItem(realVod);
assert(realListItem.vod_id === 305048, "real vod_id numeric (305048)");
assert(realListItem.vod_name === "为爱正名", "real vod_name correct");
assert(realListItem.vod_play_from.includes(","), "real list uses comma separator");
assert(!realListItem.vod_play_from.includes("$$$"), "real list does not use $$$ in play_from");

// Detail view of 305048
const realCms = vodToDetail(realVod, origin);
const sourceCount = Object.keys(realVod.sources).length;
assert(realCms.vod_id === 305048, "real detail vod_id numeric");
assert(realCms.vod_play_from.includes("$$$"), "real detail uses $$$ separator");
assert(!realCms.vod_play_from.includes("###"), "real detail has no legacy ### in play_from");
assert(realCms.vod_play_url.includes("$$$"), "real detail vod_play_url has $$$ source sep");
assert(!realCms.vod_play_url.includes("###"), "real detail vod_play_url no legacy ###");

// --- mmys.app 官方分类规范对齐验证 ---
// 三部片在 mmys.app 官方抓包中均为剧集（type_id=2）
assertEq(realListItem.type_id, 2, "real list type_id = 2 (剧集 mmys.app)");
assertEq(realListItem.type_name, "剧集", "real list type_name = 剧集 (mmys.app)");
assertEq(realCms.type_id, 2, "real detail type_id = 2");
assertEq(realCms.type_id_1, 2, "real detail type_id_1 = 2 (mmys.app single-tier)");
assertEq(realCms.type_name, "剧集", "real detail type_name = 剧集");
// 三部片一致
for (const vid of ["305048", "308179", "19067"]) {
  const v = EMBEDDED_CATALOG.vods[vid];
  assertEq(Number(v.type_id), 2, `${vid} type_id = 2 (剧集)`);
  const det = vodToDetail(v, origin);
  assertEq(det.type_id_1, 2, `${vid} type_id_1 = 2 (mmys.app single-tier)`);
}
// vod_play_server 每源 "no"（对齐 mmys.app）
const serverParts = realCms.vod_play_server.split("$$$");
assertEq(serverParts.length, sourceCount, "vod_play_server has one entry per source");
assert(serverParts.every((p) => p === "no"), "vod_play_server all 'no' (mmys.app convention)");

// Test source count matches (all three views)
const playFromListCount = realListItem.vod_play_from.split(",").length;
assertEq(sourceCount, playFromListCount, "list play_from count matches");
const playFromDetailCount = realCms.vod_play_from.split("$$$").length;
assertEq(sourceCount, playFromDetailCount, "detail play_from count matches");
const playUrlSources = realCms.vod_play_url.split("$$$").length;
assertEq(sourceCount, playUrlSources, "detail play_url source count matches");

// Episode names are preserved from source (第01集, 1, 01) when available
const vod19067 = EMBEDDED_CATALOG.vods["19067"];
const list19067 = vodToListItem(vod19067);
const cms19067 = vodToDetail(vod19067, origin);
assert(cms19067.vod_play_url.includes("第01集$"), "19067 BBA emits source-native 第01集");
assert(list19067.vod_play_from.split(",").length === 10, "19067 has 10 sources in list play_from");
assert(cms19067.vod_play_from.split("$$$").length === 10, "19067 has 10 sources in detail play_from");
// Check that youku bare-number name survives to output (youku is 3rd source)
const youkuSlice = cms19067.vod_play_url.split("$$$")[2];
assert(/^1\$/.test(youkuSlice), "19067 youku uses bare '1' name from HAR");

// --- wd 搜索：按名称（对齐 mmys.app 官方"搜索"响应行为） ---
console.log("AppCMS wd search (name-focused):");
const { getAllMovies } = await import("../edge-functions/lib/db.js");
const allVods = await getAllMovies({});

// 复现 /api/appcms?wd= 的过滤逻辑（不含 vod_content，避免长文本误伤）
function searchBy(wd) {
  const terms = wd.toLowerCase();
  return allVods.filter((m) => {
    if ((m.name || "").toLowerCase().includes(terms)) return true;
    if ((m.vod_en || "").toLowerCase().includes(terms)) return true;
    if (String(m.vod_id) === wd || String(m.id) === wd) return true;
    const hay = [
      m.vod_remarks, m.vod_class, m.vod_actor, m.vod_director,
      m.vod_area, m.vod_lang,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(terms);
  });
}

// 精确片名匹配
const hitShixiong = searchBy("师兄");
assertEq(hitShixiong.map((m) => m.name), ["师兄太稳健"], "wd=师兄 命中片名");
const hitFayi = searchBy("法医");
assertEq(hitFayi.map((m) => m.name), ["法医秦明之龙番往事"], "wd=法医 命中片名");
const hitQinming = searchBy("秦明");
assertEq(hitQinming.map((m) => m.name), ["法医秦明之龙番往事"], "wd=秦明 命中片名片段");

// 单字"爱"只应命中片名含"爱"的（为爱正名），不应被 vod_content 里"爱人如潮水"污染
const hitAi = searchBy("爱");
assertEq(hitAi.map((m) => m.name), ["为爱正名"], "wd=爱 仅命中片名，不被 vod_content 误伤");

// 分类 / 演员 / 地区搜索
assertEq(searchBy("奇幻").map((m) => m.name), ["师兄太稳健"], "wd=奇幻 命中 vod_class");
assertEq(searchBy("古装").map((m) => m.name), ["师兄太稳健"], "wd=古装 命中 vod_class");
assertEq(searchBy("悬疑").map((m) => m.name), ["法医秦明之龙番往事"], "wd=悬疑 命中 vod_class");

// 按 vod_id 精确匹配（官方 wd=数字 可查）
const hitId = searchBy("19067");
assertEq(hitId.map((m) => m.name), ["师兄太稳健"], "wd=19067 命中 vod_id");
const hitIdFull = searchBy("vod-19067");
assertEq(hitIdFull.map((m) => m.name), ["师兄太稳健"], "wd=vod-19067 命中 id 全形式");

// 大小写不敏感
assertEq(searchBy("SIMING").map((m) => m.name), [], "wd=SIMING 未命中（英文无匹配）");
assertEq(searchBy("qihuan").length, 0, "wd=qihuan 未命中（拼音不在字段中）");

// 空 wd 返回全部
assertEq(searchBy("").length, allVods.length, "wd= 空返回全部");

// --- 内置订阅源：getConfig + 上游获取 ---
console.log("\nSubscription system:");
const { getUpstreamUrl, getSourceUrl, getAllSources, SUBSCRIPTION_SOURCES, DEFAULT_SOURCE } = await import("../edge-functions/lib/db.js");

// getConfig 解析
const cfgDefault = getConfig({});
assertEq(cfgDefault.searchUpstream, "", "searchUpstream 空");

const cfgCustom = getConfig({ MYS_SEARCH_UPSTREAM: "http://ffzy5.tv/api.php/provide/vod" });
assertEq(cfgCustom.searchUpstream, "http://ffzy5.tv/api.php/provide/vod", "直接指定上游");

// SUBSCRIPTION_SOURCES 内置配置
assert(Object.keys(SUBSCRIPTION_SOURCES).length >= 10, "内置至少 10 个采集源");
assert(SUBSCRIPTION_SOURCES.mmys !== undefined, "包含 mmys 源");
assert(SUBSCRIPTION_SOURCES.ffzy !== undefined, "包含 ffzy 源");
assertEq(DEFAULT_SOURCE, "mmys", "默认源是 mmys");

// getSourceUrl
const mmysUrl = getSourceUrl("mmys");
assertEq(mmysUrl, "https://mmys.nalinali.qzz.io/api/appcms", "mmys 源 URL 正确");

const ffzyUrl = getSourceUrl("ffzy");
assertEq(ffzyUrl, "http://ffzy5.tv/api.php/provide/vod", "ffzy 源 URL 正确");

const unknownUrl = getSourceUrl("unknown");
assertEq(unknownUrl, null, "未知源返回 null");

// getAllSources
const allSources = getAllSources();
assert(Object.keys(allSources).length >= 10, "getAllSources 返回所有源");

// getUpstreamUrl 优先级测试
// 1. searchUpstream 优先
const url1 = getUpstreamUrl({ MYS_SEARCH_UPSTREAM: "http://direct.example.com/api" });
assertEq(url1, "http://direct.example.com/api", "searchUpstream 优先");

// 2. 默认返回内置订阅源
const url2 = getUpstreamUrl({});
assertEq(url2, "https://mmys.nalinali.qzz.io/api/appcms", "默认返回 mmys 源");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

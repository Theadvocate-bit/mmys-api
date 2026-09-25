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
} from "../lib/db.js";

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
assert(getDb({ TURSO_URL: "https://x.turso.io", TURSO_TOKEN: "tok" }).url, "valid env vars");
assert(!getDb({ TURSO_URL: "https://x.turso.io", TURSO_TOKEN: "tok" }).error, "no error with valid vars");

// URL prefix auto-conversion
let db = getDb({ TURSO_DATABASE_URL: "libsql://x.turso.io", TURSO_AUTH_TOKEN: "tok" });
assertEq(db.url, "https://x.turso.io", "libsql:// prefix converted to https://");
db = getDb({ TURSO_URL: "turso://x.turso.io", TURSO_TOKEN: "tok" });
assertEq(db.url, "https://x.turso.io", "turso:// prefix converted to https://");
db = getDb({ TURSO_DATABASE_URL: "https://x.turso.io/", TURSO_AUTH_TOKEN: "tok" });
assertEq(db.url, "https://x.turso.io", "trailing slash stripped");

// Backwards compat env var names
db = getDb({ TURSO_URL: "https://x.turso.io", TURSO_TOKEN: "tok" });
assert(!db.error, "TURSO_URL/TURSO_TOKEN accepted");
db = getDb({ TURSO_DATABASE_URL: "https://x.turso.io", TURSO_AUTH_TOKEN: "tok" });
assert(!db.error, "TURSO_DATABASE_URL/TURSO_AUTH_TOKEN accepted");

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

// --- Base58 ---
console.log("b58Encode/b58Decode:");
const { b58Encode, b58Decode } = await import("../lib/base58.js");
assertEq(b58Encode("hello world"), "StV1DL6CwTryKyV", "hello world");
assertEq(b58Encode(""), "", "empty string");
assertEq(b58Encode(new Uint8Array([0])), "1", "single zero byte");
assertEq(b58Encode(new Uint8Array([0, 0])), "11", "two zero bytes");
assertEq(b58Encode(new Uint8Array([0, 0, 0])), "111", "three zero bytes");
let allOne = true;
for (let b = 0; b < 58; b++) {
  if (b58Encode(new Uint8Array([b])).length !== 1) { allOne = false; break; }
}
assert(allOne, "all 58 byte values encode to 1 char");
for (const s of ["hello", "TVBox config", "电影天堂资源", JSON.stringify({ a: 1, b: "中文" })]) {
  const e = b58Encode(s);
  const d = new TextDecoder().decode(b58Decode(e));
  assert(d === s, `roundtrip: ${s.substring(0, 20)}`);
}

// --- Import embedded catalog ---
console.log("EMBEDDED_CATALOG:");
const { EMBEDDED_CATALOG } = await import("../lib/catalog_data.js");
assert(Object.keys(EMBEDDED_CATALOG.vods).length >= 2, "embedded catalog has vods");
assert(EMBEDDED_CATALOG.vods["305048"], "vod 305048 present");
assert(EMBEDDED_CATALOG.vods["308179"], "vod 308179 present");
assert(EMBEDDED_CATALOG.vods["305048"].id === "vod-305048", "id format vod-${vod_id}");
assert(Object.keys(EMBEDDED_CATALOG.vods["305048"].sources).length >= 4, "305048 has sources");

// --- AppCMS V10 Format ---
console.log("AppCMS V10 Format:");
const {
  vodToAppCms,
  parseVodClass,
  filterByClass,
  getAllCategories,
  validatePlayUrlFormat,
  validateAppCmsResponse,
} = await import("../lib/appcms_format.js");

// vodToAppCms - basic conversion
const testVod = {
  id: "vod-12345",
  vod_id: 12345,
  name: "Test Movie",
  vod_pic: "http://pic.jpg",
  vod_remarks: "更新至第10集",
  vod_class: "剧情,动作,冒险",
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
      episodes: {
        "1": "token1",
        "2": "token2",
        "3": "token3",
      },
    },
    source2: {
      name: "Source 2",
      parse_api: "http://api/test2?url=",
      episodes: {
        "1": "token4",
      },
    },
  },
};

const origin = "https://test.example.com";
const cmsResult = vodToAppCms(testVod, origin);

assertEq(cmsResult.vod_id, 12345, "vod_id preserved");
assertEq(cmsResult.vod_name, "Test Movie", "vod_name set");
assertEq(cmsResult.vod_pic, "http://pic.jpg", "vod_pic set");
assertEq(cmsResult.vod_remarks, "更新至第10集", "vod_remarks set");
assertEq(cmsResult.vod_class, "剧情,动作,冒险", "vod_class set");
assertEq(cmsResult.vod_content, "This is a test movie description.", "vod_content set");
assertEq(cmsResult.vod_actor, "Actor A, Actor B", "vod_actor set");
assertEq(cmsResult.vod_director, "Director X", "vod_director set");
assertEq(cmsResult.vod_area, "中国", "vod_area set");
assertEq(cmsResult.vod_year, "2024", "vod_year set");
assertEq(cmsResult.vod_score, "8.5", "vod_score set");

// vod_play_from format
assertEq(cmsResult.vod_play_from, "Source 1###Source 2", "vod_play_from format");

// vod_play_url format - check structure
assert(cmsResult.vod_play_url.includes("###"), "vod_play_url has source separator");
assert(cmsResult.vod_play_url.includes("$$$"), "vod_play_url has episode separator");
assert(cmsResult.vod_play_url.includes("第01集$"), "vod_play_url has episode name format");
assert(cmsResult.vod_play_url.includes("/api/play?"), "vod_play_url points to play API");

// Validate play URL format
assert(validatePlayUrlFormat(cmsResult.vod_play_url), "vod_play_url format valid");
assert(validatePlayUrlFormat("第01集$http://example.com/1.m3u8$$$第02集$http://example.com/2.m3u8"), "multi-episode format valid");
assert(validatePlayUrlFormat("Source1第01集$http://example.com/1$$$Source1第02集$http://example.com/2###Source2第01集$http://example.com/3"), "multi-source multi-episode format valid");
assert(!validatePlayUrlFormat("invalid format without separator"), "invalid format rejected");
assert(!validatePlayUrlFormat(""), "empty string rejected");

// parseVodClass
assertEq(parseVodClass("剧情,动作,冒险"), ["剧情", "动作", "冒险"], "parseVodClass basic");
assertEq(parseVodClass("剧情，动作，冒险"), ["剧情", "动作", "冒险"], "parseVodClass Chinese comma");
assertEq(parseVodClass(""), [], "parseVodClass empty");
assertEq(parseVodClass(null), [], "parseVodClass null");

// filterByClass
const testMovies = [
  { id: "1", name: "A", vod_class: "剧情,动作" },
  { id: "2", name: "B", vod_class: "喜剧,爱情" },
  { id: "3", name: "C", vod_class: "剧情,冒险" },
];
assertEq(filterByClass(testMovies, "剧情").length, 2, "filterByClass by name");
assertEq(filterByClass(testMovies, "0").length, 3, "filterByClass by index 0");
assertEq(filterByClass(testMovies, "1").length, 3, "filterByClass by index 1");
assertEq(filterByClass(testMovies, "2").length, 0, "filterByClass by index 2 (empty)");

// getAllCategories
const testCats = getAllCategories(testMovies);
assert(testCats.length > 0, "getAllCategories returns categories");
assert(testCats[0].class_id === "0", "first category id is 0");
assert(testCats[0].class_name, "category has name");
assert(typeof testCats[0].count === "number", "category has count");

// validateAppCmsResponse - list response
const listResponse = {
  code: 1,
  msg: "success",
  page: 1,
  pagecount: 2,
  limit: 10,
  total: 15,
  list: [
    {
      vod_id: 1,
      vod_name: "Movie 1",
      vod_play_from: "Source 1",
      vod_play_url: "第01集$http://example.com/1.m3u8",
    },
  ],
};
let valResult = validateAppCmsResponse(listResponse);
assert(valResult.valid, "list response valid");

// validateAppCmsResponse - detail response
const detailResponse = {
  code: 1,
  msg: "success",
  data: {
    vod_id: 1,
    vod_name: "Movie 1",
    vod_play_from: "Source 1",
    vod_play_url: "第01集$http://example.com/1.m3u8",
  },
};
valResult = validateAppCmsResponse(detailResponse);
assert(valResult.valid, "detail response valid");

// validateAppCmsResponse - error response (code: -1 is valid format, just indicates error)
const errorResponse = { code: -1, msg: "error" };
valResult = validateAppCmsResponse(errorResponse);
assert(valResult.valid, "error response format is valid (code -1 with msg)");

// validateAppCmsResponse - missing required fields
const missingFieldsResponse = {};
valResult = validateAppCmsResponse(missingFieldsResponse);
assert(!valResult.valid, "missing fields response rejected");
assert(valResult.errors.length > 0, "missing fields response has errors");

// Test with real embedded catalog data
console.log("AppCMS with real catalog:");
const realVod = EMBEDDED_CATALOG.vods["305048"];
const realCms = vodToAppCms(realVod, origin);
assert(realCms.vod_id === "305048", "real vod_id preserved");
assert(realCms.vod_name === "为爱正名", "real vod_name correct");
assert(realCms.vod_play_from.includes("###"), "real vod has multiple sources");
assert(validatePlayUrlFormat(realCms.vod_play_url), "real vod_play_url format valid");

// Test source count matches
const sourceCount = Object.keys(realVod.sources).length;
const playFromCount = realCms.vod_play_from.split("###").length;
assertEq(sourceCount, playFromCount, "source count matches play_from count");

const playUrlSources = realCms.vod_play_url.split("###").length;
assertEq(sourceCount, playUrlSources, "source count matches play_url source count");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

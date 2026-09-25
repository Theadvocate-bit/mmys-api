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

// --- Import embedded catalog ---
console.log("EMBEDDED_CATALOG:");
const { EMBEDDED_CATALOG } = await import("../lib/catalog_data.js");
assert(Object.keys(EMBEDDED_CATALOG.vods).length >= 2, "embedded catalog has vods");
assert(EMBEDDED_CATALOG.vods["305048"], "vod 305048 present");
assert(EMBEDDED_CATALOG.vods["308179"], "vod 308179 present");
assert(EMBEDDED_CATALOG.vods["305048"].id === "vod-305048", "id format vod-${vod_id}");
assert(Object.keys(EMBEDDED_CATALOG.vods["305048"].sources).length >= 4, "305048 has sources");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

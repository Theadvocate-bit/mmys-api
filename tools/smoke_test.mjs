#!/usr/bin/env node
// tools/smoke_test.mjs — Unit tests for lib/db.js (detail conversion, parse URL, etc.)
//
// Runs entirely in Node.js with no external dependencies. Tests the pure
// functions that don't require a live Turso connection.
//
// Usage: node tools/smoke_test.mjs

import {
  buildMovieFromDetail,
  buildParseUrl,
  safeJsonParse,
} from "../lib/db.js";

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ---- buildMovieFromDetail -------------------------------------------------

section("buildMovieFromDetail — direct detail data");
{
  const payload = {
    data: {
      vod_id: 12345,
      vod_info: {
        vod_id: 12345,
        vod_name: "测试影片",
        vod_pic: "https://example.com/pic.jpg",
        type_id: 1,
        vod_remarks: "完结",
      },
      vod_url_with_player: [
        {
          code: "BBA",
          name: "自建1",
          parse_api: "http://202.189.6.83:12991/xx/bt.php",
          headers: "User-Agent: dart; X-Test: v1",
          core_params: ["id"],
          url: "第01集$tok1#第02集$tok2#第03集$tok3",
        },
        {
          code: "qq",
          name: "腾讯视频",
          parse_api: "http://202.189.6.83:12991/xx/mtbytedance.php",
          headers: {},
          core_params: [],
          url: "第1集$http://v.qq.com/xxx#第2集$http://v.qq.com/yyy",
        },
      ],
    },
  };

  const movie = buildMovieFromDetail(payload);

  assert(movie.id === "vod-12345", `id = vod-12345 (got ${movie.id})`);
  assert(movie.vod_id === 12345, "vod_id = 12345");
  assert(movie.name === "测试影片", "name = 测试影片");
  assert(movie.vod_pic === "https://example.com/pic.jpg", "vod_pic set");
  assert(movie.type_id === 1, "type_id = 1");
  assert(movie.vod_remarks === "完结", "vod_remarks = 完结");
  assert(Object.keys(movie.sources).length === 2, "2 sources");

  const bba = movie.sources.BBA;
  assert(bba.parse_api.includes("bt.php"), "BBA parse_api");
  assert(bba.headers["User-Agent"] === "dart", "BBA header UA = dart");
  assert(bba.headers["X-Test"] === "v1", "BBA header X-Test = v1");
  assert(Object.keys(bba.episodes).length === 3, "BBA has 3 episodes");
  assert(bba.episodes["1"] === "tok1", "BBA episode 1 = tok1");
  assert(bba.episodes["2"] === "tok2", "BBA episode 2 = tok2");
  assert(bba.episodes["3"] === "tok3", "BBA episode 3 = tok3");

  const qq = movie.sources.qq;
  assert(Object.keys(qq.episodes).length === 2, "qq has 2 episodes");
  assert(qq.episodes["1"] === "http://v.qq.com/xxx", "qq episode 1 URL");
}

section("buildMovieFromDetail — slugify fallback");
{
  const movie = buildMovieFromDetail({
    vod_info: { vod_name: "My Great Movie 2024!" },
    vod_url_with_player: [],
  });
  assert(movie.id === "my-great-movie-2024", `slug fallback (got ${movie.id})`);
}

section("buildMovieFromDetail — missing vod_info throws");
{
  try {
    buildMovieFromDetail({});
    assert(false, "should throw");
  } catch (e) {
    assert(e.message.includes("vod_info"), "throws on missing vod_info");
  }
}

// ---- buildParseUrl --------------------------------------------------------

section("buildParseUrl");
{
  assert(
    buildParseUrl("http://x/bt.php?url=", "tok123") === "http://x/bt.php?url=tok123",
    "url= suffix"
  );
  assert(
    buildParseUrl("http://x/bt.php", "tok123") === "http://x/bt.php?url=tok123",
    "no query → ?url="
  );
  assert(
    buildParseUrl("http://x/bt.php?a=1", "tok123") === "http://x/bt.php?a=1&url=tok123",
    "has query → &url="
  );
  assert(
    buildParseUrl("http://x/bt.php", "a b&c=d") === "http://x/bt.php?url=a%20b%26c%3Dd",
    "URL-encodes token"
  );
}

// ---- safeJsonParse --------------------------------------------------------

section("safeJsonParse");
{
  const ok = safeJsonParse('{"url":"http://x","type":"mp4"}');
  assert(ok.url === "http://x", "valid JSON parses");

  const raw = safeJsonParse("HTTP/1.1 200 OK\nContent-Length: 0\n\n");
  assert(raw.code === -1, "non-JSON → code -1");

  const extracted = safeJsonParse("blah blah http://cdn.example.com/video.mp4 blah");
  assert(extracted.url === "http://cdn.example.com/video.mp4", "URL extracted from raw text");
}

// ---- Summary --------------------------------------------------------------

console.log(`\n════════════════════════════════`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`════════════════════════════════`);

if (fail > 0) process.exit(1);

#!/bin/bash
# End-to-end smoke test for mmys_api.
# Starts the app + a mock upstream, hits every endpoint, reports pass/fail.
set -u
cd "$(dirname "$0")/.."

APP_PORT="${MMYS_TEST_APP_PORT:-8081}"
MOCK_PORT=9999
APP_PID=""
MOCK_PID=""

cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null
  wait 2>/dev/null || true
}
trap cleanup EXIT

PASS=0
FAIL=0
check() {
  local name="$1" expect="$2" got="$3"
  local norm_got norm_expect
  norm_got=$(echo "$got" | tr -d ' \n\t')
  norm_expect=$(echo "$expect" | tr -d ' \n\t')
  if echo "$norm_got" | grep -qF "$norm_expect"; then
    echo "  PASS: $name"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $name"
    echo "    expect: $norm_expect"
    echo "    got   : $norm_got"
    FAIL=$((FAIL+1))
  fi
}

not_in() {
  local name="$1" absent="$2" got="$3"
  local norm_got norm_absent
  norm_got=$(echo "$got" | tr -d ' \n\t')
  norm_absent=$(echo "$absent" | tr -d ' \n\t')
  if ! echo "$norm_got" | grep -qF "$norm_absent"; then
    echo "  PASS: $name"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $name (should NOT contain: $norm_absent)"
    echo "    got   : $norm_got"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Starting mock upstream (127.0.0.1:$MOCK_PORT) ==="
python3 -c "
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({
            'code': 200, 'msg': 'mock ok',
            'url': 'http://mock.example.com/v.mp4',
            'type': 'mp4', 'time': 0
        }).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*a,**k): pass
HTTPServer(('127.0.0.1', $MOCK_PORT), H).serve_forever()
" >/tmp/mmys_mock.log 2>&1 &
MOCK_PID=$!
sleep 0.4

echo "=== Starting mmys_api (127.0.0.1:$APP_PORT) ==="
MMYS_PORT="$APP_PORT" MMYS_DATA=/tmp/mmys_test_catalog.json python3 app.py >/tmp/mmys_app.log 2>&1 &
APP_PID=$!

# Wait for /health
for i in $(seq 1 40); do
  if curl -s "http://127.0.0.1:$APP_PORT/health" 2>/dev/null | grep -q '"status":"ok"'; then
    break
  fi
  sleep 0.1
done

echo
echo "=== T1: / ==="
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/")
check "service name" '"service":"mmys_api"' "$OUT"
check "version"     '"version":"0.1.0"' "$OUT"

echo
echo "=== T2: /health ==="
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/health")
check "status ok"     '"status":"ok"' "$OUT"
check "movies zero"   '"movies":0'     "$OUT"

echo
echo "=== T3: POST /api/add-movie (maomao.php detail dump) ==="
cat > /tmp/detail.json <<'EOF'
{
  "code": 1,
  "msg": "视频详情",
  "data": {
    "vod_id": 12345,
    "vod_info": {
      "vod_id": 12345,
      "vod_name": "测试影片",
      "vod_pic": "http://example.com/pic.jpg",
      "type_id": 1,
      "vod_remarks": "测试"
    },
    "vod_play_from": ["自建1$自建2$纯享2"],
    "vod_url_with_player": [
      {
        "name": "自建1",
        "code": "BBA",
        "url": "第01集$ETH-abc#第02集$ETH-def",
        "parse_api": "http://202.189.6.83:12991/xx/bt.php?url=",
        "headers": "User-Agent: dart",
        "core_params": ["cache: yes", "cache-secs: 150"]
      },
      {
        "name": "自建2",
        "code": "bytedance",
        "url": "第01集$v0d5aag10002dan4#第02集$v0d5aag10002dan5",
        "parse_api": "http://202.189.6.83:12991/xx/mtbytedance.php?url=",
        "headers": {},
        "core_params": []
      },
      {
        "name": "纯享2",
        "code": "qq",
        "url": "第01集$https://v.qq.com/x/cover/xxx.html#第02集$https://v.qq.com/x/cover/yyy.html",
        "parse_api": "http://202.189.6.83:12991/xx/gf2.php?url=",
        "headers": {},
        "core_params": []
      }
    ]
  }
}
EOF
OUT=$(curl -s -X POST "http://127.0.0.1:$APP_PORT/api/add-movie" \
  -H "Content-Type: application/json" --data-binary @/tmp/detail.json)
check "import ok"    '"ok":true'                "$OUT"
check "movie_id"     '"movie_id":"vod-12345"'   "$OUT"
check "has BBA"      '"BBA"'                     "$OUT"
check "has bytedance" '"bytedance"'              "$OUT"
check "has qq"       '"qq"'                      "$OUT"
check "6 episodes total" '"episodes":6'          "$OUT"
echo "  raw: $OUT"

echo
echo "=== T4: /api/catalog after import ==="
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/api/catalog")
check "count=1"   '"count":1'      "$OUT"
check "vod-12345" '"vod-12345"'   "$OUT"
check "BBA"       '"BBA"'         "$OUT"
check "qq"        '"qq"'          "$OUT"
check "bytedance" '"bytedance"'   "$OUT"

echo
echo "=== T5: /api/token (BBA ep 1, ciphertext) ==="
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/api/token?movie=vod-12345&source=BBA&episode=1")
check "token ETH-abc" '"token":"ETH-abc"' "$OUT"
check "parse_api bt.php" 'bt.php' "$OUT"
check "core_params" '"cache: yes"' "$OUT"

echo
echo "=== T6: /api/token (qq ep 1, plaintext page URL) ==="
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/api/token?movie=vod-12345&source=qq&episode=1")
check "plaintext URL preserved" 'https://v.qq.com/x/cover/xxx.html' "$OUT"

echo
echo "=== T7: add a movie that points to mock upstream ==="
cat > /tmp/mock_detail.json <<'EOF'
{
  "id": "vod-mock",
  "vod_id": 99999,
  "name": "Mock Film",
  "vod_info": {},
  "sources": {
    "MOCK": {
      "name": "Mock Source",
      "parse_api": "http://127.0.0.1:9999/mock.php?url=",
      "headers": {"User-Agent": "test"},
      "core_params": [],
      "episodes": {"1": "MOCK-TOKEN-XYZ", "2": "MOCK-TOKEN-ABC"}
    }
  }
}
EOF
curl -s -X POST "http://127.0.0.1:$APP_PORT/api/add-movie" \
  -H "Content-Type: application/json" --data-binary @/tmp/mock_detail.json >/dev/null

echo
echo "=== T8: /api/play (JSON, hits mock upstream) ==="
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/api/play?movie=vod-mock&source=MOCK&episode=1")
check "code 200"       '"code":200'                    "$OUT"
check "mock url"       'http://mock.example.com/v.mp4' "$OUT"
check "type mp4"       '"type":"mp4"'                   "$OUT"
check "movie id back"  '"movie":"vod-mock"'             "$OUT"
check "source code"    '"source":"MOCK"'               "$OUT"

echo
echo "=== T9: /api/play (302 redirect mode) ==="
HEADERS=$(curl -sI "http://127.0.0.1:$APP_PORT/api/play?movie=vod-mock&source=MOCK&episode=1&redirect=1")
check "HTTP 302"           '302'                              "$HEADERS"
check "Location header"    'http://mock.example.com/v.mp4'    "$HEADERS"

echo
echo "=== T10: /api/play error — unknown movie ==="
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/api/play?movie=nope&source=X&episode=1")
check "not found error" 'not found' "$OUT"

echo
echo "=== T11: /api/play error — upstream unreachable ==="
cat > /tmp/bad_detail.json <<'EOF'
{
  "id": "vod-bad", "vod_id": 99998, "name": "Bad", "vod_info": {},
  "sources": {
    "BAD": {
      "name": "Bad", "parse_api": "http://127.0.0.1:1/bad.php?url=",
      "headers": {}, "core_params": [],
      "episodes": {"1": "TOK"}
    }
  }
}
EOF
curl -s -X POST "http://127.0.0.1:$APP_PORT/api/add-movie" \
  -H "Content-Type: application/json" --data-binary @/tmp/bad_detail.json >/dev/null
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/api/play?movie=vod-bad&source=BAD&episode=1")
check "upstream failed" 'upstream failed' "$OUT"

echo
echo "=== T12: DELETE /api/movie/vod-mock ==="
OUT=$(curl -s -X DELETE "http://127.0.0.1:$APP_PORT/api/movie/vod-mock")
check "delete ok" '"ok":true' "$OUT"

echo
echo "=== T13: /api/catalog after deletes — vod-mock should be gone ==="
OUT=$(curl -s "http://127.0.0.1:$APP_PORT/api/catalog")
not_in "vod-mock removed" '"vod-mock"' "$OUT"
check "count=2"   '"count":2'   "$OUT"
check "vod-12345 still there" '"vod-12345"' "$OUT"
check "vod-bad still there"   '"vod-bad"' "$OUT"
echo "  raw: $OUT"

echo
echo "=== T14: CORS header on /health ==="
HEADERS=$(curl -sI "http://127.0.0.1:$APP_PORT/health")
check "CORS *" 'Access-Control-Allow-Origin: *' "$HEADERS"

echo
echo "================================"
echo "RESULTS: $PASS passed, $FAIL failed"
echo "================================"

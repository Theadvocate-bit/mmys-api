#!/usr/bin/env python3
"""
mmys_api — Relay API for maomao (猫猫影视) video tokens.

Reads a local data store of movie → source → episode token mappings and
provides endpoints that swap tokens for fresh direct links by calling the
upstream parse_api in real time. Zero dependencies — Python 3.8+ stdlib only.

Endpoints:
    GET    /                       service info + route table
    GET    /health                 liveness
    GET    /api/catalog            list movies
    GET    /api/movie/{id}         movie detail (sources + episode tokens)
    GET    /api/play               relay: token → direct link (JSON or 302)
    GET    /api/token              debug: raw token for (movie, source, episode)
    POST   /api/add-movie          import a maomao.php detail dump
    DELETE /api/movie/{id}         remove a movie

Env:
    MMYS_HOST      (default 0.0.0.0)
    MMYS_PORT      (default 8080)
    MMYS_DATA      (default ./data/catalog.json)
    MMYS_TIMEOUT   (default 10s, upstream parse_api timeout)
    MMYS_CACHE_TTL (default 60s, per (parse_api, token) result cache)

See mmys.md for the reverse-engineering notes this project is built on.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


VERSION = "0.1.0"

DATA_FILE = Path(
    os.environ.get(
        "MMYS_DATA",
        str(Path(__file__).resolve().parent / "data" / "catalog.json"),
    )
)
UPSTREAM_TIMEOUT = float(os.environ.get("MMYS_TIMEOUT", "10"))
CACHE_TTL = float(os.environ.get("MMYS_CACHE_TTL", "60"))
HOST = os.environ.get("MMYS_HOST", "0.0.0.0")
PORT = int(os.environ.get("MMYS_PORT", "8080"))

# In-memory cache: (parse_api, token) → (expires_ts, response_dict)
_cache: dict[tuple[str, str], tuple[float, dict]] = {}


def log(msg: str) -> None:
    sys.stderr.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")


# ---------------------------------------------------------------------------
# Data store (JSON file on disk)
# ---------------------------------------------------------------------------

def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except Exception as e:  # malformed JSON etc.
        log(f"warn: cannot load {path}: {e}")
        return default


def load_data() -> dict:
    d = _load_json(DATA_FILE, {"movies": []})
    if not isinstance(d, dict):
        d = {"movies": []}
    if not isinstance(d.get("movies"), list):
        d["movies"] = []
    return d


def save_data(data: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_name(DATA_FILE.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(DATA_FILE)


def find_movie(data: dict, movie_id: str) -> dict | None:
    for m in data.get("movies", []):
        if str(m.get("id")) == str(movie_id):
            return m
    return None


# ---------------------------------------------------------------------------
# Detail response → movie record conversion
# ---------------------------------------------------------------------------

def _extract_headers(h_field: Any) -> dict:
    """Normalise the parse_api `headers` field.

    The upstream response uses either a dict or a semicolon-separated string
    ("User-Agent: dart; X-Other: v"). Both forms are accepted.
    """
    if not h_field:
        return {}
    if isinstance(h_field, dict):
        return {str(k): str(v) for k, v in h_field.items()}
    if isinstance(h_field, str):
        out: dict[str, str] = {}
        for line in h_field.split(";"):
            line = line.strip()
            if ":" in line:
                k, v = line.split(":", 1)
                out[k.strip()] = v.strip()
        return out
    return {}


def _parse_episode_url(url_field: str) -> dict[str, str]:
    """Parse `第01集$token#第02集$token#...` into {index_str: token}."""
    episodes: dict[str, str] = {}
    for pair in url_field.split("#"):
        if "$" not in pair:
            continue
        name, token = pair.split("$", 1)
        name, token = name.strip(), token.strip()
        if not token:
            continue
        m = re.search(r"(\d+)", name)
        # Normalise leading zeros: "第01集" → key "1", not "01".
        idx = str(int(m.group(1))) if m else "0"
        episodes[idx] = token
    return episodes


def _build_movie_from_detail(payload: dict) -> dict:
    """Convert a maomao.php detail response into an internal movie record.

    Two accepted shapes:
      A) Direct detail data: {"vod_info": {...}, "vod_url_with_player": [...]}
      B) Full response wrapper: {"code":1, "msg":"视频详情", "data": {...}}
    """
    p = payload
    if isinstance(p.get("data"), dict):
        p = p["data"]

    vod_info = p.get("vod_info") or {}
    if not vod_info:
        raise ValueError("payload missing vod_info")

    sources: dict[str, dict] = {}
    for entry in p.get("vod_url_with_player") or []:
        code = entry.get("code") or entry.get("name")
        if not code:
            continue
        sources[str(code)] = {
            "name": entry.get("name") or code,
            "parse_api": entry.get("parse_api") or "",
            "headers": _extract_headers(entry.get("headers")),
            "core_params": entry.get("core_params") or [],
            "episodes": _parse_episode_url(entry.get("url") or ""),
        }

    vod_id = p.get("vod_id") or vod_info.get("vod_id")
    name = vod_info.get("vod_name") or p.get("vod_name") or ""
    if vod_id is not None:
        slug = f"vod-{vod_id}"
    else:
        slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).lower().strip("-") or "movie"

    return {
        "id": slug,
        "vod_id": vod_id,
        "name": name,
        "vod_pic": vod_info.get("vod_pic") or p.get("vod_pic") or "",
        "type_id": vod_info.get("type_id") or p.get("type_id"),
        "vod_remarks": vod_info.get("vod_remarks") or p.get("vod_remarks") or "",
        "vod_info": vod_info,
        "sources": sources,
        "imported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


# ---------------------------------------------------------------------------
# Token lookup + upstream call
# ---------------------------------------------------------------------------

def get_token(movie: dict, source_code: str, episode_index: int) -> tuple[str, dict]:
    source = (movie.get("sources") or {}).get(source_code)
    if not source:
        available = list((movie.get("sources") or {}).keys())
        raise LookupError(
            f"source '{source_code}' not found; available: {available}"
        )
    episodes = source.get("episodes") or {}
    key = str(episode_index)
    if key not in episodes:
        raise LookupError(
            f"episode {episode_index} not in source '{source_code}' "
            f"({len(episodes)} episode(s): {sorted(episodes.keys())})"
        )
    return episodes[key], source


def _build_parse_url(parse_api: str, token: str) -> str:
    """All known parse_api endpoints arrive as `<path>.php?url=` — append token.

    We URL-encode the token defensively because plaintext sources (qq / mgtv)
    put a full page URL as the token; encoding avoids `?url=...?` sequences.
    """
    tok = urllib.parse.quote(token, safe="")
    if parse_api.endswith("url="):
        return parse_api + tok
    if "?" in parse_api:
        return f"{parse_api}&url={tok}"
    return f"{parse_api}?url={tok}"


def call_parse_api(parse_api: str, token: str, headers: dict | None = None) -> dict:
    key = (parse_api, token)
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    url = _build_parse_url(parse_api, token)
    req_headers = {"User-Agent": "dart"}
    if headers:
        req_headers.update({k: str(v) for k, v in headers.items()})

    req = urllib.request.Request(url, headers=req_headers)
    with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
        body = resp.read().decode("utf-8", errors="replace")

    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        # Upstream returned something other than JSON — try to extract a URL,
        # otherwise surface the raw snippet.
        m = re.search(r"https?://[^\s\"'<>]+", body)
        if m:
            result = {
                "code": 200,
                "msg": "raw extract (upstream non-JSON)",
                "url": m.group(0),
                "type": "unknown",
            }
        else:
            result = {"code": -1, "msg": f"non-JSON response: {body[:200]!r}"}

    _cache[key] = (now + CACHE_TTL, result)
    return result


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = f"mmys_api/{VERSION}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # noqa: D401
        log(f"{self.address_string()} — {self.command} {self.path} — {fmt % args}")

    # -- response helpers ---------------------------------------------------
    def _send(
        self,
        status: int,
        body: bytes | None = None,
        content_type: str | None = None,
        extra: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        if content_type:
            self.send_header("Content-Type", content_type)
        if body is not None:
            self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj: Any, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _redirect(self, location: str) -> None:
        self._send(302, None, None, {"Location": location})

    # -- routing ------------------------------------------------------------
    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204)

    def do_HEAD(self) -> None:  # noqa: N802
        # Mirrors GET but suppresses the body (Content-Length still sent).
        self.do_GET()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        path = parsed.path.rstrip("/") or "/"

        try:
            if path in ("/", "/api"):
                return self._json(
                    {
                        "service": "mmys_api",
                        "version": VERSION,
                        "data_file": str(DATA_FILE),
                        "movies": len(load_data().get("movies", [])),
                        "endpoints": {
                            "GET /api/catalog": "list movies",
                            "GET /api/movie/{id}": "movie detail",
                            "GET /api/play?movie=&source=&episode=[&redirect=1]": (
                                "relay: token → direct link"
                            ),
                            "GET /api/token?movie=&source=&episode=": "debug: raw token",
                            "POST /api/add-movie": "import a maomao.php detail dump",
                            "DELETE /api/movie/{id}": "remove a movie",
                            "GET /health": "liveness",
                        },
                    }
                )

            if path == "/health":
                data = load_data()
                return self._json(
                    {
                        "status": "ok",
                        "version": VERSION,
                        "movies": len(data.get("movies", [])),
                        "cache_size": len(_cache),
                    }
                )

            if path == "/api/catalog":
                data = load_data()
                movies = []
                for m in data.get("movies", []):
                    sources = m.get("sources") or {}
                    movies.append(
                        {
                            "id": m.get("id"),
                            "vod_id": m.get("vod_id"),
                            "name": m.get("name"),
                            "type_id": m.get("type_id"),
                            "vod_pic": m.get("vod_pic"),
                            "vod_remarks": m.get("vod_remarks"),
                            "sources": [
                                {
                                    "code": code,
                                    "name": s.get("name"),
                                    "episodes": len(s.get("episodes") or {}),
                                }
                                for code, s in sources.items()
                            ],
                        }
                    )
                return self._json({"count": len(movies), "movies": movies})

            if path.startswith("/api/movie/"):
                movie_id = path[len("/api/movie/"):]
                movie = find_movie(load_data(), movie_id)
                if not movie:
                    return self._json(
                        {"error": f"movie '{movie_id}' not found"}, 404
                    )
                return self._json({"movie": movie})

            if path == "/api/token":
                movie_id = qs.get("movie", [""])[0]
                source_code = qs.get("source", [""])[0]
                ep = qs.get("episode", [""])[0]
                if not (movie_id and source_code and ep):
                    return self._json(
                        {"error": "missing movie/source/episode"}, 400
                    )
                movie = find_movie(load_data(), movie_id)
                if not movie:
                    return self._json(
                        {"error": f"movie '{movie_id}' not found"}, 404
                    )
                try:
                    ep_int = int(ep)
                    token, source = get_token(movie, source_code, ep_int)
                except ValueError:
                    return self._json({"error": "episode must be integer"}, 400)
                except LookupError as e:
                    return self._json({"error": str(e)}, 404)
                return self._json(
                    {
                        "movie": movie_id,
                        "source": source_code,
                        "episode": ep_int,
                        "token": token,
                        "parse_api": source.get("parse_api"),
                        "core_params": source.get("core_params"),
                    }
                )

            if path == "/api/play":
                movie_id = qs.get("movie", [""])[0]
                source_code = qs.get("source", [""])[0]
                ep = qs.get("episode", [""])[0]
                want_redirect = qs.get("redirect", ["0"])[0].lower() in (
                    "1",
                    "true",
                    "yes",
                )

                if not (movie_id and source_code and ep):
                    return self._json(
                        {"error": "missing movie/source/episode"}, 400
                    )
                try:
                    ep_int = int(ep)
                except ValueError:
                    return self._json({"error": "episode must be integer"}, 400)

                movie = find_movie(load_data(), movie_id)
                if not movie:
                    return self._json(
                        {"error": f"movie '{movie_id}' not found"}, 404
                    )
                try:
                    token, source = get_token(movie, source_code, ep_int)
                except LookupError as e:
                    return self._json({"error": str(e)}, 404)
                if not source.get("parse_api"):
                    return self._json(
                        {
                            "error": f"source '{source_code}' has no parse_api configured"
                        },
                        500,
                    )

                try:
                    result = call_parse_api(
                        source["parse_api"], token, source.get("headers")
                    )
                except urllib.error.HTTPError as e:
                    return self._json(
                        {"error": f"upstream HTTP {e.code}", "detail": str(e)}, 502
                    )
                except Exception as e:
                    return self._json({"error": f"upstream failed: {e}"}, 502)

                if not result.get("url"):
                    return self._json(
                        {
                            "movie": movie_id,
                            "source": source_code,
                            "episode": ep_int,
                            "code": result.get("code"),
                            "msg": result.get("msg"),
                            "error": "upstream returned no url",
                        },
                        502,
                    )

                if want_redirect:
                    return self._redirect(result["url"])

                return self._json(
                    {
                        "code": result.get("code"),
                        "msg": result.get("msg"),
                        "url": result.get("url"),
                        "type": result.get("type"),
                        "movie": movie_id,
                        "source": source_code,
                        "source_name": source.get("name"),
                        "episode": ep_int,
                        "core_params": source.get("core_params"),
                    }
                )

            return self._json({"error": "not found"}, 404)

        except Exception as e:
            log(f"GET unhandled: {e}")
            return self._json({"error": str(e)}, 500)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path == "/api/add-movie":
                length = int(self.headers.get("Content-Length") or "0")
                raw = self.rfile.read(length) if length else b""
                try:
                    payload = json.loads(raw.decode("utf-8"))
                except Exception as e:
                    return self._json({"error": f"invalid JSON: {e}"}, 400)
                if not isinstance(payload, dict):
                    return self._json(
                        {"error": "payload must be an object"}, 400
                    )

                try:
                    # If payload already has `sources`, treat as pre-shaped
                    # record. Otherwise expect a maomao.php detail dump.
                    movie = (
                        payload
                        if "sources" in payload
                        else _build_movie_from_detail(payload)
                    )
                except ValueError as e:
                    return self._json({"error": str(e)}, 400)
                except Exception as e:
                    return self._json({"error": f"import failed: {e}"}, 400)

                if not movie.get("id"):
                    return self._json(
                        {"error": "cannot derive movie.id"}, 400
                    )

                data = load_data()
                data["movies"] = [
                    m
                    for m in data.get("movies", [])
                    if str(m.get("id")) != str(movie["id"])
                ]
                data["movies"].append(movie)
                save_data(data)
                n_eps = sum(
                    len(s.get("episodes") or {})
                    for s in movie.get("sources", {}).values()
                )
                log(
                    f"imported {movie['id']} — "
                    f"{len(movie.get('sources', {}))} sources, {n_eps} episodes"
                )
                return self._json(
                    {
                        "ok": True,
                        "movie_id": movie["id"],
                        "sources": list(movie.get("sources", {}).keys()),
                        "episodes": n_eps,
                    }
                )

            return self._json({"error": "not found"}, 404)

        except Exception as e:
            log(f"POST unhandled: {e}")
            return self._json({"error": str(e)}, 500)

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path.startswith("/api/movie/"):
                movie_id = path[len("/api/movie/"):]
                data = load_data()
                before = len(data.get("movies", []))
                data["movies"] = [
                    m
                    for m in data.get("movies", [])
                    if str(m.get("id")) != str(movie_id)
                ]
                if len(data["movies"]) == before:
                    return self._json(
                        {"error": f"movie '{movie_id}' not found"}, 404
                    )
                save_data(data)
                log(f"removed movie {movie_id}")
                return self._json({"ok": True, "removed": movie_id})

            return self._json({"error": "not found"}, 404)

        except Exception as e:
            log(f"DELETE unhandled: {e}")
            return self._json({"error": str(e)}, 500)


def main() -> None:
    log(f"mmys_api {VERSION} starting on {HOST}:{PORT}")
    log(f"data file: {DATA_FILE}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

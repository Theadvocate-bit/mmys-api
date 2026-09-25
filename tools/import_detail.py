#!/usr/bin/env python3
"""Import a maomao.php detail dump into the catalog.json data store.

Usage:
    python3 tools/import_detail.py <path-to-detail.json> [--dry-run] [--as <id>]

The `--as` flag overrides the derived movie.id slug (default: `vod-<vod_id>`).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import DATA_FILE, _build_movie_from_detail, load_data, save_data  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(
        description="Import a maomao.php detail dump into catalog.json"
    )
    p.add_argument("file", help="path to a maomao.php detail response (JSON)")
    p.add_argument("--dry-run", action="store_true", help="print record, do not write")
    p.add_argument("--as", dest="as_id", help="override the movie.id slug")
    args = p.parse_args()

    payload = json.loads(Path(args.file).read_text(encoding="utf-8"))
    movie = _build_movie_from_detail(payload)
    if args.as_id:
        movie["id"] = args.as_id

    n_sources = len(movie.get("sources", {}))
    n_eps = sum(
        len(s.get("episodes") or {}) for s in movie.get("sources", {}).values()
    )

    if args.dry_run:
        print(json.dumps(movie, ensure_ascii=False, indent=2))
        print(
            f"\n# would import {movie['id']} ({movie['name']}) — "
            f"{n_sources} sources, {n_eps} episodes",
            file=sys.stderr,
        )
        return 0

    data = load_data()
    data["movies"] = [m for m in data["movies"] if m.get("id") != movie["id"]]
    data["movies"].append(movie)
    save_data(data)
    print(
        f"imported {movie['id']} ({movie['name']}) — "
        f"{n_sources} sources, {n_eps} episodes"
    )
    print(f"written to {DATA_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

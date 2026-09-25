#!/usr/bin/env python3
"""Regenerate edge-functions/lib/catalog_data.js from data/catalog.json.

Data shape:
  {
    "vods": {
      "<vod_id>": {
        "vod_id": "...",
        "vod_name": "...",
        "vod_pic": "...",
        "vod_remarks": "...",
        "vod_class": "...",
        "vod_content": "...",
        "sources": {
          "<code>": {
            "parse_api": "http://...?url=",
            "episodes": [["<name>", "<token>"], ...]
          }
        },
        "imported_at": "<iso>"
      }
    }
  }

Each `["<name>", "<token>"]` pair becomes episodes["<num>"] = token plus
episode_names["<num>"] = name, preserving the source-native label so
Apple CMS V10 output can emit `1$…` for youku and `第01集$…` for BBA.
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN_PATH = ROOT / "data" / "catalog.json"
OUT_PATH = ROOT / "edge-functions" / "lib" / "catalog_data.js"


def extract_episode_num(name: str) -> str:
    m = re.search(r"(\d+)", name or "")
    return str(int(m.group(1))) if m else "0"


def build() -> None:
    if not IN_PATH.exists():
        print(f"ERROR: {IN_PATH} not found", file=sys.stderr)
        sys.exit(1)

    cat = json.loads(IN_PATH.read_text(encoding="utf-8"))
    vods = cat.get("vods", {})
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    embedded = {}
    total_eps = 0
    for vid, vod in vods.items():
        sources = {}
        for code, s in vod.get("sources", {}).items():
            episodes = {}
            episode_names = {}
            for pair in s.get("episodes", []):
                if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                    continue
                name, token = str(pair[0]).strip(), str(pair[1]).strip()
                if not token:
                    continue
                key = extract_episode_num(name)
                episodes[key] = token
                if name:
                    episode_names[key] = name
            sources[code] = {
                "name": code,
                "parse_api": s.get("parse_api", ""),
                "headers": s.get("headers", ""),
                "core_params": s.get("core_params", []),
                "episodes": episodes,
                "episode_names": episode_names,
            }
            total_eps += len(episodes)

        embedded[vid] = {
            "id": f"vod-{vid}",
            "vod_id": str(vid),
            "type_id": vod.get("type_id", ""),
            "name": vod.get("vod_name", ""),
            "vod_pic": vod.get("vod_pic", ""),
            "vod_remarks": vod.get("vod_remarks", ""),
            "vod_class": vod.get("vod_class", ""),
            "vod_content": vod.get("vod_content", ""),
            "vod_info": {
                "vod_name": vod.get("vod_name", ""),
                "vod_pic": vod.get("vod_pic", ""),
                "vod_remarks": vod.get("vod_remarks", ""),
                "vod_class": vod.get("vod_class", ""),
                "vod_content": vod.get("vod_content", ""),
                "type_id": vod.get("type_id", ""),
            },
            "sources": sources,
            "imported_at": vod.get("imported_at", ""),
        }

    body = json.dumps(embedded, ensure_ascii=False, separators=(",", ": "))
    content = (
        f"// edge-functions/lib/catalog_data.js — AUTO-GENERATED from data/catalog.json\n"
        f"// DO NOT EDIT BY HAND — run: python3 tools/build_catalog_data.py\n"
        f"// Source: data/catalog.json  Generated: {now}\n"
        f"// Embedded fallback catalog: used when Turso is unavailable.\n"
        f"// Contains {len(vods)} vods, {total_eps} episodes total.\n\n"
        f"export const EMBEDDED_CATALOG = {{\n  vods: {body},\n}};\n"
    )
    OUT_PATH.write_text(content, encoding="utf-8")
    print(f"Wrote {OUT_PATH.relative_to(ROOT)} — {len(vods)} vods, {total_eps} episodes")


if __name__ == "__main__":
    build()

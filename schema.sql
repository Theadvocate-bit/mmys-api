-- Turso schema for mmys_api
-- Run via: node tools/init_turso.mjs

CREATE TABLE IF NOT EXISTS movies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT ''
);

-- Persistent parse_api result cache (TTL enforced at read time).
CREATE TABLE IF NOT EXISTS parse_cache (
  cache_key   TEXT PRIMARY KEY,
  created_at  REAL NOT NULL DEFAULT 0,
  value       TEXT NOT NULL DEFAULT ''
);

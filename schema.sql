-- Turso schema for mmys_api
-- Run via: node tools/init_turso.mjs

CREATE TABLE IF NOT EXISTS movies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  data        TEXT NOT NULL
);

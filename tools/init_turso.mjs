#!/usr/bin/env node
// tools/init_turso.mjs — Run the schema against a real Turso instance.
//
// Usage:
//   TURSO_URL=https://xxx.turso.io TURSO_TOKEN=turso_xxx node tools/init_turso.mjs
//
// Reads schema.sql, splits on ';', and executes each statement via Turso HTTP API.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "../schema.sql");

const url = (process.env.TURSO_URL || "").trim().replace(/\/$/, "");
const token = (process.env.TURSO_TOKEN || "").trim();

if (!url || !token) {
  console.error("ERROR: set TURSO_URL and TURSO_TOKEN env vars");
  process.exit(1);
}

const schema = readFileSync(SCHEMA_PATH, "utf-8");
const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Connecting to ${url}`);
console.log(`Executing ${statements.length} statement(s)…`);

for (const sql of statements) {
  const res = await fetch(`${url}/v2/turso/stmts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: JSON.stringify([{ sql }]),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`  FAIL [${res.status}]: ${text.slice(0, 200)}`);
    process.exit(1);
  }

  const data = await res.json();
  const stmt = data.statements?.[0];
  console.log(`  ✓ ${sql.slice(0, 60)}${sql.length > 60 ? "…" : ""}`);
  if (stmt.changes > 0) console.log(`    (changes: ${stmt.changes})`);
}

console.log("\nSchema initialized. Verify:");
console.log(`  curl -s -H "Authorization: Bearer ${token}" \\\n    "${url}/v2/turso/stmts" -d '[{"sql":"SELECT name FROM sqlite_master WHERE type=\"table\""}]'`);

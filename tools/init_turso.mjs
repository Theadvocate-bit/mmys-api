#!/usr/bin/env node
// tools/init_turso.mjs — Initialize Turso schema via HANA pipeline protocol.
//
// Usage:
//   TURSO_DATABASE_URL=https://xxx.turso.io TURSO_AUTH_TOKEN=turso_xxx node tools/init_turso.mjs

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "../schema.sql");

const url0 = (process.env.TURSO_DATABASE_URL || "").trim();
const token = (process.env.TURSO_AUTH_TOKEN || "").trim();

if (!url0 || !token) {
  console.error("ERROR: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN");
  process.exit(1);
}
let url = url0;

// Auto-convert libsql:// or turso:// to https://
if (url.startsWith("libsql://")) url = "https://" + url.slice(9);
else if (url.startsWith("turso://")) url = "https://" + url.slice(8);
url = url.replace(/\/$/, "");

const schema = readFileSync(SCHEMA_PATH, "utf-8");
const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Connecting to ${url}`);
console.log(`Executing ${statements.length} statement(s) via HANA pipeline…\n`);

async function execute(sql) {
  const payload = JSON.stringify({
    requests: [{ type: "execute", stmt: { sql } }, { type: "close" }],
  });
  const res = await fetch(`${url}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turso HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const d = await res.json();
  const r0 = d.results?.[0];
  if (r0?.type === "error") {
    throw new Error(`Turso error: ${JSON.stringify(r0.error)}`);
  }
  return r0?.response?.result;
}

for (const sql of statements) {
  try {
    const r = await execute(sql);
    console.log(`  ✓ ${sql.slice(0, 60)}${sql.length > 60 ? "…" : ""}`);
    if (r && r.affected_row_count > 0)
      console.log(`    (changes: ${r.affected_row_count})`);
  } catch (e) {
    console.error(`  FAIL: ${e.message}`);
    process.exit(1);
  }
}

console.log(`\nSchema initialized.`);
console.log(`\nVerify:`);
console.log(
  `  curl -s -H "Authorization: Bearer ${token}" \\`
);
console.log(
  `    -H "Content-Type: application/json" \\`
);
console.log(`    "${url}/v2/pipeline" \\`);
console.log(
  `    -d '{"requests":[{"type":"execute","stmt":{"sql":"SELECT name FROM sqlite_master WHERE type=\\"table\\""}},{"type":"close"}]}'`
);

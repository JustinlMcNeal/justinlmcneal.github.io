#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    // optional
  }
  return env;
}

const env = loadEnv();
const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
const anon = env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const password = env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD;
const ref = "yxdzvzscufkvewecvagq";

async function probeRest(label, path) {
  const started = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    console.log(`[REST ${label}] ${res.status} ${Date.now() - started}ms ${text.slice(0, 120)}`);
  } catch (e) {
    console.log(`[REST ${label}] FAIL ${Date.now() - started}ms ${e.message}`);
  }
}

async function probePg(label, connStr) {
  const started = Date.now();
  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    const r = await client.query("SELECT 1 AS ok");
    console.log(`[PG ${label}] OK ${Date.now() - started}ms`, r.rows[0]);
  } catch (e) {
    console.log(`[PG ${label}] FAIL ${Date.now() - started}ms ${e.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

console.log("Probing Karry Kraze Supabase project...\n");
await probeRest("site_settings", "site_settings?select=key&limit=1");
await probeRest("kpis", "v_inventory_kpis?select=total_skus&limit=1");
await probeRest("issues", "v_inventory_issues?select=issue_type&limit=1");

if (password) {
  const enc = encodeURIComponent(password);
  await probePg(
    "pooler-session-5432",
    `postgresql://postgres.${ref}:${enc}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  );
  await probePg(
    "pooler-tx-6543",
    `postgresql://postgres.${ref}:${enc}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`,
  );
} else {
  console.log("[PG] skipped — no SUPABASE_DB_PASSWORD");
}

#!/usr/bin/env node
/**
 * Refresh eBay listing cache for multi-variant group products flagged unsupported_variation.
 * Run: node scripts/supabase/refresh-ebay-unsupported-variations.mjs
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { getPoolerConnectionString } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

async function resolveAdminEmail(env) {
  if (env.KK_ADMIN_EMAIL?.trim()) return env.KK_ADMIN_EMAIL.trim();
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT email FROM auth.users
       WHERE COALESCE((raw_app_meta_data->>'is_admin')::boolean, false) = true
       ORDER BY created_at LIMIT 1`,
    );
    if (rows?.[0]?.email) return rows[0].email;
  } finally {
    await client.end().catch(() => {});
  }
  throw new Error("Could not resolve admin email");
}

async function getUnsupportedProductIds() {
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT DISTINCT p.id, p.code
      FROM v_inventory_channel_sync_candidates sc
      JOIN products p ON p.id = sc.product_id
      WHERE sc.ebay_sync_action = 'unsupported_variation'
      ORDER BY p.code
    `);
    return rows;
  } finally {
    await client.end().catch(() => {});
  }
}

async function countUnsupported() {
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS n FROM v_inventory_channel_sync_candidates
      WHERE ebay_sync_action = 'unsupported_variation'
    `);
    return rows[0]?.n ?? 0;
  } finally {
    await client.end().catch(() => {});
  }
}

async function adminAccessToken(env) {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const email = await resolveAdminEmail(env);
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(error.message);
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink missing hashed_token");

  const anon = createClient(url, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr) throw new Error(verifyErr.message);
  if (!session.session?.access_token) throw new Error("No access token after verifyOtp");
  return session.session.access_token;
}

async function main() {
  const env = loadEnv();
  process.env.SUPABASE_DB_PASSWORD =
    env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
  const before = await countUnsupported();
  const products = await getUnsupportedProductIds();
  console.log(`Unsupported variation variants (before): ${before}`);
  console.log(`Products to refresh (${products.length}):`, products.map((p) => p.code).join(", "));

  if (!products.length) {
    console.log("Nothing to refresh.");
    return;
  }

  const token = await adminAccessToken(env);
  const productIds = products.map((p) => p.id);
  const resp = await fetch(`${env.SUPABASE_URL}/functions/v1/sync-ebay-listing-inventory-cache`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ productIds, limit: 50 }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    console.error("Cache refresh failed:", data.error || resp.status);
    process.exit(1);
  }

  console.log("Refresh summary:", JSON.stringify(data.summary, null, 2));
  if (Array.isArray(data.results)) {
    for (const r of data.results) {
      const code = products.find((p) => p.id === r.productId)?.code || r.productId;
      console.log(`  ${code}: ${r.status} rows=${r.cacheRows ?? "?"} errors=${JSON.stringify(r.errors || [])}`);
    }
  }

  const after = await countUnsupported();
  console.log(`Unsupported variation variants (after): ${after}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

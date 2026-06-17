#!/usr/bin/env node
/**
 * Refresh eBay listing cache for one product (KK-0001 beanie test case).
 * Run: node scripts/supabase/refresh-ebay-product-cache.mjs KK-0001
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { getPoolerConnectionString } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const productCode = process.argv[2] || "KK-0001";

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
    connectionString: getPoolerConnectionString({ password: env.SUPABASE_DB_PASSWORD }),
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

async function getProductId(code) {
  const env = loadEnv();
  const client = new pg.Client({
    connectionString: getPoolerConnectionString({ password: env.SUPABASE_DB_PASSWORD }),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, code, ebay_item_group_key FROM products WHERE code ILIKE $1 LIMIT 1`,
      [code],
    );
    if (!rows[0]) throw new Error(`Product not found: ${code}`);
    return rows[0];
  } finally {
    await client.end().catch(() => {});
  }
}

async function adminAccessToken(env) {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = await resolveAdminEmail(env);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(error.message);
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink missing hashed_token");

  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr) throw new Error(verifyErr.message);
  if (!session.session?.access_token) throw new Error("No access token");
  return session.session.access_token;
}

async function main() {
  const env = loadEnv();
  const product = await getProductId(productCode);
  console.log(`Refreshing eBay cache for ${product.code} (${product.id}) group=${product.ebay_item_group_key}`);

  const token = await adminAccessToken(env);
  const resp = await fetch(`${env.SUPABASE_URL}/functions/v1/sync-ebay-listing-inventory-cache`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ productIds: [product.id], limit: 1 }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    console.error("Cache refresh failed:", data.error || resp.status, data);
    process.exit(1);
  }

  console.log("Refresh summary:", JSON.stringify(data.summary, null, 2));
  if (Array.isArray(data.results)) {
    for (const r of data.results) {
      console.log(`  ${product.code}: ${r.status} rows=${r.cacheRows ?? "?"} errors=${JSON.stringify(r.errors || [])}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

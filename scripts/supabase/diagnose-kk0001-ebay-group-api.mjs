#!/usr/bin/env node
/**
 * Diagnose KK-0001 eBay group / child offer lookups.
 * Run: node scripts/supabase/diagnose-kk0001-ebay-group-api.mjs
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { getPoolerConnectionString } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const INV_API = "https://api.ebay.com/sell/inventory/v1";

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

async function getProduct() {
  const env = loadEnv();
  const client = new pg.Client({
    connectionString: getPoolerConnectionString({ password: env.SUPABASE_DB_PASSWORD }),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT p.id, p.code, p.ebay_item_group_key, p.ebay_listing_id, p.ebay_status,
             json_agg(json_build_object('option_value', pv.option_value, 'sku', pv.sku)) AS variants
      FROM products p
      JOIN product_variants pv ON pv.product_id = p.id AND COALESCE(pv.is_active, true)
      WHERE p.code ILIKE 'KK-0001'
      GROUP BY p.id, p.code, p.ebay_item_group_key, p.ebay_listing_id, p.ebay_status
    `);
    return rows[0];
  } finally {
    await client.end();
  }
}

function expectedSku(code, optionValue) {
  const suffix = String(optionValue || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return `${code}-${suffix}`;
}

async function getEbayToken(env) {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.from("marketplace_tokens").select("access_token, token_expires_at").eq("platform", "ebay").maybeSingle();
  if (error || !data?.access_token) throw new Error("No eBay access token in marketplace_tokens");
  return data.access_token;
}

async function ebayGet(token, path) {
  const resp = await fetch(`${INV_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
  });
  const text = await resp.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: resp.status, body };
}

async function main() {
  const env = loadEnv();
  const product = await getProduct();
  if (!product) throw new Error("KK-0001 not found");

  console.log("Product:", {
    code: product.code,
    ebay_item_group_key: product.ebay_item_group_key,
    ebay_listing_id: product.ebay_listing_id,
    ebay_status: product.ebay_status,
  });

  const variants = product.variants || [];
  const childSkus = variants.map((v) => v.sku?.trim() || expectedSku(product.code, v.option_value));
  console.log("Expected child SKUs:", childSkus);

  const token = await getEbayToken(env);

  const groupKey = product.ebay_item_group_key;
  const tries = [
    ["inventory_item_group", `/inventory_item_group/${encodeURIComponent(groupKey)}`],
    ["offer_by_group_key", `/offer?inventory_item_group_key=${encodeURIComponent(groupKey)}`],
    ...childSkus.map((sku) => ["offer_by_sku", `/offer?sku=${encodeURIComponent(sku)}`, sku]),
    ["inventory_item_black", `/inventory_item/${encodeURIComponent(childSkus[0] || "KK-0001-BLACK")}`],
  ];

  for (const [label, path, sku] of tries) {
    console.log(`\n--- ${label}${sku ? ` (${sku})` : ""} ---`);
    const r = await ebayGet(token, path);
    console.log("status:", r.status);
    const preview = JSON.stringify(r.body, null, 2);
    console.log(preview.length > 1200 ? preview.slice(0, 1200) + "\n..." : preview);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

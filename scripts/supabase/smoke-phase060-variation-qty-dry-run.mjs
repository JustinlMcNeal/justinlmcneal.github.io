#!/usr/bin/env node
/**
 * Phase 060 deploy smoke — dry-run variation child qty for one product/variant.
 * No live eBay mutation (EBAY_ENABLE_LIVE_QUANTITY_PATCH=false).
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const productId = process.env.TEST_EBAY_VARIATION_PRODUCT_ID || "1d76d383-c172-4879-a29c-fecb267c9998";
const variantId = process.env.TEST_EBAY_VARIATION_VARIANT_ID || "4c8c5709-b2c9-4fa6-b7bd-5416b83c9951";
const qty = Number(process.env.TEST_EBAY_VARIATION_QTY || 1);

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const resp = await fetch(`${url}/functions/v1/sync-ebay-inventory-quantity`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    mode: "variation_child_update_qty",
    productId,
    variantId,
    quantity: qty,
    preview: true,
  }),
});

const data = await resp.json().catch(() => ({}));
console.log("HTTP", resp.status);
console.log(JSON.stringify(data, null, 2));

if (!resp.ok) {
  process.exit(1);
}

const status = data.status || data.results?.[0]?.status;
if (status === "dry_run" || status === "success" || data.preview === true) {
  console.log("\nPASS — variation child qty dry-run smoke");
} else {
  console.error("\nUnexpected status:", status);
  process.exit(1);
}

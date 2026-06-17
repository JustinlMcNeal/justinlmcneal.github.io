#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient } from "./dbConnect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

try {
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
} catch {
  // optional
}

const client = await connectPgClient();
try {
  const q = async (label, sql) => {
    console.log(`\n=== ${label} ===`);
    try {
      const r = await client.query(sql);
      console.log(JSON.stringify(r.rows, null, 2));
    } catch (e) {
      console.error("ERROR:", e.message);
    }
  };

  await q(
    "product KK-0001",
    `SELECT id, code, ebay_item_group_key, ebay_listing_id, ebay_status, ebay_offer_id
     FROM products WHERE code ILIKE 'KK-0001' OR code ILIKE 'KK_0001' LIMIT 3`,
  );
  await q(
    "black variant",
    `SELECT pv.id, pv.sku, pv.option_name, pv.option_value, pv.stock, p.code
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE p.code ILIKE 'KK-0001' AND pv.option_value ILIKE 'black' LIMIT 3`,
  );
  await q(
    "variation candidate view exists",
    `SELECT to_regclass('public.v_inventory_ebay_variation_sync_candidates') AS view_name`,
  );
  await q(
    "variation candidate black",
    `SELECT variant_id, expected_ebay_sku, cache_ebay_sku, child_offer_id, child_listing_status,
            kk_available_qty, ebay_child_qty, candidate_state, candidate_reason, is_actionable, mapping_confidence
     FROM v_inventory_ebay_variation_sync_candidates
     WHERE product_code ILIKE 'KK-0001' AND option_value ILIKE 'black' LIMIT 3`,
  );
  await q(
    "all variation candidates for product",
    `SELECT option_value, candidate_state, candidate_reason, expected_ebay_sku, cache_ebay_sku, child_offer_id
     FROM v_inventory_ebay_variation_sync_candidates
     WHERE product_code ILIKE 'KK-0001' ORDER BY option_value`,
  );
  await q(
    "channel sync candidate",
    `SELECT variant_id, ebay_sync_action, product_id, ebay_item_group_key, product_active_variant_count
     FROM v_inventory_channel_sync_candidates
     WHERE product_code ILIKE 'KK-0001' LIMIT 8`,
  );
  await q(
    "ebay cache rows",
    `SELECT variant_id, ebay_sku, current_qty, listing_status, raw_payload_json->>'offerId' AS offer_id
     FROM ebay_listing_inventory_cache
     WHERE product_id IN (SELECT id FROM products WHERE code ILIKE 'KK-0001')
     ORDER BY ebay_sku LIMIT 15`,
  );
} finally {
  await client.end();
}

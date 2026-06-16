#!/usr/bin/env node
/**
 * Verify order summary views use landed CPI (variant override + product fallback).
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_VARIANT_ID = "a76174c5-698c-402a-9d82-6f40c69c04bb";

const CHANGED_FILES = [
  "supabase/migrations/20260822_update_order_summary_landed_cpi.sql",
  "pages/admin/lineItemsOrders.html",
  "js/admin/lineItemsOrders/api.js",
];

const FORBIDDEN = [
  /UPDATE\s+public\.products/i,
  /UPDATE\s+public\.product_variants/i,
  /SET\s+stock/i,
  /INSERT\s+INTO\s+public\.stock_ledger/i,
  /approve_parcel_import_cpi/i,
  /receive_parcel_import_inventory/i,
];

function loadEnv() {
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0 && !process.env[t.slice(0, i).trim()]) {
        process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
    }
  } catch {}
}

async function main() {
  const errors = [];
  loadEnv();

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 1) Functions exist and match expected math
  const fn70 = await client.query(
    `SELECT public.order_line_cpi_usd(0.47, 70, 80) AS variant_cpi,
            public.order_line_cpi_usd(0.47, NULL, 80) AS product_cpi`,
  );
  const variantCpi = Number(fn70.rows[0].variant_cpi);
  const productCpi = Number(fn70.rows[0].product_cpi);
  if (Math.abs(variantCpi - 0.7) > 0.001) {
    errors.push(`order_line_cpi_usd variant: expected 0.70 got ${variantCpi}`);
  }
  if (productCpi <= 0.47) {
    errors.push(`order_line_cpi_usd product fallback should exceed unit_cost 0.47, got ${productCpi}`);
  }
  console.log("SQL functions:", { variantCpi, productCpi });

  // 2) View definitions reference variant override
  for (const view of ["v_order_financials", "v_ebay_order_profit", "v_amazon_order_profit"]) {
    const { rows } = await client.query(
      `SELECT pg_get_viewdef($1::regclass, true) AS def`,
      [`public.${view}`],
    );
    const def = rows[0]?.def || "";
    if (!def.includes("unit_cost_override_cents")) {
      errors.push(`${view} missing unit_cost_override_cents join`);
    }
    if (!def.includes("order_line_cpi_usd")) {
      errors.push(`${view} missing order_line_cpi_usd()`);
    }
  }
  console.log("Views: landed CPI joins present");

  // 3) Test variant row — mock 70¢ line cost vs product-only
  const { rows: variantRow } = await client.query(
    `SELECT pv.unit_cost_override_cents, p.unit_cost, p.weight_g, p.code
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id = $1`,
    [TEST_VARIANT_ID],
  );
  if (variantRow.length) {
    const v = variantRow[0];
    const mockVariant = await client.query(
      `SELECT public.order_line_cpi_usd($1, 70, $2) AS cpi`,
      [v.unit_cost, v.weight_g],
    );
    const mockProduct = await client.query(
      `SELECT public.order_line_cpi_usd($1, NULL, $2) AS cpi`,
      [v.unit_cost, v.weight_g],
    );
    console.log("Test variant:", {
      code: v.code,
      override: v.unit_cost_override_cents,
      mock70Cpi: mockVariant.rows[0].cpi,
      productFallbackCpi: mockProduct.rows[0].cpi,
    });
    if (Number(mockVariant.rows[0].cpi) !== 0.7) {
      errors.push("Mock 70¢ variant CPI should be 0.70");
    }
  }

  // 4) Find a real order line with variant text (if any)
  const { rows: sampleLines } = await client.query(
    `SELECT li.stripe_checkout_session_id, li.product_id, li.variant, li.quantity,
            public.order_line_cpi_usd(p.unit_cost, pv.unit_cost_override_cents, p.weight_g) AS line_cpi,
            pv.unit_cost_override_cents
     FROM line_items_raw li
     JOIN products p ON p.code = li.product_id
     LEFT JOIN product_variants pv
       ON pv.product_id = p.id
      AND NULLIF(trim(li.variant), '') IS NOT NULL
      AND lower(trim(pv.option_value)) = lower(trim(li.variant))
     WHERE NULLIF(trim(li.variant), '') IS NOT NULL
     ORDER BY li.order_date DESC NULLS LAST
     LIMIT 5`,
  );
  console.log("Sample variant order lines:", sampleLines.length);
  if (sampleLines.length) {
    const withOverride = sampleLines.filter((r) => r.unit_cost_override_cents != null);
    console.log("  with variant override:", withOverride.length);
    for (const row of withOverride.slice(0, 2)) {
      const expected = Number(row.unit_cost_override_cents) / 100;
      if (Math.abs(Number(row.line_cpi) - expected) > 0.01) {
        errors.push(
          `Line ${row.product_id}/${row.variant}: CPI ${row.line_cpi} != override ${expected}`,
        );
      }
    }
  }

  // 5) v_order_summary_plus readable
  const { rows: summary } = await client.query(
    `SELECT stripe_checkout_session_id, product_cost_total_cents, profit_cents
     FROM v_order_summary_plus
     WHERE profit_cents IS NOT NULL
     ORDER BY order_date DESC
     LIMIT 3`,
  );
  if (!summary.length) {
    errors.push("v_order_summary_plus returned no rows with profit");
  } else {
    console.log("Summary sample:", summary);
  }

  await client.end();

  // Safety grep
  for (const rel of CHANGED_FILES) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(text)) errors.push(`Safety: ${rel} matches ${re}`);
    }
  }
  console.log("Safety grep: OK");

  if (errors.length) {
    console.error("\nFAILED:");
    errors.forEach((e) => console.error(" -", e));
    process.exitCode = 1;
    return;
  }
  console.log("\nAll order summary landed CPI view checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

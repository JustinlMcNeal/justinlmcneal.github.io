#!/usr/bin/env node
/**
 * Verify landed CPI integration for Products + Orders admin pages.
 * - DB check for test variant a76174c5-698c-402a-9d82-6f40c69c04bb
 * - landedCpi.js utility tests
 * - Safety: changed files must not write cost/stock
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";
import {
  CPI_SOURCE,
  formatLandedCpiUsd,
  resolveLandedCpiUsd,
  resolveOrderLineItemCost,
} from "../js/shared/landedCpi.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_VARIANT_ID = "a76174c5-698c-402a-9d82-6f40c69c04bb";

const CHANGED_FILES = [
  "js/shared/landedCpi.js",
  "js/admin/products/api.js",
  "js/admin/products/renderTable.js",
  "js/admin/products/modalRows.js",
  "js/admin/products/modalEditor.js",
  "js/admin/lineItemsOrders/api.js",
  "js/admin/lineItemsOrders/workspaceOverview.js",
  "js/admin/lineItemsOrders/workspaceFinancials.js",
];

const FORBIDDEN_PATTERNS = [
  /\.update\s*\(\s*\{[^}]*unit_cost/,
  /unit_cost_override_cents\s*:/,
  /approve_parcel_import_cpi/,
  /receive_parcel_import_inventory/,
  /\.insert\s*\([^)]*stock_ledger/,
  /\.from\s*\(\s*["']stock_ledger["']\s*\)\s*\.(insert|update|upsert|delete)/,
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
  } catch {
    // optional
  }
}

function testUtilities(errors) {
  const variant = resolveLandedCpiUsd({
    unitCost: 0.5,
    unitCostOverrideCents: 70,
  });
  if (variant.landedCpiUsd !== 0.7 || variant.source !== CPI_SOURCE.VARIANT) {
    errors.push(`variant CPI: expected $0.70 variant, got ${JSON.stringify(variant)}`);
  }
  if (formatLandedCpiUsd(0.7) !== "$0.70") {
    errors.push(`formatLandedCpiUsd(0.7) expected $0.70`);
  }

  const productOnly = resolveLandedCpiUsd({ unitCost: 0.55, unitCostOverrideCents: null });
  if (productOnly.landedCpiUsd !== 0.55 || productOnly.source !== CPI_SOURCE.PRODUCT) {
    errors.push(`product CPI fallback failed: ${JSON.stringify(productOnly)}`);
  }

  const lineVariant = resolveOrderLineItemCost({
    productUnitCost: 0.5,
    variantOverrideCents: 70,
    supplierShipPerUnitUsd: 0.12,
    quantity: 2,
  });
  if (lineVariant.cpiCents !== 70) {
    errors.push(`variant line CPI should be 70¢ not ${lineVariant.cpiCents}`);
  }
  if (lineVariant.lineCostCents !== 140) {
    errors.push(`variant line cost 2×70¢ = 140¢, got ${lineVariant.lineCostCents}`);
  }
  if (lineVariant.includesEstimatedSupplierShip) {
    errors.push("variant line should not include estimated supplier ship");
  }

  const lineProduct = resolveOrderLineItemCost({
    productUnitCost: 0.5,
    variantOverrideCents: null,
    supplierShipPerUnitUsd: 0.12,
    quantity: 1,
  });
  if (lineProduct.cpiCents !== 62) {
    errors.push(`product line CPI should be 62¢ (50+12), got ${lineProduct.cpiCents}`);
  }
  if (!lineProduct.includesEstimatedSupplierShip) {
    errors.push("product fallback should flag estimated supplier ship");
  }
}

async function testDbVariant(errors) {
  loadEnv();
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query(
    `SELECT pv.id, pv.option_value, pv.unit_cost_override_cents, p.unit_cost, p.name, p.code
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id = $1`,
    [TEST_VARIANT_ID],
  );
  if (!rows.length) {
    errors.push(`Test variant ${TEST_VARIANT_ID} not found in DB`);
    await client.end();
    return;
  }

  const row = rows[0];
  const override = row.unit_cost_override_cents != null ? Number(row.unit_cost_override_cents) : null;
  console.log("DB test variant:", {
    id: row.id,
    name: row.name,
    option: row.option_value,
    unit_cost_override_cents: override,
    product_unit_cost: row.unit_cost,
  });

  const resolved = resolveLandedCpiUsd({
    unitCost: row.unit_cost,
    unitCostOverrideCents: override,
  });
  const expectedCents = override ?? (row.unit_cost != null ? Math.round(Number(row.unit_cost) * 100) : null);
  if (expectedCents != null && Math.round(resolved.landedCpiUsd * 100) !== expectedCents) {
    errors.push(
      `DB variant resolved CPI ${resolved.landedCpiUsd} != expected ${expectedCents / 100}`,
    );
  }
  const display = formatLandedCpiUsd(resolved.landedCpiUsd);
  if (override != null && display === "—") {
    errors.push(`Variant override ${override}¢ should format as USD, got —`);
  }
  if (override == null && resolved.source !== CPI_SOURCE.PRODUCT) {
    errors.push(`Null override should fall back to product CPI`);
  }

  const mock70 = resolveOrderLineItemCost({
    productUnitCost: row.unit_cost,
    variantOverrideCents: 70,
    supplierShipPerUnitUsd: 0.12,
    quantity: 2,
  });
  if (mock70.cpiCents !== 70 || mock70.lineCostCents !== 140) {
    errors.push(`Mock 70¢ variant line: expected 70¢/140¢, got ${mock70.cpiCents}/${mock70.lineCostCents}`);
  }

  await client.end();
}

function safetyGrep(errors) {
  for (const rel of CHANGED_FILES) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(text)) {
        errors.push(`Safety: ${rel} matches forbidden pattern ${re}`);
      }
    }
  }
  console.log("Safety grep: no cost/stock writes in changed JS files");
}

async function main() {
  const errors = [];
  testUtilities(errors);
  await testDbVariant(errors);
  safetyGrep(errors);

  if (errors.length) {
    console.error("\nFAILED:");
    errors.forEach((e) => console.error(" -", e));
    process.exitCode = 1;
    return;
  }
  console.log("\nAll CPI products/orders checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

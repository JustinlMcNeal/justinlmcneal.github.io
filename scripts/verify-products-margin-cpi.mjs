#!/usr/bin/env node
/**
 * Verify Products margin badges use canonical landed CPI.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  calculateMarginFromCpi,
  resolveProductsMarginCpiUsd,
} from "../js/shared/landedCpi.js";
import {
  computeVariantMargin,
  computeProductMarginDisplay,
} from "../js/admin/products/productMargin.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CHANGED_FILES = [
  "js/shared/landedCpi.js",
  "js/admin/products/productMargin.js",
  "js/admin/products/renderTable.js",
  "js/admin/products/modalRows.js",
  "js/admin/products/modalEditor.js",
];

const FORBIDDEN = [
  /unit_cost_override_cents\s*:/,
  /\.update\s*\([^)]*unit_cost/,
  /SET\s+stock/i,
  /stock_ledger/i,
  /approve_parcel_import_cpi/i,
  /receive_parcel_import_inventory/i,
];

function safetyGrep(errors) {
  for (const rel of CHANGED_FILES) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(text)) {
        const isReadOnlyOverride =
          rel.includes("modalRows") && /unit_cost_override_cents/.test(String(re));
        if (isReadOnlyOverride) continue;
        errors.push(`Safety: ${rel} matches ${re}`);
      }
    }
  }
}

function runScript(rel, errors) {
  const r = spawnSync("node", [join(ROOT, rel)], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    errors.push(`${rel} failed:\n${[r.stdout, r.stderr].filter(Boolean).join("\n")}`);
  } else {
    console.log(`${rel}: OK`);
  }
}

function main() {
  const errors = [];

  const variantCpi = resolveProductsMarginCpiUsd({
    unitCost: 0.47,
    unitCostOverrideCents: 70,
    supplierShipPerUnitUsd: 0.5,
  });
  if (variantCpi.cpiUsd !== 0.7) {
    errors.push(`Variant margin CPI should be 0.70, got ${variantCpi.cpiUsd}`);
  }

  const productCpi = resolveProductsMarginCpiUsd({
    unitCost: 0.47,
    unitCostOverrideCents: null,
    supplierShipPerUnitUsd: 0.12,
  });
  if (Math.abs(Number(productCpi.cpiUsd) - 0.59) > 0.001) {
    errors.push(`Product margin CPI should be 0.59, got ${productCpi.cpiUsd}`);
  }

  const margin70 = calculateMarginFromCpi({
    price: 2.5,
    cpiUsd: 0.7,
    outboundShippingUsd: 0,
  });
  if (!margin70 || Math.abs(margin70.marginPercent - 72) > 0.5) {
    errors.push(`Margin at $2.50 / $0.70 CPI expected ~72%, got ${margin70?.marginPercent}`);
  }

  const mockVariant = computeVariantMargin({
    price: 2.5,
    weightG: 80,
    unitCost: 0.47,
    unitCostOverrideCents: 70,
  });
  if (!mockVariant || mockVariant.source !== "variant") {
    errors.push("computeVariantMargin should use variant source for 70¢ override");
  }
  if (mockVariant && Math.abs(mockVariant.inboundCpiUsd - 0.7) > 0.001) {
    errors.push(`Variant inbound CPI should be 0.70, got ${mockVariant.inboundCpiUsd}`);
  }
  console.log("Mock variant margin:", mockVariant);

  const mockProduct = {
    price: 2.5,
    weight_g: 80,
    unit_cost: 0.47,
    product_variants: [
      { is_active: true, unit_cost_override_cents: 70, option_value: "Black" },
      { is_active: true, unit_cost_override_cents: null, option_value: "Red" },
    ],
  };
  const disp = computeProductMarginDisplay(mockProduct);
  if (!disp.hasVariantOverrides || disp.overrideCount !== 1) {
    errors.push("Expected 1 variant override in margin display");
  }
  if (disp.variantMin == null || disp.variantMax == null) {
    errors.push("Expected variant margin range");
  }
  console.log("Product margin display:", disp);

  const productsHtml = readFileSync(join(ROOT, "pages/admin/products.html"), "utf8");
  if (!productsHtml.includes('data-sort="margin"')) {
    errors.push("products.html missing margin column");
  }
  if (!productsHtml.includes("CPI")) {
    errors.push("products.html missing CPI column");
  }
  console.log("products.html: margin + CPI columns present");

  safetyGrep(errors);
  console.log("Safety grep: OK");

  runScript("scripts/verify-cpi-products-orders.mjs", errors);
  runScript("scripts/verify-cpi-order-summary-views.mjs", errors);

  if (errors.length) {
    console.error("\nFAILED:");
    errors.forEach((e) => console.error(" -", e));
    process.exitCode = 1;
    return;
  }
  console.log("\nAll products margin CPI checks passed.");
}

main();

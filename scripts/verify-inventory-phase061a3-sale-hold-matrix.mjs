/**
 * Phase 061A.3 — Sale hold matrix verification (static).
 *
 * Run: node scripts/verify-inventory-phase061a3-sale-hold-matrix.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const MIGRATION = "supabase/migrations/20261027_inventory_phase061a_sale_hold_reservations.sql";
const SALE_HOLD = "supabase/functions/_shared/marketplaceSaleHold.ts";

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
];

const MATRIX_CHECKS = [
  { label: "RPC reserve_inventory_for_marketplace_sale", file: MIGRATION, pattern: /reserve_inventory_for_marketplace_sale/ },
  { label: "Audit table inventory_sale_hold_actions", file: MIGRATION, pattern: /inventory_sale_hold_actions/ },
  { label: "Idempotency key sale:channel:order:line:reserve", file: MIGRATION, pattern: /sale:%s:%s:%s:reserve/ },
  { label: "Skip already_reserved", file: MIGRATION, pattern: /already_reserved/ },
  { label: "Skip unmapped_line", file: MIGRATION, pattern: /unmapped_line/ },
  { label: "Skip afn_skip", file: MIGRATION, pattern: /afn_skip/ },
  { label: "Skip canceled_or_refunded", file: MIGRATION, pattern: /canceled_or_refunded/ },
  { label: "Skip already_shipped", file: MIGRATION, pattern: /already_shipped/ },
  { label: "No stock UPDATE", file: MIGRATION, pattern: /UPDATE product_variants\.stock/i, invert: true },
  { label: "buildSaleHoldIdempotencyKey", file: SALE_HOLD, pattern: /buildSaleHoldIdempotencyKey/ },
  { label: "eBay hold helper", file: SALE_HOLD, pattern: /applyEbaySaleHoldsAfterIngest/ },
  { label: "Amazon hold helper", file: SALE_HOLD, pattern: /applyAmazonSaleHoldsAfterIngest/ },
  { label: "Non-fatal catch on hold", file: SALE_HOLD, pattern: /hold pass failed/i },
  { label: "eBay webhook wiring", file: "supabase/functions/ebay-webhook/index.ts", pattern: /applyEbaySaleHoldsAfterIngest/ },
  { label: "eBay sync wiring", file: "supabase/functions/ebay-sync-orders/index.ts", pattern: /applyEbaySaleHoldsAfterIngest/ },
  { label: "Amazon sync wiring", file: "supabase/functions/_shared/amazonOrderSyncUtils.ts", pattern: /applyAmazonSaleHoldsAfterIngest/ },
  { label: "KK upsertKkReservation intact", file: "supabase/functions/_shared/stripeWebhookInventory.ts", pattern: /upsertKkReservation/ },
];

const FORBIDDEN_PATTERNS = [
  { file: SALE_HOLD, patterns: [/sync-amazon-inventory-quantity/, /sync-ebay-inventory-quantity/, /saleChannelSyncOrchestrator/, /SALE_CHANNEL_SYNC_ENABLED/] },
  { file: "supabase/functions/ebay-webhook/index.ts", patterns: [/sync-ebay-inventory-quantity/, /sync-amazon-inventory-quantity/] },
  { file: "supabase/functions/ebay-sync-orders/index.ts", patterns: [/sync-ebay-inventory-quantity/, /sync-amazon-inventory-quantity/] },
  { file: "supabase/functions/_shared/amazonOrderSyncUtils.ts", patterns: [/sync-amazon-inventory-quantity/, /sync-ebay-inventory-quantity/] },
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyMatrix() {
  const notes = [];
  const errors = [];

  for (const check of MATRIX_CHECKS) {
    if (!existsSync(join(ROOT, check.file))) {
      errors.push(`Missing file: ${check.file}`);
      continue;
    }
    const text = readText(check.file);
    const found = check.pattern.test(text);
    if (check.invert ? found : !found) {
      errors.push(`Matrix fail: ${check.label}`);
    } else {
      notes.push(check.label);
    }
  }

  for (const group of FORBIDDEN_PATTERNS) {
    const text = readText(group.file);
    for (const p of group.patterns) {
      if (p.test(text)) errors.push(`${group.file}: forbidden ${p}`);
    }
  }
  notes.push("No channel push / sale sync orchestrator in 061A paths");

  return { notes, errors };
}

function verifyAdjustUnchanged() {
  const notes = [];
  const errors = [];

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (/marketplaceSaleHold|reserve_inventory_for_marketplace_sale|applyEbaySaleHoldsAfterIngest|applyAmazonSaleHoldsAfterIngest/.test(text)) {
      errors.push(`${rel}: Adjust flow must not reference 061A sale hold`);
    }
    if (/issueSnapshot|refreshIssueSnapshot|fetchChannelSyncPreview/.test(text)) {
      errors.push(`${rel}: forbidden snapshot/preview refresh`);
    }
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const adjustCalls = (orch.match(/await adjustInventory\(/g) || []).length;
  if (adjustCalls !== 1) errors.push(`adjust_inventory sole writer (found ${adjustCalls})`);
  else notes.push("adjust_inventory remains sole manual stock writer");
  notes.push("Adjust UX/runtime unchanged by 061A");

  const holdLines = readText(SALE_HOLD).split("\n").length;
  if (holdLines > MAX_LINES) errors.push(`marketplaceSaleHold.ts over ${MAX_LINES} lines (${holdLines})`);
  else notes.push("marketplaceSaleHold.ts under 500 lines");

  return { notes, errors };
}

function main() {
  const matrix = verifyMatrix();
  const adjust = verifyAdjustUnchanged();

  const notes = [...matrix.notes, ...adjust.notes];
  const errors = [...matrix.errors, ...adjust.errors];

  console.log("\n=== Phase 061A.3 — Sale Hold Matrix ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061A.3 matrix verified\n");
}

main();

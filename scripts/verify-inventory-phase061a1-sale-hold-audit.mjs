/**
 * Phase 061A.1 — Sale hold audit + design verification.
 *
 * Run: node scripts/verify-inventory-phase061a1-sale-hold-audit.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLAN_061 = "docs/pages/admin/inventory/implementation/061_sale_triggered_channel_sync_plan.md";
const PLAN_059 = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const REQUIRED_SECTIONS = [
  "061A.1 — Audit findings",
  "Sale ingest paths",
  "KK reservation path",
  "Line → variant mapping",
  "Order states — qualify vs skip",
  "Idempotency key format",
  "Reservation vs decrement decision",
  "reservation-first",
  "sale:{channel}:",
  "061B note",
  "061A.2",
  "061A.3",
  "061B.1",
  "061B",
  "061C",
  "adjust_inventory",
];

const SALE_HOLD_PATHS = [
  "supabase/functions/_shared/marketplaceSaleHold.ts",
  "supabase/migrations/20261027_inventory_phase061a_sale_hold_reservations.sql",
];

const FORBIDDEN_IN_SALE_HOLD = [
  /sync-amazon-inventory-quantity/,
  /sync-ebay-inventory-quantity/,
  /relist-ebay-variation-group/,
  /saleChannelSyncOrchestrator/,
  /SALE_CHANNEL_SYNC_ENABLED/,
  /UPDATE product_variants\.stock/i,
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyDoc() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, PLAN_061))) {
    errors.push(`Missing plan doc: ${PLAN_061}`);
    return { notes, errors };
  }

  const doc = readText(PLAN_061);
  for (const section of REQUIRED_SECTIONS) {
    if (!doc.includes(section)) errors.push(`Plan missing: ${section}`);
  }
  notes.push("061A.1 audit sections documented");

  if (!doc.includes("verify-inventory-phase061a1-sale-hold-audit.mjs")) {
    errors.push("Plan must reference this verify script");
  }

  if (!doc.includes("No channel push")) {
    errors.push("Plan must state no channel push in 061A");
  }
  notes.push("Reservation-first decision documented");
  notes.push("Sale ingest paths documented");
  notes.push("Mapping + idempotency documented");

  return { notes, errors };
}

function verifyNoChannelPush() {
  const notes = [];
  const errors = [];

  for (const rel of SALE_HOLD_PATHS) {
    if (!existsSync(join(ROOT, rel))) {
      errors.push(`Missing 061A artifact: ${rel}`);
      continue;
    }
    const text = readText(rel);
    for (const pattern of FORBIDDEN_IN_SALE_HOLD) {
      if (pattern.test(text)) {
        errors.push(`${rel}: forbidden pattern ${pattern}`);
      }
    }
  }

  const ebayWebhook = readText("supabase/functions/ebay-webhook/index.ts");
  const amazonSync = readText("supabase/functions/_shared/amazonOrderSyncUtils.ts");
  for (const [label, text] of [["ebay-webhook", ebayWebhook], ["amazonOrderSyncUtils", amazonSync]]) {
    if (/sync-amazon-inventory-quantity|sync-ebay-inventory-quantity|saleChannelSyncOrchestrator/.test(text)) {
      errors.push(`${label}: must not invoke channel push in 061A`);
    }
    if (!/marketplaceSaleHold|applyEbaySaleHoldsAfterIngest|applyAmazonSaleHoldsAfterIngest/.test(text)) {
      errors.push(`${label}: missing sale hold wiring`);
    }
  }

  notes.push("No channel push in 061A artifacts");
  notes.push("eBay/Amazon sale hold wiring present");

  return { notes, errors };
}

function verifyPhasesFrozen() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);

  if (!/059.*✅ Complete|Phase 059.*Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 059 must remain complete/frozen");
  }
  if (!/060.*✅ Complete|Phase 060.*Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 060 must remain complete/frozen");
  }

  const static059 = spawnSync(process.execPath, ["scripts/verify-inventory-phase059-final.mjs", "--static"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, VERIFY_FAST: "1" },
  });
  if (static059.status === 0) notes.push("059 final static PASS");
  else errors.push("059 final static regression FAIL");

  if (!/060.*✅ Complete|Phase 060.*Complete.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: Phase 060 must remain complete/frozen");
  } else {
    notes.push("060 frozen per roadmap (full freeze in 061A final compose)");
  }

  if (!readText(PLAN_059).includes("Frozen") && !readText(PLAN_059).includes("Complete")) {
    errors.push("059 plan must remain frozen");
  }
  if (!readText(PLAN_060).includes("Frozen") && !readText(PLAN_060).includes("Complete")) {
    errors.push("060 plan must remain frozen");
  }

  return { notes, errors };
}

function main() {
  const doc = verifyDoc();
  const push = verifyNoChannelPush();
  const frozen = verifyPhasesFrozen();

  const notes = [...doc.notes, ...push.notes, ...frozen.notes];
  const errors = [...doc.errors, ...push.errors, ...frozen.errors];

  console.log("\n=== Phase 061A.1 — Sale Hold Audit ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061A.1 audit verified\n");
}

main();

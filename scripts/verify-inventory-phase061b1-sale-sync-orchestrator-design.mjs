/**
 * Phase 061B.1 — Sale sync orchestrator design verification (design-only).
 *
 * Run: node scripts/verify-inventory-phase061b1-sale-sync-orchestrator-design.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLAN = "docs/pages/admin/inventory/implementation/061_sale_triggered_channel_sync_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const REQUIRED_SECTIONS = [
  "061B.1 — Sale sync orchestrator design",
  "061B.1 audit findings",
  "Orchestrator contract",
  "saleChannelSyncOrchestrator.ts",
  "Channel selection rules",
  "Candidate loading strategy",
  "Idempotency design",
  "sale:{source_channel}",
  ":push:amazon",
  ":push:ebay",
  "Option A vs Option B",
  "Option B (lightweight queue)",
  "Failure and issue handling",
  "sale_sync_push_failed",
  "sale_sync_mapping_manual",
  "sale_sync_gate_off",
  "sale_sync_disabled",
  "061B.2 scope",
  "061B.2 — Queue",
  "061B.3 scope",
  "inventory_sale_sync_queue",
  "SALE_CHANNEL_SYNC_ENABLED",
  "AMAZON_ENABLE_LIVE_PATCH",
  "EBAY_ENABLE_LIVE_QUANTITY_PATCH",
  "verify-inventory-phase060-final-freeze.mjs",
  "Qty 0",
  "no relist",
  "fetchChannelSyncPreview",
  "adjust_inventory",
  "061A",
  "061B.2",
];

const SALE_PATHS = [
  "supabase/functions/_shared/marketplaceSaleHold.ts",
  "supabase/functions/ebay-webhook/index.ts",
  "supabase/functions/ebay-sync-orders/index.ts",
  "supabase/functions/_shared/amazonOrderSyncUtils.ts",
  "supabase/functions/stripe-webhook/index.ts",
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
];

const FORBIDDEN_RUNTIME = [
  "supabase/functions/_shared/saleChannelSyncOrchestrator.ts",
  "supabase/functions/process-sale-sync-queue",
  "supabase/functions/process-sale-sync",
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyDoc() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, PLAN))) {
    errors.push(`Missing plan: ${PLAN}`);
    return { notes, errors };
  }

  const doc = readText(PLAN);
  for (const section of REQUIRED_SECTIONS) {
    if (!doc.includes(section)) errors.push(`Plan missing: ${section}`);
  }
  notes.push("061B.1 design sections documented");

  if (!doc.includes("design-only") && !doc.includes("Design-only")) {
    errors.push("061B.1 must be marked design-only");
  }
  if (!doc.includes("verify-inventory-phase061b1-sale-sync-orchestrator-design.mjs")) {
    errors.push("Plan must reference this verify script");
  }
  if (!/061B\.1.*✅|061B\.1.*Complete/i.test(doc)) {
    errors.push("061B.1 must be marked complete in plan");
  }
  if (!/061A.*✅|061A.*Frozen/i.test(doc)) {
    errors.push("061A must remain frozen in plan");
  }

  return { notes, errors };
}

function verifyNoRuntimePush() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN);
  const postRuntime = process.env.VERIFY_PHASE061_FINAL === "1"
    || /061B\.3.*✅|061B.*Complete.*Frozen/i.test(plan);

  if (postRuntime) {
    const required = [
      "supabase/functions/_shared/saleChannelSyncOrchestrator.ts",
      "supabase/functions/process-sale-channel-sync-queue/index.ts",
      "supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts",
    ];
    for (const rel of required) {
      if (!existsSync(join(ROOT, rel))) errors.push(`Post-runtime artifact missing: ${rel}`);
    }
    for (const rel of SALE_PATHS) {
      const text = readText(rel);
      if (/sync-amazon-inventory-quantity|sync-ebay-inventory-quantity|runSaleChannelSync/.test(text)) {
        errors.push(`${rel}: inline channel sync forbidden in sale ingest paths`);
      }
    }
    notes.push("061B runtime artifacts present (post-design freeze mode)");
    return { notes, errors };
  }

  for (const rel of FORBIDDEN_RUNTIME) {
    if (existsSync(join(ROOT, rel))) {
      errors.push(`Forbidden runtime artifact (design-only): ${rel}`);
    }
  }
  notes.push("No saleChannelSyncOrchestrator runtime module");

  for (const rel of SALE_PATHS) {
    const text = readText(rel);
    if (postRuntime) {
      if (/sync-amazon-inventory-quantity|sync-ebay-inventory-quantity|runSaleChannelSync/.test(text)) {
        errors.push(`${rel}: inline channel sync forbidden in sale ingest paths`);
      }
      continue;
    }
    if (/saleChannelSyncOrchestrator|process-sale-sync|inventory_sale_sync_queue/.test(text)) {
      errors.push(`${rel}: sale push runtime must not be wired yet`);
    }
    if (/sync-amazon-inventory-quantity|sync-ebay-inventory-quantity|pushAmazonFbmInventory|pushEbayInventoryQuantity/.test(text)) {
      errors.push(`${rel}: channel sync edge calls must not be in sale ingest paths`);
    }
    if (/SALE_CHANNEL_SYNC_ENABLED/.test(text)) {
      errors.push(`${rel}: master switch runtime must not be wired in 061B.1`);
    }
  }
  notes.push("No webhook/sale-path channel push calls");

  const hold = readText("supabase/functions/_shared/marketplaceSaleHold.ts");
  if (/UPDATE product_variants\.stock/i.test(hold)) {
    errors.push("marketplaceSaleHold: forbidden direct stock update");
  }
  notes.push("No direct stock updates in sale hold path");

  return { notes, errors };
}

function verifyAdjustFrozen() {
  const notes = [];
  const errors = [];

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (/saleChannelSyncOrchestrator|sale_sync|SALE_CHANNEL_SYNC/.test(text)) {
      errors.push(`${rel}: Adjust must not reference sale sync orchestrator`);
    }
    if (/issueSnapshot|refreshIssueSnapshot/.test(text)) {
      errors.push(`${rel}: forbidden snapshot refresh`);
    }
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const adjustCalls = (orch.match(/await adjustInventory\(/g) || []).length;
  if (adjustCalls !== 1) errors.push(`adjust_inventory sole writer (found ${adjustCalls})`);
  else notes.push("adjust_inventory remains sole manual/admin stock writer");

  notes.push("No Adjust runtime changes for 061B.1");

  return { notes, errors };
}

function verify061AFrozen() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);

  if (!/061A.*✅|061A.*Complete.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: 061A must remain frozen");
  }
  const postRuntime = process.env.VERIFY_PHASE061_FINAL === "1"
    || /061C\.3.*✅|Phase 061.*Production-ready/i.test(readText(PLAN));
  if (!postRuntime) {
    if (!/061B\.1.*✅|061B\.1.*Complete|061B\.2.*next/i.test(roadmap)) {
      errors.push("Roadmap: 061B.1 complete and 061B.2 next");
    }
  }
  if (!/059.*✅|Phase 059.*Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 059 frozen");
  }
  if (!/060.*✅|Phase 060.*Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 060 frozen");
  }

  const a1 = spawnSync(process.execPath, ["scripts/verify-inventory-phase061a1-sale-hold-audit.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, VERIFY_FAST: "1" },
  });
  if (a1.status === 0) notes.push("061A.1 audit regression PASS");
  else errors.push("061A.1 audit regression FAIL");

  return { notes, errors };
}

function main() {
  const doc = verifyDoc();
  const runtime = verifyNoRuntimePush();
  const adjust = verifyAdjustFrozen();
  const frozen = verify061AFrozen();

  const notes = [...doc.notes, ...runtime.notes, ...adjust.notes, ...frozen.notes];
  const errors = [...doc.errors, ...runtime.errors, ...adjust.errors, ...frozen.errors];

  console.log("\n=== Phase 061B.1 — Sale Sync Orchestrator Design ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061B.1 design verified (no runtime sale push)\n");
}

main();

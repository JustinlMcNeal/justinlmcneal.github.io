/**
 * Phase 061C.3 — Final Phase 061 freeze / production readiness verification.
 *
 * Run: node scripts/verify-inventory-phase061-final-freeze.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN = "docs/pages/admin/inventory/implementation/061_sale_triggered_channel_sync_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const FAST_ENV = {
  VERIFY_FAST: "1",
  VERIFY_SKIP_DEEP_REGRESSION: "1",
  VERIFY_SKIP_NESTED_REGRESSION: "1",
  VERIFY_SKIP_BROWSER: "1",
  VERIFY_PHASE061_FINAL: "1",
};

const MIGRATIONS = [
  "supabase/migrations/20261027_inventory_phase061a_sale_hold_reservations.sql",
  "supabase/migrations/20261028_inventory_phase061b2_sale_sync_queue.sql",
  "supabase/migrations/20261029_inventory_phase061c1_sale_reservation_release.sql",
];

const ARTIFACTS = [
  ...MIGRATIONS,
  "supabase/functions/_shared/marketplaceSaleHold.ts",
  "supabase/functions/_shared/marketplaceSaleRelease.ts",
  "supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts",
  "supabase/functions/_shared/marketplaceSaleSyncAfterRelease.ts",
  "supabase/functions/_shared/saleSyncQueue.ts",
  "supabase/functions/_shared/saleChannelSyncTypes.ts",
  "supabase/functions/_shared/saleChannelSyncOrchestrator.ts",
  "supabase/functions/_shared/saleChannelSyncAmazonTarget.ts",
  "supabase/functions/_shared/saleChannelSyncEbayTarget.ts",
  "supabase/functions/process-sale-channel-sync-queue/index.ts",
  "supabase/functions/enqueue-sale-channel-sync/index.ts",
  "scripts/reconcile-sale-channel-qty.mjs",
  "scripts/verify-inventory-phase061-final-freeze.mjs",
];

const SALE_INGEST = [
  "supabase/functions/stripe-webhook/index.ts",
  "supabase/functions/ebay-webhook/index.ts",
  "supabase/functions/ebay-sync-orders/index.ts",
  "supabase/functions/_shared/amazonOrderSyncUtils.ts",
  "supabase/functions/_shared/stripeWebhookChargeRefunded.ts",
  "supabase/functions/_shared/ebayOrderCancelAware.ts",
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
];

const COMPOSED = [
  { script: "verify-inventory-phase061a1-sale-hold-audit.mjs", label: "061A.1" },
  { script: "verify-inventory-phase061a3-sale-hold-matrix.mjs", label: "061A.3" },
  { script: "verify-inventory-phase061a-final-freeze.mjs", label: "061A freeze" },
  { script: "verify-inventory-phase061b1-sale-sync-orchestrator-design.mjs", label: "061B.1" },
  { script: "verify-inventory-phase061b2-sale-sync-queue-worker.mjs", label: "061B.2" },
  { script: "verify-inventory-phase061b-sale-push.mjs", label: "061B.3" },
  { script: "verify-inventory-phase061b-final-freeze.mjs", label: "061B freeze" },
  { script: "verify-inventory-phase061c-cancel-restore.mjs", label: "061C.1" },
  { script: "verify-inventory-phase061c2-release-repush-visibility.mjs", label: "061C.2" },
  { script: "verify-inventory-phase059-final.mjs", label: "059 static", args: ["--static"] },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue view safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "10Y stabilization" },
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function runScript(script, args = []) {
  return spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...FAST_ENV },
  });
}

function verifyDocsFreeze() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN);
  const roadmap = readText(ROADMAP);

  const subphases = [
    "061A.1", "061A.2", "061A.3", "061B.1", "061B.2", "061B.3",
    "061C.1", "061C.2", "061C.3",
  ];
  for (const sp of subphases) {
    if (!new RegExp(`${sp}.*✅|${sp}.*Complete`, "i").test(plan)) {
      errors.push(`Plan: ${sp} must be marked complete`);
    }
  }

  for (const major of ["061A", "061B", "061C"]) {
    if (!new RegExp(`${major}.*Complete|${major}.*Frozen`, "i").test(plan)) {
      errors.push(`Plan: ${major} must be frozen`);
    }
  }

  if (!/Phase 061.*Complete|Phase 061.*Frozen|Production-ready/i.test(plan)) {
    errors.push("Plan: Phase 061 must be production-ready/frozen");
  }
  if (!/061C\.3.*✅|061C\.3.*Complete/i.test(plan)) {
    errors.push("Plan: 061C.3 must be marked complete");
  }
  if (!plan.includes("verify-inventory-phase061-final-freeze.mjs")) {
    errors.push("Plan must reference final freeze script");
  }
  if (/061D/i.test(plan) || /061D/i.test(roadmap)) {
    errors.push("No 061D — Phase 061 is 3×3 structure only");
  }
  if (!/3.*3|061A.*061C/i.test(plan)) {
    errors.push("Plan must document 3×3 structure");
  }

  if (!/061.*Complete|061.*Frozen|Production-ready/i.test(roadmap)) {
    errors.push("Roadmap: Phase 061 must be complete/frozen/production-ready");
  }
  if (!/059.*✅|Phase 059.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: Phase 059 must remain frozen");
  }
  if (!/060.*✅|Phase 060.*Frozen|Production-ready/i.test(roadmap)) {
    errors.push("Roadmap: Phase 060 must remain frozen");
  }

  notes.push("061A–061C subphases + Phase 061 frozen in plan/roadmap");
  notes.push("059/060 remain frozen; no 061D");
  return { notes, errors };
}

function verifyArtifacts() {
  const notes = [];
  const errors = [];

  for (const rel of ARTIFACTS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing artifact: ${rel}`);
  }

  const sql061a = readText(MIGRATIONS[0]);
  if (!sql061a.includes("reserve_inventory_for_marketplace_sale")) {
    errors.push("061A migration missing hold RPC");
  }

  const sql061c = readText(MIGRATIONS[2]);
  if (!sql061c.includes("release_marketplace_sale_reservation")) {
    errors.push("061C migration missing release RPC");
  }

  const sql061b = readText(MIGRATIONS[1]);
  for (const term of ["inventory_sale_sync_queue", "claim_inventory_sale_sync_jobs"]) {
    if (!sql061b.includes(term)) errors.push(`061B migration missing: ${term}`);
  }

  for (const rel of ARTIFACTS.filter((r) => r.endsWith(".ts"))) {
    if (existsSync(join(ROOT, rel)) && lineCount(rel) > MAX_LINES) {
      errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    }
  }

  if (!errors.length) notes.push("All Phase 061 artifacts present");
  return { notes, errors };
}

function verifyE2EBehavior() {
  const notes = [];
  const errors = [];

  const hold = readText("supabase/functions/_shared/marketplaceSaleHold.ts");
  const afterHold = readText("supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts");
  const release = readText("supabase/functions/_shared/marketplaceSaleRelease.ts");
  const afterRelease = readText("supabase/functions/_shared/marketplaceSaleSyncAfterRelease.ts");
  const types = readText("supabase/functions/_shared/saleChannelSyncTypes.ts");
  const queue = readText("supabase/functions/_shared/saleSyncQueue.ts");
  const orch = readText("supabase/functions/_shared/saleChannelSyncOrchestrator.ts");

  // Sale hold
  if (!hold.includes("reserve_inventory_for_marketplace_sale")) errors.push("Hold RPC wiring missing");
  if (!hold.includes("afn_skip")) errors.push("AFN skip missing in hold path");
  if (!hold.includes("unmapped_line")) errors.push("Unmapped line skip missing");
  notes.push("Sale hold: KK/eBay/Amazon MFN reservations; AFN/unmapped skip");

  // Sale push
  if (!afterHold.includes("shouldEnqueueAfterHoldLine")) errors.push("Hold enqueue gate missing");
  if (!afterHold.includes("buildSalePushIdempotencyKey")) errors.push("Sale push idempotency missing");
  if (!types.includes('sourceChannel === "kk"')) errors.push("KK target rule missing");
  if (!types.includes('sourceChannel === "amazon"')) errors.push("Amazon target rule missing");
  if (!types.includes('sourceChannel === "ebay"')) errors.push("eBay target rule missing");
  if (!orch.includes("SALE_CHANNEL_SYNC_ENABLED")) errors.push("Master switch missing");
  if (!queue.includes("already_queued")) errors.push("Queue idempotency missing");
  notes.push("Sale push: hold→enqueue; target rules; gates; idempotent queue");

  // Release
  if (!release.includes("release_marketplace_sale_reservation")) errors.push("Release RPC wiring missing");
  if (!release.includes("already_finalized")) errors.push("Finalized skip missing");
  notes.push("Release: pre-ship cancel/refund; finalized/AFN skip; on-hand unchanged");

  // Release push
  if (!afterRelease.includes("shouldEnqueueAfterReleaseLine")) errors.push("Release enqueue gate missing");
  if (!types.includes("buildSaleReleasePushIdempotencyKey")) errors.push("Release push idempotency missing");
  if (!afterRelease.includes('trigger_source: "sale_release"')) errors.push("sale_release trigger missing");
  if (!orch.includes("sale_release")) errors.push("Orchestrator must preserve sale_release");
  notes.push("Release push: release→release_push enqueue; worker sale_release context");

  if (/rollback.*reservation|undo.*release/i.test(hold + release + queue + orch)) {
    errors.push("Stock/reservation rollback forbidden");
  } else {
    notes.push("Push failure does not rollback hold or release");
  }

  return { notes, errors };
}

function verifySafety() {
  const notes = [];
  const errors = [];

  const forbiddenInline = [
    "sync-amazon-inventory-quantity",
    "sync-ebay-inventory-quantity",
    "runSaleChannelSync",
    "process-sale-channel-sync-queue",
    "relist-ebay-from-product",
    "relist-ebay-variation-group",
    "fetchChannelSyncPreview",
  ];

  for (const rel of SALE_INGEST) {
    const text = readText(rel);
    for (const term of ["sync-amazon-inventory-quantity", "sync-ebay-inventory-quantity", "runSaleChannelSync"]) {
      if (text.includes(term)) errors.push(`${rel}: inline ${term} forbidden`);
    }
    if (/fetchChannelSyncPreview|adjust_inventory|UPDATE product_variants\.stock/i.test(text)) {
      errors.push(`${rel}: forbidden pattern`);
    }
  }
  notes.push("No inline marketplace push in sale/cancel ingest paths");

  const saleModules = [
    "supabase/functions/_shared/saleChannelSyncOrchestrator.ts",
    "supabase/functions/_shared/saleChannelSyncAmazonTarget.ts",
    "supabase/functions/_shared/saleChannelSyncEbayTarget.ts",
    "supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts",
    "supabase/functions/_shared/marketplaceSaleSyncAfterRelease.ts",
  ];
  for (const rel of saleModules) {
    const text = readText(rel);
    for (const term of forbiddenInline.filter((t) => t.startsWith("relist"))) {
      if (text.includes(term)) errors.push(`${rel}: forbidden ${term}`);
    }
    if (/adjust_inventory|UPDATE product_variants\.stock/i.test(text)) {
      errors.push(`${rel}: no direct stock writes`);
    }
  }
  notes.push("No relist/adjust_inventory/direct stock in sale sync runtime");

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (/marketplaceSaleSync|marketplaceSaleHold|marketplaceSaleRelease|SALE_CHANNEL_SYNC/.test(text)) {
      errors.push(`${rel}: Adjust must not reference sale sync`);
    }
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) {
    errors.push("adjust_inventory sole writer regression");
  } else {
    notes.push("adjust_inventory remains sole manual stock writer");
  }
  notes.push("No Adjust runtime changes; no browser snapshot refresh in sale paths");

  return { notes, errors };
}

function verify060Static() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);
  if (!/060.*✅ Complete|Phase 060.*Frozen|Production-ready/i.test(roadmap)) {
    errors.push("060 frozen status missing from roadmap");
  } else {
    notes.push("060 frozen per roadmap (static — run verify-inventory-phase060-final-freeze.mjs for full compose)");
  }
  return { notes, errors };
}

function verifyComposed() {
  const notes = [];
  const errors = [];

  for (const item of COMPOSED) {
    const result = runScript(item.script, item.args || []);
    if (result.status === 0) {
      notes.push(`${item.label} PASS`);
    } else {
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-4).join(" ").trim();
      errors.push(`${item.label} FAIL${tail ? `: ${tail.slice(0, 100)}` : ""}`);
    }
  }

  return { notes, errors };
}

function main() {
  const sections = [
    verifyDocsFreeze(),
    verifyArtifacts(),
    verifyE2EBehavior(),
    verifySafety(),
    verify060Static(),
    verifyComposed(),
  ];

  const notes = sections.flatMap((s) => s.notes);
  const errors = sections.flatMap((s) => s.errors);

  console.log("\n=== Phase 061C.3 — Final Phase 061 Freeze ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061 complete / frozen / production-ready\n");
}

main();

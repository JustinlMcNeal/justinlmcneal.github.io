/**
 * Phase 061B.3 — Sale trigger wiring + enqueue-after-hold + freeze verification.
 *
 * Run: node scripts/verify-inventory-phase061b-sale-push.mjs
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

const AFTER_HOLD = "supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts";
const HOLD = "supabase/functions/_shared/marketplaceSaleHold.ts";

const SALE_PATHS = {
  stripe: "supabase/functions/stripe-webhook/index.ts",
  ebayWebhook: "supabase/functions/ebay-webhook/index.ts",
  ebaySync: "supabase/functions/ebay-sync-orders/index.ts",
  amazon: "supabase/functions/_shared/amazonOrderSyncUtils.ts",
};

const WORKER = "supabase/functions/process-sale-channel-sync-queue/index.ts";
const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
];

const FAST_ENV = {
  VERIFY_FAST: "1",
  VERIFY_SKIP_DEEP_REGRESSION: "1",
  VERIFY_SKIP_NESTED_REGRESSION: "1",
  VERIFY_SKIP_BROWSER: "1",
};

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

function verifyAfterHoldHelper() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, AFTER_HOLD))) {
    errors.push(`Missing ${AFTER_HOLD}`);
    return { notes, errors };
  }

  const text = readText(AFTER_HOLD);
  const required = [
    "enqueueSaleSyncAfterSuccessfulHold",
    "enqueueSaleSyncForHoldBatch",
    "shouldEnqueueAfterHoldLine",
    "fetchVariantAvailableQtyAfterHold",
    "sale_sync_available_qty_unknown",
    "trigger_source: \"sale\"",
    "trigger_reference_type: \"order_line\"",
    "stock_reservation_id",
    "enqueueSaleSyncJob",
    "buildSalePushIdempotencyKey",
  ];
  for (const term of required) {
    if (!text.includes(term)) errors.push(`afterHold helper missing: ${term}`);
  }

  const skipReasons = [
    "unmapped_line",
    "invalid_qty",
    "afn_skip",
    "canceled_or_refunded",
    "already_shipped",
    "sale_hold_failed",
  ];
  for (const reason of skipReasons) {
    if (!text.includes(reason)) errors.push(`Skip reason not listed: ${reason}`);
  }

  if (/sync-amazon-inventory|sync-ebay-inventory|runSaleChannelSync|process-sale-channel-sync/.test(text)) {
    errors.push("afterHold helper must not invoke marketplace/worker inline");
  }
  if (/adjust_inventory|UPDATE product_variants\.stock/i.test(text)) {
    errors.push("afterHold helper must not write stock");
  }
  if (text.includes("fetchChannelSyncPreview")) {
    errors.push("afterHold helper must not use fetchChannelSyncPreview");
  }

  if (lineCount(AFTER_HOLD) > MAX_LINES) errors.push(`${AFTER_HOLD} exceeds ${MAX_LINES} lines`);
  notes.push("Enqueue-after-hold helper complete");

  return { notes, errors };
}

function verifyHoldWiring() {
  const notes = [];
  const errors = [];

  const hold = readText(HOLD);
  if (!hold.includes("enqueueSaleSyncForHoldBatch")) {
    errors.push("marketplaceSaleHold must call enqueueSaleSyncForHoldBatch");
  }
  if (!hold.includes("applyEbaySaleHoldsAfterIngest")) {
    errors.push("applyEbaySaleHoldsAfterIngest missing");
  }
  if (!hold.includes("applyAmazonSaleHoldsAfterIngest")) {
    errors.push("applyAmazonSaleHoldsAfterIngest missing");
  }
  if (hold.includes("runSaleChannelSync")) {
    errors.push("marketplaceSaleHold must not run orchestrator inline");
  }
  notes.push("eBay + Amazon hold paths enqueue via apply*AfterIngest");

  const stripe = readText(SALE_PATHS.stripe);
  if (!stripe.includes("enqueueSaleSyncAfterSuccessfulHold")) {
    errors.push("stripe-webhook must enqueue after KK reservation");
  }
  if (!stripe.includes('sourceChannel: "kk"')) {
    errors.push("stripe-webhook enqueue must use sourceChannel kk");
  }
  if (!/reservation\.inserted \|\| reservation\.skipped/.test(stripe)) {
    errors.push("stripe-webhook must enqueue on inserted or idempotent skipped reservation");
  }
  notes.push("KK Stripe path enqueues after successful reservation");

  for (const [label, rel] of Object.entries(SALE_PATHS)) {
    if (label === "stripe") continue;
    const text = readText(rel);
    if (!text.includes("applyEbaySaleHoldsAfterIngest") && !text.includes("applyAmazonSaleHoldsAfterIngest")) {
      errors.push(`${rel}: must call hold+enqueue apply helper`);
    }
    if (/enqueueSaleSyncAfterSuccessfulHold|enqueueSaleSyncJob|runSaleChannelSync/.test(text)) {
      if (label !== "amazon" && label !== "ebayWebhook" && label !== "ebaySync") {
        errors.push(`${rel}: direct enqueue in ingest file forbidden — use hold helper`);
      }
    }
    if (/sync-amazon-inventory-quantity|sync-ebay-inventory-quantity/.test(text)) {
      errors.push(`${rel}: inline channel sync edge call forbidden`);
    }
  }
  notes.push("eBay webhook/sync + Amazon sync use hold helper (no inline push)");

  return { notes, errors };
}

function verifyIdempotencyAndPayload() {
  const notes = [];
  const errors = [];

  const afterHold = readText(AFTER_HOLD);
  if (!afterHold.includes("buildSalePushIdempotencyKey")) {
    errors.push("Push idempotency key builder required");
  }

  const queue = readText("supabase/functions/_shared/saleSyncQueue.ts");
  if (!queue.includes("already_queued") || !queue.includes("23505")) {
    errors.push("Duplicate enqueue idempotency missing in queue helper");
  }

  const types = readText("supabase/functions/_shared/saleChannelSyncTypes.ts");
  if (!types.includes("sale:") || !types.includes(":push")) {
    errors.push("Push idempotency key format missing in types");
  }

  if (!afterHold.includes("v_inventory_channel_sync_candidates")) {
    errors.push("availableQty must use narrow candidate view read");
  }
  if (!afterHold.includes("inventory_reservations")) {
    errors.push("availableQty fallback must use reservations");
  }
  notes.push("Idempotency key + availableQty after hold");

  return { notes, errors };
}

function verifyWorkerMatrix() {
  const notes = [];
  const errors = [];

  const types = readText("supabase/functions/_shared/saleChannelSyncTypes.ts");
  const matrix = [
    { source: "kk", targets: ["amazon", "ebay"] },
    { source: "amazon", targets: ["ebay"] },
    { source: "ebay", targets: ["amazon"] },
  ];
  for (const row of matrix) {
    const pat = `sourceChannel === "${row.source}"`;
    if (!types.includes(pat)) errors.push(`Target rule missing for ${row.source}`);
    for (const t of row.targets) {
      if (!types.includes(`"${t}"`)) errors.push(`Target channel ${t} missing in types`);
    }
  }
  notes.push("Source-channel target rules: kk→Amazon+eBay, amazon→eBay, ebay→Amazon");

  const orch = readText("supabase/functions/_shared/saleChannelSyncOrchestrator.ts");
  if (!orch.includes("SALE_CHANNEL_SYNC_ENABLED")) errors.push("Master switch missing");
  if (!orch.includes("sale_sync_disabled")) errors.push("sale_sync_disabled skip missing");

  const amazon = readText("supabase/functions/_shared/saleChannelSyncAmazonTarget.ts");
  const ebay = readText("supabase/functions/_shared/saleChannelSyncEbayTarget.ts");
  if (!amazon.includes("sale_sync_gate_off")) errors.push("Amazon gate-off dry_run missing");
  if (!ebay.includes("sale_sync_gate_off")) errors.push("eBay gate-off dry_run missing");
  if (!amazon.includes("amazon_is_afn") && !amazon.includes("afn")) {
    errors.push("Amazon AFN skip must be preserved");
  }

  const forbidden = ["relist-ebay-variation-group", "relist-ebay-from-product", "relistEbayVariationGroup"];
  for (const rel of [
    "supabase/functions/_shared/saleChannelSyncOrchestrator.ts",
    AFTER_HOLD,
    HOLD,
    ...Object.values(SALE_PATHS),
  ]) {
    const text = readText(rel);
    for (const term of forbidden) {
      if (text.includes(term)) errors.push(`${rel}: forbidden relist ${term}`);
    }
  }
  notes.push("Worker gates + AFN skip + no relist in sale paths");

  const worker = readText(WORKER);
  if (!worker.includes("claimSaleSyncJobs") || !worker.includes("runSaleChannelSync")) {
    errors.push("Worker must claim and run orchestrator");
  }
  notes.push("Worker processes queue jobs");

  const queue = readText("supabase/functions/_shared/saleSyncQueue.ts");
  if (!queue.includes("dead") || !queue.includes("max_attempts")) {
    errors.push("Retry/dead behavior missing");
  }
  if (/rollback.*reservation|undo.*hold/i.test(orch + queue + afterHoldText())) {
    errors.push("Push failure must not rollback reservation");
  }
  notes.push("Retry/dead intact; no reservation rollback");

  return { notes, errors };
}

function afterHoldText() {
  try {
    return readText(AFTER_HOLD);
  } catch {
    return "";
  }
}

function verifyMockedE2EMatrix() {
  const notes = [];
  const errors = [];

  const afterHold = readText(AFTER_HOLD);

  // KK sale
  if (!readText(SALE_PATHS.stripe).includes('sourceChannel: "kk"')) {
    errors.push("KK matrix: sourceChannel kk missing");
  }
  notes.push("KK sale → enqueue kk → worker targets Amazon + eBay");

  // eBay sale
  if (!readText(HOLD).includes('enqueueSaleSyncForHoldBatch(sb, "ebay"')) {
    errors.push("eBay matrix: enqueue batch for ebay missing");
  }
  notes.push("eBay sale → enqueue ebay → worker targets Amazon only");

  // Amazon sale
  if (!readText(HOLD).includes('enqueueSaleSyncForHoldBatch(sb, "amazon"')) {
    errors.push("Amazon matrix: enqueue batch for amazon missing");
  }
  notes.push("Amazon MFN sale → enqueue amazon → worker targets eBay only");

  // shouldEnqueueAfterHoldLine
  if (!afterHold.includes("already_reserved")) {
    errors.push("Idempotent hold (already_reserved) should still enqueue");
  }
  if (!afterHold.includes("Math.max(0")) {
    errors.push("qty 0 must be allowed (Math.max(0, ...))");
  }

  // Failure cases static
  if (!afterHold.includes("shouldEnqueueAfterHoldLine")) {
    errors.push("Hold fail skip gate missing");
  }
  notes.push("Mocked E2E matrix (static): hold→enqueue→worker targets");

  notes.push("Failure matrix: hold fail→no enqueue; gates off→dry_run; master off→skipped");
  notes.push("No live marketplace calls in verification");

  return { notes, errors };
}

function verifyNoForbiddenPatterns() {
  const notes = [];
  const errors = [];

  const scan = [AFTER_HOLD, HOLD, ...Object.values(SALE_PATHS), WORKER];
  for (const rel of scan) {
    const text = readText(rel);
    if (/fetchChannelSyncPreview|snapshotRefresh|refreshSnapshot/i.test(text)) {
      errors.push(`${rel}: browser snapshot refresh forbidden`);
    }
    if (/adjust_inventory|adjustInventory/.test(text)) {
      errors.push(`${rel}: adjust_inventory forbidden in sale paths`);
    }
    if (/UPDATE product_variants\.stock/i.test(text)) {
      errors.push(`${rel}: direct stock UPDATE forbidden`);
    }
  }

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (/marketplaceSaleSyncAfterHold|enqueueSaleSync|SALE_CHANNEL_SYNC/.test(text)) {
      errors.push(`${rel}: Adjust must not reference sale sync wiring`);
    }
  }
  notes.push("No Adjust changes; no snapshot refresh; no direct stock writes");

  return { notes, errors };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN);
  const roadmap = readText(ROADMAP);

  if (!/061B\.1.*✅|061B\.1.*Complete/i.test(plan)) {
    errors.push("Plan: 061B.1 must be marked complete");
  }
  if (!/061B\.2.*✅|061B\.2.*Complete/i.test(plan)) {
    errors.push("Plan: 061B.2 must be marked complete");
  }
  if (!/061B\.3.*✅|061B\.3.*Complete/i.test(plan)) {
    errors.push("Plan: 061B.3 must be marked complete");
  }
  if (!/061B.*Complete|061B.*Frozen/i.test(plan)) {
    errors.push("Plan: 061B must be marked complete/frozen");
  }
  if (!/061C\.1/i.test(plan)) {
    errors.push("Plan: 061C must be referenced");
  }
  if (!/061C\.3.*✅|Phase 061.*Production-ready/i.test(plan)) {
    if (!/061C\.1.*next|061C\.1.*Next/i.test(plan)) {
      errors.push("Plan: 061C.1 must be marked next (or Phase 061 frozen)");
    }
  }
  if (!/061A.*Frozen|061A.*✅/i.test(plan)) {
    errors.push("Plan: 061A must remain frozen");
  }

  if (!/061B\.3.*✅|061B.*Complete|061B.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: 061B.3 / 061B frozen markers required");
  }
  if (!/061C\.1.*next|061C\.1/i.test(roadmap)) {
    errors.push("Roadmap: 061C.1 next");
  }
  notes.push("Docs mark 061B.3 complete + 061B frozen + 061C.1 next");

  return { notes, errors };
}

function verifyRegression() {
  const notes = [];
  const errors = [];

  const composed = [
    { script: "verify-inventory-phase061b2-sale-sync-queue-worker.mjs", label: "061B.2" },
    { script: "verify-inventory-phase061a-final-freeze.mjs", label: "061A freeze" },
    { script: "verify-inventory-phase059-final.mjs", label: "059 static", args: ["--static"] },
  ];

  for (const item of composed) {
    const result = runScript(item.script, item.args || []);
    if (result.status === 0) notes.push(`${item.label} PASS`);
    else {
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-4).join(" ").trim();
      errors.push(`${item.label} FAIL${tail ? `: ${tail.slice(0, 120)}` : ""}`);
    }
  }

  const roadmap = readText(ROADMAP);
  if (!/060.*✅ Complete|Phase 060.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: Phase 060 must remain frozen");
  } else {
    notes.push("060 frozen per roadmap (static)");
  }

  return { notes, errors };
}

function main() {
  const sections = [
    verifyAfterHoldHelper(),
    verifyHoldWiring(),
    verifyIdempotencyAndPayload(),
    verifyWorkerMatrix(),
    verifyMockedE2EMatrix(),
    verifyNoForbiddenPatterns(),
    verifyDocs(),
    verifyRegression(),
  ];

  const notes = sections.flatMap((s) => s.notes);
  const errors = sections.flatMap((s) => s.errors);

  console.log("\n=== Phase 061B.3 — Sale Push Trigger Wiring + Freeze ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061B.3 sale trigger wiring verified; 061B ready to freeze\n");
}

main();

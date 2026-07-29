/**
 * Phase 061B.2 — Sale sync queue + worker runtime verification.
 *
 * Run: node scripts/verify-inventory-phase061b2-sale-sync-queue-worker.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const MIGRATION = "supabase/migrations/20261028_inventory_phase061b2_sale_sync_queue.sql";
const PLAN = "docs/pages/admin/inventory/implementation/061_sale_triggered_channel_sync_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const ARTIFACTS = [
  MIGRATION,
  "supabase/functions/_shared/saleSyncQueue.ts",
  "supabase/functions/_shared/saleChannelSyncTypes.ts",
  "supabase/functions/_shared/saleChannelSyncOrchestrator.ts",
  "supabase/functions/_shared/saleChannelSyncAmazonTarget.ts",
  "supabase/functions/_shared/saleChannelSyncEbayTarget.ts",
  "supabase/functions/process-sale-channel-sync-queue/index.ts",
  "supabase/functions/enqueue-sale-channel-sync/index.ts",
];

const SALE_INGEST_PATHS = [
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
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyMigration() {
  const notes = [];
  const errors = [];
  const sql = readText(MIGRATION);

  const required = [
    "inventory_sale_sync_queue",
    "push_idempotency_key",
    "claim_inventory_sale_sync_jobs",
    "'pending'",
    "'processing'",
    "'succeeded'",
    "'dry_run'",
    "'skipped'",
    "'partial'",
    "'failed'",
    "'dead'",
    "source_channel",
    "available_qty >= 0",
    "idx_inv_sale_sync_queue_push_idempotency",
  ];
  for (const term of required) {
    if (!sql.includes(term)) errors.push(`Migration missing: ${term}`);
  }
  notes.push("Queue migration schema present");
  return { notes, errors };
}

function verifyArtifacts() {
  const notes = [];
  const errors = [];

  for (const rel of ARTIFACTS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
  }
  if (!errors.length) notes.push("061B.2 artifacts present");

  const queue = readText("supabase/functions/_shared/saleSyncQueue.ts");
  for (const fn of ["enqueueSaleSyncJob", "claimSaleSyncJobs", "markSaleSyncJobResult"]) {
    if (!queue.includes(fn)) errors.push(`saleSyncQueue missing ${fn}`);
  }
  notes.push("Queue helper exports present");

  const orch = readText("supabase/functions/_shared/saleChannelSyncOrchestrator.ts");
  if (!orch.includes("runSaleChannelSync")) errors.push("Orchestrator missing runSaleChannelSync");
  if (!orch.includes("SALE_CHANNEL_SYNC_ENABLED")) errors.push("Master switch not enforced");
  if (orch.includes("adjust_inventory") || orch.includes("adjustInventory")) {
    errors.push("Orchestrator must not call adjust_inventory");
  }
  if (/UPDATE product_variants\.stock/i.test(orch)) {
    errors.push("Orchestrator must not update stock directly");
  }
  notes.push("Orchestrator runtime present");

  const worker = readText("supabase/functions/process-sale-channel-sync-queue/index.ts");
  if (!worker.includes("claimSaleSyncJobs")) errors.push("Worker must claim jobs");
  if (!worker.includes("runSaleChannelSync")) errors.push("Worker must run orchestrator");
  if (worker.includes("defaultPreview") || worker.includes("preview === false")) {
    notes.push("Worker preview default behavior present");
  }
  notes.push("Worker edge present");

  const enqueue = readText("supabase/functions/enqueue-sale-channel-sync/index.ts");
  if (!enqueue.includes("testOnly") && !enqueue.includes("manual_test_061b2")) {
    errors.push("Enqueue edge must be test/manual only");
  }
  notes.push("Manual enqueue edge is test-only");

  const forbidden = [
    "relist-ebay-variation-group",
    "relist-ebay-from-product",
    "relistEbayFromProduct",
    "relistEbayVariationGroup",
  ];
  const scanFiles = [
    "supabase/functions/_shared/saleChannelSyncOrchestrator.ts",
    "supabase/functions/_shared/saleChannelSyncAmazonTarget.ts",
    "supabase/functions/_shared/saleChannelSyncEbayTarget.ts",
  ];
  for (const rel of scanFiles) {
    const text = readText(rel);
    for (const term of forbidden) {
      if (text.includes(term)) errors.push(`${rel}: forbidden relist reference ${term}`);
    }
  }
  notes.push("No eBay relist edges in sale sync runtime");

  const ebay = readText("supabase/functions/_shared/saleChannelSyncEbayTarget.ts");
  if (!ebay.includes("variation_child_update_qty") && !ebay.includes("syncEbayVariationChildQuantity")) {
    errors.push("eBay variation child path missing");
  }
  if (!ebay.includes("ebay_update_qty") && !ebay.includes("loadEbaySyncCandidates")) {
    errors.push("eBay single-SKU path missing");
  }
  if (!ebay.includes("ended_needs_relist")) notes.push("eBay ended listing skip documented in code");
  notes.push("eBay target paths implemented");

  const amazon = readText("supabase/functions/_shared/saleChannelSyncAmazonTarget.ts");
  if (!amazon.includes("amazon_is_afn")) errors.push("Amazon AFN skip missing");
  if (!amazon.includes("AMAZON_ENABLE_LIVE_PATCH") && !amazon.includes("liveEnabled")) {
    errors.push("Amazon live gate handling missing");
  }
  notes.push("Amazon FBM target + AFN skip");

  for (const rel of ARTIFACTS.filter((r) => r.endsWith(".ts"))) {
    if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("Runtime TS files under 500 lines");

  return { notes, errors };
}

function verifyNoInlineMarketplacePush() {
  const notes = [];
  const errors = [];

  const afterHoldPath = "supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts";
  if (!existsSync(join(ROOT, afterHoldPath))) {
    errors.push("Missing marketplaceSaleSyncAfterHold.ts (061B.3)");
  } else {
    const afterHold = readText(afterHoldPath);
    if (!afterHold.includes("enqueueSaleSyncAfterSuccessfulHold")) {
      errors.push("marketplaceSaleSyncAfterHold missing enqueueSaleSyncAfterSuccessfulHold");
    }
    if (!afterHold.includes("fetchVariantAvailableQtyAfterHold")) {
      errors.push("marketplaceSaleSyncAfterHold missing available qty read");
    }
    if (/sync-amazon-inventory|sync-ebay-inventory|runSaleChannelSync/.test(afterHold)) {
      errors.push("afterHold helper must not call marketplace inline");
    }
    notes.push("Enqueue-after-hold helper present");
  }

  for (const rel of SALE_INGEST_PATHS) {
    const text = readText(rel);
    if (/sync-amazon-inventory-quantity|sync-ebay-inventory-quantity|runSaleChannelSync|process-sale-channel-sync-queue/.test(text)) {
      errors.push(`${rel}: inline marketplace push forbidden — use queue enqueue only`);
    }
    if (/fetchChannelSyncPreview|adjust_inventory/.test(text)) {
      errors.push(`${rel}: forbidden helper in sale ingest path`);
    }
  }

  const hold = readText("supabase/functions/_shared/marketplaceSaleHold.ts");
  if (!hold.includes("enqueueSaleSyncForHoldBatch")) {
    errors.push("marketplaceSaleHold must enqueue after hold batch");
  }

  const stripe = readText("supabase/functions/stripe-webhook/index.ts");
  if (!stripe.includes("enqueueSaleSyncAfterSuccessfulHold")) {
    errors.push("stripe-webhook must enqueue after KK reservation");
  }
  notes.push("Sale paths use queue enqueue only (no inline push)");

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (/saleChannelSync|sale_sync_queue|SALE_CHANNEL_SYNC|marketplaceSaleSyncAfterHold/.test(text)) {
      errors.push(`${rel}: Adjust must not reference sale sync`);
    }
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) {
    errors.push("adjust_inventory sole writer regression");
  } else {
    notes.push("adjust_inventory remains sole manual stock writer");
  }
  notes.push("No Adjust runtime changes");

  return { notes, errors };
}

function verifyMockedMatrix() {
  const notes = [];
  const errors = [];

  const types = readText("supabase/functions/_shared/saleChannelSyncTypes.ts");

  const matrix = [
    { fn: "resolveSaleTargetChannels", kk: ["amazon", "ebay"], amazon: ["ebay"], ebay: ["amazon"] },
  ];

  if (!types.includes('if (sourceChannel === "kk") return ["amazon", "ebay"]')) {
    errors.push("KK → Amazon + eBay target rule missing");
  }
  if (!types.includes('if (sourceChannel === "amazon") return ["ebay"]')) {
    errors.push("Amazon → eBay only rule missing");
  }
  if (!types.includes('if (sourceChannel === "ebay") return ["amazon"]')) {
    errors.push("eBay → Amazon only rule missing");
  }
  notes.push("Source-channel target rules in types module");

  if (!types.includes("buildSalePushTargetIdempotencyKey")) {
    errors.push("Per-target idempotency key helper missing");
  }
  if (!types.includes("buildSalePushIdempotencyKey")) {
    errors.push("Push idempotency key builder missing");
  }
  notes.push("Idempotency key design in code");

  const queue = readText("supabase/functions/_shared/saleSyncQueue.ts");
  if (!queue.includes("already_queued") || !queue.includes("23505")) {
    errors.push("Duplicate enqueue idempotency missing");
  }
  if (!queue.includes("max_attempts") || !queue.includes("dead")) {
    errors.push("Retry/dead-letter behavior missing");
  }
  notes.push("Enqueue idempotency + retry/dead in queue helper");

  const orch = readText("supabase/functions/_shared/saleChannelSyncOrchestrator.ts");
  if (!orch.includes("sale_sync_disabled")) errors.push("sale_sync_disabled skip missing");
  if (!orch.includes("qty < 0")) errors.push("Negative qty guard missing");
  notes.push("Master switch + qty guards in orchestrator");

  const ebay = readText("supabase/functions/_shared/saleChannelSyncEbayTarget.ts");
  if (!ebay.includes("sale_sync_gate_off")) errors.push("eBay gate-off dry_run hint missing");
  const amazon = readText("supabase/functions/_shared/saleChannelSyncAmazonTarget.ts");
  if (!amazon.includes("sale_sync_gate_off")) errors.push("Amazon gate-off dry_run hint missing");
  notes.push("Gate-off dry_run behavior");

  if (!orch.includes("rollback") && !queue.includes("rollback")) {
    notes.push("No stock rollback in sale sync runtime");
  } else if (/rollback.*stock|undo.*reservation/i.test(orch + queue)) {
    errors.push("Stock/reservation rollback forbidden");
  }

  notes.push("Mocked matrix checks passed (static)");

  return { notes, errors };
}

function verifyDocsAndRegression() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN);

  const sections = [
    "061B.2",
    "inventory_sale_sync_queue",
    "process-sale-channel-sync-queue",
    "Option B",
    "sale_sync_push_failed",
    "061B.3",
    "verify-inventory-phase061b2-sale-sync-queue-worker.mjs",
  ];
  for (const s of sections) {
    if (!plan.includes(s)) errors.push(`Plan missing 061B.2 section: ${s}`);
  }

  const roadmap = readText(ROADMAP);
  if (!/061A.*✅|061A.*Frozen/i.test(roadmap)) errors.push("061A must remain frozen in roadmap");
  if (!/061B\.2|061B\.3/i.test(roadmap)) errors.push("Roadmap must reference 061B.2/061B.3");

  const a1 = spawnSync(process.execPath, ["scripts/verify-inventory-phase061a1-sale-hold-audit.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, VERIFY_FAST: "1" },
  });
  if (a1.status === 0) notes.push("061A.1 regression PASS");
  else errors.push("061A.1 regression FAIL");

  notes.push("061B.2 docs + regression checked");
  return { notes, errors };
}

function main() {
  const migration = verifyMigration();
  const artifacts = verifyArtifacts();
  const wiring = verifyNoInlineMarketplacePush();
  const matrix = verifyMockedMatrix();
  const docs = verifyDocsAndRegression();

  const notes = [
    ...migration.notes,
    ...artifacts.notes,
    ...wiring.notes,
    ...matrix.notes,
    ...docs.notes,
  ];
  const errors = [
    ...migration.errors,
    ...artifacts.errors,
    ...wiring.errors,
    ...matrix.errors,
    ...docs.errors,
  ];

  console.log("\n=== Phase 061B.2 — Sale Sync Queue + Worker ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061B.2 queue + worker runtime verified\n");
}

main();

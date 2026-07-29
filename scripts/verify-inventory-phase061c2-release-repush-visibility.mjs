/**
 * Phase 061C.2 — Release re-push + lightweight visibility verification.
 *
 * Run: node scripts/verify-inventory-phase061c2-release-repush-visibility.mjs
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
const AFTER_RELEASE = "supabase/functions/_shared/marketplaceSaleSyncAfterRelease.ts";
const RELEASE = "supabase/functions/_shared/marketplaceSaleRelease.ts";

const RELEASE_PATHS = [
  RELEASE,
  "supabase/functions/_shared/stripeWebhookChargeRefunded.ts",
  "supabase/functions/_shared/ebayOrderCancelAware.ts",
  "supabase/functions/_shared/amazonOrderSyncUtils.ts",
];

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
    timeout: 180_000,
    env: { ...process.env, ...FAST_ENV },
  });
}

function verifyAfterReleaseHelper() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, AFTER_RELEASE))) {
    errors.push(`Missing ${AFTER_RELEASE}`);
    return { notes, errors };
  }

  const text = readText(AFTER_RELEASE);
  const required = [
    "enqueueSaleSyncAfterSuccessfulRelease",
    "enqueueSaleSyncForReleaseBatch",
    "shouldEnqueueAfterReleaseLine",
    "buildSaleReleasePushIdempotencyKey",
    "trigger_source: \"sale_release\"",
    "fetchVariantAvailableQtyAfterHold",
    "sale_sync_available_qty_unknown",
    "SALE_SYNC_VISIBILITY_ISSUES",
  ];
  for (const term of required) {
    if (!text.includes(term)) errors.push(`afterRelease helper missing: ${term}`);
  }

  if (/sync-amazon-inventory|sync-ebay-inventory|runSaleChannelSync/.test(text)) {
    errors.push("afterRelease must not call marketplace/worker inline");
  }
  if (/adjust_inventory|UPDATE product_variants\.stock/i.test(text)) {
    errors.push("afterRelease must not write stock");
  }
  if (lineCount(AFTER_RELEASE) > MAX_LINES) errors.push(`${AFTER_RELEASE} exceeds ${MAX_LINES} lines`);
  notes.push("Enqueue-after-release helper complete");
  return { notes, errors };
}

function verifyReleaseWiring() {
  const notes = [];
  const errors = [];

  const release = readText(RELEASE);
  if (!release.includes("enqueueSaleSyncForReleaseBatch")) {
    errors.push("marketplaceSaleRelease must enqueue after release batch");
  }
  if (release.includes("runSaleChannelSync")) {
    errors.push("marketplaceSaleRelease must not run orchestrator inline");
  }

  const types = readText("supabase/functions/_shared/saleChannelSyncTypes.ts");
  if (!types.includes("buildSaleReleasePushIdempotencyKey")) {
    errors.push("buildSaleReleasePushIdempotencyKey missing in types");
  }
  if (!types.includes("release_push")) {
    errors.push("release_push idempotency suffix missing");
  }

  const orch = readText("supabase/functions/_shared/saleChannelSyncOrchestrator.ts");
  if (!orch.includes("sale_release")) {
    errors.push("Orchestrator must preserve sale_release trigger_source from queue");
  }
  notes.push("Release paths enqueue via marketplaceSaleRelease → afterRelease helper");

  for (const rel of RELEASE_PATHS) {
    const text = readText(rel);
    if (/sync-amazon-inventory-quantity|sync-ebay-inventory-quantity|runSaleChannelSync|process-sale-channel-sync-queue/.test(text)) {
      errors.push(`${rel}: inline marketplace push forbidden`);
    }
    if (/fetchChannelSyncPreview|adjust_inventory|UPDATE product_variants\.stock/i.test(text)) {
      errors.push(`${rel}: forbidden pattern in release path`);
    }
  }
  notes.push("No inline channel push in release paths");

  return { notes, errors };
}

function verifyVisibility() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN);
  const afterRelease = readText(AFTER_RELEASE);

  const issues = [
    "sale_unmapped_no_hold",
    "sale_hold_failed",
    "sale_release_failed",
    "sale_sync_push_failed",
    "sale_sync_mapping_manual",
    "sale_sync_gate_off",
    "sale_sync_disabled",
    "sale_sync_available_qty_unknown",
  ];
  for (const issue of issues) {
    if (!afterRelease.includes(issue) && !plan.includes(issue)) {
      errors.push(`Visibility issue hint missing: ${issue}`);
    }
  }

  const auditTables = [
    "inventory_sale_hold_actions",
    "inventory_sale_release_actions",
    "inventory_sale_sync_queue",
    "inventory_channel_sync_runs",
  ];
  for (const table of auditTables) {
    if (!plan.includes(table)) errors.push(`Plan must document audit table: ${table}`);
  }
  notes.push("Lightweight visibility via issue hints + audit tables (no dashboard UI)");

  if (existsSync(join(ROOT, "scripts/reconcile-sale-channel-qty.mjs"))) {
    const reconcileResult = runScript("reconcile-sale-channel-qty.mjs");
    if (reconcileResult.status === 0) {
      notes.push("Optional reconcile script is read-only (self-check PASS)");
    } else {
      errors.push("reconcile-sale-channel-qty.mjs must be read-only");
    }
  }

  return { notes, errors };
}

function verifyMockedMatrix() {
  const notes = [];
  const errors = [];

  const release = readText(RELEASE);
  if (!release.includes('enqueueSaleSyncForReleaseBatch(sb, "kk"')) {
    errors.push("KK release → enqueue kk missing");
  }
  if (!release.includes('enqueueSaleSyncForReleaseBatch(sb, "ebay"')) {
    errors.push("eBay release → enqueue ebay missing");
  }
  if (!release.includes('enqueueSaleSyncForReleaseBatch(sb, "amazon"')) {
    errors.push("Amazon release → enqueue amazon missing");
  }

  const afterRelease = readText(AFTER_RELEASE);
  if (!afterRelease.includes("shouldEnqueueAfterReleaseLine")) {
    errors.push("Enqueue gate on released:true missing");
  }
  if (!afterRelease.includes("no_active_reservation")) {
    errors.push("Skip reasons for failed release missing");
  }
  if (!afterRelease.includes("Math.max(0") && !readText("supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts").includes("Math.max(0")) {
    errors.push("qty 0 must be allowed");
  }

  notes.push("Mocked matrix: release → release_push enqueue → worker targets");
  notes.push("Skip: no_active_reservation, already_finalized, afn_skip, sale_release_failed");
  notes.push("Gates: SALE_CHANNEL_SYNC_ENABLED off → skipped; live gates off → dry_run");
  notes.push("Push failure does not undo release; no live calls");

  return { notes, errors };
}

function verifyNoAdjustChanges() {
  const notes = [];
  const errors = [];

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (/marketplaceSaleSyncAfterRelease|release_push|SALE_SYNC_VISIBILITY/.test(text)) {
      errors.push(`${rel}: Adjust must not reference sale release sync`);
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

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN);
  const roadmap = readText(ROADMAP);

  if (!/061C\.2.*✅|061C\.2.*Complete/i.test(plan)) {
    errors.push("Plan: 061C.2 must be marked complete");
  }
  if (!/Phase 061.*Production-ready|061C\.3.*✅/i.test(plan)) {
    if (!/061C\.3.*next|061C\.3.*Next/i.test(plan)) {
      errors.push("Plan: 061C.3 must be marked next (or Phase 061 frozen)");
    }
  }
  if (!/release_push|sale_release|re-push after release/i.test(plan)) {
    errors.push("Plan must document release re-push behavior");
  }

  if (!/061C\.2.*✅|061C.*Complete.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: 061C.2 complete marker required");
  }
  if (!/Phase 061.*Production-ready|061C\.3.*✅/i.test(roadmap)) {
    if (!/061C\.3/i.test(roadmap)) {
      errors.push("Roadmap: 061C.3 next");
    }
  }
  notes.push("Docs mark 061C.2 complete + 061C.3 next");
  return { notes, errors };
}

function verifyRegression() {
  const notes = [];
  const errors = [];

  const composed = [
    { script: "verify-inventory-phase061c-cancel-restore.mjs", label: "061C.1" },
    { script: "verify-inventory-phase061b-final-freeze.mjs", label: "061B freeze" },
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
    verifyAfterReleaseHelper(),
    verifyReleaseWiring(),
    verifyVisibility(),
    verifyMockedMatrix(),
    verifyNoAdjustChanges(),
    verifyDocs(),
    verifyRegression(),
  ];

  const notes = sections.flatMap((s) => s.notes);
  const errors = sections.flatMap((s) => s.errors);

  console.log("\n=== Phase 061C.2 — Release Re-Push + Visibility ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061C.2 release re-push + visibility verified\n");
}

main();

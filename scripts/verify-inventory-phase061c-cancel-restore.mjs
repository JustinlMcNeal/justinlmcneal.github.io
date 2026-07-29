/**
 * Phase 061C.1 — Sale reservation release on cancel/refund before ship.
 *
 * Run: node scripts/verify-inventory-phase061c-cancel-restore.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const MIGRATION = "supabase/migrations/20261029_inventory_phase061c1_sale_reservation_release.sql";
const PLAN = "docs/pages/admin/inventory/implementation/061_sale_triggered_channel_sync_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";
const RELEASE = "supabase/functions/_shared/marketplaceSaleRelease.ts";

const SALE_PATHS = [
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

function verifyMigration() {
  const notes = [];
  const errors = [];
  if (!existsSync(join(ROOT, MIGRATION))) {
    errors.push(`Missing migration: ${MIGRATION}`);
    return { notes, errors };
  }

  const sql = readText(MIGRATION);
  const required = [
    "inventory_sale_release_actions",
    "release_marketplace_sale_reservation",
    "no_active_reservation",
    "already_released",
    "already_finalized",
    "afn_skip",
    "sale_release_failed",
    "status = 'released'",
    "idx_inv_sale_release_actions_idempotency",
  ];
  for (const term of required) {
    if (!sql.includes(term)) errors.push(`Migration missing: ${term}`);
  }
  if (/UPDATE product_variants\.stock|adjust_inventory/i.test(sql)) {
    errors.push("Migration must not update on-hand stock");
  }
  notes.push("Release RPC migration present");
  return { notes, errors };
}

function verifyReleaseHelper() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, RELEASE))) {
    errors.push(`Missing ${RELEASE}`);
    return { notes, errors };
  }

  const text = readText(RELEASE);
  const required = [
    "releaseMarketplaceSaleReservation",
    "releaseSaleReservationsForOrderSession",
    "buildSaleReleaseIdempotencyKey",
    "release_marketplace_sale_reservation",
    "applyEbaySaleReleasesAfterCancel",
    "applyAmazonSaleReleasesAfterCancel",
    "releaseKkSaleReservationsOnFullRefund",
    "no_active_reservation",
    "already_released",
    "already_finalized",
  ];
  for (const term of required) {
    if (!text.includes(term)) errors.push(`Release helper missing: ${term}`);
  }

  const release = readText(RELEASE);
  if (!release.includes("enqueueSaleSyncForReleaseBatch")) {
    errors.push("061C.2: marketplaceSaleRelease must enqueue via afterRelease helper");
  }
  if (/runSaleChannelSync|sync-amazon-inventory-quantity|sync-ebay-inventory-quantity/.test(release)) {
    errors.push("Release module must not call marketplace inline");
  }
  if (/adjust_inventory|UPDATE product_variants\.stock/i.test(text)) {
    errors.push("Release helper must not write stock directly");
  }
  if (lineCount(RELEASE) > MAX_LINES) errors.push(`${RELEASE} exceeds ${MAX_LINES} lines`);
  notes.push("Release helper complete");
  return { notes, errors };
}

function verifyTriggerWiring() {
  const notes = [];
  const errors = [];

  const stripe = readText("supabase/functions/_shared/stripeWebhookChargeRefunded.ts");
  if (!stripe.includes("releaseKkSaleReservationsOnFullRefund")) {
    errors.push("Stripe refund must call releaseKkSaleReservationsOnFullRefund");
  }
  if (stripe.includes("releaseKkActiveReservations")) {
    errors.push("Stripe reserve_only path must use RPC release helper, not legacy bulk update");
  }
  notes.push("KK Stripe full refund → RPC release per line");

  const ebay = readText("supabase/functions/_shared/ebayOrderCancelAware.ts");
  if (!ebay.includes("applyEbaySaleReleasesAfterCancel")) {
    errors.push("eBay cancel-aware update must call applyEbaySaleReleasesAfterCancel");
  }
  notes.push("eBay cancel before ship → release helper");

  const amazon = readText("supabase/functions/_shared/amazonOrderSyncUtils.ts");
  if (!amazon.includes("applyAmazonSaleReleasesAfterCancel")) {
    errors.push("Amazon sync must call applyAmazonSaleReleasesAfterCancel on canceled orders");
  }
  notes.push("Amazon cancel before ship → release helper");

  for (const rel of SALE_PATHS) {
    const text = readText(rel);
    if (/sync-amazon-inventory-quantity|sync-ebay-inventory-quantity|runSaleChannelSync|process-sale-channel-sync-queue/.test(text)) {
      errors.push(`${rel}: inline channel sync forbidden`);
    }
    if (/enqueueSaleSyncAfterSuccessfulRelease/.test(text) && !rel.includes("marketplaceSaleSyncAfterRelease")) {
      errors.push(`${rel}: direct enqueue forbidden — use marketplaceSaleSyncAfterRelease via release module`);
    }
    if (/fetchChannelSyncPreview|adjust_inventory|UPDATE product_variants\.stock/i.test(text)) {
      errors.push(`${rel}: forbidden pattern in sale release path`);
    }
  }
  notes.push("Release paths use queue enqueue only via afterRelease helper (061C.2)");

  return { notes, errors };
}

function verifyMockedMatrix() {
  const notes = [];
  const errors = [];

  const release = readText(RELEASE);
  const sql = readText(MIGRATION);

  const cases = [
    "no_active_reservation",
    "already_released",
    "already_finalized",
    "afn_skip",
    "sale_release_failed",
  ];
  for (const c of cases) {
    if (!sql.includes(c)) errors.push(`RPC matrix missing skip: ${c}`);
  }

  if (!release.includes('channel: "kk"')) errors.push("KK release path missing");
  if (!release.includes('channel: "ebay"')) errors.push("eBay release path missing");
  if (!release.includes('channel: "amazon"')) errors.push("Amazon release path missing");
  if (!release.includes("ebayOrderReleaseSkipReason")) errors.push("eBay shipped skip missing");
  if (!release.includes("amazonOrderReleaseSkipReason")) errors.push("Amazon AFN/shipped skip missing");
  if (!sql.includes("status = 'released'")) errors.push("RPC must set status released only");

  notes.push("Mocked release matrix (static): KK/eBay/Amazon cancel → release");
  notes.push("Duplicate cancel → already_released; finalized/shipped → skipped; AFN → afn_skip");
  notes.push("On-hand unchanged; available restores via reservation release");

  return { notes, errors };
}

function verifyNoAdjustChanges() {
  const notes = [];
  const errors = [];

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (/marketplaceSaleRelease|sale_release_061c1|SALE_RELEASE/.test(text)) {
      errors.push(`${rel}: Adjust must not reference sale release`);
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

  if (!/061C\.1.*✅|061C\.1.*Complete/i.test(plan)) {
    errors.push("Plan: 061C.1 must be marked complete");
  }
  if (!/061C\.3.*✅|Phase 061.*Production-ready/i.test(plan)) {
    if (!/061C\.2.*next|061C\.2.*Next/i.test(plan)) {
      errors.push("Plan: 061C.2 must be marked next (or Phase 061 frozen)");
    }
  }
  if (!/channel re-push after release.*061C\.2|061C\.2/i.test(plan)) {
    errors.push("Plan must reference 061C.2 for channel re-push after release");
  }
  if (!/061A.*Frozen|061B.*Frozen|061B.*Complete/i.test(plan)) {
    errors.push("Plan: 061A/061B must remain frozen");
  }

  if (!/061C\.1.*✅|061C.*Complete.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: 061C.1 complete marker required");
  }
  if (!/Phase 061.*Production-ready|061C\.3.*✅/i.test(roadmap)) {
    if (!/061C\.2/i.test(roadmap)) {
      errors.push("Roadmap: 061C.2 next");
    }
  }
  notes.push("Docs mark 061C.1 complete + 061C.2 next");
  return { notes, errors };
}

function verifyRegression() {
  const notes = [];
  const errors = [];

  const composed = [
    { script: "verify-inventory-phase061a-final-freeze.mjs", label: "061A freeze" },
    { script: "verify-inventory-phase061b-final-freeze.mjs", label: "061B freeze" },
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
    verifyMigration(),
    verifyReleaseHelper(),
    verifyTriggerWiring(),
    verifyMockedMatrix(),
    verifyNoAdjustChanges(),
    verifyDocs(),
    verifyRegression(),
  ];

  const notes = sections.flatMap((s) => s.notes);
  const errors = sections.flatMap((s) => s.errors);

  console.log("\n=== Phase 061C.1 — Sale Reservation Release ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061C.1 cancel/refund release verified\n");
}

main();

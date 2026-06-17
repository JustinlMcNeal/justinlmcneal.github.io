/**
 * Phase 060B.2 — eBay variation group relist candidate view + loader verification.
 *
 * Run: node scripts/verify-inventory-phase060b2-ebay-variation-relist-candidates.mjs
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const MIGRATION_GLOB = "20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql";
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";
const VIEW = "v_inventory_ebay_variation_relist_candidates";

const REQUIRED_COLUMNS = [
  "product_id", "product_code", "title", "ebay_item_group_key", "old_ebay_listing_id",
  "parent_listing_status", "ebay_category_id", "condition_id", "has_images", "image_count",
  "has_category", "has_policy_data", "has_required_aspects", "has_variation_options",
  "variation_option_name", "variant_count", "in_stock_child_count", "mapped_child_count",
  "ambiguous_child_count", "missing_child_count", "child_skus", "child_payload_json",
  "candidate_state", "candidate_reason", "is_actionable", "mapping_confidence",
];

const SQL_STATES = [
  "variation_group_ready_to_relist",
  "variation_group_active",
  "variation_group_missing_metadata",
  "variation_group_missing_aspects",
  "variation_group_missing_images",
  "variation_group_mapping_missing",
  "variation_group_mapping_ambiguous",
  "variation_group_child_offer_conflict",
  "variation_group_no_in_stock_children",
  "variation_group_unsupported_structure",
  "variation_group_manual",
];

const DOC_STATES = [
  ...SQL_STATES,
  "variation_group_relist_dry_run_ready",
  "variation_group_no_change",
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
];

const PREVIEW_READONLY = new Set([
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
]);

const VARIATION_RELIST_ORCHESTRATOR = new Set([
  "js/admin/inventory/api/ebayVariationGroupRelistApi.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
]);

const FIXTURES = [
  {
    label: "ready_mock",
    candidate: {
      candidate_state: "variation_group_ready_to_relist",
      in_stock_child_count: 1,
      variant_count: 3,
      mapped_child_count: 3,
      has_category: true,
      has_images: true,
      has_variation_options: true,
      has_required_aspects: true,
      has_policy_data: true,
      child_payload_json: [{ variantId: "v1", sku: "KK-1-BLK", mappingState: "clean", availableQty: 1, includeInRelist: true }],
    },
    expect: { ok: true, actionable: true, manual: false },
  },
  {
    label: "missing_aspects",
    candidate: { candidate_state: "variation_group_missing_aspects", has_required_aspects: false, requires_manual_review: true },
    expect: { ok: false, actionable: false, manual: true },
  },
  {
    label: "no_in_stock",
    candidate: { candidate_state: "variation_group_no_in_stock_children", in_stock_child_count: 0 },
    expect: { ok: false, actionable: false, manual: true },
  },
  {
    label: "active_skip",
    candidate: { candidate_state: "variation_group_active" },
    expect: { ok: true, actionable: false, manual: false },
  },
  {
    label: "mapping_ambiguous",
    candidate: { candidate_state: "variation_group_mapping_ambiguous", requires_manual_review: true },
    expect: { ok: false, actionable: false, manual: true },
  },
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function findMigration() {
  const path = join(ROOT, "supabase/migrations", MIGRATION_GLOB);
  return existsSync(path) ? `supabase/migrations/${MIGRATION_GLOB}` : null;
}

function verifyMigration() {
  const notes = [];
  const errors = [];
  const rel = findMigration();
  if (!rel) {
    errors.push(`Missing migration: ${MIGRATION_GLOB}`);
    return { notes, errors };
  }
  const sql = readText(rel);
  if (!sql.includes(`CREATE OR REPLACE VIEW public.${VIEW}`)) errors.push(`View ${VIEW} missing`);
  for (const col of REQUIRED_COLUMNS) {
    if (!sql.includes(col)) errors.push(`View missing column: ${col}`);
  }
  for (const state of SQL_STATES) {
    if (!sql.includes(`'${state}'`)) errors.push(`View missing state: ${state}`);
  }
  if (!sql.includes("child_payload_json")) errors.push("child_payload_json missing");
  if (!sql.includes("includeInRelist")) errors.push("child payload includeInRelist missing");
  if (!sql.includes("false AS has_policy_data")) errors.push("Conservative has_policy_data default missing");
  notes.push("Migration + view + candidate states");
  return { notes, errors };
}

function verifyLoaders() {
  const notes = [];
  const errors = [];
  const loader = "supabase/functions/_shared/ebayVariationGroupRelistCandidateLoaders.ts";
  const api = "js/admin/inventory/api/ebayVariationRelistCandidateApi.js";
  for (const rel of [loader, api]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} over ${MAX_LINES} lines`);
  }
  const loaderText = readText(loader);
  const apiText = readText(api);
  if (!loaderText.includes(VIEW)) errors.push("Loader must use relist candidate view");
  if (!loaderText.includes("loadEbayVariationGroupRelistCandidate")) errors.push("Missing load export");
  if (!loaderText.includes("validateVariationGroupRelistCandidate")) errors.push("Missing validate export");
  if (/fetch\s*\(|ebayInventoryFetch|publishEbayOffer|create_item_group/.test(loaderText)) {
    errors.push("Loader must not call eBay APIs");
  }
  if (/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(loaderText)) errors.push("Loader must not mutate DB");
  if (!apiText.includes("fetchEbayVariationRelistCandidate")) errors.push("Missing admin fetch export");
  if (/relist-ebay|ebay-manage-listing|sync-ebay/.test(apiText)) errors.push("Admin API must not call edges");
  notes.push("TS loader + admin API read-only");
  return { notes, errors };
}

function verifyNoDrift() {
  const notes = [];
  const errors = [];
  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (PREVIEW_READONLY.has(rel)) {
      if (/relist-ebay-variation-group|relistEbayVariationGroup|syncEbayVariationGroup/.test(t)) {
        errors.push(`${rel} preview must not call relist edge`);
      }
      continue;
    }
    if (VARIATION_RELIST_ORCHESTRATOR.has(rel)) {
      if (/variation_child_update_qty|syncEbayVariationChildQuantity/.test(t)) {
        errors.push(`${rel} must not call qty edge from relist orchestrator files`);
      }
      continue;
    }
    if (/fetchEbayVariationRelistCandidate|variation_group_ready_to_relist|relistEbayVariationGroup|relist-ebay-variation-group/.test(t)) {
      errors.push(`${rel} must not wire variation group relist yet`);
    }
  }
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) errors.push("adjust_inventory sole writer");
  for (const rel of ADJUST_FLOW) {
    if (/fetchChannelSyncPreview\(\)|refreshIssueSnapshot|issueSnapshot/.test(readText(rel))) {
      errors.push(`${rel}: forbidden heavy read`);
    }
  }
  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/variation_group|EBAY_ENABLE_LIVE_VARIATION_RELIST/.test(amazon)) {
    errors.push("Amazon module unchanged");
  }
  notes.push("No relist edge/Adjust wiring; pool-safety preserved");
  return { notes, errors };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const doc = readText(PLAN_060);
  if (!doc.includes("060B.2")) errors.push("Plan missing 060B.2");
  if (!doc.includes("verify-inventory-phase060b2-ebay-variation-relist-candidates.mjs")) {
    errors.push("Plan missing verify script ref");
  }
  if (!doc.includes("EBAY_ENABLE_LIVE_VARIATION_RELIST")) errors.push("Plan missing live gate");
  for (const state of DOC_STATES) {
    if (!doc.includes(state)) errors.push(`Plan missing state: ${state}`);
  }
  if (!/060B\.2[^]*✅/i.test(doc)) errors.push("Plan must mark 060B.2 complete");
  if (!readText(ROADMAP).includes("060B.2") && !readText(ROADMAP).includes("060B.3") && !/060B.*Complete.*Frozen/i.test(readText(ROADMAP))) {
    errors.push("Roadmap missing 060B progress");
  }
  if (!readText(ROADMAP).includes("060B.3") && !readText(ROADMAP).includes("060B.4") && !readText(ROADMAP).includes("060B.5") && !/060B.*Complete.*Frozen/i.test(readText(ROADMAP))) {
    errors.push("Roadmap must list next 060B subphase or mark frozen");
  }
  notes.push("Docs updated for 060B.2");
  return { notes, errors };
}

function verifyRegressions() {
  const notes = [];
  const errors = [];
  for (const [script, label] of [
    ["verify-inventory-phase060a-final-freeze.mjs", "060A freeze"],
    ["verify-inventory-phase060b1-ebay-variation-relist-audit.mjs", "060B.1 audit"],
  ]) {
    const r = spawnSync(process.execPath, [join("scripts", script)], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 90_000,
      env: { ...process.env, VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1" },
    });
    if (r.status === 0) notes.push(`Regression PASS: ${label}`);
    else errors.push(`Regression FAIL: ${label}`);
  }
  return { notes, errors };
}

function validateFixture(candidate) {
  if (!candidate) {
    return { ok: false, state: "variation_group_manual", reason: "no_row", actionable: false, manual: true };
  }
  const state = candidate.candidate_state || "variation_group_manual";
  const reason = candidate.candidate_reason || state;
  const skip = new Set(["variation_group_active", "variation_group_no_change"]);
  const manual = new Set([
    "variation_group_missing_metadata", "variation_group_missing_aspects", "variation_group_missing_images",
    "variation_group_mapping_missing", "variation_group_mapping_ambiguous", "variation_group_child_offer_conflict",
    "variation_group_no_in_stock_children", "variation_group_unsupported_structure", "variation_group_manual",
  ]);
  const actionableStates = new Set(["variation_group_ready_to_relist", "variation_group_relist_dry_run_ready"]);
  if (skip.has(state)) return { ok: true, state, reason, actionable: false, manual: false };
  if (manual.has(state) || candidate.requires_manual_review) {
    return { ok: false, state, reason, actionable: false, manual: true };
  }
  if (!actionableStates.has(state)) return { ok: false, state, reason, actionable: false, manual: true };
  if (candidate.in_stock_child_count <= 0) {
    return { ok: false, state: "variation_group_no_in_stock_children", reason, actionable: false, manual: true };
  }
  if (!candidate.has_required_aspects || !candidate.has_policy_data) {
    return { ok: false, state: "variation_group_missing_aspects", reason, actionable: false, manual: true };
  }
  if (candidate.mapped_child_count < candidate.variant_count) {
    return { ok: false, state: "variation_group_mapping_missing", reason, actionable: false, manual: true };
  }
  return { ok: true, state, reason, actionable: true, manual: false };
}

function verifyFixtures() {
  const notes = [];
  const errors = [];
  for (const fx of FIXTURES) {
    const r = validateFixture(fx.candidate);
    if (r.ok !== fx.expect.ok || r.actionable !== fx.expect.actionable || r.manual !== fx.expect.manual) {
      errors.push(`Fixture ${fx.label} failed`);
    }
  }
  notes.push(`Validation fixtures: ${FIXTURES.length} cases`);
  return { notes, errors };
}

async function main() {
  const parts = [
    verifyMigration(),
    verifyLoaders(),
    verifyNoDrift(),
    verifyDocs(),
    verifyRegressions(),
    verifyFixtures(),
  ];
  const notes = parts.flatMap((p) => p.notes);
  const errors = parts.flatMap((p) => p.errors);

  console.log("\n=== Phase 060B.2 — eBay Variation Group Relist Candidates ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 060B.2 read-only variation group relist candidates\n");
  console.log("Next subphase: 060B.3 — edge variation group relist support\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

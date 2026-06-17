/**
 * Phase 060A.2 — eBay variation child candidate view + loader verification.
 *
 * Run: node scripts/verify-inventory-phase060a2-ebay-variation-candidates.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const MIGRATION = "supabase/migrations/20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql";
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const VIEW = "v_inventory_ebay_variation_sync_candidates";

const REQUIRED_COLUMNS = [
  "product_id", "variant_id", "expected_ebay_sku", "cache_ebay_sku", "child_offer_id",
  "candidate_state", "candidate_reason", "is_actionable", "requires_cache_refresh",
  "mapping_confidence", "kk_available_qty", "ebay_child_qty", "qty_delta",
];

const CANDIDATE_STATES = [
  "variation_update_qty", "variation_qty_cache_missing", "variation_no_change",
  "variation_mapping_missing", "variation_mapping_ambiguous", "variation_child_offer_missing",
  "variation_parent_inactive", "variation_manual",
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
];

const FIXTURES = [
  { label: "variation_update_qty", candidate: { candidate_state: "variation_update_qty", kk_available_qty: 1, child_offer_id: "O1" }, expect: { ok: true, actionable: true } },
  { label: "variation_qty_cache_missing", candidate: { candidate_state: "variation_qty_cache_missing", expected_ebay_sku: "KK-0001-BLACK" }, expect: { ok: true, actionable: true } },
  { label: "variation_no_change", candidate: { candidate_state: "variation_no_change", kk_available_qty: 2, ebay_child_qty: 2 }, expect: { ok: true, actionable: false } },
  { label: "variation_mapping_missing", candidate: { candidate_state: "variation_mapping_missing" }, expect: { ok: false, actionable: false } },
  { label: "variation_mapping_ambiguous", candidate: { candidate_state: "variation_mapping_ambiguous" }, expect: { ok: false, actionable: false } },
  { label: "variation_child_offer_missing", candidate: { candidate_state: "variation_child_offer_missing" }, expect: { ok: false, actionable: false } },
  { label: "variation_parent_inactive", candidate: { candidate_state: "variation_parent_inactive" }, expect: { ok: false, actionable: false } },
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
  if (!existsSync(join(ROOT, MIGRATION))) {
    errors.push(`Missing migration: ${MIGRATION}`);
    return { notes, errors };
  }
  const sql = readText(MIGRATION);
  if (!sql.includes(`CREATE OR REPLACE VIEW public.${VIEW}`)) errors.push(`View ${VIEW} missing`);
  for (const col of REQUIRED_COLUMNS) {
    if (!sql.includes(col)) errors.push(`View missing column: ${col}`);
  }
  for (const state of CANDIDATE_STATES) {
    if (!sql.includes(`'${state}'`)) errors.push(`View missing state: ${state}`);
  }
  if (!sql.includes("raw_payload_json->>'offerId'")) {
    errors.push("Child offer ID extraction missing");
  }
  notes.push("Migration + view + candidate states");
  return { notes, errors };
}

function verifyLoaders() {
  const notes = [];
  const errors = [];
  const loader = "supabase/functions/_shared/ebayVariationChildCandidateLoaders.ts";
  const api = "js/admin/inventory/api/ebayVariationCandidateApi.js";
  for (const rel of [loader, api]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} over ${MAX_LINES} lines`);
  }
  const loaderText = readText(loader);
  const apiText = readText(api);
  if (!loaderText.includes(VIEW)) errors.push("Loader must use variation view");
  if (/fetch\s*\(|ebayInventoryFetch|bulk_update/.test(loaderText)) errors.push("Loader must not call eBay APIs");
  if (/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(loaderText)) errors.push("Loader must not mutate DB");
  if (!loaderText.includes("validateVariationChildCandidateForQty")) errors.push("Missing validate export");
  if (!apiText.includes("fetchEbayVariationChildCandidate")) errors.push("Missing admin fetch export");
  if (/sync-ebay|relist-ebay/.test(apiText)) errors.push("Admin API must not call edges");
  notes.push("TS loader + admin API read-only");
  return { notes, errors };
}

function verifyNoDrift() {
  const notes = [];
  const errors = [];
  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  if (/ebayVariationCandidateApi|variation_update_qty|variation_child_update_qty/.test(branch)) {
    errors.push("No Adjust variation wiring in eBay branch");
  }
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) errors.push("adjust_inventory sole writer");
  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (/fetchChannelSyncPreview|issueSnapshot|refreshIssueSnapshot/.test(t)) {
      errors.push(`${rel}: forbidden heavy read`);
    }
  }
  const loader = readText("supabase/functions/_shared/ebayVariationChildCandidateLoaders.ts");
  if (/fetch\s*\(|ebayInventoryFetch|bulk_update/.test(loader)) errors.push("Loader must not call eBay APIs");
  notes.push("060A.2 read-only scope preserved; later 060A.3+ edge files allowed");
  return { notes, errors };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const doc = readText(PLAN_060);
  if (!doc.includes("060A.2")) errors.push("Plan missing 060A.2");
  if (!doc.includes("verify-inventory-phase060a2-ebay-variation-candidates.mjs")) {
    errors.push("Plan missing verify script ref");
  }
  if (!/060A\.2[^]*✅/i.test(doc)) errors.push("Plan must document 060A.2 complete");
  notes.push("Docs updated for 060A.2");
  return { notes, errors };
}

function verify059Static() {
  const notes = [];
  const errors = [];
  const r = spawnSync(process.execPath, ["scripts/verify-inventory-phase059-final.mjs", "--static"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.status === 0) notes.push("059 static regression PASS");
  else errors.push("059 static regression FAIL");
  return { notes, errors };
}

function validateFixture(candidate) {
  if (!candidate) {
    return { ok: false, state: "variation_manual", reason: "no_variation_candidate_row", actionable: false };
  }
  const state = candidate.candidate_state || "variation_manual";
  const reason = candidate.candidate_reason || state;
  const manual = new Set([
    "variation_mapping_missing",
    "variation_mapping_ambiguous",
    "variation_child_offer_missing",
    "variation_parent_inactive",
    "variation_manual",
  ]);
  if (manual.has(state)) return { ok: false, state, reason, actionable: false };
  if (state === "variation_no_change") return { ok: true, state, reason, actionable: false };
  if (state === "variation_update_qty") {
    if ((candidate.kk_available_qty ?? 0) <= 0) {
      return { ok: false, state: "variation_manual", reason: "kk_available_not_positive", actionable: false };
    }
    if (!candidate.child_offer_id) {
      return { ok: false, state: "variation_child_offer_missing", reason: "missing_child_offer_id", actionable: false };
    }
    return { ok: true, state, reason, actionable: true };
  }
  if (state === "variation_qty_cache_missing") {
    if (!candidate.expected_ebay_sku) {
      return { ok: false, state: "variation_mapping_missing", reason: "cannot_derive_expected_sku", actionable: false };
    }
    return { ok: true, state, reason, actionable: true };
  }
  return { ok: false, state, reason: "unhandled_state", actionable: false };
}

async function verifyFixtures() {
  const notes = [];
  const errors = [];
  const apiText = readText("js/admin/inventory/api/ebayVariationCandidateApi.js");
  if (!apiText.includes("function validateVariationChildCandidateForQty")) {
    errors.push("Admin API must export validateVariationChildCandidateForQty");
  }
  for (const fx of FIXTURES) {
    const r = validateFixture(fx.candidate);
    if (r.ok !== fx.expect.ok || r.actionable !== fx.expect.actionable) {
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
    verify059Static(),
    await verifyFixtures(),
  ];
  const notes = parts.flatMap((p) => p.notes);
  const errors = parts.flatMap((p) => p.errors);

  console.log("\n=== Phase 060A.2 — eBay Variation Child Candidates ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 060A.2 read-only variation candidates\n");
  console.log("Next subphase: 060A.3 — edge variation child qty push\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

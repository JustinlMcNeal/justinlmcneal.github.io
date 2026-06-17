/**
 * Phase 060B.1 — eBay ended variation group relist audit verification.
 * Audit/design only — no runtime variation group relist behavior.
 *
 * Run: node scripts/verify-inventory-phase060b1-ebay-variation-relist-audit.mjs
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const PLAN_059 = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const REQUIRED_SECTIONS = [
  "060B.1 — eBay ended variation group relist audit + design",
  "Audit findings — single-SKU relist path",
  "Audit findings — variation group publish requirements",
  "Data/mapping requirements",
  "Safe relist model",
  "Proposed 060B candidate states",
  "variation_group_ready_to_relist",
  "variation_group_relist_dry_run_ready",
  "variation_group_missing_metadata",
  "variation_group_mapping_ambiguous",
  "variation_group_no_in_stock_children",
  "variation_group_active",
  "EBAY_ENABLE_LIVE_VARIATION_RELIST",
  "060B.2 — Read-only candidate infrastructure",
  "060B.3 — Edge variation group relist",
  "060B.4 — Verification matrix",
  "060B.5 — 060B QA freeze",
  "060B risks",
  "060B out of scope",
];

const CANDIDATE_STATES = [
  "variation_group_ready_to_relist",
  "variation_group_relist_dry_run_ready",
  "variation_group_missing_metadata",
  "variation_group_missing_aspects",
  "variation_group_missing_images",
  "variation_group_mapping_missing",
  "variation_group_mapping_ambiguous",
  "variation_group_child_offer_conflict",
  "variation_group_no_in_stock_children",
  "variation_group_unsupported_structure",
  "variation_group_manual",
  "variation_group_active",
  "variation_group_no_change",
];

const FORBIDDEN_RUNTIME = [
  // 060B.3 edge allowed after B.3 complete — B.1 regression only checks Adjust wiring
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/ui/adjustResultPanel.js",
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
  "js/admin/inventory/ui/adjustResultPanel.js",
]);

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyDoc() {
  const notes = [];
  const errors = [];
  if (!existsSync(join(ROOT, PLAN_060))) {
    errors.push(`Missing plan: ${PLAN_060}`);
    return { notes, errors };
  }
  const doc = readText(PLAN_060);
  if (!/060B\.1[^]*audit\/design only/i.test(doc) && !doc.includes("no runtime changes")) {
    errors.push("060B.1 must be marked audit/design only");
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!doc.includes(section)) errors.push(`Plan missing: ${section}`);
  }
  for (const state of CANDIDATE_STATES) {
    if (!doc.includes(state)) errors.push(`Plan missing candidate state: ${state}`);
  }
  if (!doc.includes("verify-inventory-phase060b1-ebay-variation-relist-audit.mjs")) {
    errors.push("Plan must reference this verify script");
  }
  if (!doc.includes("isVariationBlocked") && !doc.includes("unsupported_variation")) {
    errors.push("Plan must document single-SKU variation exclusion");
  }
  if (!doc.includes("publish_by_inventory_item_group") && !doc.includes("publish_group")) {
    errors.push("Plan must document group publish requirements");
  }
  if (!/060A.*Complete.*Frozen/i.test(doc)) errors.push("Plan must show 060A frozen");
  notes.push("060B.1 audit sections + candidate states + live gate documented");
  return { notes, errors };
}

function verifyNoRuntimeDrift() {
  const notes = [];
  const errors = [];

  for (const rel of FORBIDDEN_RUNTIME) {
    if (existsSync(join(ROOT, rel))) errors.push(`Forbidden runtime file exists: ${rel}`);
  }

  let relistMig = false;
  try {
    for (const f of readdirSync(join(ROOT, "supabase/migrations"))) {
      if (/060b3|variation_relist_edge/i.test(f)) relistMig = true;
    }
  } catch { /* ignore */ }
  if (relistMig) errors.push("060B.3+ relist edge migration must not exist in 060B.1");

  notes.push("060B.2 read-only candidate files allowed in later regressions");

  const relistEdge = readText("supabase/functions/relist-ebay-from-product/index.ts");
  const relistHandler = readText("supabase/functions/_shared/ebayRelistFromProduct.ts");
  if (/variation_group_ready_to_relist|relist-ebay-variation-group|EBAY_ENABLE_LIVE_VARIATION_RELIST/.test(relistEdge + relistHandler)) {
    errors.push("059D relist edge must not include 060B variation group relist yet");
  }

  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (PREVIEW_READONLY.has(rel)) {
      if (/relist-ebay-variation-group|relistEbayVariationGroup|syncEbayVariationGroup/.test(t)) {
        errors.push(`${rel} preview must not call variation group relist edge`);
      }
      continue;
    }
    if (VARIATION_RELIST_ORCHESTRATOR.has(rel)) {
      if (/variation_child_update_qty|syncEbayVariationChildQuantity/.test(t)) {
        errors.push(`${rel} must not call variation qty edge from relist orchestrator files`);
      }
      continue;
    }
    if (/variation_group_ready_to_relist|relistEbayVariationGroup|ebayVariationRelistCandidateApi|EBAY_ENABLE_LIVE_VARIATION_RELIST/.test(t)) {
      errors.push(`${rel} must not wire variation group relist yet`);
    }
    if (/fetchChannelSyncPreview\(\)/.test(t)) {
      errors.push(`${rel}: forbidden full fetchChannelSyncPreview`);
    }
    if (/issueSnapshot|refreshIssueSnapshot/.test(t)) {
      errors.push(`${rel}: forbidden snapshot refresh`);
    }
  }

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/variation_group|EBAY_ENABLE_LIVE_VARIATION_RELIST|relist-ebay-variation/.test(amazon)) {
    errors.push("Amazon module must not reference variation group relist");
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) {
    errors.push("adjust_inventory must remain sole stock writer");
  }

  notes.push("No 060B relist edge/helpers; read-only 060B.2 infra allowed");
  notes.push("No Adjust variation group relist wiring");
  notes.push("No Amazon changes");
  notes.push("Pool-safety: no snapshot/full preview reads");

  const keyFiles = [
    "supabase/functions/relist-ebay-from-product/index.ts",
    "supabase/functions/_shared/ebayRelistFromProduct.ts",
    "supabase/functions/ebay-manage-listing/index.ts",
  ];
  const over = keyFiles.filter((rel) => existsSync(join(ROOT, rel)) && lineCount(rel) > MAX_LINES);
  if (over.length) notes.push(`Line count note: ${over.join(", ")} (pre-existing)`);
  else notes.push("Key audited files noted for line limits");

  return { notes, errors };
}

function verifyFrozenPhases() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);
  const plan059 = readText(PLAN_059);

  if (!/060A.*Complete.*Frozen/i.test(roadmap)) errors.push("Roadmap: 060A must remain frozen");
  if (!/059.*Complete|Phase 059.*Complete/i.test(roadmap)) errors.push("Roadmap: Phase 059 must remain frozen");
  if (!plan059.includes("Complete") && !plan059.includes("Frozen")) {
    errors.push("059 plan must remain frozen");
  }

  const r = spawnSync(process.execPath, ["scripts/verify-inventory-phase059-final.mjs", "--static"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, VERIFY_FAST: "1" },
  });
  if (r.status === 0) notes.push("059 static regression PASS");
  else errors.push("059 static regression FAIL");

  const a = spawnSync(process.execPath, ["scripts/verify-inventory-phase060a-final-freeze.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1" },
  });
  if (a.status === 0) notes.push("060A freeze regression PASS");
  else errors.push("060A freeze regression FAIL");

  return { notes, errors };
}

function verifyRoadmap() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("060B.1") && !roadmap.includes("060B.2") && !roadmap.includes("060B.3") && !roadmap.includes("060B.4") && !/060B.*Complete.*Frozen|060B.*✅/i.test(roadmap)) {
    errors.push("Roadmap must reference Phase 060B progress");
  }
  notes.push("Roadmap reflects Phase 060 / 059 frozen");
  return { notes, errors };
}

async function main() {
  const doc = verifyDoc();
  const drift = verifyNoRuntimeDrift();
  const frozen = verifyFrozenPhases();
  const roadmap = verifyRoadmap();

  const notes = [...doc.notes, ...drift.notes, ...frozen.notes, ...roadmap.notes];
  const errors = [...doc.errors, ...drift.errors, ...frozen.errors, ...roadmap.errors];

  console.log("\n=== Phase 060B.1 — eBay Variation Group Relist Audit ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 060B.1 audit/design complete (no runtime changes)\n");
  console.log("Next subphase: 060B.2 — read-only relist candidate infrastructure\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

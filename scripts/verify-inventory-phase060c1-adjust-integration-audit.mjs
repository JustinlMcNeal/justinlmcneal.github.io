/**
 * Phase 060C.1 — Adjust integration audit + wiring plan verification.
 * Audit/design only — no runtime Adjust variation wiring.
 *
 * Run: node scripts/verify-inventory-phase060c1-adjust-integration-audit.mjs
 */
import { readFileSync, existsSync } from "fs";
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
  "060C.1 — Adjust integration audit + wiring plan",
  "Audit findings — current Adjust preview integration",
  "Audit findings — current eBay orchestrator branch",
  "060A Adjust behavior",
  "060B Adjust behavior",
  "Preview / toggle state design",
  "Result panel state design",
  "API wrapper plan",
  "060C.2 scope",
  "060C.3 scope",
  "060C.4 scope",
  "060C.5 scope",
  "060C risks",
  "060C out of scope",
  "variation_child_update_qty",
  "relist-ebay-variation-group",
  "syncEbayVariationChildQuantity",
  "relistEbayVariationGroup",
  "ebayVariationQtySyncApi.js",
  "ebayVariationGroupRelistApi.js",
  "variation_update_qty",
  "variation_group_ready_to_relist",
  "EBAY_ENABLE_LIVE_QUANTITY_PATCH",
  "EBAY_ENABLE_LIVE_VARIATION_RELIST",
];

const FORBIDDEN_API_FILES = [
  "js/admin/inventory/api/ebayVariationQtySyncApi.js",
  "js/admin/inventory/api/ebayVariationGroupRelistApi.js",
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/ui/adjustResultPanel.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
];

const FAST_ENV = { VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1" };

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function runScript(script, args = []) {
  const r = spawnSync(process.execPath, [join("scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, ...FAST_ENV },
  });
  return { ok: r.status === 0, tail: (r.stdout || r.stderr || "").split("\n").slice(-4).join(" ") };
}

function verifyDoc() {
  const notes = [];
  const errors = [];
  const doc = readText(PLAN_060);
  if (!/060C\.1[^]*audit\/design only/i.test(doc) && !doc.includes("no runtime Adjust wiring")) {
    errors.push("060C.1 must be marked audit/design only");
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!doc.includes(section)) errors.push(`Plan missing: ${section}`);
  }
  if (!/060B.*Complete.*Frozen/i.test(doc)) errors.push("Plan must show 060B frozen");
  if (!/060A.*Complete.*Frozen/i.test(doc)) errors.push("Plan must show 060A frozen");
  if (!doc.includes("060C.2")) errors.push("Plan must document 060C.2 scope");
  if (!doc.includes("syncToggleUserSet")) errors.push("Plan must document toggle override preservation");
  if (!doc.includes("fetchChannelSyncPreview")) errors.push("Plan must reference fetchChannelSyncPreview avoidance");
  notes.push("060C.1 audit sections + wiring plan documented");
  return { notes, errors };
}

function verifyNoRuntimeWiring() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_060);

  if (/060C\.2[^]*✅|Phase 060.*Complete.*Frozen/i.test(plan)) {
    notes.push("060C.1 audit frozen — runtime drift superseded by 060C.2+ integration");
    if (!plan.includes("060C.1 — Adjust integration audit")) {
      errors.push("Plan must retain 060C.1 audit section");
    }
    return { notes, errors };
  }

  for (const rel of FORBIDDEN_API_FILES) {
    if (existsSync(join(ROOT, rel))) errors.push(`API wrapper must not exist yet in 060C.1: ${rel}`);
  }

  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (/syncEbayVariationChildQuantity|relistEbayVariationGroup|ebayVariationQtySyncApi|ebayVariationGroupRelistApi/.test(t)) {
      errors.push(`${rel} must not wire variation sync/relist APIs yet`);
    }
    if (/variation_child_update_qty/.test(t) && !rel.includes("adjustChannelPreview")) {
      errors.push(`${rel} must not call variation_child_update_qty yet`);
    }
    if (/relist-ebay-variation-group|functions\/v1\/relist-ebay-variation-group/.test(t)) {
      errors.push(`${rel} must not call variation group relist edge yet`);
    }
    if (/fetchEbayVariationChildCandidate|fetchEbayVariationRelistCandidate/.test(t) && rel.includes("adjustModal")) {
      errors.push(`${rel} must not fetch variation candidates in Adjust yet (060C.2)`);
    }
    if (/fetchChannelSyncPreview\(\)/.test(t)) {
      errors.push(`${rel}: forbidden full fetchChannelSyncPreview in Adjust flow`);
    }
    if (/refreshIssueSnapshot|issueSnapshot/.test(t)) {
      errors.push(`${rel}: forbidden browser snapshot refresh`);
    }
    if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }

  const preview = readText("js/admin/inventory/ui/adjustModalChannelPreview.js");
  if (!preview.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("Preview must use single-variant candidate API");
  }
  if (preview.includes("fetchChannelSyncPreview")) {
    errors.push("Adjust preview must not use fetchChannelSyncPreview");
  }

  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  if (!branch.includes("resolveEbayBranch")) errors.push("eBay branch resolver must exist");
  if (branch.includes("variation_child_update_qty")) {
    errors.push("Orchestrator must not wire variation qty mode in 060C.1");
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  if (orch.includes("adjust_inventory") && orch.includes("variation_group_relist")) {
    errors.push("Orchestrator must not reference variation group relist");
  }

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/variation_child_update_qty|relist-ebay-variation-group|EBAY_ENABLE_LIVE_VARIATION_RELIST/.test(amazon)) {
    errors.push("Amazon module unchanged");
  }

  notes.push("No Adjust variation runtime wiring; pool-safety preserved");
  return { notes, errors };
}

function verifyRoadmap() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);
  const plan = readText(PLAN_060);
  const phase060Complete = /Phase 060.*Complete.*Frozen|Production-ready/i.test(plan);

  if (phase060Complete) {
    if (!/060C.*Complete.*Frozen|Phase 060.*Complete/i.test(roadmap)) {
      errors.push("Roadmap must show Phase 060 complete when plan is frozen");
    }
    notes.push("Roadmap reflects Phase 060 complete/frozen");
  } else {
    if (!roadmap.includes("060C.1")) errors.push("Roadmap missing 060C.1");
    if (!roadmap.includes("060C.2") && !roadmap.includes("C.2 next")) {
      errors.push("Roadmap must list 060C.2 next");
    }
    notes.push("Roadmap reflects 060C.1 / frozen 060A/060B/059");
  }
  if (!/060B.*Complete.*Frozen|060B ✅/i.test(roadmap)) errors.push("Roadmap: 060B must remain frozen");
  if (!/060A.*Complete.*Frozen|060A ✅/i.test(roadmap)) errors.push("Roadmap: 060A must remain frozen");
  if (!/059.*Complete/i.test(roadmap)) errors.push("Roadmap: Phase 059 must remain frozen");
  return { notes, errors };
}

function verifyRegressions() {
  const notes = [];
  const errors = [];
  for (const { script, label, args = [] } of [
    { script: "verify-inventory-phase060a-final-freeze.mjs", label: "060A freeze" },
    { script: "verify-inventory-phase060b-final-freeze.mjs", label: "060B freeze", extraEnv: { VERIFY_SKIP_NESTED_REGRESSION: "1" } },
    { script: "verify-inventory-phase059-final.mjs", label: "059 static", args: ["--static"] },
  ]) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing regression: ${script}`);
      continue;
    }
    const r = spawnSync(process.execPath, [path, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 90_000,
      env: { ...process.env, ...FAST_ENV, VERIFY_SKIP_NESTED_REGRESSION: "1" },
    });
    if (r.status === 0) notes.push(`Regression PASS: ${label}`);
    else errors.push(`Regression FAIL: ${label}`);
  }
  return { notes, errors };
}

function main() {
  console.log("\n=== Phase 060C.1 — Adjust Integration Audit ===\n");

  const parts = [verifyDoc(), verifyNoRuntimeWiring(), verifyRoadmap(), verifyRegressions()];
  const notes = parts.flatMap((p) => p.notes);
  const errors = parts.flatMap((p) => p.errors);

  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060C.1 Adjust integration audit/design complete (no runtime wiring)\n");
  console.log("Next subphase: 060C.2 — preview/toggle read-only integration\n");
}

main();

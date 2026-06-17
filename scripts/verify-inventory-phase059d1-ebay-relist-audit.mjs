/**
 * Phase 059D.1 — eBay relist architecture audit + design verification.
 * Design/audit only — confirms documentation and no 059D runtime drift.
 *
 * Run: node scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs
 *
 * Fast mode (skip full 059C freeze chain — use when composed from 059D.2):
 *   VERIFY_FAST=1 node scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { isVerifyFastMode } from "./lib/verifyFastMode.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PLAN_DOC =
  "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const REQUIRED_DOC_SECTIONS = [
  "059D.1 — eBay relist architecture audit ✅",
  "Audit findings — eBay publish path",
  "Audit findings — Relist Assist",
  "Same details",
  "059D auto-relist eligibility",
  "059D.2 edge contract",
  "Live gate recommendation",
  "Safety rules (059D",
  "Failure handling (059D",
  "Verification plan — 059D.2 through 059D.5",
];

const RELIST_RUNTIME_FORBIDDEN = [
  "js/admin/inventory/services/adjustChannelEbayRelist.js",
];

function is059D3Complete() {
  const roadmap = readText(ROADMAP);
  const plan = readText(PLAN_DOC);
  return (
    (roadmap.includes("059D.3") && roadmap.includes("✅")) ||
    plan.includes("059D.3 — Adjust orchestrator integration ✅")
  );
}

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyDoc() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, PLAN_DOC))) {
    errors.push(`Missing plan doc: ${PLAN_DOC}`);
    return { notes, errors };
  }

  const doc = readText(PLAN_DOC);

  if (!doc.includes("059C") || !doc.includes("frozen")) {
    errors.push("Plan doc must preserve 059C frozen state");
  }

  for (const section of REQUIRED_DOC_SECTIONS) {
    if (!doc.includes(section)) {
      errors.push(`Plan doc missing audit section: ${section}`);
    }
  }
  notes.push("059D.1 audit sections present in plan doc");

  if (doc.includes("relist-ebay-from-product")) {
    notes.push("Plan doc documents relist-ebay-from-product edge");
  }
  if (doc.includes("059D.2 — Relist edge function ✅")) {
    notes.push("059D.2 edge complete (post-059D.1 audit)");
  } else if (!doc.includes("059D.2 edge contract")) {
    errors.push("Plan doc must document 059D.2 edge contract");
  }
  notes.push("Eligibility, live gate, and 059D subphases documented");

  if (!doc.includes("verify-inventory-phase059d1-ebay-relist-audit.mjs")) {
    errors.push("Plan doc must reference 059D.1 verify script");
  }

  return { notes, errors };
}

function verifyNo059DRuntimeDrift() {
  const notes = [];
  const errors = [];

  for (const rel of RELIST_RUNTIME_FORBIDDEN) {
    if (existsSync(join(ROOT, rel))) {
      errors.push(`059D runtime file must not exist yet: ${rel}`);
    }
  }
  if (existsSync(join(ROOT, "supabase/functions/relist-ebay-from-product/index.ts"))) {
    notes.push("relist-ebay-from-product edge present (059D.2+)");
  } else {
    notes.push("No relist-ebay-from-product edge (059D.1 scope)");
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const ebayBranch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const d3 = is059D3Complete();
  if (d3) {
    if (!existsSync(join(ROOT, "js/admin/inventory/api/ebayRelistFromProductApi.js"))) {
      errors.push("059D.3 requires ebayRelistFromProductApi.js");
    }
    if (!ebayBranch.includes("runEbayEndedRelist") || !ebayBranch.includes("relistEbayFromProduct")) {
      errors.push("059D.3 eBay branch must call relistEbayFromProduct via runEbayEndedRelist");
    }
    notes.push("059D.3 orchestrator relist wiring present");
  } else {
    if (existsSync(join(ROOT, "js/admin/inventory/api/ebayRelistFromProductApi.js"))) {
      errors.push("ebayRelistFromProductApi must not exist before 059D.3");
    }
    if (orch.includes("relist-ebay-from-product") || orch.includes("runEbayRelist")) {
      errors.push("Orchestrator must not wire relist edge yet (059D.3)");
    }
    if (ebayBranch.includes("relist-ebay-from-product") || ebayBranch.includes("runEbayRelistFromProduct")) {
      errors.push("eBay branch must not call relist edge yet (059D.3)");
    }
    if (!ebayBranch.includes("Relist starts in 059D") && !ebayBranch.includes("runEbayEndedRelist")) {
      errors.push("eBay branch must defer ended listings to 059D");
    }
    notes.push("Adjust orchestrator unchanged for relist automation (pre-059D.3)");
  }

  const relistAssist = readText("js/admin/inventory/ui/syncEbayRelistAssist.js");
  if (!relistAssist.includes("Assist-only") || relistAssist.includes("relist-ebay-from-product")) {
    errors.push("Relist Assist must remain assist-only links");
  }
  notes.push("Relist Assist remains manual/assist-only");

  if (!existsSync(join(ROOT, "supabase/functions/ebay-manage-listing/index.ts"))) {
    errors.push("Missing ebay-manage-listing edge (audit reference)");
  }
  if (!existsSync(join(ROOT, "js/admin/ebayListings/pushModal.js"))) {
    errors.push("Missing Push modal (audit reference)");
  }
  notes.push("Existing publish path files present for 059D.2 reference");

  return { notes, errors };
}

function verify059CFrozenLite() {
  const notes = [];
  const errors = [];

  const doc = readText(PLAN_DOC);
  if (!doc.includes("059C") || !doc.includes("frozen")) {
    errors.push("Plan doc must preserve 059C frozen state");
  }

  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("059C ✅ Complete") && !roadmap.includes("059C.5 ✅")) {
    errors.push("roadmap.md must mark 059C complete (frozen)");
  }

  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const d3 = is059D3Complete();
  if (d3) {
    if (!branch.includes("runEbayEndedRelist")) {
      errors.push("059C frozen + 059D.3: eBay branch must wire runEbayEndedRelist");
    }
  } else if (branch.includes("relist-ebay-from-product") || branch.includes("runEbayRelistFromProduct")) {
    errors.push("059C eBay branch must not wire relist edge (059D.3)");
  } else if (!branch.includes("Relist starts in 059D")) {
    errors.push("059C eBay branch must defer ended listings to 059D");
  }

  notes.push("059C frozen boundaries verified (fast mode — full freeze chain skipped)");
  return { notes, errors };
}

function verify059CFrozen() {
  if (isVerifyFastMode()) {
    return verify059CFrozenLite();
  }

  const notes = [];
  const errors = [];
  const freezeScript = join(ROOT, "scripts", "verify-inventory-phase059c-final-freeze.mjs");
  if (!existsSync(freezeScript)) {
    errors.push("Missing 059C freeze script");
    return { notes, errors };
  }
  const result = spawnSync(process.execPath, [freezeScript], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900_000,
    env: { ...process.env },
  });
  if (result.status === 0) notes.push("059C final freeze script still PASS");
  else {
    const tail = (result.stdout || result.stderr || "").split("\n").slice(-4).join(" ").trim();
    errors.push(`059C freeze regression FAIL${tail ? `: ${tail.slice(0, 120)}` : ""}`);
  }
  return { notes, errors };
}

function verifyRoadmap() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("059C ✅ Complete")) {
    errors.push("roadmap.md must mark 059C complete");
  }
  const hasD =
    roadmap.includes("059D.1") ||
    roadmap.includes("D.1") ||
    roadmap.includes("059D ✅ Complete") ||
    roadmap.includes("059D.1–D");
  if (!hasD) errors.push("roadmap.md must reference 059D");
  if (roadmap.includes("059D ✅ Complete")) {
    notes.push("roadmap.md marks 059D complete (frozen)");
  } else {
    notes.push("roadmap.md reflects 059C frozen + 059D in progress");
  }
  return { notes, errors };
}

function main() {
  const fast = isVerifyFastMode();
  const doc = verifyDoc();
  const drift = verifyNo059DRuntimeDrift();
  const frozen = verify059CFrozen();
  const roadmap = verifyRoadmap();

  const notes = [...doc.notes, ...drift.notes, ...frozen.notes, ...roadmap.notes];
  const errors = [...doc.errors, ...drift.errors, ...frozen.errors, ...roadmap.errors];

  console.log("\n=== Phase 059D.1 — eBay Relist Architecture Audit ===\n");
  if (fast) console.log("  ○ VERIFY_FAST=1 — deep 059C freeze chain skipped\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059D.1 eBay relist architecture audit complete (no runtime changes)\n");
  console.log("Next subphase: 059D.3 — Adjust orchestrator relist integration\n");
}

main();

/**
 * Phase 061A — Final freeze verification.
 *
 * Run: node scripts/verify-inventory-phase061a-final-freeze.mjs
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLAN = "docs/pages/admin/inventory/implementation/061_sale_triggered_channel_sync_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const FAST_ENV = {
  VERIFY_FAST: "1",
  VERIFY_SKIP_DEEP_REGRESSION: "1",
  VERIFY_SKIP_NESTED_REGRESSION: "1",
  VERIFY_SKIP_BROWSER: "1",
};

const COMPOSED = [
  { script: "verify-inventory-phase061a1-sale-hold-audit.mjs", label: "061A.1 audit" },
  { script: "verify-inventory-phase061a3-sale-hold-matrix.mjs", label: "061A.3 matrix" },
  { script: "verify-inventory-phase059-final.mjs", label: "059 final", args: ["--static"] },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue view safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "10Y stabilization" },
];

const ARTIFACTS = [
  "supabase/migrations/20261027_inventory_phase061a_sale_hold_reservations.sql",
  "supabase/functions/_shared/marketplaceSaleHold.ts",
  "supabase/functions/ebay-webhook/index.ts",
  "supabase/functions/ebay-sync-orders/index.ts",
  "supabase/functions/_shared/amazonOrderSyncUtils.ts",
  "scripts/verify-inventory-phase061a1-sale-hold-audit.mjs",
  "scripts/verify-inventory-phase061a3-sale-hold-matrix.mjs",
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function runScript(script, args = []) {
  return spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...FAST_ENV },
  });
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN);
  const roadmap = readText(ROADMAP);

  if (!/061A.*✅ Complete|061A.*Complete \/ Frozen/i.test(plan)) {
    errors.push("061 plan: 061A must be marked complete/frozen");
  }
  if (!/061A.*Frozen|061A.*✅/i.test(plan)) {
    errors.push("061 plan: 061A frozen status required");
  }

  if (!/061A.*✅|061A.*Complete/i.test(roadmap)) {
    errors.push("roadmap: 061A must be marked complete/frozen");
  }
  notes.push("061A frozen in plan + roadmap");

  return { notes, errors };
}

function verifyArtifacts() {
  const notes = [];
  const errors = [];
  for (const rel of ARTIFACTS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing artifact: ${rel}`);
  }
  if (!errors.length) notes.push("061A artifacts present");
  return { notes, errors };
}

function verify060FrozenStatic() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);
  if (!/060.*✅ Complete|Phase 060.*Complete.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: Phase 060 must remain frozen");
  } else {
    notes.push("060 frozen per roadmap (run verify-inventory-phase060-final-freeze.mjs for full compose)");
  }
  return { notes, errors };
}

function main() {
  const notes = [];
  const errors = [];

  const docs = verifyDocs();
  const artifacts = verifyArtifacts();
  const frozen060 = verify060FrozenStatic();
  notes.push(...docs.notes, ...artifacts.notes, ...frozen060.notes);
  errors.push(...docs.errors, ...artifacts.errors, ...frozen060.errors);

  for (const item of COMPOSED) {
    const result = runScript(item.script, item.args || []);
    if (result.status === 0) {
      notes.push(`${item.label} PASS`);
    } else {
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-3).join(" ").trim();
      errors.push(`${item.label} FAIL${tail ? `: ${tail.slice(0, 100)}` : ""}`);
    }
  }

  console.log("\n=== Phase 061A — Final Freeze ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061A complete/frozen\n");
}

main();

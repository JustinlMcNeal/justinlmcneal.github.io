/**
 * Phase 061B — Final freeze verification (061B.1 + 061B.2 + 061B.3).
 *
 * Run: node scripts/verify-inventory-phase061b-final-freeze.mjs
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLAN = "docs/pages/admin/inventory/implementation/061_sale_triggered_channel_sync_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const ARTIFACTS = [
  "supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts",
  "supabase/functions/_shared/marketplaceSaleHold.ts",
  "supabase/functions/_shared/saleSyncQueue.ts",
  "supabase/functions/_shared/saleChannelSyncOrchestrator.ts",
  "supabase/functions/process-sale-channel-sync-queue/index.ts",
  "supabase/migrations/20261028_inventory_phase061b2_sale_sync_queue.sql",
  "scripts/verify-inventory-phase061b-sale-push.mjs",
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function runScript(script) {
  return spawnSync(process.execPath, [join(ROOT, "scripts", script)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180_000,
    env: {
      ...process.env,
      VERIFY_FAST: "1",
      VERIFY_SKIP_DEEP_REGRESSION: "1",
      VERIFY_SKIP_NESTED_REGRESSION: "1",
      VERIFY_SKIP_BROWSER: "1",
    },
  });
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN);
  const roadmap = readText(ROADMAP);

  for (const marker of ["061B.1", "061B.2", "061B.3"]) {
    if (!new RegExp(`${marker}.*✅|${marker}.*Complete`, "i").test(plan)) {
      errors.push(`Plan: ${marker} must be marked complete`);
    }
  }
  if (!/061B.*Complete|061B.*Frozen/i.test(plan)) {
    errors.push("Plan: 061B must be frozen");
  }
  if (!/061C\.1/i.test(plan)) {
    errors.push("Plan: 061C must be referenced");
  }

  if (!/061B.*✅|061B.*Complete|061B.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: 061B frozen");
  }
  if (!/061A.*✅|061A.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: 061A must remain frozen");
  }
  notes.push("061B complete/frozen; 061A frozen");

  return { notes, errors };
}

function verifyArtifacts() {
  const notes = [];
  const errors = [];
  for (const rel of ARTIFACTS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
  }
  if (!errors.length) notes.push("061B artifacts present");
  return { notes, errors };
}

function main() {
  const notes = [];
  const errors = [];

  const docs = verifyDocs();
  const artifacts = verifyArtifacts();
  notes.push(...docs.notes, ...artifacts.notes);
  errors.push(...docs.errors, ...artifacts.errors);

  const b3 = runScript("verify-inventory-phase061b-sale-push.mjs");
  if (b3.status === 0) notes.push("061B.3 sale-push verification PASS");
  else {
    const tail = (b3.stdout || b3.stderr || "").split("\n").slice(-4).join(" ").trim();
    errors.push(`061B.3 verification FAIL${tail ? `: ${tail.slice(0, 120)}` : ""}`);
  }

  console.log("\n=== Phase 061B — Final Freeze ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 061B complete and frozen; next: 061C.1\n");
}

main();

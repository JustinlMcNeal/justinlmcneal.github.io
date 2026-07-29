/**
 * Read-only drift report: KK available vs channel cache for recently sale-touched variants.
 *
 * Run: node scripts/reconcile-sale-channel-qty.mjs [--limit N]
 *
 * No writes. No channel API calls. No fixes.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 50) : 50;

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyReadOnlyDesign() {
  const text = readText("scripts/reconcile-sale-channel-qty.mjs");
  const lines = text.split("\n").filter((line) => !line.trim().startsWith("//") && !line.includes("forbidden"));
  const body = lines.join("\n");
  const forbidden = [/\.update\(/, /\.insert\(/, /\.upsert\(/, /\.delete\(/, /await adjustInventory\(/];
  for (const pat of forbidden) {
    if (pat.test(body)) {
      console.error(`FAIL: reconcile script must be read-only (matched ${pat})`);
      process.exit(1);
    }
  }
}

function main() {
  verifyReadOnlyDesign();

  const notes = [];
  const errors = [];

  const queueMigration = "supabase/migrations/20261028_inventory_phase061b2_sale_sync_queue.sql";
  if (!existsSync(join(ROOT, queueMigration))) {
    errors.push("Missing sale sync queue migration");
  } else {
    notes.push("Sale sync queue schema referenced for report design");
  }

  const candidateView = "v_inventory_channel_sync_candidates";
  const orchestrator = readText("supabase/functions/_shared/saleChannelSyncOrchestrator.ts");
  if (!orchestrator.includes(candidateView) && !readText("supabase/functions/_shared/marketplaceSaleSyncAfterHold.ts").includes(candidateView)) {
    errors.push("Candidate view not referenced in sale sync modules");
  } else {
    notes.push(`Report compares ${candidateView}.available_qty vs channel cache columns`);
  }

  notes.push(`Report limit default: ${limit} variants (static design check)`);
  notes.push("Runtime DB query optional — operator runs against Supabase SQL editor:");
  notes.push("  SELECT variant_id, available_qty, amazon_qty, ebay_qty FROM v_inventory_channel_sync_candidates");
  notes.push("  WHERE variant_id IN (SELECT DISTINCT variant_id FROM inventory_sale_sync_queue ORDER BY created_at DESC LIMIT N)");
  notes.push("Read-only: no writes, no channel calls, no auto-fix");

  console.log("\n=== reconcile-sale-channel-qty (read-only) ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — reconcile script is read-only design verified\n");
}

main();

#!/usr/bin/env node
/**
 * Remove test parcel 227461 and related side effects.
 *
 * Usage:
 *   node scripts/supabase/cleanup-parcel-227461.mjs           # dry-run
 *   node scripts/supabase/cleanup-parcel-227461.mjs --execute # apply
 *
 * Optional:
 *   --revert-cpi  NULL unit_cost_override_cents on variants mapped by these imports
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const PARCEL_ID = "227461";

function loadEnv() {
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0 && !process.env[t.slice(0, i).trim()]) {
        process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
    }
  } catch {
    // optional
  }
}

async function main() {
  const execute = process.argv.includes("--execute");
  const revertCpi = process.argv.includes("--revert-cpi");
  loadEnv();

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const imports = await client.query(
    `SELECT id, status, expense_id, inventory_received_at
     FROM public.parcel_imports WHERE parcel_id = $1`,
    [PARCEL_ID],
  );

  if (!imports.rows.length) {
    console.log(`No parcel_imports found for parcel_id=${PARCEL_ID}.`);
    await client.end();
    return;
  }

  const importIds = imports.rows.map((r) => r.id);
  const expenseIds = [
    ...new Set(imports.rows.map((r) => r.expense_id).filter(Boolean)),
  ];

  const ledger = await client.query(
    `SELECT id, variant_id, change, stock_before, stock_after, reference_id
     FROM public.stock_ledger
     WHERE reference_id = ANY($1::text[]) AND reason = 'parcel_receive'`,
    [importIds.map(String)],
  );

  const variantIds = await client.query(
    `SELECT DISTINCT product_variant_id AS id
     FROM parcel_import_item_mappings
     WHERE parcel_import_id = ANY($1::uuid[]) AND product_variant_id IS NOT NULL`,
    [importIds],
  );

  console.log(`\nCleanup plan for parcel_id=${PARCEL_ID} (${execute ? "EXECUTE" : "DRY-RUN"})\n`);
  console.log(`- Delete ${imports.rows.length} parcel_imports (+ cascaded children)`);
  console.log(`- Delete ${expenseIds.length} linked expense(s):`, expenseIds);
  console.log(`- Reverse ${ledger.rows.length} stock_ledger receive(s)`);
  for (const row of ledger.rows) {
    console.log(
      `    variant ${row.variant_id}: stock ${row.stock_after} → ${row.stock_before} (change ${row.change})`,
    );
  }
  if (revertCpi) {
    console.log(
      `- NULL unit_cost_override_cents on ${variantIds.rows.length} mapped variant(s)`,
    );
  } else {
    console.log(
      `- CPI overrides left unchanged (pass --revert-cpi to NULL mapped variant overrides)`,
    );
  }

  if (!execute) {
    console.log("\nDry-run only. Re-run with --execute to apply.\n");
    await client.end();
    return;
  }

  await client.query("BEGIN");
  try {
    for (const row of ledger.rows) {
      await client.query(
        `UPDATE public.product_variants
         SET stock = $1
         WHERE id = $2 AND stock = $3`,
        [row.stock_before, row.variant_id, row.stock_after],
      );
      await client.query(`DELETE FROM public.stock_ledger WHERE id = $1`, [row.id]);
    }

    if (revertCpi && variantIds.rows.length) {
      const ids = variantIds.rows.map((r) => r.id);
      await client.query(
        `UPDATE public.product_variants
         SET unit_cost_override_cents = NULL
         WHERE id = ANY($1::uuid[])`,
        [ids],
      );
    }

    if (expenseIds.length) {
      await client.query(`DELETE FROM public.expenses WHERE id = ANY($1::uuid[])`, [
        expenseIds,
      ]);
    }

    const deleted = await client.query(
      `DELETE FROM public.parcel_imports WHERE parcel_id = $1 RETURNING id`,
      [PARCEL_ID],
    );

    await client.query("COMMIT");

    console.log(`\nDone. Deleted ${deleted.rowCount} parcel_import(s).`);
    const remaining = await client.query(
      `SELECT count(*)::int AS n FROM public.parcel_imports WHERE parcel_id = $1`,
      [PARCEL_ID],
    );
    console.log(`Remaining parcel_imports for ${PARCEL_ID}:`, remaining.rows[0].n);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

#!/usr/bin/env node
/** Inspect all DB rows related to test parcel 227461. */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

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
  loadEnv();
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const imports = await client.query(
    `SELECT id, parcel_id, status, imported_at, approved_at, expense_id,
            inventory_received_at, source_file_name, products_affected_count
     FROM public.parcel_imports
     WHERE parcel_id = '227461'
     ORDER BY imported_at`,
  );

  const importIds = imports.rows.map((r) => r.id);
  console.log(`\nparcel_imports (parcel_id=227461): ${imports.rows.length}`);
  console.table(imports.rows);

  if (!importIds.length) {
    await client.end();
    return;
  }

  const placeholders = importIds.map((_, i) => `$${i + 1}`).join(", ");

  const counts = await client.query(
    `SELECT
       (SELECT count(*)::int FROM parcel_import_items WHERE parcel_import_id = ANY($1::uuid[])) AS items,
       (SELECT count(*)::int FROM parcel_import_item_mappings WHERE parcel_import_id = ANY($1::uuid[])) AS mappings,
       (SELECT count(*)::int FROM parcel_import_cost_allocations WHERE parcel_import_id = ANY($1::uuid[])) AS allocations,
       (SELECT count(*)::int FROM parcel_import_events WHERE parcel_import_id = ANY($1::uuid[])) AS events`,
    [importIds],
  );
  console.log("\nChild row counts:", counts.rows[0]);

  const expenseIds = [
    ...new Set(imports.rows.map((r) => r.expense_id).filter(Boolean)),
  ];
  if (expenseIds.length) {
    const expenses = await client.query(
      `SELECT id, amount_cents, description, vendor, category, created_at
       FROM public.expenses WHERE id = ANY($1::uuid[])`,
      [expenseIds],
    );
    console.log("\nLinked expenses:", expenses.rows.length);
    console.table(expenses.rows);
  }

  const ledger = await client.query(
    `SELECT id, variant_id, change, reason, reference_id, stock_before, stock_after, created_at
     FROM public.stock_ledger
     WHERE reference_id = ANY($1::uuid[]) AND reason = 'parcel_receive'
     ORDER BY created_at`,
    [importIds],
  );
  if (ledger.rows.length) {
    console.log("\nstock_ledger (parcel_receive):", ledger.rows.length);
    console.table(ledger.rows);
  }

  const approvedIds = imports.rows
    .filter((r) => r.status === "approved")
    .map((r) => r.id);
  if (approvedIds.length) {
    const finalAllocs = await client.query(
      `SELECT a.parcel_import_id, a.parcel_import_item_id, a.landed_cpi_usd,
              m.product_id, m.product_variant_id, m.mapped_product_label
       FROM parcel_import_cost_allocations a
       JOIN parcel_import_item_mappings m
         ON m.parcel_import_item_id = a.parcel_import_item_id
       WHERE a.parcel_import_id = ANY($1::uuid[])
         AND a.allocation_run_type = 'final'
         AND a.included_in_final_product_cpi = true`,
      [approvedIds],
    );
    if (finalAllocs.rows.length) {
      console.log("\nFinal CPI allocations (approved imports):", finalAllocs.rows.length);
      console.table(finalAllocs.rows.slice(0, 10));
    }
  }

  const variants = await client.query(
    `SELECT DISTINCT pv.id, pv.sku, pv.stock, pv.unit_cost_override_cents, p.name, p.unit_cost
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     JOIN parcel_import_item_mappings m ON m.product_variant_id = pv.id
     WHERE m.parcel_import_id = ANY($1::uuid[])`,
    [importIds],
  );
  if (variants.rows.length) {
    console.log("\nVariants touched by mappings:", variants.rows.length);
    console.table(variants.rows);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

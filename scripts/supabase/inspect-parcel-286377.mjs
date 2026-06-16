#!/usr/bin/env node
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./dbConnect.mjs";

const PARCEL_ID = "286377";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
try {
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && !process.env[t.slice(0, i).trim()]) {
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
} catch {}

const client = new pg.Client({
  connectionString: getPoolerConnectionString(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const imports = await client.query(
  `SELECT id, status, imported_at, source_file_name
   FROM parcel_imports WHERE parcel_id = $1 ORDER BY imported_at DESC`,
  [PARCEL_ID],
);
console.log(`\nparcel_imports (${PARCEL_ID}):`, imports.rows.length);
console.table(imports.rows);

if (imports.rows.length) {
  const importId = imports.rows[0].id;
  const items = await client.query(
    `SELECT row_number, baestao_order_id, source_item_name, item_weight_grams
     FROM parcel_import_items
     WHERE parcel_import_id = $1
     ORDER BY row_number`,
    [importId],
  );
  console.log("\nItems:");
  console.table(items.rows);
}

await client.end();

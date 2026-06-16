#!/usr/bin/env node
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./dbConnect.mjs";

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
} catch {
  // optional
}

const client = new pg.Client({
  connectionString: getPoolerConnectionString(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(
  `SELECT id, status, xls_parcel_weight_grams, xls_charged_weight_grams,
          actual_charged_weight_grams, actual_parcel_weight_grams,
          source_file_name, imported_at
   FROM parcel_imports WHERE parcel_id = $1 ORDER BY imported_at DESC LIMIT 5`,
  ["288333"],
);
console.table(rows);
await client.end();

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient, runLinkedSql, runLinkedSqlFile } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const migrationPath = join(
  repoRoot,
  "supabase",
  "migrations",
  "20260811_amazon_live_offer_price_view.sql",
);

const mode = process.env.APPLY_MIGRATIONS_VIA || "linked";

if (mode === "pg") {
  const client = await connectPgClient();
  const sql = readFileSync(migrationPath, "utf8");
  await client.query("DROP VIEW IF EXISTS public.v_amazon_listing_workspace CASCADE");
  await client.query(sql);
  await client.end();
} else {
  runLinkedSql("DROP VIEW IF EXISTS public.v_amazon_listing_workspace CASCADE", repoRoot);
  runLinkedSqlFile(migrationPath, repoRoot);
}

console.log("Applied 20260811_amazon_live_offer_price_view.sql");

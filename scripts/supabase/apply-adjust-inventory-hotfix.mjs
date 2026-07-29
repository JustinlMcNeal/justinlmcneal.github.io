#!/usr/bin/env node
/** Apply 20261107 adjust_inventory SECURITY DEFINER hotfix only. */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { connectPgClient } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const MIGRATION = "20261107_security_hotfix_adjust_inventory_definer.sql";

function loadEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && !process.env[t.slice(0, i).trim()]) {
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
}

async function main() {
  loadEnv();
  const sql = readFileSync(join(ROOT, "supabase/migrations", MIGRATION), "utf8");
  const client = await connectPgClient();
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
      ["20261107"],
    );
    const { rows } = await client.query(`
      SELECT p.prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'adjust_inventory'
    `);
    console.log("adjust_inventory SECURITY DEFINER:", rows[0]?.prosecdef === true ? "yes" : "no");
    console.log("Applied:", MIGRATION);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

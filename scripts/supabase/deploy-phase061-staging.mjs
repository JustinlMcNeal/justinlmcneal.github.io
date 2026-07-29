/**
 * Phase 061 staging deploy helper — migrations, function deploy list, worker preview, pilot check.
 *
 * Run: node scripts/supabase/deploy-phase061-staging.mjs [--migrations-only] [--worker-preview] [--pilot-check]
 *
 * Requires .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL)
 * Optional: CRON_SECRET, PILOT_VARIANT_ID (default KK-0001 Black from plan)
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getPoolerConnectionString } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const PROJECT_REF = "yxdzvzscufkvewecvagq";

const MIGRATIONS = [
  "20261027_inventory_phase061a_sale_hold_reservations.sql",
  "20261028_inventory_phase061b2_sale_sync_queue.sql",
  "20261029_inventory_phase061c1_sale_reservation_release.sql",
];

const FUNCTIONS = [
  "stripe-webhook",
  "ebay-webhook",
  "ebay-sync-orders",
  "amazon-sync-orders",
  "amazon-sync-orders-cron",
  "process-sale-channel-sync-queue",
  "enqueue-sale-channel-sync",
];

const DEFAULT_PILOT_VARIANT = "4c8c5709-b2c9-4fa6-b7bd-5416b83c9951";

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    ...opts,
  });
  return r;
}

async function check061Schema(client) {
  const checks = [
    { name: "reserve_inventory_for_marketplace_sale", sql: "SELECT 1 FROM pg_proc WHERE proname = 'reserve_inventory_for_marketplace_sale'" },
    { name: "release_marketplace_sale_reservation", sql: "SELECT 1 FROM pg_proc WHERE proname = 'release_marketplace_sale_reservation'" },
    { name: "inventory_sale_sync_queue", sql: "SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_sale_sync_queue'" },
    { name: "claim_inventory_sale_sync_jobs", sql: "SELECT 1 FROM pg_proc WHERE proname = 'claim_inventory_sale_sync_jobs'" },
    { name: "inventory_sale_release_actions", sql: "SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_sale_release_actions'" },
  ];
  const out = {};
  for (const c of checks) {
    const { rows } = await client.query(c.sql);
    out[c.name] = rows.length > 0;
  }
  return out;
}

async function applyMigrations(client) {
  const applied = [];
  for (const file of MIGRATIONS) {
    const path = join(ROOT, "supabase/migrations", file);
    if (!existsSync(path)) throw new Error(`Missing migration: ${file}`);
    const sql = readFileSync(path, "utf8");
    const version = file.split("_")[0];
    const { rows } = await client.query(
      "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1",
      [version],
    );
    if (rows.length) {
      console.log(`  skip ${file} (already in schema_migrations)`);
      continue;
    }
    console.log(`  applying ${file}...`);
    await client.query(sql);
    await client.query(
      "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
      [version],
    );
    applied.push(file);
  }
  return applied;
}

function deployFunctions() {
  const results = [];
  for (const fn of FUNCTIONS) {
    console.log(`  deploying ${fn}...`);
    const r = run("npx", [
      "supabase", "functions", "deploy", fn,
      "--project-ref", PROJECT_REF,
    ], { input: "y\n" });
    results.push({
      fn,
      ok: r.status === 0,
      tail: (r.stdout || r.stderr || "").split("\n").slice(-3).join(" ").trim(),
    });
  }
  return results;
}

function setSecrets() {
  console.log("  setting SALE_CHANNEL_SYNC_ENABLED=false...");
  const r = run("npx", [
    "supabase", "secrets", "set",
    "SALE_CHANNEL_SYNC_ENABLED=false",
    "--project-ref", PROJECT_REF,
  ]);
  return r.status === 0;
}

async function workerPreview(env) {
  const url = `${env.SUPABASE_URL}/functions/v1/process-sale-channel-sync-queue`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (env.CRON_SECRET) headers["x-cron-secret"] = env.CRON_SECRET;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ limit: 5, preview: true, workerId: "deploy-phase061-staging" }),
  });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  return { status: resp.status, body };
}

async function pilotCheck(sb, variantId) {
  const { data: variant } = await sb
    .from("product_variants")
    .select("id, product_id, stock, products(code, name)")
    .eq("id", variantId)
    .maybeSingle();

  const { data: candidate } = await sb
    .from("v_inventory_channel_sync_candidates")
    .select(
      "variant_id, internal_sku, available_qty, amazon_seller_sku, amazon_current_qty, ebay_sku, ebay_current_qty, ebay_item_group_key, product_id",
    )
    .eq("variant_id", variantId)
    .maybeSingle();

  const { data: queueRows } = await sb
    .from("inventory_sale_sync_queue")
    .select("id, status, push_idempotency_key, available_qty, source_channel, created_at")
    .eq("variant_id", variantId)
    .order("created_at", { ascending: false })
    .limit(5);

  return { variant, candidate, queueRows: queueRows || [] };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const env = { ...process.env, ...loadEnv() };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  console.log("\n=== Phase 061 Staging Deploy ===\n");

  const dbPassword = env.SUPABASE_DB_PASSWORD || env.PGPASSWORD;
  const client = new pg.Client({
    connectionString:
      env.SUPABASE_DB_URL ||
      getPoolerConnectionString({ password: dbPassword, projectRef: PROJECT_REF }),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const before = await check061Schema(client);
    console.log("Schema before:", before);

    if (!args.has("--skip-migrations")) {
      console.log("\n--- Migrations ---");
      const applied = await applyMigrations(client);
      console.log(`Applied: ${applied.length ? applied.join(", ") : "(none — already present)"}`);
    }

    const after = await check061Schema(client);
    console.log("Schema after:", after);
    const allOk = Object.values(after).every(Boolean);
    if (!allOk) {
      console.error("FAIL: 061 schema incomplete after migrations");
      process.exit(1);
    }
  } finally {
    await client.end();
  }

  if (!args.has("--migrations-only")) {
    console.log("\n--- Function deploy ---");
    const deployResults = deployFunctions();
    for (const r of deployResults) {
      console.log(`  ${r.ok ? "✓" : "✗"} ${r.fn}${r.tail ? ` — ${r.tail.slice(0, 80)}` : ""}`);
    }
    if (deployResults.some((r) => !r.ok)) {
      console.error("FAIL: one or more function deploys failed");
      process.exit(1);
    }

    console.log("\n--- Secrets ---");
    if (!setSecrets()) {
      console.warn("WARN: secrets set may have failed — verify in Supabase dashboard");
    } else {
      console.log("  ✓ SALE_CHANNEL_SYNC_ENABLED=false");
    }
  }

  if (args.has("--worker-preview") || !args.has("--migrations-only")) {
    console.log("\n--- Worker preview (dry_run) ---");
    const preview = await workerPreview(env);
    console.log(`  HTTP ${preview.status}`, JSON.stringify(preview.body).slice(0, 400));
    if (preview.status >= 400) {
      console.warn("WARN: worker preview returned error — check CRON_SECRET or admin auth");
    }
  }

  if (args.has("--pilot-check") || !args.has("--migrations-only")) {
    console.log("\n--- Pilot SKU check (KK-0001 Black) ---");
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const variantId = env.PILOT_VARIANT_ID || DEFAULT_PILOT_VARIANT;
    const pilot = await pilotCheck(sb, variantId);
    console.log("  variant:", pilot.variant ? `${pilot.variant.products?.code} / ${pilot.variant.id}` : "NOT FOUND");
    console.log("  candidate:", pilot.candidate || "no row in v_inventory_channel_sync_candidates");
    console.log("  recent queue:", pilot.queueRows.length, "rows");
  }

  console.log("\nPASS — Phase 061 staging deploy steps completed\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

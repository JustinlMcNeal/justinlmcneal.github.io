#!/usr/bin/env node
/**
 * Drain inventory_sale_sync_queue via process-sale-channel-sync-queue.
 *
 * Preview (safe):  node scripts/supabase/drain-sale-channel-sync-queue.mjs
 * Live push:       node scripts/supabase/drain-sale-channel-sync-queue.mjs --live
 * Reset dry_run → pending before live:
 *                  node scripts/supabase/drain-sale-channel-sync-queue.mjs --reset-dry-run --live
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnv() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(join(ROOT, name), "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i > 0) env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
      }
    } catch {
      // optional
    }
  }
  return { ...process.env, ...env };
}

async function invokeWorker(env, { preview, limit, workerId }) {
  const url = `${env.SUPABASE_URL}/functions/v1/process-sale-channel-sync-queue`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (env.CRON_SECRET) headers["x-cron-secret"] = env.CRON_SECRET;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ limit, preview, workerId }),
  });
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 800) };
  }
  return { status: resp.status, body };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const live = args.has("--live");
  const resetDryRun = args.has("--reset-dry-run");
  const env = loadEnv();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: before } = await sb
    .from("inventory_sale_sync_queue")
    .select("id, status")
    .order("created_at", { ascending: false })
    .limit(50);

  const counts = {};
  for (const row of before || []) counts[row.status] = (counts[row.status] || 0) + 1;
  console.log("Queue before:", counts);

  if (resetDryRun) {
    const { data: resetRows, error } = await sb
      .from("inventory_sale_sync_queue")
      .update({
        status: "pending",
        last_result: null,
        last_error: null,
        locked_at: null,
        locked_by: null,
        available_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("status", "dry_run")
      .select("id");
    if (error) throw error;
    console.log(`Reset dry_run → pending: ${(resetRows || []).length}`);
  }

  const preview = !live;
  console.log(`\nInvoking worker preview=${preview} limit=20 …`);
  const result = await invokeWorker(env, {
    preview,
    limit: 20,
    workerId: live ? "drain-sale-sync-live" : "drain-sale-sync-preview",
  });

  console.log("HTTP", result.status);
  console.log(JSON.stringify(result.body, null, 2));

  const { data: after } = await sb
    .from("inventory_sale_sync_queue")
    .select("id, status, source_channel, available_qty, external_order_id, last_error, updated_at")
    .order("updated_at", { ascending: false })
    .limit(20);

  const afterCounts = {};
  for (const row of after || []) afterCounts[row.status] = (afterCounts[row.status] || 0) + 1;
  console.log("\nQueue sample after:", afterCounts);
  console.log(
    JSON.stringify(
      (after || []).map((r) => ({
        status: r.status,
        source: r.source_channel,
        qty: r.available_qty,
        order: r.external_order_id,
        err: r.last_error,
        updated: r.updated_at,
      })),
      null,
      2,
    ),
  );

  if (result.status !== 200 || result.body?.ok === false) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

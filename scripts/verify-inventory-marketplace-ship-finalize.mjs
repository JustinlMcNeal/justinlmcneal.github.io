#!/usr/bin/env node
/**
 * Verify marketplace ship finalize RPC behavior (structural + live smoke).
 *
 * Run: node scripts/verify-inventory-marketplace-ship-finalize.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    // optional
  }
  return { ...env, ...process.env };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function mainStructural() {
  const migration = readFileSync(
    join(ROOT, "supabase/migrations/20261111_inventory_marketplace_ship_finalize.sql"),
    "utf8",
  );
  assert(!/Non-KK order session/.test(migration), "migration must not skip marketplace sessions");
  assert(/v_channel := 'ebay'/.test(migration), "migration must resolve ebay channel");
  assert(/v_channel := 'amazon'/.test(migration), "migration must resolve amazon channel");
  assert(/GREATEST\(0,/.test(migration), "migration must clamp stock at zero");
  assert(/finalize:%s:%s:%s:%s/.test(migration), "migration must use channel-aware idempotency");

  const helper = readFileSync(
    join(ROOT, "supabase/functions/_shared/finalizeKkReservations.ts"),
    "utf8",
  );
  assert(
    !/if \(!isKkStoreSession\(orderId\)\) return null/.test(helper),
    "edge helper must call RPC for marketplace sessions",
  );

  const adminApi = readFileSync(join(ROOT, "js/admin/lineItemsOrders/api.js"), "utf8");
  assert(
    !/startsWith\("ebay"\)[\s\S]{0,80}return null/.test(adminApi),
    "admin finalize must not skip ebay/amazon",
  );

  assert(
    existsSync(join(ROOT, "scripts/backfill-marketplace-ship-finalize.mjs")),
    "backfill script missing",
  );

  console.log("OK structural checks");
}

async function mainLive() {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("SKIP live: missing service role env");
    return;
  }
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Idempotent smoke: finalize a fake missing order — should not throw, missing_reservations=1
  const { data, error } = await sb.rpc("finalize_kk_order_reservations", {
    p_order_id: "ebay_api_verify_nonexistent_order",
    p_reference_id: "verify",
    p_source: "marketplace_ship_finalize_verify",
  });
  assert(!error, `RPC error: ${error?.message}`);
  assert(data?.channel === "ebay", `expected channel ebay, got ${data?.channel}`);
  assert(
    Number(data?.finalized_count ?? -1) === 0,
    `expected 0 finalized for missing order, got ${data?.finalized_count}`,
  );

  const { data: kkData, error: kkErr } = await sb.rpc("finalize_kk_order_reservations", {
    p_order_id: "cs_test_verify_nonexistent_kk",
    p_reference_id: "verify",
    p_source: "marketplace_ship_finalize_verify",
  });
  assert(!kkErr, `KK RPC error: ${kkErr?.message}`);
  assert(kkData?.channel === "kk", `expected channel kk, got ${kkData?.channel}`);

  console.log("OK live RPC smoke", { ebay: data, kk: kkData });
}

async function main() {
  mainStructural();
  await mainLive();
  console.log("PASS verify-inventory-marketplace-ship-finalize");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});

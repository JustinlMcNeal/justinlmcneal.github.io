#!/usr/bin/env node
/**
 * Backfill marketplace reservation finalize for shipped/delivered orders.
 *
 * Finds ebay/amazon inventory_reservations still status=reserved where
 * fulfillment_shipments is shipped/delivered (or delivered_at set), then
 * calls finalize_kk_order_reservations per order session.
 *
 * Run:
 *   node scripts/backfill-marketplace-ship-finalize.mjs --dry-run
 *   node scripts/backfill-marketplace-ship-finalize.mjs --apply
 *   node scripts/backfill-marketplace-ship-finalize.mjs --apply --order ebay_api_17-14946-82010
 */
import { readFileSync } from "fs";
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

function parseArgs(argv) {
  const opts = { dryRun: true, apply: false, orderId: null, limit: 500 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      opts.dryRun = true;
      opts.apply = false;
    } else if (a === "--apply") {
      opts.apply = true;
      opts.dryRun = false;
    } else if (a === "--order" && argv[i + 1]) opts.orderId = argv[++i];
    else if (a === "--limit" && argv[i + 1]) opts.limit = Number(argv[++i]) || 500;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/backfill-marketplace-ship-finalize.mjs [--dry-run|--apply] [--order SESSION_ID] [--limit N]`);
      process.exit(0);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);
  const env = loadEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const sb = createClient(url, key, { auth: { persistSession: false } });

  let q = sb
    .from("inventory_reservations")
    .select(
      "id, order_id, order_item_id, channel, variant_id, quantity, status, created_at",
    )
    .eq("status", "reserved")
    .in("channel", ["ebay", "amazon"])
    .eq("is_shadow", false)
    .order("created_at", { ascending: true })
    .limit(opts.limit);

  if (opts.orderId) q = q.eq("order_id", opts.orderId);

  const { data: reservations, error: resErr } = await q;
  if (resErr) throw resErr;

  const orderIds = [...new Set((reservations || []).map((r) => r.order_id).filter(Boolean))];
  if (!orderIds.length) {
    console.log("No reserved marketplace holds found.");
    return;
  }

  const { data: shipments, error: shipErr } = await sb
    .from("fulfillment_shipments")
    .select("stripe_checkout_session_id, label_status, delivered_at, tracking_number")
    .in("stripe_checkout_session_id", orderIds);
  if (shipErr) throw shipErr;

  const shipBySession = new Map(
    (shipments || []).map((s) => [s.stripe_checkout_session_id, s]),
  );

  const eligibleByOrder = new Map();
  const skipped = [];
  const wouldGoNegative = [];

  for (const r of reservations || []) {
    const ship = shipBySession.get(r.order_id);
    const status = ship?.label_status || "pending";
    const delivered = !!ship?.delivered_at;
    const shipped =
      status === "shipped" || status === "delivered" || delivered;

    if (!shipped) {
      skipped.push({
        order_id: r.order_id,
        reason: `fulfillment=${status}`,
        quantity: r.quantity,
      });
      continue;
    }

    if (!eligibleByOrder.has(r.order_id)) {
      eligibleByOrder.set(r.order_id, {
        order_id: r.order_id,
        channel: r.channel,
        tracking: ship?.tracking_number || r.order_id,
        label_status: status,
        lines: [],
        units: 0,
      });
    }
    const bucket = eligibleByOrder.get(r.order_id);
    bucket.lines.push(r);
    bucket.units += Number(r.quantity) || 0;
  }

  // Preview stock impact per variant
  const variantQty = new Map();
  for (const bucket of eligibleByOrder.values()) {
    for (const line of bucket.lines) {
      if (!line.variant_id) continue;
      variantQty.set(
        line.variant_id,
        (variantQty.get(line.variant_id) || 0) + (Number(line.quantity) || 0),
      );
    }
  }

  if (variantQty.size) {
    const { data: variants, error: vErr } = await sb
      .from("product_variants")
      .select("id, stock")
      .in("id", [...variantQty.keys()]);
    if (vErr) throw vErr;
    for (const v of variants || []) {
      const deduct = variantQty.get(v.id) || 0;
      const after = Number(v.stock ?? 0) - deduct;
      if (after < 0) {
        wouldGoNegative.push({
          variant_id: v.id,
          stock_before: v.stock,
          deduct,
          stock_after: after,
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: opts.dryRun ? "dry-run" : "apply",
        reserved_rows_scanned: (reservations || []).length,
        eligible_orders: eligibleByOrder.size,
        eligible_units: [...eligibleByOrder.values()].reduce((a, b) => a + b.units, 0),
        skipped_not_shipped: skipped.length,
        would_go_negative: wouldGoNegative,
        sample_eligible: [...eligibleByOrder.values()].slice(0, 10).map((b) => ({
          order_id: b.order_id,
          channel: b.channel,
          label_status: b.label_status,
          units: b.units,
          lines: b.lines.length,
        })),
      },
      null,
      2,
    ),
  );

  if (opts.dryRun) {
    console.log("Dry-run only. Re-run with --apply to finalize.");
    return;
  }

  if (wouldGoNegative.length) {
    console.warn(
      "WARNING: some variants would go negative. Proceeding anyway (intended correction if stock was never deducted).",
    );
  }

  let ok = 0;
  let failed = 0;
  let units = 0;
  const failures = [];

  for (const bucket of eligibleByOrder.values()) {
    const { data, error } = await sb.rpc("finalize_kk_order_reservations", {
      p_order_id: bucket.order_id,
      p_reference_id: bucket.tracking,
      p_source: "marketplace_ship_finalize_backfill",
    });
    if (error) {
      failed += 1;
      failures.push({ order_id: bucket.order_id, error: error.message });
      console.error("FAIL", bucket.order_id, error.message);
      continue;
    }
    ok += 1;
    units += Number(data?.finalized_units ?? 0);
    console.log(
      "OK",
      bucket.order_id,
      `finalized_units=${data?.finalized_units ?? 0}`,
      `skipped=${data?.skipped_already_finalized ?? 0}`,
    );
  }

  console.log(
    JSON.stringify(
      { applied_orders: ok, failed_orders: failed, finalized_units: units, failures },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

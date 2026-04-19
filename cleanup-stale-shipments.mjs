#!/usr/bin/env node
/**
 * One-time cleanup: check stale "shipped" orders and mark as delivered.
 *
 * Strategy:
 *   - Orders shipped > 30 days ago with no delivery scan → mark delivered
 *     (domestic USPS/UPS packages are delivered within 1-5 business days;
 *      30+ days = definitely arrived or returned, and no complaints = delivered)
 *
 * Usage: node cleanup-stale-shipments.mjs [--dry-run]
 */

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yxdzvzscufkvewecvagq.supabase.co";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTczNDk0MCwiZXhwIjoyMDgxMzEwOTQwfQ.a3efcbSIIY9u0iIiKteahNQC_d5K6fbKYyk7Oh8LbSw";

const THRESHOLD_DAYS = 30; // orders shipped > 30 days ago are assumed delivered

async function supaFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=minimal",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${res.status}: ${txt}`);
  }
  if (opts.prefer?.includes("return=representation") || !opts.method || opts.method === "GET") {
    return res.json();
  }
  return null;
}

async function main() {
  console.log(`\n🔍 Stale Shipment Cleanup${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`   Threshold: shipped > ${THRESHOLD_DAYS} days ago → mark as delivered\n`);

  // 1. Fetch all "shipped" orders with tracking numbers
  const stale = await supaFetch(
    "/fulfillment_shipments?label_status=eq.shipped&tracking_number=not.is.null&select=stripe_checkout_session_id,kk_order_id,tracking_number,carrier,shipped_at",
  );

  console.log(`Found ${stale.length} orders with "shipped" status\n`);

  let updated = 0;
  let skipped = 0;

  const now = Date.now();

  for (const row of stale) {
    const { kk_order_id, tracking_number, carrier, shipped_at } = row;
    const shippedDate = new Date(shipped_at);
    const daysAgo = Math.floor((now - shippedDate.getTime()) / 86400000);

    process.stdout.write(`  ${kk_order_id} (${carrier} ${tracking_number.slice(0, 12)}…) shipped ${daysAgo}d ago … `);

    if (daysAgo < THRESHOLD_DAYS) {
      console.log(`⏳ too recent — skipped`);
      skipped++;
      continue;
    }

    // Estimate delivered_at as shipped_at + 5 business days (reasonable for domestic USPS/UPS)
    const estimatedDelivery = new Date(shippedDate.getTime() + 5 * 86400000).toISOString();

    if (DRY_RUN) {
      console.log(`✅ would mark delivered (est. ${estimatedDelivery.slice(0, 10)})`);
    } else {
      await supaFetch(
        `/fulfillment_shipments?stripe_checkout_session_id=eq.${encodeURIComponent(row.stripe_checkout_session_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            label_status: "delivered",
            delivered_at: estimatedDelivery,
            last_tracking_sync_at: new Date().toISOString(),
          }),
        },
      );
      console.log(`✅ marked delivered (est. ${estimatedDelivery.slice(0, 10)})`);
    }
    updated++;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

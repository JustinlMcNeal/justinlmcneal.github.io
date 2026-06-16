#!/usr/bin/env node
/**
 * Backfill marketplace_refund_observations from local order/finance/fulfillment data.
 * Run: node scripts/backfill-marketplace-refund-observations.mjs [--channel ebay|amazon|all] [--since YYYY-MM-DD] [--limit N] [--dry-run] [--order ORDER_ID]
 */
import { connectPgClient } from "./supabase/dbConnect.mjs";

function parseArgs(argv) {
  const opts = {
    channel: "all",
    since: null,
    limit: null,
    dryRun: false,
    orderId: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--channel" && argv[i + 1]) opts.channel = argv[++i];
    else if (a === "--since" && argv[i + 1]) opts.since = argv[++i];
    else if (a === "--limit" && argv[i + 1]) opts.limit = Number(argv[++i]);
    else if (a === "--order" && argv[i + 1]) opts.orderId = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/backfill-marketplace-refund-observations.mjs [options]

Options:
  --channel ebay|amazon|all   Channel filter (default: all)
  --since YYYY-MM-DD          Only observations on/after date
  --limit N                   Max rows per source batch (default: 100000)
  --order ORDER_ID            Single order session id
  --dry-run                   Count eligible sources without writing
  --help                      Show this help
`);
      process.exit(0);
    }
  }
  if (!["all", "ebay", "amazon"].includes(opts.channel)) {
    throw new Error(`Invalid --channel ${opts.channel}`);
  }
  return opts;
}

async function countEligible(client, opts) {
  const counts = {};
  const since = opts.since ? `${opts.since}T00:00:00Z` : null;

  if (opts.channel === "all" || opts.channel === "amazon") {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM amazon_finance_transactions aft
       WHERE aft.stripe_checkout_session_id LIKE 'amazon_%'
         AND (aft.transaction_type ILIKE '%refund%' OR aft.transaction_type ILIKE '%return%' OR aft.transaction_type ILIKE '%chargeback%')
         AND ($1::timestamptz IS NULL OR COALESCE(aft.transaction_date, aft.synced_at, aft.created_at) >= $1)
         AND ($2::text IS NULL OR aft.stripe_checkout_session_id = $2)`,
      [since, opts.orderId],
    );
    counts.amazon_finance = rows[0]?.c ?? 0;
  }

  if (opts.channel === "all" || opts.channel === "ebay") {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM ebay_finance_transactions eft
       WHERE eft.stripe_checkout_session_id LIKE 'ebay%'
         AND UPPER(COALESCE(eft.transaction_type, '')) IN ('REFUND', 'CREDIT', 'REVERSAL')
         AND ($1::timestamptz IS NULL OR COALESCE(eft.transaction_date, eft.synced_at, eft.created_at) >= $1)
         AND ($2::text IS NULL OR eft.stripe_checkout_session_id = $2)`,
      [since, opts.orderId],
    );
    counts.ebay_finance = rows[0]?.c ?? 0;
  }

  const { rows: orderRows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM orders_raw o
     WHERE COALESCE(o.refund_status, '') NOT IN ('', 'none')
       AND (o.stripe_checkout_session_id LIKE 'ebay%' OR o.stripe_checkout_session_id LIKE 'amazon_%')
       AND ($1::timestamptz IS NULL OR COALESCE(o.refunded_at, o.updated_at, o.order_date) >= $1)
       AND ($2::text IS NULL OR o.stripe_checkout_session_id = $2)`,
    [since, opts.orderId],
  );
  counts.orders_raw = orderRows[0]?.c ?? 0;

  return counts;
}

async function main() {
  const opts = parseArgs(process.argv);
  console.log("Marketplace refund observation backfill");
  console.log("Options:", opts);

  const client = await connectPgClient();
  try {
    const table = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'marketplace_refund_observations'
    `);
    if (!table.rows.length) {
      console.error("Table marketplace_refund_observations missing — apply Phase 10N migrations first.");
      process.exit(1);
    }

    if (opts.dryRun) {
      const counts = await countEligible(client, opts);
      console.log("\nDry-run — eligible source rows (approx):");
      for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
      console.log("\nNo rows written.");
      return;
    }

    const { rows } = await client.query(
      `SELECT public.backfill_marketplace_refund_observations($1, $2::timestamptz, $3, $4) AS result`,
      [
        opts.channel,
        opts.since ? `${opts.since}T00:00:00Z` : null,
        opts.limit,
        opts.orderId,
      ],
    );

    const result = rows[0]?.result ?? {};
    console.log("\nBackfill complete:");
    console.log(`  inserted: ${result.inserted ?? 0}`);
    console.log(`  updated:  ${result.updated ?? 0}`);
    console.log(`  skipped:  ${result.skipped ?? 0}`);
    console.log(`  channel:  ${result.channel ?? opts.channel}`);
    if (result.confidence_counts) {
      console.log("\nConfidence counts:");
      for (const [k, v] of Object.entries(result.confidence_counts)) {
        console.log(`  ${k}: ${v}`);
      }
    }
    if (result.amazon_canceled_retained != null) {
      console.log(`  amazon_canceled_retained: ${result.amazon_canceled_retained}`);
    }
    if (result.ebay_canceled_updated != null) {
      console.log(`  ebay_canceled_updated: ${result.ebay_canceled_updated}`);
    }
    if (result.total_observations != null) {
      console.log(`\nTotal persisted observations: ${result.total_observations}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

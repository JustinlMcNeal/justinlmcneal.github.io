#!/usr/bin/env node
/**
 * Phase 7A — read-only channel sync dry-run preview.
 *
 * Run:
 *   node scripts/preview-inventory-channel-sync.mjs
 *   node scripts/preview-inventory-channel-sync.mjs --channel amazon
 *   node scripts/preview-inventory-channel-sync.mjs --limit 10 --variant <uuid>
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

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
  return env;
}

function parseArgs(argv) {
  const out = { channel: "all", limit: 15, sku: null, variant: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--channel" && argv[i + 1]) out.channel = argv[++i].toLowerCase();
    else if (a === "--limit" && argv[i + 1]) out.limit = Math.max(1, parseInt(argv[++i], 10) || 15);
    else if (a === "--sku" && argv[i + 1]) out.sku = argv[++i];
    else if (a === "--variant" && argv[i + 1]) out.variant = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/preview-inventory-channel-sync.mjs [options]

Options:
  --channel kk|amazon|ebay|all   Filter summary (default all)
  --limit N                      Sample rows per channel (default 15)
  --sku TEXT                     Filter by internal_sku ilike
  --variant UUID                 Filter by variant_id
`);
      process.exit(0);
    }
  }
  return out;
}

function sampleRows(rows, limit) {
  return rows.slice(0, limit);
}

async function main() {
  const args = parseArgs(process.argv);
  const fileEnv = loadEnv();
  for (const [k, v] of Object.entries(fileEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  const notes = [];
  const warnings = [];

  try {
    await client.connect();

    const stockBefore = (
      await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants WHERE COALESCE(is_active,true)`)
    ).rows[0].t;
    const resBefore = (
      await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations WHERE status='reserved'`)
    ).rows[0].c;

    let where = "WHERE 1=1";
    const params = [];
    if (args.sku) {
      params.push(`%${args.sku}%`);
      where += ` AND internal_sku ILIKE $${params.length}`;
    }
    if (args.variant) {
      params.push(args.variant);
      where += ` AND variant_id = $${params.length}::uuid`;
    }

    const { rows } = await client.query(
      `SELECT * FROM v_inventory_channel_sync_candidates ${where} ORDER BY product_label, internal_sku`,
      params,
    );

    const total = rows.length;

    const kk = {
      align: rows.filter((r) => r.kk_sync_action === "align_to_available"),
      no_change: rows.filter((r) => r.kk_sync_action === "no_change"),
      negative: rows.filter((r) => r.kk_sync_action === "negative_available"),
    };

    const amazon = {
      update: rows.filter((r) => r.amazon_sync_action === "update_qty"),
      inactive: rows.filter((r) => r.amazon_sync_action === "inactive_can_update"),
      afn_skip: rows.filter((r) => r.amazon_sync_action === "afn_skip"),
      missing: rows.filter((r) => r.amazon_sync_action === "missing_mapping"),
      no_change: rows.filter((r) => r.amazon_sync_action === "no_change"),
    };

    const ebay = {
      update: rows.filter((r) => r.ebay_sync_action === "update_qty"),
      ended: rows.filter((r) => r.ebay_sync_action === "ended_needs_relist"),
      qty_cache_missing: rows.filter((r) => r.ebay_sync_action === "qty_cache_missing"),
      qty_unknown: rows.filter((r) => r.ebay_sync_action === "qty_cache_missing"),
      missing: rows.filter((r) => r.ebay_sync_action === "missing_mapping"),
      no_listing: rows.filter((r) => r.ebay_sync_action === "no_active_listing"),
      no_change: rows.filter((r) => r.ebay_sync_action === "no_change"),
    };

    const zeroPush = rows.filter((r) => r.available_qty === 0 && (
      r.amazon_sync_action === "update_qty" ||
      r.ebay_sync_action === "update_qty" ||
      r.kk_sync_action === "align_to_available"
    ));

    notes.push(`Total active variants considered: ${total}`);
    notes.push(`KK align_to_available (storefront uses on_hand): ${kk.align.length}`);
    notes.push(`KK no_change: ${kk.no_change.length}`);
    notes.push(`KK negative_available warnings: ${kk.negative.length}`);
    notes.push(`Amazon update_qty candidates (FBM): ${amazon.update.length}`);
    notes.push(`Amazon inactive_can_update: ${amazon.inactive.length}`);
    notes.push(`Amazon AFN/FBA skipped: ${amazon.afn_skip.length}`);
    notes.push(`Amazon missing_mapping: ${amazon.missing.length}`);
    notes.push(`eBay ended_needs_relist: ${ebay.ended.length}`);
    notes.push(`eBay qty_unknown (no cache): ${ebay.qty_unknown.length}`);
    notes.push(`eBay missing_mapping: ${ebay.missing.length}`);
    notes.push(`Zero-qty push candidates: ${zeroPush.length}`);

    if (ebay.qty_unknown.length > 0) {
      warnings.push("eBay current quantity is not cached in DB — Phase 7D needs qty read/cache before push");
    }

    const stockAfter = (
      await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants WHERE COALESCE(is_active,true)`)
    ).rows[0].t;
    const resAfter = (
      await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations WHERE status='reserved'`)
    ).rows[0].c;

    if (String(stockBefore) !== String(stockAfter) || resBefore !== resAfter) {
      warnings.push("Unexpected stock/reservation change during read-only script");
    } else {
      notes.push("Read-only confirmed: no stock/reservation mutations");
    }

    console.log("\n=== Channel sync dry-run preview (read-only) ===\n");
    for (const n of notes) console.log(`  ${n}`);

    const show = (label, list, pick) => {
      if (args.channel !== "all" && args.channel !== label) return;
      if (!list.length) return;
      console.log(`\n--- Sample ${label} (${Math.min(list.length, args.limit)} of ${list.length}) ---`);
      console.log(JSON.stringify(sampleRows(list.map(pick), args.limit), null, 2));
    };

    show("kk", kk.align, (r) => ({
      sku: r.internal_sku,
      product: r.product_label,
      available: r.available_qty,
      on_hand: r.on_hand_qty,
      reserved: r.reserved_qty,
      action: r.kk_sync_action,
    }));

    show("amazon", amazon.update, (r) => ({
      sku: r.internal_sku,
      product: r.product_label,
      available: r.available_qty,
      amazon_qty: r.amazon_current_qty,
      action: r.amazon_sync_action,
      status: r.amazon_listing_status,
    }));

    show("ebay", [...ebay.ended, ...ebay.qty_unknown], (r) => ({
      sku: r.internal_sku,
      product: r.product_label,
      available: r.available_qty,
      action: r.ebay_sync_action,
      status: r.ebay_listing_status,
    }));

    if (warnings.length) {
      console.log("\nWARNINGS:");
      for (const w of warnings) console.warn(`  ⚠ ${w}`);
    }
    console.log("\nDONE (no writes)\n");
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();

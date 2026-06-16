#!/usr/bin/env node
/**
 * Read-only Stripe webhook environment diagnostic.
 *
 * Run:
 *   node scripts/verify-stripe-webhook-environment-readiness.mjs
 *   node scripts/verify-stripe-webhook-environment-readiness.mjs --since 2026-06-09T00:00:00Z
 *   node scripts/verify-stripe-webhook-environment-readiness.mjs --session cs_live_...
 *   node scripts/verify-stripe-webhook-environment-readiness.mjs --order KKO-123456
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { PROJECT_REF, getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const EXPECTED_WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook`;
const EXPECTED_SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const OTHER_PROJECT_REF = "worvqswzdixjgwtjqtub"; // KKNumbers — not linked

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
  const out = { since: null, session: null, order: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since" && argv[i + 1]) {
      out.since = argv[++i];
    } else if (a === "--session" && argv[i + 1]) {
      out.session = argv[++i];
    } else if (a === "--order" && argv[i + 1]) {
      out.order = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/verify-stripe-webhook-environment-readiness.mjs [options]

Options:
  --since ISO8601   Only report rows created at/after this timestamp
  --session cs_...  Look up specific Stripe checkout session id
  --order KKO-...   Look up specific kk_order_id
`);
      process.exit(0);
    }
  }
  return out;
}

function readFrontendSupabaseUrl() {
  const envPath = join(ROOT, "js/config/env.js");
  if (!existsSync(envPath)) return null;
  const text = readFileSync(envPath, "utf8");
  const m = text.match(/SUPABASE_URL\s*=\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

async function main() {
  const args = parseArgs(process.argv);
  const fileEnv = loadEnv();
  for (const [k, v] of Object.entries(fileEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const notes = [];
  const warnings = [];
  const errors = [];

  const frontendUrl = readFrontendSupabaseUrl();
  const envUrl = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || null;

  notes.push(`Linked project ref (dbConnect): ${PROJECT_REF}`);
  notes.push(`Expected webhook URL: ${EXPECTED_WEBHOOK_URL}`);
  notes.push(`Expected Supabase URL: ${EXPECTED_SUPABASE_URL}`);
  notes.push(`Frontend js/config/env.js SUPABASE_URL: ${frontendUrl ?? "not found"}`);

  if (frontendUrl && frontendUrl !== EXPECTED_SUPABASE_URL) {
    errors.push(`Frontend SUPABASE_URL mismatch: ${frontendUrl}`);
  } else if (frontendUrl) {
    notes.push("Frontend Supabase URL matches linked project ref");
  }

  if (envUrl && !envUrl.includes(PROJECT_REF)) {
    warnings.push(`.env SUPABASE_URL may not match linked project: ${envUrl}`);
  } else if (envUrl) {
    notes.push(`.env SUPABASE_URL contains linked ref`);
  }

  notes.push(`Other Supabase project in org (not linked): ${OTHER_PROJECT_REF} (KKNumbers)`);
  warnings.push(
    `If Stripe webhook endpoint uses ${OTHER_PROJECT_REF} instead of ${PROJECT_REF}, orders will not appear in validation DB`,
  );

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const settings = await client.query(`
      SELECT kk_reservation_mode, shadow_mode_started_at
      FROM inventory_cutover_settings WHERE id = 1
    `);
    if (settings.rows[0]) {
      notes.push(
        `inventory_cutover_settings: mode=${settings.rows[0].kk_reservation_mode}, shadow_started=${settings.rows[0].shadow_mode_started_at}`,
      );
    }

    const latestOrder = await client.query(`
      SELECT stripe_checkout_session_id, kk_order_id, order_date,
             CASE WHEN stripe_checkout_session_id LIKE 'cs_live_%' THEN 'live'
                  WHEN stripe_checkout_session_id LIKE 'cs_test_%' THEN 'test'
                  ELSE 'unknown' END AS stripe_session_mode
      FROM orders_raw
      WHERE stripe_checkout_session_id NOT LIKE 'ebay%'
        AND stripe_checkout_session_id NOT LIKE 'amazon%'
      ORDER BY order_date DESC NULLS LAST
      LIMIT 5
    `);
    notes.push(`Latest KK orders in linked DB: ${latestOrder.rows.length}`);
    for (const r of latestOrder.rows) {
      notes.push(`  ${r.order_date} | ${r.kk_order_id} | ${r.stripe_checkout_session_id} (${r.stripe_session_mode})`);
    }
    if (latestOrder.rows[0]?.stripe_session_mode === "live") {
      notes.push("Historical KK orders use Stripe LIVE mode (cs_live_*)");
    }

    const sinceClause = args.since ? `AND created_at >= $1::timestamptz` : "";
    const sinceParams = args.since ? [args.since] : [];

    const ledgerOrders = await client.query(
      `SELECT id, variant_id, change, reason, reference_id, created_at
       FROM stock_ledger
       WHERE reason = 'order' ${sinceClause}
       ORDER BY created_at DESC LIMIT 10`,
      sinceParams,
    );
    notes.push(`stock_ledger order rows${args.since ? ` since ${args.since}` : ""}: ${ledgerOrders.rows.length}`);
    for (const r of ledgerOrders.rows.slice(0, 5)) {
      notes.push(`  ${r.created_at} | ${r.reference_id} | change=${r.change}`);
    }

    const dedup = await client.query(
      `SELECT stripe_event_id, action_type, reference_id, created_at
       FROM inventory_event_dedup ${args.since ? "WHERE created_at >= $1::timestamptz" : ""}
       ORDER BY created_at DESC LIMIT 10`,
      sinceParams,
    );
    notes.push(`inventory_event_dedup rows${args.since ? ` since ${args.since}` : ""}: ${dedup.rows.length}`);
    if (dedup.rows.length === 0) {
      warnings.push("No inventory_event_dedup rows — Phase 6C checkout deduct guard never fired in linked DB");
    }

    const reservations = await client.query(
      `SELECT id, order_id, order_item_id, variant_id, quantity, status, is_shadow, idempotency_key, created_at
       FROM inventory_reservations ${args.since ? "WHERE created_at >= $1::timestamptz" : ""}
       ORDER BY created_at DESC LIMIT 10`,
      sinceParams,
    );
    notes.push(`inventory_reservations rows${args.since ? ` since ${args.since}` : ""}: ${reservations.rows.length}`);
    if (reservations.rows.length === 0) {
      warnings.push("No inventory_reservations rows — shadow flow never wrote to linked DB");
    }

    const readiness = await client.query(`SELECT post_6c_matched_lines, safe_to_proceed_hint, shadow_reservation_rows FROM v_inventory_cutover_readiness_summary`);
    const rd = readiness.rows[0];
    if (rd) {
      notes.push(`readiness: post_6c_matched=${rd.post_6c_matched_lines}, safe=${rd.safe_to_proceed_hint}, shadow_rows=${rd.shadow_reservation_rows}`);
    }

    if (args.session) {
      notes.push(`--- Lookup session: ${args.session} ---`);
      const o = await client.query(
        `SELECT stripe_checkout_session_id, kk_order_id, order_date, refund_status
         FROM orders_raw WHERE stripe_checkout_session_id = $1`,
        [args.session],
      );
      if (!o.rows.length) warnings.push(`orders_raw: session NOT FOUND: ${args.session}`);
      else notes.push(`orders_raw: FOUND ${JSON.stringify(o.rows[0])}`);

      const li = await client.query(
        `SELECT stripe_line_item_id, product_id, variant_id, quantity FROM line_items_raw WHERE stripe_checkout_session_id = $1`,
        [args.session],
      );
      notes.push(`line_items_raw: ${li.rows.length} row(s)`);

      const sl = await client.query(
        `SELECT id, change, reason, created_at FROM stock_ledger
         WHERE reference_id = $1 OR reference_id = (SELECT kk_order_id FROM orders_raw WHERE stripe_checkout_session_id = $1 LIMIT 1)
         ORDER BY created_at DESC`,
        [args.session],
      );
      notes.push(`stock_ledger for session: ${sl.rows.length} row(s)`);

      const ir = await client.query(
        `SELECT * FROM inventory_reservations WHERE order_id = $1`,
        [args.session],
      );
      notes.push(`inventory_reservations for session: ${ir.rows.length} row(s)`);

      const rc = await client.query(
        `SELECT is_match, mismatch_reason FROM v_inventory_shadow_reservation_reconciliation WHERE stripe_session_id = $1`,
        [args.session],
      );
      notes.push(`reconciliation rows: ${rc.rows.length}; matches=${rc.rows.filter((x) => x.is_match).length}`);
    }

    if (args.order) {
      notes.push(`--- Lookup order: ${args.order} ---`);
      const o = await client.query(
        `SELECT stripe_checkout_session_id, kk_order_id, order_date FROM orders_raw WHERE kk_order_id = $1`,
        [args.order],
      );
      if (!o.rows.length) warnings.push(`orders_raw: kk_order_id NOT FOUND: ${args.order}`);
      else notes.push(`orders_raw: FOUND session=${o.rows[0].stripe_checkout_session_id}`);
    }

    notes.push("Stripe Dashboard checklist: Developers → Events → search session/event id");
    notes.push(`Supabase function logs: Dashboard → Functions → stripe-webhook → Logs (${PROJECT_REF})`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await client.end().catch(() => {});
  }

  console.log("\n=== Stripe webhook environment diagnostic (read-only) ===\n");
  for (const n of notes) console.log(`  ${n}`);
  if (warnings.length) {
    console.log("\nWARNINGS:");
    for (const w of warnings) console.warn(`  ⚠ ${w}`);
  }
  if (errors.length) {
    console.error("\nERRORS:");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nDONE\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

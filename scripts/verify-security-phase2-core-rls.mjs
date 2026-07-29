#!/usr/bin/env node
/**
 * Phase 2 — verify core RLS on PII/order/webhook/ops tables.
 * Run: node scripts/verify-security-phase2-core-rls.mjs
 */
import {
  connectPg,
  selectAsAnon,
  anonClient,
  serviceClient,
  printReport,
} from "./security/securityVerifyUtils.mjs";

const CORE_TABLES = [
  "customers",
  "orders_raw",
  "fulfillment_shipments",
  "product_storage",
  "package_presets",
  "imported_product_images",
  "stripe_webhook_events",
  "shippo_webhook_events",
  "coupon_attempt_logs",
  "analytics_daily",
  "inventory_issue_snapshots",
];

const SERVICE_ONLY = ["stripe_webhook_events", "shippo_webhook_events"];

async function tableHasRls(client, table) {
  const { rows } = await client.query(
    `SELECT c.relrowsecurity AS rls
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind = 'r'`,
    [table]
  );
  return rows[0]?.rls === true;
}

async function anonCanSelect(table) {
  const res = await selectAsAnon(table, "id", 1);
  return !res.error;
}

async function serviceCanSelect(table) {
  const sb = serviceClient();
  const res = await sb.from(table).select("id").limit(1);
  return !res.error;
}

async function main() {
  const notes = [];
  const errors = [];
  let client;

  try {
    client = await connectPg();

    for (const table of CORE_TABLES) {
      const exists = (await client.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`])).rows[0]?.reg;
      if (!exists) {
        notes.push(`${table}: not present (skipped)`);
        continue;
      }

      if (!(await tableHasRls(client, table))) {
        errors.push(`${table}: RLS not enabled`);
        continue;
      }
      notes.push(`${table}: RLS enabled`);

      const anonOk = await anonCanSelect(table);
      if (anonOk) {
        errors.push(`${table}: anon SELECT should be denied`);
      } else {
        notes.push(`${table}: anon SELECT denied`);
      }

      if (SERVICE_ONLY.includes(table)) {
        const svcOk = await serviceCanSelect(table);
        if (!svcOk) errors.push(`${table}: service_role SELECT failed`);
        else notes.push(`${table}: service_role SELECT ok`);
      }
    }

    const customersJs = await import("fs").then((fs) =>
      fs.readFileSync(new URL("../js/admin/customers/index.js", import.meta.url), "utf8")
    );
    if (!customersJs.includes("requireAdmin")) {
      errors.push("js/admin/customers/index.js must use requireAdmin()");
    } else {
      notes.push("customers admin page uses requireAdmin()");
    }

    const apiJs = await import("fs").then((fs) =>
      fs.readFileSync(new URL("../js/admin/customers/api.js", import.meta.url), "utf8")
    );
    if (apiJs.includes("createClient(") && !apiJs.includes("getSupabaseClient")) {
      errors.push("js/admin/customers/api.js should use shared getSupabaseClient()");
    } else {
      notes.push("customers api uses shared Supabase client");
    }

    const ok = printReport("Security Phase 2 — Core RLS", notes, errors);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    if (client) await client.end();
  }
}

main();

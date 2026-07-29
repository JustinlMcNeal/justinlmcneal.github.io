#!/usr/bin/env node
/**
 * Phase 1 — verify anon cannot execute sensitive SECURITY DEFINER RPCs.
 * Run: node scripts/verify-security-phase1-rpc-lockdown.mjs
 */
import {
  connectPg,
  rpcAsAnon,
  querySecurityDefinerFunctions,
  printReport,
} from "./security/securityVerifyUtils.mjs";

const DANGEROUS_RPCS = [
  { fn: "amazon_get_lwa_refresh_token", args: { p_seller_account_id: "00000000-0000-0000-0000-000000000000" } },
  { fn: "amazon_store_lwa_refresh_token", args: { p_seller_account_id: "00000000-0000-0000-0000-000000000000", p_refresh_token: "x" } },
  { fn: "analytics_backfill", args: { p_start: "2026-01-01", p_end: "2026-01-02" } },
  { fn: "analytics_refresh_day", args: { p_day: "2026-01-01" } },
  { fn: "rpc_import_amazon_orders", args: { p_orders: [], p_items: [] } },
  { fn: "execute_kk_reservation_cutover", args: {} },
  { fn: "rollback_kk_reservation_cutover", args: {} },
  { fn: "reserve_inventory_for_marketplace_sale", args: {} },
  { fn: "release_marketplace_sale_reservation", args: {} },
  { fn: "claim_inventory_sale_sync_jobs", args: { p_limit: 1, p_worker_id: "verify-script" } },
  { fn: "enable_inventory_bundle_global_live_mode", args: {} },
  { fn: "enable_bundle_live_mode", args: { p_bundle_variant_id: "00000000-0000-0000-0000-000000000000", p_note: "verify" } },
  { fn: "apply_inventory_mapping_assist", args: {} },
  { fn: "apply_inventory_mapping_assist_batch", args: {} },
  { fn: "rpc_order_kpis", args: { p_start: null, p_end: null, p_channel: null, p_status: null } },
];

const ANON_ALLOWLIST = new Set([
  "get_product_stock",
  // Read-only; required by security-definer v_kk_variant_available_stock for anon storefront stock
  "is_bundle_live_deduction_enabled",
]);

async function main() {
  const notes = [];
  const errors = [];
  let client;

  try {
    client = await connectPg();

    const { rows: isAdminCfg } = await client.query(`
      SELECT prosecdef, proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'is_admin'
        AND pg_get_function_identity_arguments(p.oid) = ''
    `);

    if (!isAdminCfg.length) {
      errors.push("public.is_admin() not found");
    } else {
      if (!isAdminCfg[0].prosecdef) errors.push("is_admin() must be SECURITY DEFINER");
      const cfg = isAdminCfg[0].proconfig || [];
      if (!cfg.some((c) => String(c).startsWith("search_path="))) {
        errors.push("is_admin() missing SET search_path");
      } else {
        notes.push("is_admin() is SECURITY DEFINER with fixed search_path");
      }
    }

    const definerFns = await querySecurityDefinerFunctions(client);
    const anonCallable = definerFns.filter(
      (f) => f.anon_execute && !ANON_ALLOWLIST.has(f.function_name)
    );

    if (anonCallable.length) {
      for (const f of anonCallable.slice(0, 20)) {
        errors.push(`anon EXECUTE still granted: ${f.function_name}(${f.args})`);
      }
      if (anonCallable.length > 20) {
        errors.push(`... and ${anonCallable.length - 20} more anon-callable SECURITY DEFINER functions`);
      }
    } else {
      notes.push("No unexpected anon EXECUTE on SECURITY DEFINER functions");
    }

    for (const { fn, args } of DANGEROUS_RPCS) {
      const res = await rpcAsAnon(fn, args);
      const code = res.error?.code || "";
      const msg = res.error?.message || "";
      const permissionDenied =
        !!res.error &&
        (code === "42501" ||
          /permission denied|not authorized|must be admin|admin only|authentication required|could not find the function/i.test(msg));
      if (!permissionDenied) {
        errors.push(`anon rpc ${fn}: expected permission denial, got ${msg || "success"}`);
      } else {
        notes.push(`anon rpc ${fn} denied`);
      }
    }

    const ok = printReport("Security Phase 1 — RPC lockdown", notes, errors);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    if (client) await client.end();
  }
}

main();

#!/usr/bin/env node
/**
 * Phase 3 — verify security_invoker views and anon grant classification.
 * Run: node scripts/verify-security-phase3-views.mjs
 */
import {
  connectPg,
  selectAsAnon,
  queryPublicViewsSecurityInvoker,
  printReport,
} from "./security/securityVerifyUtils.mjs";

const DOCUMENTED_DEFINER_EXCEPTIONS = new Set([
  "v_kk_variant_available_stock",
  "v_inventory_bundle_summary_preview",
  "v_inventory_bundle_availability_preview",
  "v_inventory_bundle_like_variants",
]);

const SENSITIVE_VIEWS = [
  "v_customers_summary",
  "v_order_summary",
  "v_order_summary_plus",
  "v_order_financials",
  "v_ebay_order_profit",
  "v_amazon_order_profit",
  "v_inventory_workspace",
  "sms_v_flow_performance_dated",
];

const STOREFRONT_VIEWS = [
  "v_home_active_promo",
  "v_home_categories",
  "v_home_best_sellers",
  "v_categories_public",
  "v_products_with_tags",
  "v_kk_variant_available_stock",
];

async function main() {
  const notes = [];
  const errors = [];
  let client;

  try {
    client = await connectPg();

    const views = await queryPublicViewsSecurityInvoker(client);
    const nonInvoker = views.filter(
      (v) => !v.security_invoker && !DOCUMENTED_DEFINER_EXCEPTIONS.has(v.view_name)
    );

    if (nonInvoker.length) {
      for (const v of nonInvoker.slice(0, 15)) {
        errors.push(`view ${v.view_name} is not security_invoker`);
      }
      if (nonInvoker.length > 15) errors.push(`... ${nonInvoker.length - 15} more non-invoker views`);
    } else {
      notes.push("All public views are security_invoker (except documented exceptions)");
    }

    if (DOCUMENTED_DEFINER_EXCEPTIONS.has("v_kk_variant_available_stock")) {
      const stock = views.find((v) => v.view_name === "v_kk_variant_available_stock");
      if (stock && stock.security_invoker) {
        notes.push("v_kk_variant_available_stock is invoker (exception doc may be stale)");
      } else if (stock) {
        notes.push("v_kk_variant_available_stock documented security definer exception");
      }
    }

    for (const view of SENSITIVE_VIEWS) {
      const reg = (await client.query(`SELECT to_regclass($1) r`, [`public.${view}`])).rows[0]?.r;
      if (!reg) continue;
      const res = await selectAsAnon(view, "*", 1);
      if (!res.error) {
        errors.push(`anon can SELECT ${view}`);
      } else {
        notes.push(`anon denied on ${view}`);
      }
    }

    for (const view of STOREFRONT_VIEWS) {
      const reg = (await client.query(`SELECT to_regclass($1) r`, [`public.${view}`])).rows[0]?.r;
      if (!reg) continue;
      const res = await selectAsAnon(view, "*", 1);
      if (res.error) {
        errors.push(`storefront view ${view} blocked for anon: ${res.error.message}`);
      } else {
        notes.push(`storefront view ${view} readable by anon`);
      }
    }

    const ok = printReport("Security Phase 3 — Views", notes, errors);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    if (client) await client.end();
  }
}

main();

/**
 * api.js — eBay Listings admin API helpers.
 *
 * Keeps Edge Function calls and Supabase read helpers out of the page
 * orchestrator. This module intentionally does not own UI state or DOM updates.
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";

const supabase = getSupabaseClient();
const SUPABASE_URL = "https://yxdzvzscufkvewecvagq.supabase.co";

// ── Edge Function Helper ──────────────────────────────────────
export async function callEdge(fnName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated — please refresh the page");
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok && !resp.headers.get("content-type")?.includes("application/json")) {
    return { success: false, error: `HTTP ${resp.status} from ${fnName}` };
  }
  const data = await resp.json().catch(() => ({ success: false, error: `Non-JSON response from ${fnName} (HTTP ${resp.status})` }));
  if (!data?.success && fnName === "ebay-manage-listing") {
    const expectedMappingDiagnostic = ["GROUP_OFFER_MAPPING_UNRESOLVED", "GROUP_CHILD_OFFER_LOOKUP_FAILED", "RECONCILE_GROUP_CHILD_OFFERS_FAILED"].includes(data?.code)
      || data?.state === "offer_mapping_unresolved";
    const log = expectedMappingDiagnostic ? console.info : console.warn;
    log("[ebay-listing] edge action diagnostic", {
      action: body?.action,
      sku: body?.sku,
      offerId: body?.offerId,
      inventoryItemGroupKey: body?.inventoryItemGroupKey,
      code: data?.code,
      status: data?.status || data?.upstreamStatus || resp.status,
      message: data?.message || data?.error,
    });
  }
  return data;
}

// ── Product + Workspace Reads ─────────────────────────────────
export async function fetchProducts() {
  return supabase
    .from("products")
    .select("id, code, name, slug, price, weight_g, unit_cost, catalog_image_url, catalog_hover_url, primary_image_url, is_active, ebay_sku, ebay_offer_id, ebay_listing_id, ebay_status, ebay_category_id, ebay_price_cents, ebay_item_group_key, ebay_volume_promo_id, ebay_store_category, product_gallery_images(url, position, is_active), product_variants(id, option_name, option_value, stock, preview_image_url, sort_order, is_active)")
    .order("code");
}

// Fetches v_ebay_listing_workspace and merges workspace metrics onto product rows.
// If the view is unavailable, products load normally and metric badges show "—".
export async function mergeWorkspaceMetrics(products) {
  try {
    const { data: wsData, error: wsErr } = await supabase
      .from("v_ebay_listing_workspace")
      .select("product_code, sold_qty_30d, sold_qty_90d, last_sold_at, avg_sold_price_cents_90d, gallery_image_count, active_variant_count, active_variant_stock_total, issue_flags, issue_count");
    if (wsErr || !wsData) {
      console.warn("[workspace] metrics unavailable:", wsErr?.message);
      return products;
    }
    const map = Object.fromEntries(wsData.map(row => [row.product_code, row]));
    return products.map(p => ({ ...p, _ws: map[p.code] || null }));
  } catch (e) {
    console.warn("[workspace] metrics skipped:", e.message);
    return products;
  }
}

export async function fetchProductsWithWorkspaceMetrics() {
  const result = await fetchProducts();
  if (result.error) return result;
  return {
    ...result,
    data: await mergeWorkspaceMetrics(result.data || []),
  };
}

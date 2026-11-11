/** Supabase client for the Parcel Planner (next-parcel wishlist + restock suggestions). */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PLAN_SELECT =
  "id, title, product_id, variant_label, supplier_url, unit_price_cny, qty, unit_weight_g, seller_freight_cny, target_price_usd, status, notes, created_at, products(code, catalog_image_url, primary_image_url)";

/** @param {{ includeOrdered?: boolean }} [opts] */
export async function fetchPlanItems({ includeOrdered = false } = {}) {
  const statuses = includeOrdered ? ["planned", "ordered"] : ["planned"];
  const { data, error } = await supabase
    .from("parcel_plan_items")
    .select(PLAN_SELECT)
    .in("status", statuses)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message || "Load plan failed");
  return data || [];
}

/** @param {object} row */
export async function insertPlanItem(row) {
  const { data, error } = await supabase
    .from("parcel_plan_items")
    .insert(row)
    .select(PLAN_SELECT)
    .single();
  if (error) throw new Error(error.message || "Add item failed");
  return data;
}

/** @param {string} id @param {object} patch */
export async function updatePlanItem(id, patch) {
  const { error } = await supabase.from("parcel_plan_items").update(patch).eq("id", id);
  if (error) throw new Error(error.message || "Update failed");
}

/** @param {string} id */
export async function deletePlanItem(id) {
  const { error } = await supabase.from("parcel_plan_items").delete().eq("id", id);
  if (error) throw new Error(error.message || "Delete failed");
}

/** @param {string[]} ids */
export async function markPlanItemsOrdered(ids) {
  if (!ids.length) return;
  const { error } = await supabase
    .from("parcel_plan_items")
    .update({ status: "ordered" })
    .in("id", ids);
  if (error) throw new Error(error.message || "Mark ordered failed");
}

export async function fetchRestockSuggestions() {
  const { data, error } = await supabase.rpc("parcel_planner_restock_suggestions", {
    p_window_days: 90,
    p_cover_days: 60,
  });
  if (error) throw new Error(error.message || "Restock suggestions failed");
  return data || [];
}

/** Past parcels used to fit the shipping cost model. */
export async function fetchShippingHistory() {
  const { data, error } = await supabase
    .from("parcel_imports")
    .select(
      "parcel_id, imported_at, xls_parcel_weight_grams, actual_parcel_weight_grams, xls_charged_weight_grams, actual_charged_weight_grams, xls_shipment_fee_cny, actual_shipment_fee_cny, xls_service_fee_cny, actual_service_fee_cny, effective_fx_rate, xls_total_item_fee_cny",
    )
    .is("voided_at", null)
    .order("imported_at", { ascending: true });
  if (error) throw new Error(error.message || "Shipping history failed");
  return data || [];
}

/** @param {string} query */
export async function searchProductsForPlan(query) {
  const q = query.trim().replace(/[,()%*\\]/g, " ").trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, supplier_url, weight_g, price, ebay_price_cents")
    .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
    .order("code")
    .limit(8);
  if (error) throw new Error(error.message || "Product search failed");
  return data || [];
}

/**
 * Most recent Baestao line for a product (unit price + per-unit inbound weight).
 * @param {string} productId
 * @returns {Promise<{ unitPriceCny: number, unitWeightG: number|null } | null>}
 */
export async function fetchLastPurchase(productId) {
  const { data, error } = await supabase
    .from("parcel_import_item_mappings")
    .select("parcel_import_items(unit_price_cny, item_weight_grams, quantity, created_at)")
    .eq("product_id", productId)
    .limit(50);
  if (error) throw new Error(error.message || "Last purchase lookup failed");
  const rows = (data || [])
    .map((r) => r.parcel_import_items)
    .filter(Boolean)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const last = rows[0];
  if (!last) return null;
  const qty = Number(last.quantity) || 0;
  const weight = Number(last.item_weight_grams) || 0;
  return {
    unitPriceCny: Number(last.unit_price_cny) || 0,
    unitWeightG: qty > 0 && weight > 0 ? Math.round((weight / qty) * 10) / 10 : null,
  };
}

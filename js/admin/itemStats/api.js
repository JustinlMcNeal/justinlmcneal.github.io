// /js/admin/itemStats/api.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { getSupplierShippingDetails } from "/js/admin/pStorage/profitCalc.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Convert a range token into an ISO date string (or null for "all").
 */
function rangeToDate(range) {
  if (!range || range === "all") return null;
  const now = new Date();
  const map = {
    "7d":  7,
    "30d": 30,
    "90d": 90,
    "6m":  180,
    "1y":  365
  };
  const days = map[range] || 0;
  if (!days) return null;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

/**
 * Fetch line items + product data, aggregate client-side.
 *
 * We do this client-side because:
 *   1. No server-side view exists that aggregates by product
 *   2. We need the JS shipping formula for CPI calculation
 *   3. Dataset is small enough (< few thousand line items)
 */
export async function fetchItemStats({ range = "all" } = {}) {
  // 1. Fetch all line items (only columns we need)
  let liQuery = supabase
    .from("line_items_raw")
    .select("product_id,product_name,variant,quantity,unit_price_cents,post_discount_unit_price_cents,order_date,stripe_checkout_session_id,item_weight_g")
    .order("order_date", { ascending: false });

  const minDate = rangeToDate(range);
  if (minDate) {
    liQuery = liQuery.gte("order_date", minDate);
  }

  const { data: lineItems, error: liErr } = await liQuery;
  if (liErr) throw liErr;

  // 2. Fetch products (for cost, weight, image, active status)
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("code,name,unit_cost,weight_g,catalog_image_url,is_active,price");
  if (pErr) throw pErr;

  // Index products by code
  const prodMap = {};
  for (const p of (products || [])) {
    prodMap[p.code] = p;
  }

  // 3. Aggregate by product_id (= product code)
  const agg = {};

  for (const li of (lineItems || [])) {
    const code = li.product_id || "UNKNOWN";
    if (!agg[code]) {
      const prod = prodMap[code] || null;
      agg[code] = {
        product_code: code,
        product_name: li.product_name || prod?.name || code,
        image: prod?.catalog_image_url || null,
        is_active: prod?.is_active ?? null,
        unit_cost: prod?.unit_cost ?? null,
        weight_g: prod?.weight_g ?? li.item_weight_g ?? null,
        retail_price: prod?.price ?? null,
        units_sold: 0,
        order_count: 0,
        revenue_cents: 0,
        original_cents: 0,
        orders: new Set(),
        first_sale: null,
        last_sale: null
      };
    }

    const a = agg[code];
    const qty = li.quantity || 1;
    a.units_sold += qty;
    a.revenue_cents += (li.post_discount_unit_price_cents || 0) * qty;
    a.original_cents += (li.unit_price_cents || 0) * qty;

    if (li.stripe_checkout_session_id) {
      a.orders.add(li.stripe_checkout_session_id);
    }

    const d = li.order_date;
    if (d) {
      if (!a.first_sale || d < a.first_sale) a.first_sale = d;
      if (!a.last_sale || d > a.last_sale) a.last_sale = d;
    }
  }

  // 4. Compute CPI, profit, margin for each product
  const rows = Object.values(agg).map(a => {
    a.order_count = a.orders.size;
    delete a.orders;

    // CPI calculation (same formula as order modal)
    let cpi_cents = 0;
    if (a.unit_cost != null && a.weight_g) {
      const shipDetails = getSupplierShippingDetails(a.weight_g, 30);
      cpi_cents = Math.round((a.unit_cost + shipDetails.perUnitUSD) * 100);
    } else if (a.unit_cost != null) {
      cpi_cents = Math.round(a.unit_cost * 100);
    }

    a.cpi_cents = cpi_cents;
    a.total_cost_cents = cpi_cents * a.units_sold;
    a.profit_cents = a.revenue_cents - a.total_cost_cents;
    a.margin_pct = a.revenue_cents > 0
      ? Math.round((a.profit_cents / a.revenue_cents) * 1000) / 10
      : 0;
    a.discount_pct = a.original_cents > 0
      ? Math.round(((a.original_cents - a.revenue_cents) / a.original_cents) * 1000) / 10
      : 0;

    return a;
  });

  return { rows, lineItems: lineItems || [] };
}

// /js/admin/lineItemsOrders/api.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { getSupplierShippingDetails } from "/js/admin/pStorage/profitCalc.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ switched to the combined view that includes cost/profit columns
const SUMMARY = "v_order_summary_plus";
const SHIP = "fulfillment_shipments";

/**
 * Fetch full order details including line items with product images and costs
 */
export async function fetchOrderDetails(stripe_checkout_session_id) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");

  // Get order from summary view
  const { data: orderData, error: orderErr } = await supabase
    .from(SUMMARY)
    .select("*")
    .eq("stripe_checkout_session_id", stripe_checkout_session_id)
    .single();

  if (orderErr) throw orderErr;

  // Get line items
  const { data: lineItems, error: liErr } = await supabase
    .from("v_order_lines")
    .select("*")
    .eq("stripe_checkout_session_id", stripe_checkout_session_id)
    .order("line_item_row_id", { ascending: true });

  if (liErr) throw liErr;

  // Get product codes from line items (product_id is the product code like "KK-0016")
  // Legacy items have been remapped to new codes so they can pull images correctly.
  const productCodes = [...new Set((lineItems || []).map(li => li.product_id).filter(Boolean))];
  let productsMap = new Map();
  let variantsMap = new Map(); // key: "productCode|variantName" -> variant
  
  if (productCodes.length > 0) {
    // Fetch products by code with their variants and weight
    // CPI is calculated from: unit_cost + supplier_ship (from weight formula)
    const { data: products, error: pErr } = await supabase
      .from("products")
      .select(`
        id, code, name, unit_cost, weight_g, primary_image_url, catalog_image_url,
        product_variants (option_value, preview_image_url)
      `)
      .in("code", productCodes);
    
    if (pErr) console.error("[fetchOrderDetails] Products error:", pErr);
    console.log("[fetchOrderDetails] Product codes:", productCodes);
    console.log("[fetchOrderDetails] Products data:", products);
    
    for (const p of products || []) {
      // Calculate supplier ship per unit using the weight formula (default 30 qty)
      const weightG = Number(p.weight_g ?? 0);
      const shipDetails = getSupplierShippingDetails(weightG, 30);
      const supplierShipPerUnit = shipDetails.perUnitUSD || 0;
      
      console.log(`[fetchOrderDetails] Product ${p.code} unit_cost:`, p.unit_cost, "weight_g:", weightG, "supplierShip:", supplierShipPerUnit);
      productsMap.set(p.code, { ...p, _supplierShipPerUnit: supplierShipPerUnit });
      // Build variant image map
      for (const v of p.product_variants || []) {
        if (v.option_value && v.preview_image_url) {
          variantsMap.set(`${p.code}|${v.option_value}`, v.preview_image_url);
        }
      }
    }
  }

  // Enrich line items with product data and calculate costs
  // CPI (Paid Shipping) = unit_cost + supplier_ship_per_unit (calculated from weight)
  let calculatedCostCents = 0;
  const enrichedLineItems = (lineItems || []).map(li => {
    const product = productsMap.get(li.product_id);
    const qty = Number(li.quantity ?? 1);
    const unitCostDollars = Number(product?.unit_cost ?? 0);
    const supplierShipDollars = Number(product?._supplierShipPerUnit ?? 0);
    // CPI for Paid Shipping scenario (customer pays USPS, we only pay supplier ship)
    const cpiDollars = unitCostDollars + supplierShipDollars;
    const lineCostCents = Math.round(cpiDollars * 100 * qty);
    calculatedCostCents += lineCostCents;
    
    // Get variant-specific image, or fall back to product images
    const variantKey = `${li.product_id}|${li.variant}`;
    const variantImage = variantsMap.get(variantKey);
    const imageUrl = variantImage || product?.primary_image_url || product?.catalog_image_url || null;
    
    return {
      ...li,
      product_image_url: imageUrl,
      unit_cost_cents: Math.round(unitCostDollars * 100),
      supplier_ship_cents: Math.round(supplierShipDollars * 100),
      cpi_cents: Math.round(cpiDollars * 100), // CPI per unit (Paid Shipping)
      line_cost_cents: lineCostCents, // CPI × quantity
    };
  });

  // Get shipment info
  const { data: shipment } = await supabase
    .from(SHIP)
    .select("*")
    .eq("stripe_checkout_session_id", stripe_checkout_session_id)
    .single();

  // Get refund info
  const { data: refund } = await supabase
    .from("v_order_refunds")
    .select("*")
    .eq("stripe_checkout_session_id", stripe_checkout_session_id)
    .single()
    .then(r => r)
    .catch(() => ({ data: null }));

  // Cost & profit for the modal.
  // Use JS-calculated CPI (sum of per-item costs) so section 5 matches the
  // per-item CPI display. Fall back to view values for orders where products
  // aren't in the table (unmatched legacy items).
  const viewCpiCents = Number(orderData.product_cost_total_cents || 0)
    + Number(orderData.supplier_ship_total_cents || 0);
  const productCpiCents = calculatedCostCents > 0 ? calculatedCostCents : viewCpiCents;
  const labelCostCents = shipment?.label_cost_cents || 0;
  const refundCents = Number(refund?.refund_amount_cents || 0);
  const profitCents = Number(orderData.total_paid_cents || 0) - productCpiCents - labelCostCents - refundCents;

  const orderWithCost = {
    ...orderData,
    product_cpi_cents: productCpiCents,
    profit_cents: profitCents,
    refund: refund || null,
  };

  return {
    order: orderWithCost,
    lineItems: enrichedLineItems,
    shipment: shipment || null,
  };
}

async function getSessionIdsByStatus(label_status) {
  // Handle refund pseudo-statuses
  if (label_status === "refunded" || label_status === "partial_refund") {
    const refundVal = label_status === "refunded" ? "full" : "partial";
    const { data, error } = await supabase
      .from("v_order_refunds")
      .select("stripe_checkout_session_id")
      .eq("refund_status", refundVal);
    if (error) throw error;
    return (data || []).map((r) => r.stripe_checkout_session_id).filter(Boolean);
  }

  if (!label_status) return null;
  const { data, error } = await supabase
    .from(SHIP)
    .select("stripe_checkout_session_id")
    .eq("label_status", label_status);

  if (error) throw error;
  return (data || []).map((r) => r.stripe_checkout_session_id).filter(Boolean);
}

async function getShipmentsMap(sessionIds) {
  if (!sessionIds?.length) return new Map();

  const { data, error } = await supabase
    .from(SHIP)
    .select(
      [
        "stripe_checkout_session_id",
        "kk_order_id",
        "label_status",
        "label_purchased_at",
        "shipped_at",
        "carrier",
        "service",
        "tracking_number",
        "pirate_ship_shipment_id",
        "package_weight_g_final",
        "notes",
        "batch_id",
        "printed_at",
        "label_cost_cents",
      ].join(",")
    )
    .in("stripe_checkout_session_id", sessionIds);

  if (error) throw error;

  const m = new Map();
  for (const row of data || []) m.set(row.stripe_checkout_session_id, row);
  return m;
}

async function getRefundsMap(sessionIds) {
  if (!sessionIds?.length) return new Map();

  const { data, error } = await supabase
    .from("v_order_refunds")
    .select("stripe_checkout_session_id, refund_status, refund_amount_cents, refunded_at, stripe_refund_id, net_revenue_cents")
    .in("stripe_checkout_session_id", sessionIds);

  if (error) {
    // Gracefully degrade if view doesn't exist yet (migration not run)
    console.warn("[api] v_order_refunds fetch failed (migration may not be applied yet):", error.message);
    return new Map();
  }

  const m = new Map();
  for (const row of data || []) m.set(row.stripe_checkout_session_id, row);
  return m;
}

function buildSearchOr(q) {
  const like = `%${q}%`;
  return [
    `kk_order_id.ilike.${like}`,
    `email.ilike.${like}`,
    `first_name.ilike.${like}`,
    `last_name.ilike.${like}`,
    `coupon_code_used.ilike.${like}`,
    `stripe_checkout_session_id.ilike.${like}`,
  ].join(",");
}

function applyDateRange(qb, dateFrom, dateTo) {
  if (dateFrom) qb = qb.gte("order_date", `${dateFrom}T00:00:00Z`);
  if (dateTo) qb = qb.lte("order_date", `${dateTo}T23:59:59Z`);
  return qb;
}

export async function fetchOrderSummaryPage({
  q = "",
  status = "",
  dateFrom = "",
  dateTo = "",
  limit = 25,
  offset = 0,
} = {}) {
  const Q = (q || "").trim();
  const L = Math.min(200, Math.max(5, Number(limit || 25)));
  const O = Math.max(0, Number(offset || 0));

  let statusSessionIds = null;
  if (status) {
    statusSessionIds = await getSessionIdsByStatus(status);
    if (!statusSessionIds.length) return { rows: [], totalCount: 0, hasMore: false };
  }

  let countQ = supabase.from(SUMMARY).select("*", { count: "exact", head: true });
  let dataQ = supabase.from(SUMMARY).select("*");

  if (Q) {
    const or = buildSearchOr(Q);
    countQ = countQ.or(or);
    dataQ = dataQ.or(or);
  }

  countQ = applyDateRange(countQ, dateFrom, dateTo);
  dataQ = applyDateRange(dataQ, dateFrom, dateTo);

  if (statusSessionIds) {
    countQ = countQ.in("stripe_checkout_session_id", statusSessionIds);
    dataQ = dataQ.in("stripe_checkout_session_id", statusSessionIds);
  }

  dataQ = dataQ.order("order_date", { ascending: false }).range(O, O + L - 1);

  const [{ count, error: countErr }, { data, error: dataErr }] = await Promise.all([countQ, dataQ]);
  if (countErr) throw countErr;
  if (dataErr) throw dataErr;

  const rows = data || [];
  const sessionIds = rows.map((r) => r.stripe_checkout_session_id).filter(Boolean);

  const shipMap = await getShipmentsMap(sessionIds);
  const refundMap = await getRefundsMap(sessionIds);

  // Cost & profit come from the v_order_summary_plus view (via v_order_financials).
  // The view already handles legacy stored cost vs dynamic CPI correctly.
  const merged = rows.map((r) => {
    const shipment = shipMap.get(r.stripe_checkout_session_id) || null;
    const refund = refundMap.get(r.stripe_checkout_session_id) || null;
    return { ...r, shipment, refund };
  });

  const totalCount = Number(count ?? 0);
  const hasMore = O + merged.length < totalCount;

  return { rows: merged, totalCount, hasMore };
}

export async function fetchOrderSummaryAllForExport(filters = {}) {
  const chunk = 500;
  let offset = 0;
  let all = [];

  while (true) {
    const { rows, hasMore } = await fetchOrderSummaryPage({ ...filters, limit: chunk, offset });
    all = all.concat(rows);
    if (!hasMore || rows.length === 0) break;
    offset += rows.length;
    if (all.length > 50000) break; // safety
  }
  return all;
}

/**
 * ✅ UPSERT into fulfillment_shipments (keyed by stripe_checkout_session_id).
 * Auto timestamps:
 * - if status becomes label_purchased and label_purchased_at is null -> set now
 * - if status becomes shipped and shipped_at is null -> set now
 */
export async function upsertFulfillmentShipment({
  stripe_checkout_session_id,
  kk_order_id,
  patch,
  previousShipment,
} = {}) {
  if (!stripe_checkout_session_id) throw new Error("Missing stripe_checkout_session_id");

  const nowIso = new Date().toISOString();

  const nextStatus = (patch.label_status ?? previousShipment?.label_status ?? "pending") || "pending";

  // auto timestamp rules
  const auto = {};
  if (nextStatus === "label_purchased" && !previousShipment?.label_purchased_at && !patch.label_purchased_at) {
    auto.label_purchased_at = nowIso;
  }
  if (nextStatus === "shipped" && !previousShipment?.shipped_at && !patch.shipped_at) {
    auto.shipped_at = nowIso;
  }

  const upsertRow = {
    stripe_checkout_session_id,
    kk_order_id: kk_order_id || previousShipment?.kk_order_id || null,
    ...patch,
    ...auto,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from(SHIP)
    .upsert(upsertRow, { onConflict: "stripe_checkout_session_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function fetchOrderKpis({ q = "", status = "", dateFrom = "", dateTo = "" } = {}) {
  // Get base KPIs from RPC (orders count, revenue, unfulfilled)
  const { data, error } = await supabase.rpc("rpc_order_kpis", {
    p_q: (q || "").trim() || null,
    p_status: (status || "").trim() || null,
    p_date_from: (dateFrom || "").trim() || null,
    p_date_to: (dateTo || "").trim() || null,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const baseKpis = row || { orders_count: 0, revenue_cents: 0, profit_cents: 0, unfulfilled_count: 0 };

  // Profit comes from v_order_summary_plus (via v_order_financials) which already
  // handles legacy stored cost vs dynamic CPI. Sum it for the filtered orders.
  let profitQ = supabase
    .from(SUMMARY)
    .select("profit_cents")
    .order("order_date", { ascending: false })
    .limit(500);

  const Q = (q || "").trim();
  if (Q) {
    const or = buildSearchOr(Q);
    profitQ = profitQ.or(or);
  }

  profitQ = applyDateRange(profitQ, dateFrom, dateTo);

  if (status) {
    const statusSessionIds = await getSessionIdsByStatus(status);
    if (statusSessionIds && statusSessionIds.length > 0) {
      profitQ = profitQ.in("stripe_checkout_session_id", statusSessionIds);
    } else if (status) {
      return { ...baseKpis, profit_cents: 0 };
    }
  }

  const { data: profitRows, error: profitErr } = await profitQ;
  if (profitErr) throw profitErr;

  let totalProfit = 0;
  for (const r of profitRows || []) {
    totalProfit += Number(r.profit_cents || 0);
  }

  return {
    ...baseKpis,
    profit_cents: totalProfit,
  };
}

export async function importPirateShipExport({ batchId, rows } = {}) {
  if (!batchId) throw new Error("Missing batchId");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("No rows to import");

  const { data, error } = await supabase.rpc("rpc_import_pirateship_export", {
    p_batch_id: batchId,
    p_rows: rows,
  });

  if (error) throw error;

  // Supabase RPC returns array with one row
  const r = Array.isArray(data) ? data[0] : data;
  return r || { updated_count: 0, skipped_count: 0 };
}

/**
 * Issue a refund via the stripe-refund edge function.
 * @param {string} stripe_checkout_session_id
 * @param {number|null} amount_cents - null for full refund
 */
export async function issueRefund(stripe_checkout_session_id, amount_cents = null) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const body = { stripe_checkout_session_id };
  if (amount_cents != null) body.amount_cents = amount_cents;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  if (!res.ok || result.error) {
    throw new Error(result.error || `Refund failed (${res.status})`);
  }
  return result;
}

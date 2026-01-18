// /js/admin/lineItemsOrders/api.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

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

  // Get product codes from line items (product_id in line_items is actually the product code like "KK-0016")
  const productCodes = [...new Set((lineItems || []).map(li => li.product_id).filter(Boolean))];
  let productsMap = new Map();
  let variantsMap = new Map(); // key: "productCode|variantName" -> variant
  
  if (productCodes.length > 0) {
    // Fetch products by code with their variants and costs
    // Cost data is in product_costs table (unit_cost, supplier_ship_per_unit)
    const { data: products, error: pErr } = await supabase
      .from("products")
      .select(`
        id, code, name, primary_image_url, catalog_image_url,
        product_variants (option_value, preview_image_url),
        product_costs (unit_cost, supplier_ship_per_unit)
      `)
      .in("code", productCodes);
    
    if (pErr) console.error("[fetchOrderDetails] Products error:", pErr);
    
    for (const p of products || []) {
      // product_costs can come back as [] or object depending on relationships
      const pcRaw = p.product_costs;
      const pc = Array.isArray(pcRaw) ? pcRaw[0] : pcRaw;
      productsMap.set(p.code, { ...p, _costs: pc || {} });
      // Build variant image map
      for (const v of p.product_variants || []) {
        if (v.option_value && v.preview_image_url) {
          variantsMap.set(`${p.code}|${v.option_value}`, v.preview_image_url);
        }
      }
    }
  }

  // Enrich line items with product data and calculate costs
  // TRUE CPI = unit_cost + supplier_ship_per_unit (from product_costs table)
  let calculatedCostCents = 0;
  const enrichedLineItems = (lineItems || []).map(li => {
    const product = productsMap.get(li.product_id);
    const costs = product?._costs || {};
    const qty = Number(li.quantity ?? 1);
    const unitCostDollars = Number(costs.unit_cost ?? 0);
    const supplierShipDollars = Number(costs.supplier_ship_per_unit ?? 0);
    const trueCpiDollars = unitCostDollars + supplierShipDollars;
    const lineCostCents = Math.round(trueCpiDollars * 100 * qty);
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
      cpi_cents: Math.round(trueCpiDollars * 100), // True CPI per unit
      line_cost_cents: lineCostCents, // CPI × quantity
    };
  });

  // Get shipment info
  const { data: shipment } = await supabase
    .from(SHIP)
    .select("*")
    .eq("stripe_checkout_session_id", stripe_checkout_session_id)
    .single();

  // Calculate costs - always use our calculated value for accuracy
  const labelCostCents = shipment?.label_cost_cents || 0;
  const totalPaidCents = orderData.total_paid_cents || 0;
  const profitCents = totalPaidCents - calculatedCostCents - labelCostCents;

  const orderWithCost = {
    ...orderData,
    order_cost_total_cents: calculatedCostCents,
    profit_cents: profitCents,
  };

  return {
    order: orderWithCost,
    lineItems: enrichedLineItems,
    shipment: shipment || null,
  };
}

async function getSessionIdsByStatus(label_status) {
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
  
  // Recalculate profit from line items and product costs
  const profitMap = await calculateProfitsForOrders(sessionIds);

  const merged = rows.map((r) => {
    const shipment = shipMap.get(r.stripe_checkout_session_id) || null;
    const calcProfit = profitMap.get(r.stripe_checkout_session_id);
    
    return {
      ...r,
      shipment,
      // Use calculated profit if available, recalculating based on actual product costs
      order_cost_total_cents: calcProfit?.costCents ?? r.order_cost_total_cents ?? 0,
      profit_cents: calcProfit?.profitCents ?? r.profit_cents ?? 0,
    };
  });

  const totalCount = Number(count ?? 0);
  const hasMore = O + merged.length < totalCount;

  return { rows: merged, totalCount, hasMore };
}

/**
 * Calculate actual profits for orders based on product unit_cost
 */
async function calculateProfitsForOrders(sessionIds) {
  const profitMap = new Map();
  if (!sessionIds?.length) return profitMap;

  // Get all line items for these orders
  const { data: lineItems } = await supabase
    .from("line_items_raw")
    .select("stripe_checkout_session_id, product_id, quantity")
    .in("stripe_checkout_session_id", sessionIds);

  if (!lineItems?.length) return profitMap;

  // Get unique product codes
  const productCodes = [...new Set(lineItems.map(li => li.product_id).filter(Boolean))];
  
  // Fetch products with their costs from product_costs table
  const { data: products } = await supabase
    .from("products")
    .select("code, product_costs (unit_cost, supplier_ship_per_unit)")
    .in("code", productCodes);

  // TRUE CPI = unit_cost + supplier_ship_per_unit (from product_costs)
  const productCostMap = new Map();
  for (const p of products || []) {
    const pcRaw = p.product_costs;
    const pc = Array.isArray(pcRaw) ? pcRaw[0] : pcRaw;
    const unitCost = Number(pc?.unit_cost ?? 0);
    const supplierShip = Number(pc?.supplier_ship_per_unit ?? 0);
    productCostMap.set(p.code, unitCost + supplierShip);
  }

  // Get shipments for label costs
  const { data: shipments } = await supabase
    .from(SHIP)
    .select("stripe_checkout_session_id, label_cost_cents")
    .in("stripe_checkout_session_id", sessionIds);

  const labelCostMap = new Map();
  for (const s of shipments || []) {
    labelCostMap.set(s.stripe_checkout_session_id, s.label_cost_cents || 0);
  }

  // Get order totals
  const { data: orders } = await supabase
    .from(SUMMARY)
    .select("stripe_checkout_session_id, total_paid_cents")
    .in("stripe_checkout_session_id", sessionIds);

  const orderTotalMap = new Map();
  for (const o of orders || []) {
    orderTotalMap.set(o.stripe_checkout_session_id, o.total_paid_cents || 0);
  }

  // Calculate cost per order (using TRUE CPI)
  const orderCostMap = new Map();
  for (const li of lineItems) {
    const sid = li.stripe_checkout_session_id;
    const qty = Number(li.quantity ?? 1);
    const trueCpi = productCostMap.get(li.product_id) || 0;
    const lineCostCents = Math.round(trueCpi * 100 * qty);
    
    orderCostMap.set(sid, (orderCostMap.get(sid) || 0) + lineCostCents);
  }

  // Build final profit map
  for (const sid of sessionIds) {
    const costCents = orderCostMap.get(sid) || 0;
    const labelCents = labelCostMap.get(sid) || 0;
    const totalPaid = orderTotalMap.get(sid) || 0;
    const profitCents = totalPaid - costCents - labelCents;
    
    profitMap.set(sid, { costCents, profitCents });
  }

  return profitMap;
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
  const { data, error } = await supabase.rpc("rpc_order_kpis", {
    p_q: (q || "").trim() || null,
    p_status: (status || "").trim() || null,
    p_date_from: (dateFrom || "").trim() || null,
    p_date_to: (dateTo || "").trim() || null,
  });

  if (error) throw error;

  // RPC returns an array with 1 row in Supabase JS
  const row = Array.isArray(data) ? data[0] : data;
  return row || { orders_count: 0, revenue_cents: 0, profit_cents: 0, unfulfilled_count: 0 };
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

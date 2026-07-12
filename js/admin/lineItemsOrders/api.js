// /js/admin/lineItemsOrders/api.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { getSupplierShippingDetails } from "/js/admin/pStorage/profitCalc.js";
import {
  cpiSourceLabel,
  normalizeVariantKey,
  resolveOrderLineItemCost,
} from "/js/shared/landedCpi.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ switched to the combined view that includes cost/profit columns
const SUMMARY = "v_order_summary_plus";
const SHIP = "fulfillment_shipments";

function indexById(rows = []) {
  const m = new Map();
  for (const row of rows || []) {
    if (row?.id) m.set(row.id, row);
  }
  return m;
}

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
  let variantsMap = new Map(); // key: "productCode|variantName" -> variant row
  
  if (productCodes.length > 0) {
    const { data: products, error: pErr } = await supabase
      .from("products")
      .select(`
        id, code, slug, name, unit_cost, weight_g, primary_image_url, catalog_image_url,
        product_variants (id, option_value, sku, preview_image_url, unit_cost_override_cents)
      `)
      .in("code", productCodes);
    
    if (pErr) console.error("[fetchOrderDetails] Products error:", pErr);

    for (const p of products || []) {
      const weightG = Number(p.weight_g ?? 0);
      const shipDetails = getSupplierShippingDetails(weightG, 30);
      const supplierShipPerUnit = shipDetails.perUnitUSD || 0;
      productsMap.set(p.code, { ...p, _supplierShipPerUnit: supplierShipPerUnit });
      for (const v of p.product_variants || []) {
        if (v.option_value) {
          variantsMap.set(`${p.code}|${normalizeVariantKey(v.option_value)}`, v);
        }
        if (v.sku) {
          variantsMap.set(`${p.code}|sku:${normalizeVariantKey(v.sku)}`, v);
        }
      }
    }
  }

  let calculatedCostCents = 0;
  const enrichedLineItems = (lineItems || []).map(li => {
    const product = productsMap.get(li.product_id);
    const qty = Number(li.quantity ?? 1);
    const variantKey = `${li.product_id}|${normalizeVariantKey(li.variant)}`;
    const variant =
      variantsMap.get(variantKey) ||
      variantsMap.get(`${li.product_id}|sku:${normalizeVariantKey(li.variant_sku)}`) ||
      variantsMap.get(`${li.product_id}|sku:${normalizeVariantKey(li.variant)}`) ||
      null;

    const cost = resolveOrderLineItemCost({
      productUnitCost: product?.unit_cost,
      variantOverrideCents: variant?.unit_cost_override_cents,
      supplierShipPerUnitUsd: product?._supplierShipPerUnit ?? 0,
      quantity: qty,
    });
    calculatedCostCents += cost.lineCostCents;

    const variantImage = variant?.preview_image_url || null;
    const imageUrl = variantImage || product?.primary_image_url || product?.catalog_image_url || null;
    const displayVariant =
      li.variant_title ||
      variant?.option_value ||
      li.variant ||
      null;
    
    return {
      ...li,
      variant: displayVariant,
      product_slug: product?.slug || null,
      product_image_url: imageUrl,
      product_variant_id: variant?.id || li.variant_id || null,
      unit_cost_cents: cost.unitCostCents,
      supplier_ship_cents: cost.supplierShipCents,
      cpi_cents: cost.cpiCents,
      line_cost_cents: cost.lineCostCents,
      landed_cpi_cents: cost.unitCostCents,
      cost_source: cost.costSource,
      cost_source_label: cpiSourceLabel(cost.costSource),
      uses_landed_variant_cpi: cost.costSource === "variant",
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

  // For eBay orders: fetch Finance API earnings for accurate profit calculation.
  // v_ebay_order_profit joins ebay_finance_transactions (upserted by ebay-sync-finances).
  const isEbayOrder = String(stripe_checkout_session_id).startsWith("ebay_api_");
  const isAmazonOrder = String(stripe_checkout_session_id).startsWith("amazon_");
  let ebayFinancials = null;
  let amazonFinancials = null;
  if (isEbayOrder) {
    const { data: ebayFin, error: ebayFinErr } = await supabase
      .from("v_ebay_order_profit")
      .select("*")
      .eq("stripe_checkout_session_id", stripe_checkout_session_id)
      .maybeSingle();
    if (ebayFinErr) {
      console.warn("[fetchOrderDetails] v_ebay_order_profit fetch failed:", ebayFinErr.message);
    } else {
      ebayFinancials = ebayFin || null;
    }
  }
  if (isAmazonOrder) {
    const { data: amazonFin, error: amazonFinErr } = await supabase
      .from("v_amazon_order_profit")
      .select("*")
      .eq("stripe_checkout_session_id", stripe_checkout_session_id)
      .maybeSingle();
    if (amazonFinErr) {
      console.warn("[fetchOrderDetails] v_amazon_order_profit fetch failed:", amazonFinErr.message);
    } else {
      amazonFinancials = amazonFin || null;
    }
  }

  // Cost & profit for the modal.
  // Use JS-calculated CPI (sum of per-item costs) so section 5 matches the
  // per-item CPI display. Fall back to view values for orders where products
  // aren't in the table (unmatched legacy items).
  const viewCpiCents = Number(orderData.product_cost_total_cents || 0)
    + Number(orderData.supplier_ship_total_cents || 0);
  const productCpiCents = calculatedCostCents > 0 ? calculatedCostCents : viewCpiCents;
  const labelCostCents = shipment?.label_cost_cents || 0;
  const refundCents = Number(refund?.refund_amount_cents || 0);
  const refundReason = refund?.refund_reason || orderData.refund_reason || null;
  const totalPaid = Number(orderData.total_paid_cents || 0);

  // Smart profit based on order type and refund reason.
  // eBay: use Finance API earnings as revenue (ebay_order_earnings_cents already nets
  //   out the SALE-embedded FVF AND any separately-billed per-order NON_SALE_CHARGE fees).
  //   When finance_status is 'estimated' (ad fee not yet captured), the view returns NULL
  //   for ebay_net_profit_cents to avoid overstating — we mirror that here.
  // Standard: use total_paid_cents minus all costs.
  let profitCents;
  const ebayFinStatus = ebayFinancials?.finance_status;
  const isEstimatedEbay = ebayFinStatus === "estimated"; // ad fee not yet captured
  if (isEbayOrder && ebayFinancials?.ebay_order_earnings_cents != null && !isEstimatedEbay) {
    const earnings = Number(ebayFinancials.ebay_order_earnings_cents);
    if (orderData.refund_status === "full" && (!refundReason || refundReason === "cancelled_before_ship")) {
      profitCents = 0;
    } else {
      // earnings excludes eBay fees (FVF + per-order ad fees) and eBay-collected tax
      profitCents = earnings - productCpiCents - labelCostCents - refundCents;
    }
  } else if (isEbayOrder && isEstimatedEbay) {
    // Ad fee not yet billed by eBay — profit unknown; set null so UI shows estimate badge
    profitCents = null;
  } else if (isAmazonOrder && amazonFinancials?.amazon_net_profit_cents != null) {
    profitCents = Number(amazonFinancials.amazon_net_profit_cents);
  } else if (orderData.refund_status === "full" && (!refundReason || refundReason === "cancelled_before_ship")) {
    // Never shipped / cancelled → no costs incurred → $0 profit
    profitCents = 0;
  } else if (refundReason === "returned") {
    // Customer returned → product cost is sunk, no label cost
    profitCents = totalPaid - refundCents - productCpiCents;
  } else {
    // refunded_kept_item, partial, or no refund → standard calc
    profitCents = totalPaid - productCpiCents - labelCostCents - refundCents;
  }

  const orderWithCost = {
    ...orderData,
    product_cpi_cents: productCpiCents,
    profit_cents: profitCents,
    refund: refund || null,
    refund_reason: refundReason,
    ebay_financials: ebayFinancials,
    amazon_financials: amazonFinancials,
  };

  return {
    order: orderWithCost,
    lineItems: enrichedLineItems,
    shipment: shipment || null,
  };
}

/**
 * Fetch CTA label print/link/scan history for a single order workspace.
 * Read-only helper: queries existing tracking tables by session_id and normalizes
 * scan aggregates in JS so Phase 2F does not require DB views or policy changes.
 */
export async function fetchCtaLabelHistory(sessionId) {
  if (!sessionId) {
    return {
      prints: [],
      links: [],
      scans: [],
      scanCountsByPrintId: {},
      latestScanByPrintId: {},
      scanCountsByLinkId: {},
      latestScanByLinkId: {},
      linksByPrintId: {},
    };
  }

  const [
    { data: prints, error: printsErr },
    { data: links, error: linksErr },
    { data: scans, error: scansErr },
  ] = await Promise.all([
    supabase
      .from("cta_label_prints")
      .select("*")
      .eq("session_id", sessionId)
      .order("printed_at", { ascending: false }),
    supabase
      .from("cta_label_links")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false }),
    supabase
      .from("cta_label_scans")
      .select("*")
      .eq("session_id", sessionId)
      .order("scanned_at", { ascending: false }),
  ]);

  if (printsErr) throw printsErr;
  if (linksErr) throw linksErr;
  if (scansErr) throw scansErr;

  const printRows = prints || [];
  const linkRows = links || [];
  const scanRows = scans || [];
  const printById = indexById(printRows);
  const linkById = indexById(linkRows);
  const scanCountsByPrintId = {};
  const scanCountsByLinkId = {};
  const latestScanByPrintId = {};
  const latestScanByLinkId = {};
  const linksByPrintId = {};

  for (const link of linkRows) {
    if (!link?.print_id) continue;
    if (!linksByPrintId[link.print_id]) linksByPrintId[link.print_id] = [];
    linksByPrintId[link.print_id].push(link);
  }

  for (const scan of scanRows) {
    const link = scan?.link_id ? linkById.get(scan.link_id) : null;
    const printId = scan?.print_id || link?.print_id || null;
    const linkId = scan?.link_id || null;

    if (printId && printById.has(printId)) {
      scanCountsByPrintId[printId] = (scanCountsByPrintId[printId] || 0) + 1;
      if (
        !latestScanByPrintId[printId] ||
        new Date(scan?.scanned_at || 0) > new Date(latestScanByPrintId[printId]?.scanned_at || 0)
      ) {
        latestScanByPrintId[printId] = scan;
      }
    }
    if (linkId) {
      scanCountsByLinkId[linkId] = (scanCountsByLinkId[linkId] || 0) + 1;
      if (
        !latestScanByLinkId[linkId] ||
        new Date(scan?.scanned_at || 0) > new Date(latestScanByLinkId[linkId]?.scanned_at || 0)
      ) {
        latestScanByLinkId[linkId] = scan;
      }
    }
  }

  return {
    prints: printRows,
    links: linkRows,
    scans: scanRows,
    scanCountsByPrintId,
    latestScanByPrintId,
    scanCountsByLinkId,
    latestScanByLinkId,
    linksByPrintId,
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
        "shippo_transaction_id",
        "label_url",
        "tracking_url",
        "in_transit_at",
        "delivered_at",
        "estimated_delivery",
        "last_tracking_sync_at",
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
    .select("stripe_checkout_session_id, refund_status, refund_reason, refund_amount_cents, refunded_at, stripe_refund_id, net_revenue_cents")
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

/** Phase 10P — derived marketplace cancel/refund/fulfillment status (guidance-only). */
async function getMarketplaceStatusMap(sessionIds) {
  if (!sessionIds?.length) return new Map();

  const { data, error } = await supabase
    .from("v_order_marketplace_status")
    .select(
      "stripe_checkout_session_id, order_status, cancel_status, refund_status, refund_status_derived, return_observation_status, fulfillment_status, is_afn_observed, marketplace_line_confidence",
    )
    .in("stripe_checkout_session_id", sessionIds);

  if (error) {
    console.warn("[api] v_order_marketplace_status fetch failed (migration may not be applied yet):", error.message);
    return new Map();
  }

  const m = new Map();
  for (const row of data || []) m.set(row.stripe_checkout_session_id, row);
  return m;
}

/**
 * Batch-fetch eBay Finance API data from v_ebay_order_profit for a set of session IDs.
 * Only queries for session IDs that look like eBay orders (start with "ebay_api_").
 * Returns Map<session_id, ebay_finance_row>
 */
async function getEbayFinancesMap(sessionIds) {
  if (!sessionIds?.length) return new Map();

  const ebayIds = sessionIds.filter((id) => id?.startsWith("ebay_api_"));
  if (!ebayIds.length) return new Map();

  const { data, error } = await supabase
    .from("v_ebay_order_profit")
    .select(
      [
        "stripe_checkout_session_id",
        "ebay_order_earnings_cents",
        "ebay_total_fee_cents",
        "fee_final_value_cents",
        "per_order_ad_fee_cents",
        "fee_regulatory_cents",
        "fee_international_cents",
        "fee_other_cents",
        "product_cost_cents",
        "shippo_label_cost_cents",
        "ebay_net_profit_cents",
        "finance_status",
        "finance_synced_at",
        "buyer_total_cents",
        "sale_fee_breakdown",
        "ad_fee_breakdown",
      ].join(",")
    )
    .in("stripe_checkout_session_id", ebayIds);

  if (error) {
    // Gracefully degrade if view doesn't exist yet (migration not applied)
    console.warn("[api] v_ebay_order_profit fetch failed (migration may not be applied):", error.message);
    return new Map();
  }

  const m = new Map();
  for (const row of data || []) m.set(row.stripe_checkout_session_id, row);
  return m;
}

async function getAmazonFinancesMap(sessionIds) {
  if (!sessionIds?.length) return new Map();

  const amazonIds = sessionIds.filter((id) => id?.startsWith("amazon_"));
  if (!amazonIds.length) return new Map();

  const { data, error } = await supabase
    .from("v_amazon_order_profit")
    .select(
      [
        "stripe_checkout_session_id",
        "amazon_order_earnings_cents",
        "amazon_total_fee_cents",
        "fee_referral_cents",
        "fee_fba_cents",
        "fee_other_cents",
        "product_cost_cents",
        "shippo_label_cost_cents",
        "amazon_net_profit_cents",
        "finance_status",
        "finance_synced_at",
        "buyer_total_cents",
        "fee_breakdown",
      ].join(",")
    )
    .in("stripe_checkout_session_id", amazonIds);

  if (error) {
    console.warn("[api] v_amazon_order_profit fetch failed:", error.message);
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

/**
 * Fetch review counts per order session ID (batch).
 * Returns Map<session_id, number>
 */
async function getReviewCountsMap(sessionIds) {
  if (!sessionIds?.length) return new Map();

  // Query reviews grouped by order_session_id for the given session IDs
  const { data, error } = await supabase
    .from("reviews")
    .select("order_session_id")
    .in("order_session_id", sessionIds);

  if (error) {
    console.warn("[api] reviews fetch failed:", error.message);
    return new Map();
  }

  const m = new Map();
  for (const row of data || []) {
    const sid = row.order_session_id;
    m.set(sid, (m.get(sid) || 0) + 1);
  }
  return m;
}

/**
 * Get all session IDs that have at least one review.
 */
async function getReviewedSessionIds() {
  const { data, error } = await supabase
    .from("reviews")
    .select("order_session_id");

  if (error) {
    console.warn("[api] reviews fetch failed:", error.message);
    return new Set();
  }

  return new Set((data || []).map(r => r.order_session_id));
}

function applyDateRange(qb, dateFrom, dateTo) {
  if (dateFrom) qb = qb.gte("order_date", `${dateFrom}T00:00:00Z`);
  if (dateTo) qb = qb.lte("order_date", `${dateTo}T23:59:59Z`);
  return qb;
}

/** @param {import("@supabase/supabase-js").PostgrestFilterBuilder} qb */
function applyPlatformFilter(qb, platform) {
  const p = String(platform || "").trim().toLowerCase();
  if (!p || p === "all") return qb;
  if (p === "amazon") return qb.like("stripe_checkout_session_id", "amazon_%");
  if (p === "ebay") return qb.like("stripe_checkout_session_id", "ebay_%");
  if (p === "kk") {
    return qb.or(
      "stripe_checkout_session_id.like.cs_live_%,stripe_checkout_session_id.like.cs_test_%",
    );
  }
  return qb;
}

async function resolveListFilterContext({
  q = "",
  status = "",
  dateFrom = "",
  dateTo = "",
  reviewStatus = "",
} = {}) {
  let statusSessionIds = null;
  if (status) {
    statusSessionIds = await getSessionIdsByStatus(status);
    if (!statusSessionIds.length) return { empty: true, statusSessionIds, reviewSessionIds: null };
  }

  let reviewSessionIds = null;
  if (reviewStatus === "reviewed" || reviewStatus === "no_reviews") {
    const reviewedSet = await getReviewedSessionIds();
    reviewSessionIds = { set: reviewedSet, mode: reviewStatus };
    if (reviewSessionIds.mode === "reviewed" && reviewedSet.size === 0) {
      return { empty: true, statusSessionIds, reviewSessionIds };
    }
  }

  return { empty: false, statusSessionIds, reviewSessionIds, q: (q || "").trim() };
}

/** @param {import("@supabase/supabase-js").PostgrestFilterBuilder} qb */
function applyListFilters(qb, filters, ctx) {
  const { q, statusSessionIds, reviewSessionIds } = ctx;

  if (q) qb = qb.or(buildSearchOr(q));
  qb = applyDateRange(qb, filters.dateFrom, filters.dateTo);
  qb = applyPlatformFilter(qb, filters.platform);

  if (statusSessionIds) {
    qb = qb.in("stripe_checkout_session_id", statusSessionIds);
  }

  if (reviewSessionIds?.mode === "reviewed") {
    const ids = [...reviewSessionIds.set];
    qb = qb.in("stripe_checkout_session_id", ids);
  } else if (reviewSessionIds?.mode === "no_reviews") {
    const ids = [...reviewSessionIds.set];
    if (ids.length > 0) {
      qb = qb.not("stripe_checkout_session_id", "in", `(${ids.join(",")})`);
    }
  }

  return qb;
}

export async function fetchOrderSummaryPage({
  q = "",
  status = "",
  dateFrom = "",
  dateTo = "",
  reviewStatus = "",
  platform = "",
  limit = 25,
  offset = 0,
} = {}) {
  const L = Math.min(200, Math.max(5, Number(limit || 25)));
  const O = Math.max(0, Number(offset || 0));

  const ctx = await resolveListFilterContext({ q, status, dateFrom, dateTo, reviewStatus });
  if (ctx.empty) return { rows: [], totalCount: 0, hasMore: false };

  const filters = { dateFrom, dateTo, platform };
  let countQ = supabase.from(SUMMARY).select("*", { count: "exact", head: true });
  let dataQ = supabase.from(SUMMARY).select("*");

  countQ = applyListFilters(countQ, filters, ctx);
  dataQ = applyListFilters(dataQ, filters, ctx);

  dataQ = dataQ.order("order_date", { ascending: false }).range(O, O + L - 1);

  const [{ count, error: countErr }, { data, error: dataErr }] = await Promise.all([countQ, dataQ]);
  if (countErr) throw countErr;
  if (dataErr) throw dataErr;

  const rows = data || [];
  const sessionIds = rows.map((r) => r.stripe_checkout_session_id).filter(Boolean);

  const shipMap = await getShipmentsMap(sessionIds);
  const refundMap = await getRefundsMap(sessionIds);
  const marketplaceStatusMap = await getMarketplaceStatusMap(sessionIds);
  const reviewMap = await getReviewCountsMap(sessionIds);
  const ebayFinanceMap = await getEbayFinancesMap(sessionIds);
  const amazonFinanceMap = await getAmazonFinancesMap(sessionIds);

  // Cost & profit from v_order_summary_plus (landed CPI in SQL views; variant override when set).
  // For eBay orders, ebay_finance provides Finance API earnings for accurate profit.
  const merged = rows.map((r) => {
    const shipment = shipMap.get(r.stripe_checkout_session_id) || null;
    const refund = refundMap.get(r.stripe_checkout_session_id) || null;
    const marketplace_status = marketplaceStatusMap.get(r.stripe_checkout_session_id) || null;
    const review_count = reviewMap.get(r.stripe_checkout_session_id) || 0;
    const ebay_finance = ebayFinanceMap.get(r.stripe_checkout_session_id) || null;
    const amazon_finance = amazonFinanceMap.get(r.stripe_checkout_session_id) || null;
    return { ...r, shipment, refund, marketplace_status, review_count, ebay_finance, amazon_finance };
  });

  const totalCount = Number(count ?? 0);
  const hasMore = O + merged.length < totalCount;

  return { rows: merged, totalCount, hasMore };
}

/**
 * Find a single order summary row by session / kk order id (Phase 10I deep links).
 * @param {string} sessionOrOrderId
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function fetchOrderSummaryRow(sessionOrOrderId) {
  const id = (sessionOrOrderId || "").trim();
  if (!id) return null;

  const { rows } = await fetchOrderSummaryPage({ q: id, limit: 25, offset: 0 });
  return (
    rows.find(
      (r) => r.stripe_checkout_session_id === id || String(r.kk_order_id || "") === id,
    ) || null
  );
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

/** Phase 6E — finalize KK inventory reservations when order ships (admin path). */
export async function finalizeKkOrderReservations({
  stripe_checkout_session_id,
  reference_id,
  source = "admin_fulfillment",
} = {}) {
  if (!stripe_checkout_session_id) throw new Error("Missing stripe_checkout_session_id");
  if (
    stripe_checkout_session_id.startsWith("ebay") ||
    stripe_checkout_session_id.startsWith("amazon")
  ) {
    return null;
  }

  const { data, error } = await supabase.rpc("finalize_kk_order_reservations", {
    p_order_id: stripe_checkout_session_id,
    p_reference_id: reference_id || stripe_checkout_session_id,
    p_source: source,
  });

  if (error) throw error;
  return data;
}

export async function fetchOrderKpis({
  q = "",
  status = "",
  dateFrom = "",
  dateTo = "",
  reviewStatus = "",
  platform = "",
} = {}) {
  const platformVal = String(platform || "").trim().toLowerCase();
  const usePlatformScopedKpis = platformVal && platformVal !== "all";

  if (!usePlatformScopedKpis) {
    const { data, error } = await supabase.rpc("rpc_order_kpis", {
      p_q: (q || "").trim() || null,
      p_status: (status || "").trim() || null,
      p_date_from: (dateFrom || "").trim() || null,
      p_date_to: (dateTo || "").trim() || null,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const baseKpis = row || {
      orders_count: 0,
      revenue_cents: 0,
      profit_cents: 0,
      unfulfilled_count: 0,
      refunded_count: 0,
      refunded_cents: 0,
    };

    let profitQ = supabase
      .from(SUMMARY)
      .select("profit_cents")
      .order("order_date", { ascending: false })
      .limit(500);

    const ctx = await resolveListFilterContext({ q, status, dateFrom, dateTo, reviewStatus });
    if (ctx.empty) return { ...baseKpis, profit_cents: 0 };

    profitQ = applyListFilters(
      profitQ,
      { dateFrom, dateTo, platform: "" },
      ctx,
    );

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

  const ctx = await resolveListFilterContext({ q, status, dateFrom, dateTo, reviewStatus });
  if (ctx.empty) {
    return {
      orders_count: 0,
      revenue_cents: 0,
      profit_cents: 0,
      unfulfilled_count: 0,
      refunded_count: 0,
      refunded_cents: 0,
    };
  }

  let kpiQ = supabase
    .from(SUMMARY)
    .select(
      "total_paid_cents, refund_amount_cents, refund_status, profit_cents, label_status",
    )
    .order("order_date", { ascending: false })
    .limit(10000);

  kpiQ = applyListFilters(kpiQ, { dateFrom, dateTo, platform: platformVal }, ctx);

  let countQ = supabase.from(SUMMARY).select("*", { count: "exact", head: true });
  countQ = applyListFilters(countQ, { dateFrom, dateTo, platform: platformVal }, ctx);

  const [{ data: kpiRows, error: kpiErr }, { count, error: countErr }] = await Promise.all([
    kpiQ,
    countQ,
  ]);
  if (kpiErr) throw kpiErr;
  if (countErr) throw countErr;

  let revenueCents = 0;
  let profitCents = 0;
  let unfulfilledCount = 0;
  let refundedCount = 0;
  let refundedCents = 0;

  for (const r of kpiRows || []) {
    revenueCents +=
      Number(r.total_paid_cents || 0) - Number(r.refund_amount_cents || 0);
    profitCents += Number(r.profit_cents || 0);
    if ((r.label_status || "pending") === "pending") unfulfilledCount += 1;
    if (r.refund_status) {
      refundedCount += 1;
      refundedCents += Number(r.refund_amount_cents || 0);
    }
  }

  return {
    orders_count: Number(count ?? (kpiRows || []).length),
    revenue_cents: revenueCents,
    profit_cents: profitCents,
    unfulfilled_count: unfulfilledCount,
    refunded_count: refundedCount,
    refunded_cents: refundedCents,
  };
}

/**
 * Issue a refund via the stripe-refund edge function.
 * @param {string} stripe_checkout_session_id
 * @param {number|null} amount_cents - null for full refund
 */
export async function updateRefundReason(stripe_checkout_session_id, refund_reason) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");
  const { error } = await supabase
    .from("orders_raw")
    .update({ refund_reason, updated_at: new Date().toISOString() })
    .eq("stripe_checkout_session_id", stripe_checkout_session_id);
  if (error) throw new Error(error.message);
}

export async function fetchPackagePresets() {
  const { data, error } = await supabase
    .from("package_presets")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function invokeEdgeFunction(functionName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok || result.error) {
    const err = new Error(result.error || result.detail || `${functionName} failed (${res.status})`);
    if (result.address_validation) err.addressValidation = result.address_validation;
    if (result.detail) err.detail = result.detail;
    throw err;
  }
  return result;
}

export async function updateOrderShippingAddress(stripe_checkout_session_id, address) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");
  return invokeEdgeFunction("update-order-shipping-address", {
    stripe_checkout_session_id,
    ...address,
  });
}

export async function validateOrderShippingAddress(stripe_checkout_session_id) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");
  return invokeEdgeFunction("shippo-validate-address", { stripe_checkout_session_id });
}

export async function buyShippingLabel(stripe_checkout_session_id, preset_id = null) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");

  const body = { stripe_checkout_session_id };
  if (preset_id) body.preset_id = preset_id;

  return invokeEdgeFunction("shippo-create-label", body);
}

export async function voidShippingLabel(stripe_checkout_session_id) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/shippo-void-label`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ stripe_checkout_session_id }),
  });

  const result = await res.json();
  if (!res.ok || result.error) {
    throw new Error(result.error || `Void failed (${res.status})`);
  }
  return result;
}

export async function confirmAmazonShipment(stripe_checkout_session_id) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/amazon-confirm-shipment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ stripe_checkout_session_id }),
  });

  const result = await res.json();
  if (!res.ok || !result.ok) {
    throw new Error(result.error || `Amazon shipment confirm failed (${res.status})`);
  }
  return result;
}

export async function getSignedLabelUrl(storagePath) {
  if (!storagePath) throw new Error("No label path");
  const { data, error } = await supabase.storage
    .from("labels")
    .createSignedUrl(storagePath, 300); // 5 min expiry
  if (error) throw error;
  return data.signedUrl;
}

export async function issueRefund(stripe_checkout_session_id, amount_cents = null, refund_reason = null) {
  if (!stripe_checkout_session_id) throw new Error("Missing session ID");

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const body = { stripe_checkout_session_id };
  if (amount_cents != null) body.amount_cents = amount_cents;
  if (refund_reason) body.refund_reason = refund_reason;

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

/**
 * Record a CTA label print event in cta_label_prints.
 * Phase 2C: lightweight insert-only analytics — never throws; returns ok/error.
 *
 * Caller (ctaPrintFlow.js) is responsible for treating failures as non-blocking
 * and showing only a secondary status message.
 *
 * @param {object} params
 * @param {string} params.sessionId    - stripe_checkout_session_id
 * @param {string|null} params.kkOrderId - kk_order_id (null for marketplace orders)
 * @param {string} params.orderSource  - 'kk' | 'ebay' | 'amazon'
 * @param {string} params.labelType    - 'review_cta' | 'channel_cta'
 * @param {object} [params.metadata]  - optional extra data (e.g. qr_target)
 * @returns {Promise<{ ok: true, id: string|null } | { ok: false, error: string }>}
 */
export async function trackCtaLabelPrint({ sessionId, kkOrderId, orderSource, labelType, metadata = {} }) {
  if (!sessionId || !orderSource || !labelType) {
    return { ok: false, error: "trackCtaLabelPrint: missing required fields" };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/track-cta-label-print`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
        "apikey":        SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        session_id:   sessionId,
        kk_order_id:  kkOrderId || null,
        order_source: orderSource,
        label_type:   labelType,
        metadata,
      }),
    });

    const result = await res.json();
    if (!res.ok || !result.ok) {
      return { ok: false, error: result.error || `Edge Function failed (${res.status})` };
    }
    return { ok: true, id: result.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Call the create-cta-label-link Edge Function to generate a tracking token
 * and insert a row into cta_label_links (service-role, token generated server-side).
 *
 * @param {object} params
 * @param {string|null} params.printId      - id from cta_label_prints (may be null)
 * @param {string}      params.sessionId    - stripe_checkout_session_id
 * @param {string|null} params.kkOrderId    - kk_order_id (null for marketplace orders)
 * @param {string}      params.orderSource  - 'kk' | 'ebay' | 'amazon'
 * @param {string}      params.labelType    - 'review_cta' | 'channel_cta'
 * @param {string}      params.destinationUrl - full final destination URL
 * @param {object}      [params.metadata]   - optional extra metadata
 * @returns {Promise<{ ok: true, token: string, trackingUrl: string } | { ok: false, error: string }>}
 */
export async function createCtaLabelLink({ printId, sessionId, kkOrderId, orderSource, labelType, destinationUrl, metadata = {} }) {
  if (!sessionId || !orderSource || !labelType || !destinationUrl) {
    return { ok: false, error: "createCtaLabelLink: missing required fields" };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-cta-label-link`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
        "apikey":        SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        print_id:        printId || null,
        session_id:      sessionId,
        kk_order_id:     kkOrderId || null,
        order_source:    orderSource,
        label_type:      labelType,
        destination_url: destinationUrl,
        metadata,
      }),
    });

    const result = await res.json();
    if (!res.ok || !result.ok) {
      return { ok: false, error: result.error || `Edge Function failed (${res.status})` };
    }
    return { ok: true, token: result.token, trackingUrl: result.tracking_url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

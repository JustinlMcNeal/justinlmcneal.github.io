// Amazon Orders API sync — fetch orders/items and map to orders_raw / line_items_raw.

import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";
import { createRestrictedDataToken, parsePayload, spApiGet } from "./amazonSpApiRequestUtils.ts";
import { upsertAmazonCancelObservations } from "./marketplaceObservationSync.ts";

export type ServiceClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      in: (col: string, vals: string[]) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
    upsert: (
      rows: unknown,
      opts: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

type SpApiGetResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; httpStatus?: number; hint?: string };

type ProductRow = { code: string; name: string; weight_g: number | null; unit_cost: number | null };

export type AmazonOrderSyncStats = {
  fetched: number;
  synced: number;
  skipped: number;
  canceledRetained: number;
  matched: number;
  unmatched: number;
  unmappedSkus: string[];
  addressesEnriched: number;
  buyerInfoEnriched: number;
  piiEnrichErrors: string[];
};

const ORDER_PII_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone_number",
  "street_address",
] as const;

/** Legacy SKU map — keep in sync with js/admin/lineItemsOrders/amazonImport.js */
const LEGACY_SKU_MAP: Record<string, string> = {
  "B4-322V-67TS": "KK-0013",
  "WJ-8PFO-2XHO": "KK-0059",
  "39-SL7O-N5GV": "KK-0059",
};

const PACKAGING_WEIGHT_G = 30;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function moneyToCents(value: unknown): number {
  const rec = asRecord(value);
  const amount = rec?.Amount ?? rec?.amount;
  if (amount == null) return 0;
  const n = parseFloat(String(amount));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function extractVariant(productName: string | null | undefined): string | null {
  const m = productName?.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : null;
}

function estimateLabelCostCents(totalItemWeightG: number): number {
  const packageOz = (totalItemWeightG + PACKAGING_WEIGHT_G) / 28.35;
  if (packageOz <= 4) return 400;
  if (packageOz <= 8) return 485;
  if (packageOz <= 13) return 530;
  if (packageOz <= 16) return 580;
  return 650 + Math.ceil((packageOz - 16) / 4) * 40;
}

function resolveLabelStatus(order: Record<string, unknown>): string {
  const status = String(order.OrderStatus || "").toLowerCase();
  if (status === "canceled" || status === "cancelled") return "cancelled";
  const channel = String(order.FulfillmentChannel || "").toUpperCase();
  if (channel === "AFN") return "shipped";
  if (status === "shipped" || status === "partiallyshipped") return "shipped";
  return "pending";
}

function buildOrdersUrl(
  endpoint: string,
  marketplaceIds: string[],
  createdAfter: string,
  nextToken?: string | null,
): string {
  const query = new URLSearchParams({
    MarketplaceIds: marketplaceIds.join(","),
    CreatedAfter: createdAfter,
  });
  if (nextToken?.trim()) query.set("NextToken", nextToken.trim());
  const base = endpoint.replace(/\/$/, "");
  return `${base}/orders/v0/orders?${query.toString()}`;
}

function buildOrderItemsUrl(endpoint: string, amazonOrderId: string): string {
  const base = endpoint.replace(/\/$/, "");
  return `${base}/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/orderItems`;
}

export async function fetchAmazonOrdersSince(
  creds: AmazonCredentials,
  marketplaceIds: string[],
  createdAfter: string,
): Promise<{ ok: true; orders: Record<string, unknown>[] } | { ok: false; error: string; hint?: string }> {
  const orders: Record<string, unknown>[] = [];
  let nextToken: string | null = null;

  while (true) {
    const url = buildOrdersUrl(creds.endpoint, marketplaceIds, createdAfter, nextToken);
    const result = await spApiGet(url, creds.accessToken, creds.aws);
    if (!result.ok) return result;

    const payload = parsePayload(result.data);
    const pageOrders = asArray(payload?.Orders)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    orders.push(...pageOrders);

    nextToken = typeof payload?.NextToken === "string" ? payload.NextToken : null;
    if (!nextToken) break;
    await sleep(1100);
  }

  return { ok: true, orders };
}

export async function fetchAmazonOrderItems(
  creds: AmazonCredentials,
  amazonOrderId: string,
): Promise<{ ok: true; items: Record<string, unknown>[] } | { ok: false; error: string; hint?: string }> {
  const url = buildOrderItemsUrl(creds.endpoint, amazonOrderId);
  const result = await spApiGet(url, creds.accessToken, creds.aws);
  if (!result.ok) return result;

  const payload = parsePayload(result.data);
  const items = asArray(payload?.OrderItems)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  return { ok: true, items };
}

export async function loadSkuToKkCodeMap(
  // deno-lint-ignore no-explicit-any
  client: any,
): Promise<Map<string, string>> {
  const map = new Map<string, string>(Object.entries(LEGACY_SKU_MAP));

  const { data: mappings, error: mapErr } = await client
    .from("amazon_listing_mappings")
    .select("kk_sku, amazon_listing_id")
    .eq("mapping_status", "mapped")
    .not("kk_sku", "is", null);

  if (mapErr) {
    console.warn("[amazon-order-sync] sku map query failed:", mapErr.message);
    return map;
  }

  const listingIds = [...new Set((mappings || []).map((m: { amazon_listing_id: string }) => m.amazon_listing_id).filter(Boolean))];
  if (!listingIds.length) return map;

  const { data: listings, error: listingsErr } = await client
    .from("amazon_listings")
    .select("id, seller_sku")
    .in("id", listingIds);

  if (listingsErr) {
    console.warn("[amazon-order-sync] listings query failed:", listingsErr.message);
    return map;
  }

  const skuByListingId = new Map<string, string>();
  for (const row of listings || []) {
    skuByListingId.set(String(row.id), String(row.seller_sku || "").trim());
  }

  for (const row of mappings || []) {
    const sellerSku = skuByListingId.get(String(row.amazon_listing_id)) || "";
    const kkSku = typeof row.kk_sku === "string" ? row.kk_sku.trim() : "";
    if (sellerSku && kkSku) map.set(sellerSku, kkSku);
  }

  return map;
}

export async function loadProductsMap(
  // deno-lint-ignore no-explicit-any
  client: any,
): Promise<Map<string, ProductRow>> {
  const { data, error } = await client.from("products").select("code, name, weight_g, unit_cost");
  const out = new Map<string, ProductRow>();
  if (error) {
    console.warn("[amazon-order-sync] products query failed:", error.message);
    return out;
  }
  for (const row of data || []) {
    out.set(String(row.code), row as ProductRow);
  }
  return out;
}

function buildOrderRows(
  order: Record<string, unknown>,
  items: Record<string, unknown>[],
  skuMap: Map<string, string>,
  products: Map<string, ProductRow>,
  stats: AmazonOrderSyncStats,
): {
  orderRow: Record<string, unknown>;
  lineItemRows: Record<string, unknown>[];
  shipmentRow: Record<string, unknown>;
  isCanceled: boolean;
} | null {
  const amazonOrderId = String(order.AmazonOrderId || "").trim();
  if (!amazonOrderId) return null;

  const orderStatus = String(order.OrderStatus || "").toLowerCase();
  const isCanceled = orderStatus === "canceled" || orderStatus === "cancelled";

  const sessionId = `amazon_${amazonOrderId}`;
  const shortId = amazonOrderId.split("-").pop() || amazonOrderId;
  const kkOrderId = `AMZ-${shortId}`;
  const purchaseDate = String(order.PurchaseDate || new Date().toISOString());
  const shipAddr = asRecord(order.ShippingAddress);

  let orderSubtotalCents = 0;
  let orderTaxCents = 0;
  let orderShipCents = 0;
  let orderShipTaxCents = 0;
  let totalQty = 0;
  let totalWeightG = 0;
  let orderCostCents = 0;

  const lineItemRows: Record<string, unknown>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const sellerSku = String(item.SellerSKU || item.sellerSKU || "").trim();
    const kkCode = skuMap.get(sellerSku) || null;
    const product = kkCode ? products.get(kkCode) : undefined;

    if (sellerSku && !kkCode) stats.unmappedSkus.push(sellerSku);
    if (kkCode) stats.matched++;
    else stats.unmatched++;

    const qty = Number(item.QuantityOrdered ?? item.quantityOrdered ?? 1) || 1;
    const title = String(item.Title || item.title || sellerSku || "Amazon item");
    const itemPriceCents = moneyToCents(item.ItemPrice ?? item.itemPrice);
    const itemTaxCents = moneyToCents(item.ItemTax ?? item.itemTax);
    const shipPriceCents = moneyToCents(item.ShippingPrice ?? item.shippingPrice);
    const shipTaxCents = moneyToCents(item.ShippingTax ?? item.shippingTax);
    const unitPriceCents = qty > 0 ? Math.round(itemPriceCents / qty) : itemPriceCents;
    const weightG = product?.weight_g ?? null;
    const variant = extractVariant(title);

    orderSubtotalCents += itemPriceCents;
    orderTaxCents += itemTaxCents;
    orderShipCents += shipPriceCents;
    orderShipTaxCents += shipTaxCents;
    totalQty += qty;
    if (weightG) totalWeightG += weightG * qty;
    if (product?.unit_cost) orderCostCents += Math.round(product.unit_cost * 100) * qty;

    const lineItemId = String(item.OrderItemId || item.orderItemId || i);
    lineItemRows.push({
      stripe_checkout_session_id: sessionId,
      stripe_line_item_id: `amazon_${amazonOrderId}_li_${lineItemId}`,
      order_date: purchaseDate,
      product_id: kkCode || sellerSku || `unknown_${i}`,
      product_name: product?.name || title,
      variant,
      quantity: qty,
      unit_price_cents: unitPriceCents,
      post_discount_unit_price_cents: unitPriceCents,
      item_weight_g: weightG,
    });
  }

  const orderTotalCents = moneyToCents(order.OrderTotal ?? order.orderTotal);
  const totalPaidCents = orderTotalCents > 0
    ? orderTotalCents
    : orderSubtotalCents + orderTaxCents + orderShipCents + orderShipTaxCents;

  const labelStatus = resolveLabelStatus(order);
  const isShipped = labelStatus === "shipped";
  const fulfillmentChannel = String(order.FulfillmentChannel || "").toUpperCase();

  const orderRow: Record<string, unknown> = {
    stripe_checkout_session_id: sessionId,
    kk_order_id: kkOrderId,
    order_date: purchaseDate,
    total_items: totalQty,
    subtotal_original_cents: orderSubtotalCents,
    subtotal_paid_cents: orderSubtotalCents,
    tax_cents: orderTaxCents,
    shipping_paid_cents: orderShipCents + orderShipTaxCents,
    total_paid_cents: totalPaidCents,
    total_weight_g: totalWeightG || 0,
    order_savings_total_cents: 0,
    order_savings_code_cents: 0,
    order_savings_auto_cents: 0,
    coupon_code_used: null,
    first_name: null,
    last_name: null,
    email: null,
    phone_number: null,
    street_address: null,
    city: shipAddr?.City ? String(shipAddr.City) : null,
    state: shipAddr?.StateOrRegion ? String(shipAddr.StateOrRegion) : null,
    zip: shipAddr?.PostalCode ? String(shipAddr.PostalCode) : null,
    country: shipAddr?.CountryCode ? String(shipAddr.CountryCode) : null,
    stripe_customer_id: null,
    order_cost_total_cents: orderCostCents || null,
  };

  const shipmentRow: Record<string, unknown> = {
    stripe_checkout_session_id: sessionId,
    kk_order_id: kkOrderId,
    label_status: isCanceled ? "cancelled" : labelStatus,
    carrier: fulfillmentChannel === "AFN" ? "Amazon" : null,
    service: fulfillmentChannel === "AFN" ? "Fulfilled by Amazon" : null,
    tracking_number: null,
    shipped_at: isCanceled
      ? null
      : isShipped
        ? (order.LatestShipDate ? String(order.LatestShipDate) : purchaseDate)
        : null,
    label_cost_cents: isCanceled ? 0 : (isShipped && totalWeightG ? estimateLabelCostCents(totalWeightG) : 0),
    notes: isCanceled
      ? `Amazon order canceled (${String(order.OrderStatus || "Canceled")}) — observational retention only`
      : `Synced from Amazon Orders API (${String(order.OrderStatus || "unknown")})`,
  };

  if (isCanceled) {
    stats.canceledRetained = (stats.canceledRetained ?? 0) + 1;
  } else {
    stats.synced++;
  }
  return { orderRow, lineItemRows, shipmentRow, isCanceled };
}

function stripNullPiiFields(orderRow: Record<string, unknown>): Record<string, unknown> {
  const row = { ...orderRow };
  for (const key of ORDER_PII_FIELDS) {
    if (row[key] == null) delete row[key];
  }
  return row;
}

type EnrichResult = { ok: true } | { ok: false; error: string };

export async function enrichAmazonOrderAddress(
  // deno-lint-ignore no-explicit-any
  client: any,
  creds: AmazonCredentials,
  amazonOrderId: string,
  sessionId: string,
): Promise<EnrichResult> {
  const rdt = await createRestrictedDataToken(creds, [{
    method: "GET",
    path: `/orders/v0/orders/${amazonOrderId}/address`,
    dataElements: ["shippingAddress"],
  }]);
  if (!rdt.ok) {
    console.warn(`[amazon-order-sync] RDT failed for ${amazonOrderId}:`, rdt.error);
    return { ok: false, error: rdt.error };
  }

  const base = creds.endpoint.replace(/\/$/, "");
  const url = `${base}/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/address`;
  const result = await spApiGet(url, rdt.token, creds.aws);
  if (!result.ok) {
    console.warn(`[amazon-order-sync] address fetch failed for ${amazonOrderId}:`, result.error);
    return { ok: false, error: result.error };
  }

  const payload = parsePayload(result.data);
  const addr = asRecord(payload.ShippingAddress) ?? asRecord(payload.shippingAddress);
  if (!addr) return { ok: false, error: "shipping_address_empty" };

  const fullName = String(addr.Name || addr.name || "").trim();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const patch = {
    first_name: nameParts[0] || null,
    last_name: nameParts.slice(1).join(" ") || null,
    street_address: [
      String(addr.AddressLine1 || addr.addressLine1 || "").trim(),
      String(addr.AddressLine2 || addr.addressLine2 || "").trim(),
    ].filter(Boolean).join(", ") || null,
    city: String(addr.City || addr.city || "").trim() || null,
    state: String(addr.StateOrRegion || addr.stateOrRegion || "").trim() || null,
    zip: String(addr.PostalCode || addr.postalCode || "").trim() || null,
    country: String(addr.CountryCode || addr.countryCode || "").trim() || null,
    phone_number: String(addr.Phone || addr.phone || "").trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client
    .from("orders_raw")
    .update(patch)
    .eq("stripe_checkout_session_id", sessionId);

  if (error) {
    console.warn(`[amazon-order-sync] address update failed for ${amazonOrderId}:`, error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/** Amazon proxy buyer email (marketplace.amazon.com) — not the buyer's personal email. */
export async function enrichAmazonOrderBuyerInfo(
  // deno-lint-ignore no-explicit-any
  client: any,
  creds: AmazonCredentials,
  amazonOrderId: string,
  sessionId: string,
): Promise<EnrichResult> {
  const rdt = await createRestrictedDataToken(creds, [{
    method: "GET",
    path: `/orders/v0/orders/${amazonOrderId}`,
    dataElements: ["buyerInfo"],
  }]);
  if (!rdt.ok) {
    console.warn(`[amazon-order-sync] buyer RDT failed for ${amazonOrderId}:`, rdt.error);
    return { ok: false, error: rdt.error };
  }

  const base = creds.endpoint.replace(/\/$/, "");
  const url = `${base}/orders/v0/orders/${encodeURIComponent(amazonOrderId)}`;
  const result = await spApiGet(url, rdt.token, creds.aws);
  if (!result.ok) {
    console.warn(`[amazon-order-sync] buyer fetch failed for ${amazonOrderId}:`, result.error);
    return { ok: false, error: result.error };
  }

  const payload = parsePayload(result.data);
  const order = asRecord(payload) ?? asRecord(payload.Order);
  const buyerInfo = asRecord(order?.BuyerInfo) ?? asRecord(order?.buyerInfo);
  const buyerEmail = String(buyerInfo?.BuyerEmail || buyerInfo?.buyerEmail || "").trim();
  const buyerName = String(buyerInfo?.BuyerName || buyerInfo?.buyerName || "").trim();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (buyerEmail) patch.email = buyerEmail;
  if (buyerName) {
    const nameParts = buyerName.split(/\s+/).filter(Boolean);
    patch.first_name = nameParts[0] || null;
    patch.last_name = nameParts.slice(1).join(" ") || null;
  }

  if (!patch.email && !patch.first_name) {
    return { ok: false, error: "buyer_info_empty" };
  }

  const { error } = await client
    .from("orders_raw")
    .update(patch)
    .eq("stripe_checkout_session_id", sessionId);

  if (error) {
    console.warn(`[amazon-order-sync] buyer update failed for ${amazonOrderId}:`, error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function syncAmazonOrdersToDb(
  // deno-lint-ignore no-explicit-any
  client: any,
  creds: AmazonCredentials,
  marketplaceIds: string[],
  daysBack: number,
): Promise<
  | { ok: true; stats: AmazonOrderSyncStats }
  | { ok: false; error: string; hint?: string }
> {
  const createdAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const stats: AmazonOrderSyncStats = {
    fetched: 0,
    synced: 0,
    skipped: 0,
    canceledRetained: 0,
    matched: 0,
    unmatched: 0,
    unmappedSkus: [],
    addressesEnriched: 0,
    buyerInfoEnriched: 0,
    piiEnrichErrors: [],
  };

  const ordersResult = await fetchAmazonOrdersSince(creds, marketplaceIds, createdAfter);
  if (!ordersResult.ok) return ordersResult;

  stats.fetched = ordersResult.orders.length;
  if (!ordersResult.orders.length) {
    return { ok: true, stats };
  }

  const skuMap = await loadSkuToKkCodeMap(client);
  const products = await loadProductsMap(client);

  for (const order of ordersResult.orders) {
    const amazonOrderId = String(order.AmazonOrderId || "").trim();
    if (!amazonOrderId) continue;

    const itemsResult = await fetchAmazonOrderItems(creds, amazonOrderId);
    if (!itemsResult.ok) {
      console.warn(`[amazon-order-sync] order items failed for ${amazonOrderId}:`, itemsResult.error);
      stats.skipped++;
      continue;
    }
    if (!itemsResult.items.length) {
      stats.skipped++;
      continue;
    }

    const built = buildOrderRows(order, itemsResult.items, skuMap, products, stats);
    if (!built) continue;

    const sessionId = String(built.orderRow.stripe_checkout_session_id);
    const orderRowForUpsert = stripNullPiiFields(built.orderRow);

    const { error: orderErr } = await client
      .from("orders_raw")
      .upsert(orderRowForUpsert, { onConflict: "stripe_checkout_session_id" });
    if (orderErr) {
      console.warn(`[amazon-order-sync] order upsert failed ${amazonOrderId}:`, orderErr.message);
      if (built.isCanceled) {
        stats.canceledRetained = Math.max(0, stats.canceledRetained - 1);
      } else {
        stats.synced--;
      }
      stats.skipped++;
      continue;
    }

    if (built.lineItemRows.length) {
      const { error: lineErr } = await client
        .from("line_items_raw")
        .upsert(built.lineItemRows, { onConflict: "stripe_checkout_session_id,stripe_line_item_id" });
      if (lineErr) {
        console.warn(`[amazon-order-sync] line items upsert failed ${amazonOrderId}:`, lineErr.message);
      }
    }

    const { error: shipErr } = await client
      .from("fulfillment_shipments")
      .upsert(built.shipmentRow, { onConflict: "stripe_checkout_session_id" });
    if (shipErr) {
      console.warn(`[amazon-order-sync] shipment upsert failed ${amazonOrderId}:`, shipErr.message);
    }

    const fulfillmentChannel = String(order.FulfillmentChannel || "").toUpperCase();

    if (built.isCanceled) {
      await upsertAmazonCancelObservations(client, {
        sourceOrderId: sessionId,
        isAfn: fulfillmentChannel === "AFN",
        observedAt: String(built.orderRow.order_date || new Date().toISOString()),
        orderPayload: { order, items: itemsResult.items },
        lineItemRows: built.lineItemRows.map((row) => ({
          stripe_line_item_id: String(row.stripe_line_item_id),
        })),
      });
      continue;
    }

    const isMerchantFulfilled = fulfillmentChannel !== "AFN";

    if (isMerchantFulfilled) {
      const { data: existing } = await client
        .from("orders_raw")
        .select("first_name, street_address, email")
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();

      const needsAddress = !existing?.street_address || !existing?.first_name;
      const needsBuyer = !existing?.email;

      if (needsAddress) {
        const addrResult = await enrichAmazonOrderAddress(
          client,
          creds,
          amazonOrderId,
          sessionId,
        );
        if (addrResult.ok) stats.addressesEnriched++;
        else stats.piiEnrichErrors.push(`${amazonOrderId} address: ${addrResult.error}`);
        await sleep(1100);
      }

      if (needsBuyer) {
        const buyerResult = await enrichAmazonOrderBuyerInfo(
          client,
          creds,
          amazonOrderId,
          sessionId,
        );
        if (buyerResult.ok) stats.buyerInfoEnriched++;
        else if (buyerResult.error !== "buyer_info_empty") {
          stats.piiEnrichErrors.push(`${amazonOrderId} buyer: ${buyerResult.error}`);
        }
        await sleep(1100);
      }
    }

    await sleep(1100);
  }

  stats.unmappedSkus = [...new Set(stats.unmappedSkus.filter(Boolean))];
  stats.piiEnrichErrors = stats.piiEnrichErrors.slice(0, 5);
  return { ok: true, stats };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**

 * Deep links from Inventory admin to Line Items / Orders (Phase 6B+).

 */



export const LINE_ITEMS_ORDERS_PAGE = "/pages/admin/lineItemsOrders.html";



/** Order lines needing variant mapping before future reservation. */

export const UNMAPPED_ORDER_LINES_URL = LINE_ITEMS_ORDERS_PAGE;



/** @typedef {{ sessionId: string, lineId: string|null, channel: string|null, tab: string, q: string }} LineItemsDeepLinkParams */



const VALID_TABS = new Set(["overview", "fulfillment", "financials", "labels", "ids"]);



/**

 * Infer channel slug from a source order id prefix.

 * @param {string|null|undefined} orderId

 * @returns {"ebay"|"amazon"|"kk"|null}

 */

export function channelFromOrderId(orderId) {

  if (!orderId) return null;

  if (orderId.startsWith("ebay_")) return "ebay";

  if (orderId.startsWith("amazon_")) return "amazon";

  return "kk";

}



/**

 * Parse Line Items Orders deep-link params from URL search params.

 * @param {URLSearchParams|string} searchParams

 * @returns {LineItemsDeepLinkParams|null}

 */

export function parseLineItemsDeepLinkParams(searchParams) {

  const sp =

    searchParams instanceof URLSearchParams

      ? searchParams

      : new URLSearchParams(String(searchParams || ""));

  const sessionId = (sp.get("session_id") || sp.get("order_id") || "").trim();

  if (!sessionId) return null;



  const rawTab = (sp.get("tab") || "").trim().toLowerCase();

  const tab = VALID_TABS.has(rawTab) ? rawTab : "overview";

  const lineId = (sp.get("line_id") || "").trim() || null;

  const channel = (sp.get("channel") || channelFromOrderId(sessionId) || "").trim().toLowerCase() || null;

  const q = (sp.get("q") || sessionId).trim();



  return { sessionId, lineId, channel, tab, q };

}



/**

 * Build Line Items Orders URL with optional deep-link params (Phase 9A + 10I).

 * @param {Object} [opts]

 * @param {string} [opts.sessionId] Stripe/eBay/Amazon session id

 * @param {string} [opts.orderId] Alias for sessionId

 * @param {string} [opts.lineId] Line item id — workspace scrolls + highlights on Overview

 * @param {string} [opts.channel] ebay | amazon | kk (hint when multiple matches)

 * @param {string} [opts.tab] overview | fulfillment | financials | labels | ids

 */

export function buildLineItemsOrdersUrl(opts = {}) {

  const params = new URLSearchParams();

  const sessionId = opts.sessionId || opts.orderId;

  if (sessionId) {

    params.set("session_id", sessionId);

    params.set("q", sessionId);

  }

  if (opts.lineId) params.set("line_id", opts.lineId);

  const channel = opts.channel || channelFromOrderId(sessionId);

  if (channel) params.set("channel", channel);

  if (opts.tab) params.set("tab", opts.tab);

  const qs = params.toString();

  return qs ? `${LINE_ITEMS_ORDERS_PAGE}?${qs}` : LINE_ITEMS_ORDERS_PAGE;

}



/**

 * Human-readable order reference for clipboard copy.

 * @param {Object} [opts]

 * @param {string} [opts.sessionId]

 * @param {string} [opts.orderId]

 * @param {string} [opts.lineId]

 * @param {string} [opts.channel]

 */

export function buildOrderReferenceLabel(opts = {}) {

  const sessionId = opts.sessionId || opts.orderId || "";

  const channel = opts.channel || channelFromOrderId(sessionId) || "";

  const parts = [];

  if (channel) parts.push(channel);

  if (sessionId) {

    parts.push(sessionId.length > 28 ? `${sessionId.slice(0, 14)}…${sessionId.slice(-10)}` : sessionId);

  }

  if (opts.lineId) {

    const lid = String(opts.lineId);

    parts.push(`line:${lid.length > 20 ? `${lid.slice(0, 10)}…` : lid}`);

  }

  return parts.join(" · ") || "order";

}



/**

 * Inventory admin page URL with optional search hint (Phase 10I evidence links).

 * @param {Object} [opts]

 * @param {string} [opts.q] SKU or product search hint

 */

export function buildInventoryPageUrl(opts = {}) {

  const params = new URLSearchParams();

  if (opts.q) params.set("q", opts.q);

  const qs = params.toString();

  return qs ? `/pages/admin/inventory.html?${qs}` : "/pages/admin/inventory.html";

}



export { VALID_TABS as LINE_ITEMS_VALID_TABS };



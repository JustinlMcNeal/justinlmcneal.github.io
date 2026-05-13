/**
 * salesHistory.js — Phase 4: Read-only eBay sales drilldown modal.
 *
 * Opens a compact modal showing the last 10 eBay sales for a given product.
 * Uses v_ebay_product_recent_sales view (deployed in Phase 4 migration).
 *
 * ── Data source ───────────────────────────────────────────────────────────────
 *
 *   View: v_ebay_product_recent_sales
 *   Join: line_items_raw JOIN orders_raw (eBay-only filter, proven in Phase 1)
 *   Filter: eq("product_code", product.code)
 *   Order: sold_at DESC, LIMIT 10
 *
 * ── Fields used ───────────────────────────────────────────────────────────────
 *
 *   sold_at             — timestamptz, sale date
 *   kk_order_id         — text, internal admin order ref (e.g. EBAY-27-14595-12804)
 *   quantity            — integer
 *   unit_price_cents    — original listed price per unit
 *   sold_price_cents    — actual per-unit sold price (post-discount)
 *   line_total_cents    — quantity × sold_price_cents
 *   variant_title       — text | null
 *
 * ── Summary metrics ───────────────────────────────────────────────────────────
 *
 *   Displayed from product._ws (already loaded, no extra fetch needed):
 *   - sold_qty_30d
 *   - sold_qty_90d
 *   - last_sold_at
 *
 * ── Phase 4 exclusions ────────────────────────────────────────────────────────
 *
 *   refund_status  — excluded (adds complexity; can be added in a future phase)
 *   per-product profit/fees — order-level proration blocker still applies
 *   impressions/clicks/watchers — no data source
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { esc } from "./utils.js";

const supabase  = getSupabaseClient();
const MODAL_ID  = "salesModal";
const LIMIT     = 10;

// ── Date Helpers ───────────────────────────────────────────────────────────────

function fmtDate(dtStr) {
  if (!dtStr) return "—";
  const d = new Date(dtStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtRelative(dtStr) {
  if (!dtStr) return null;
  const diffMs = Date.now() - new Date(dtStr).getTime();
  const days   = Math.floor(diffMs / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30)  return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function fmtPrice(cents) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

// ── Data Fetcher ───────────────────────────────────────────────────────────────

async function fetchRecentSales(productCode) {
  return supabase
    .from("v_ebay_product_recent_sales")
    .select("sold_at, kk_order_id, quantity, unit_price_cents, sold_price_cents, line_total_cents, variant_title")
    .eq("product_code", productCode)
    .order("sold_at", { ascending: false })
    .limit(LIMIT);
}

// ── Render Sales Table ─────────────────────────────────────────────────────────

function renderSalesTable(containerEl, rows, product) {
  const status = product.ebay_status || "not_listed";

  if (!rows.length) {
    const endedNote = status === "ended"
      ? '<p class="text-[10px] text-amber-600 mt-1">This listing is ended — no eBay sales on record.</p>'
      : "";
    containerEl.innerHTML = `
      <div class="text-center py-6">
        <p class="text-xs text-gray-400">No eBay sales found for this product.</p>
        ${endedNote}
      </div>`;
    return;
  }

  // Detect whether variant column is useful
  const hasVariants = rows.some(r => r.variant_title);

  // Build table rows
  const tbodyHtml = rows.map(r => {
    const wasDiscounted = r.unit_price_cents != null
      && r.sold_price_cents !== r.unit_price_cents;

    const priceHtml = wasDiscounted
      ? `<span class="font-bold text-green-700">${fmtPrice(r.sold_price_cents)}</span> <span class="text-[9px] line-through text-gray-400">${fmtPrice(r.unit_price_cents)}</span>`
      : `<span class="font-bold">${fmtPrice(r.sold_price_cents)}</span>`;

    const lineHtml = r.quantity > 1
      ? `<span class="text-[9px] text-gray-400 ml-1">(${fmtPrice(r.line_total_cents)} total)</span>`
      : "";

    return `<tr class="border-b border-gray-100 hover:bg-gray-50">
      <td class="py-1.5 pr-2 text-xs whitespace-nowrap">${esc(fmtDate(r.sold_at))}</td>
      <td class="py-1.5 pr-2 text-xs text-center font-mono">${r.quantity}</td>
      <td class="py-1.5 pr-2 text-xs text-right">${priceHtml}${lineHtml}</td>
      ${hasVariants ? `<td class="py-1.5 pr-2 text-xs text-gray-500">${r.variant_title ? esc(r.variant_title) : "—"}</td>` : ""}
      <td class="py-1.5 text-[9px] font-mono text-gray-400 whitespace-nowrap">${r.kk_order_id ? esc(r.kk_order_id) : "—"}</td>
    </tr>`;
  }).join("");

  // Ended listing with actual sales — show helpful relist note
  const relistNote = status === "ended"
    ? '<p class="text-[10px] text-amber-600 mt-2 font-medium">This listing is ended but has prior sales — worth reviewing for relist.</p>'
    : "";

  containerEl.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b-2 border-gray-200 text-left">
            <th class="pb-1.5 pr-2 text-[9px] font-black uppercase tracking-wider text-gray-500">Date</th>
            <th class="pb-1.5 pr-2 text-[9px] font-black uppercase tracking-wider text-gray-500 text-center">Qty</th>
            <th class="pb-1.5 pr-2 text-[9px] font-black uppercase tracking-wider text-gray-500 text-right">Sold Price</th>
            ${hasVariants ? '<th class="pb-1.5 pr-2 text-[9px] font-black uppercase tracking-wider text-gray-500">Variant</th>' : ""}
            <th class="pb-1.5 text-[9px] font-black uppercase tracking-wider text-gray-500">Order Ref</th>
          </tr>
        </thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>
    ${relistNote}
    <p class="text-[9px] text-gray-400 mt-3">Last ${Math.min(rows.length, LIMIT)} eBay sales · eBay-imported orders only</p>`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Open the sales history modal for the given product.
 * Immediately shows summary from _ws, then async-fetches line-item detail.
 *
 * @param {object} product — row from allProducts (with _ws attached)
 */
export function openSalesHistory(product) {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;

  // Header fields
  const nameEl = document.getElementById("salesModalName");
  const codeEl = document.getElementById("salesModalCode");
  if (nameEl) nameEl.textContent = product.name;
  if (codeEl) codeEl.textContent = product.code;

  // Summary from _ws (no fetch needed — already loaded with products)
  const summaryEl = document.getElementById("salesModalSummary");
  if (summaryEl) {
    const ws     = product._ws;
    const sold30 = ws?.sold_qty_30d ?? 0;
    const sold90 = ws?.sold_qty_90d ?? 0;
    const ago    = ws?.last_sold_at ? fmtRelative(ws.last_sold_at) : null;
    const statusLabel = {
      active: "Active", draft: "Draft", ended: "Ended", not_listed: "Not Listed",
    }[product.ebay_status || "not_listed"];

    summaryEl.innerHTML = `
      <div class="flex flex-wrap gap-3 mb-4 py-2 px-3 bg-gray-50 rounded-lg text-xs items-center">
        <span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ebay-${product.ebay_status || "not_listed"}">${esc(statusLabel)}</span>
        <div class="text-gray-300">|</div>
        <div><span class="text-gray-500">30d</span> <span class="font-bold">${sold30} sold</span></div>
        <div class="text-gray-300">|</div>
        <div><span class="text-gray-500">90d</span> <span class="font-bold">${sold90} sold</span></div>
        ${ago ? `<div class="text-gray-300">|</div><div><span class="text-gray-500">Last</span> <span class="font-bold">${esc(ago)}</span></div>` : ""}
      </div>`;
  }

  // Loading state while fetch runs
  const bodyEl = document.getElementById("salesModalBody");
  if (bodyEl) {
    bodyEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-6">Loading sales history…</p>';
  }

  // Show modal
  modal.classList.remove("hidden");

  // Async fetch line-item detail
  fetchRecentSales(product.code).then(({ data, error }) => {
    if (!bodyEl) return;
    if (error) {
      bodyEl.innerHTML = `<p class="text-xs text-red-500 text-center py-4">Failed to load sales: ${esc(error.message)}</p>`;
      return;
    }
    renderSalesTable(bodyEl, data ?? [], product);
  });
}

/**
 * Close the sales history modal.
 */
export function closeSalesHistory() {
  document.getElementById(MODAL_ID)?.classList.add("hidden");
}

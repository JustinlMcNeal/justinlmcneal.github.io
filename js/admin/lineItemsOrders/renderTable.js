// /js/admin/lineItemsOrders/renderTable.js
import { esc, moneyFromCents, gramsToOz, formatOz, formatDateShort, getOrderSource } from "./dom.js";

/** Truncate long IDs for display; full value stays in title + data attr */
function truncateId(id, max = 16) {
  const s = String(id || "—");
  if (s.length <= max) return esc(s);
  return s.slice(0, max) + "…";
}

function isMobile() {
  return window.matchMedia("(max-width: 639px)").matches;
}

function statusPillClasses(labelStatus) {
  const s = String(labelStatus || "pending").toLowerCase();

  const base =
    "inline-flex items-center border-[3px] border-black px-2 py-1 " +
    "text-[10px] font-black uppercase tracking-[.18em] whitespace-nowrap";

  if (s === "shipped" || s === "delivered") return `${base} bg-black text-white`;
  if (s === "label_purchased" || s === "label-purchased") return `${base} bg-white text-black`;
  if (s === "cancelled" || s === "canceled") return `${base} bg-white text-black`;
  if (s === "error" || s === "failed") return `${base} bg-black text-white`;

  return `${base} bg-white text-black`;
}

function refundBadgeHtml(refund) {
  if (!refund?.refund_status) return "";
  const isFull = refund.refund_status === "full";

  // Reason-aware label
  const reason = refund.refund_reason;
  let label;
  if (!isFull) {
    label = "PARTIAL REFUND";
  } else if (reason === "cancelled_before_ship") {
    label = "CANCELLED";
  } else if (reason === "refunded_kept_item") {
    label = "REFUNDED · KEPT";
  } else if (reason === "returned") {
    label = "RETURNED";
  } else {
    label = "REFUNDED";
  }

  const amt = refund.refund_amount_cents
    ? ` $${(refund.refund_amount_cents / 100).toFixed(2)}`
    : "";

  const clsMap = {
    cancelled_before_ship: "bg-gray-600 text-white border-gray-700",
    refunded_kept_item: "bg-amber-500 text-white border-amber-600",
    returned: "bg-purple-600 text-white border-purple-700",
  };
  const cls = isFull
    ? (clsMap[reason] || "bg-red-600 text-white border-red-700")
    : "bg-amber-500 text-white border-amber-600";

  return `<span class="inline-flex items-center border-[3px] ${cls} px-2 py-1 text-[10px] font-black uppercase tracking-[.18em] whitespace-nowrap ml-1">${label}${amt}</span>`;
}

/** Phase 10P — marketplace observation badges (no Stripe refund yet). */
function marketplaceObsBadgeHtml(r) {
  if (r.refund?.refund_status) return "";
  const ms = r.marketplace_status;
  if (!ms) return "";

  const badges = [];
  const base =
    "inline-flex items-center border-[3px] px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1";

  if (ms.cancel_status === "observed" || ms.order_status === "canceled_observed") {
    badges.push(
      `<span class="${base} border-gray-600 bg-gray-100 text-gray-800" title="Marketplace cancel observed (guidance only)">CANCELED</span>`,
    );
  }
  if (ms.refund_status_derived === "observed" || ms.order_status === "refund_observed") {
    badges.push(
      `<span class="${base} border-red-500 bg-red-50 text-red-700" title="Marketplace refund observed (guidance only)">REFUND OBSERVED</span>`,
    );
  }
  if (ms.return_observation_status) {
    badges.push(
      `<span class="${base} border-purple-500 bg-purple-50 text-purple-700" title="Return observation — manual review">RETURN REVIEW</span>`,
    );
  }
  if (ms.is_afn_observed) {
    badges.push(
      `<span class="${base} border-blue-400 bg-blue-50 text-blue-700" title="Amazon Fulfilled Network (external fulfillment)">AFN EXTERNAL</span>`,
    );
  }

  return badges.join("");
}

function displayStatus(labelStatus) {
  return String(labelStatus || "pending").replaceAll("_", " ");
}

function formatTracking(trk) {
  const t = String(trk || "—").trim();
  return t.length ? t : "—";
}

function reviewBadgeHtml(reviewCount) {
  const n = Number(reviewCount || 0);
  if (n > 0) {
    return `<span class="inline-flex items-center gap-1 border-[3px] border-emerald-600 bg-emerald-50 text-emerald-700 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap" title="${n} review${n === 1 ? '' : 's'}">⭐ ${n}</span>`;
  }
  return `<span class="inline-flex items-center border-[3px] border-gray-200 bg-gray-50 text-gray-400 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap">No reviews</span>`;
}

/**
 * Badge shown on eBay order rows when Finance API data is not yet complete.
 * Returns empty string when data is complete (reliable profit shown as-is).
 */
function ebayFinanceBadgeHtml(r) {
  const ef = r.ebay_finance;
  if (!ef) return "";
  const status = ef.finance_status || "missing";
  if (status === "complete") return "";
  if (status === "estimated") {
    return `<span class="inline-flex items-center border-[3px] border-amber-400 bg-amber-50 text-amber-700 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1" title="eBay Promoted Listing fee not yet billed (1-2 day lag) — profit unknown until synced">≈ AD FEE PENDING</span>`;
  }
  if (status === "estimated_no_ad_fee") {
    return `<span class="inline-flex items-center border-[3px] border-amber-300 bg-amber-50 text-amber-600 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1" title="No promoted listing fee detected for this order — earnings based on SALE only">≈ EST</span>`;
  }
  if (status === "partial") {
    return `<span class="inline-flex items-center border-[3px] border-amber-400 bg-amber-50 text-amber-700 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1" title="eBay Finance API synced — Shippo label not yet purchased; label cost not subtracted">≈ PARTIAL</span>`;
  }
  if (status === "pending_finances") {
    return `<span class="inline-flex items-center border-[3px] border-blue-300 bg-blue-50 text-blue-700 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1" title="eBay Finance API transaction not yet synced (may take up to 1 day after sale)">🕐 PENDING</span>`;
  }
  // missing
  return `<span class="inline-flex items-center border-[3px] border-gray-300 bg-gray-50 text-gray-500 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1" title="eBay Finance data not available">? EBAY</span>`;
}

/**
 * For eBay orders: resolve the correct profit cents to display.
 * Uses Finance API earnings when available; falls back to view profit.
 * Returns null when profit is genuinely unknown (estimated status — ad fee pending).
 */
function resolveEbayProfit(r) {
  const ef = r.ebay_finance;
  if (!ef) return { cents: r.profit_cents, isEstimate: false };
  const status = ef.finance_status || "missing";
  // complete or estimated_no_ad_fee: Finance API earnings available, use ebay_net_profit_cents
  if ((status === "complete" || status === "estimated_no_ad_fee") && ef.ebay_net_profit_cents != null) {
    return { cents: ef.ebay_net_profit_cents, isEstimate: status === "estimated_no_ad_fee" };
  }
  // estimated: ad fee pending, profit unknown — show null (prevents overstating)
  if (status === "estimated") {
    return { cents: null, isEstimate: true };
  }
  // pending_finances or missing: Finance API not synced yet, fall back to view profit
  return { cents: r.profit_cents, isEstimate: false };
}

function amazonFinanceBadgeHtml(r) {
  const af = r.amazon_finance;
  if (!af) return "";
  const status = af.finance_status || "missing";
  if (status === "complete") return "";
  if (status === "partial") {
    return `<span class="inline-flex items-center border-[3px] border-amber-400 bg-amber-50 text-amber-700 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1" title="Amazon finances synced — Shippo label cost not yet subtracted">≈ PARTIAL</span>`;
  }
  if (status === "pending_finances") {
    return `<span class="inline-flex items-center border-[3px] border-blue-300 bg-blue-50 text-blue-700 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1" title="Label purchased — Amazon Finances not synced yet">🕐 PENDING</span>`;
  }
  return `<span class="inline-flex items-center border-[3px] border-gray-300 bg-gray-50 text-gray-500 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap ml-1" title="Amazon finance data not available">? AMZ</span>`;
}

function resolveAmazonProfit(r) {
  const af = r.amazon_finance;
  if (!af) return { cents: r.profit_cents, isEstimate: false };
  const status = af.finance_status || "missing";
  if ((status === "complete" || status === "partial") && af.amazon_net_profit_cents != null) {
    return { cents: af.amazon_net_profit_cents, isEstimate: status === "partial" };
  }
  return { cents: r.profit_cents, isEstimate: false };
}

function resolveChannelProfit(r) {
  const source = getOrderSource(r);
  if (source === "ebay") return resolveEbayProfit(r);
  if (source === "amazon") return resolveAmazonProfit(r);
  return { cents: r.profit_cents, isEstimate: false };
}

function channelFinanceBadgeHtml(r) {
  const source = getOrderSource(r);
  if (source === "ebay") return ebayFinanceBadgeHtml(r);
  if (source === "amazon") return amazonFinanceBadgeHtml(r);
  return "";
}

function mobileCardStatusAccent(labelStatus, refund) {
  if (refund?.refund_status) return 'border-l-red-500';
  switch (String(labelStatus || 'pending').toLowerCase()) {
    case 'pending':         return 'border-l-amber-400';
    case 'label_purchased': return 'border-l-blue-400';
    case 'shipped':         return 'border-l-blue-600';
    case 'delivered':       return 'border-l-emerald-500';
    case 'voided':
    case 'returned':        return 'border-l-gray-400';
    default:                return 'border-l-transparent';
  }
}

/* -------------------------
   ROW EXTRAS SEAM
   Normalises per-row injection objects supplied by render callers.
   All keys default to empty strings so the HTML is unchanged when no
   extras are provided.
-------------------------- */
function normalizeRowExtras(extras = {}) {
  return {
    desktopActionContent: extras.desktopActionContent || "",
    mobileActionBlock: extras.mobileActionBlock || "",
  };
}

/* -------------------------
   MOBILE RENDER (CARDS)
-------------------------- */
function renderMobileCards(rows = [], getRowExtras = () => ({})) {
  return rows
    .map((r, idx) => {
      const extras = normalizeRowExtras(getRowExtras(r, idx));
      const ship = r.shipment;

      const orderId = r.kk_order_id || "—";
      const date = formatDateShort(r.order_date);

      const customer =
        `${r.first_name || ""} ${r.last_name || ""}`.trim() || "—";

      const items = r.total_items ?? r.li_total_items ?? "—";

      const paid = moneyFromCents(r.total_paid_cents);
      const { cents: profitCents } = resolveChannelProfit(r);
      const profit = profitCents != null ? moneyFromCents(profitCents) : "—";
      const profitColor = profitCents == null ? 'text-amber-600' : (Number(profitCents) > 0 ? 'text-emerald-600' : 'text-red-600');

      const labelStatus = ship?.label_status || "pending";
      const statusAccent = mobileCardStatusAccent(labelStatus, r.refund);
      const source = getOrderSource(r);
      const channelBadge = source === "ebay"
        ? `<span class="border-[3px] border-black bg-black text-white px-2 py-0.5 text-[9px] font-black uppercase tracking-[.14em]">eBay</span>`
        : source === "amazon"
          ? `<span class="border-[3px] border-orange-500 bg-orange-500 text-white px-2 py-0.5 text-[9px] font-black uppercase tracking-[.14em]">Amazon</span>`
          : `<span class="border-[3px] border-kkpink bg-kkpink text-black px-2 py-0.5 text-[9px] font-black uppercase tracking-[.14em]">KK</span>`;

      return `
        <tr>
          <td colspan="8" class="p-0">
            <div class="border-b border-black/15 border-l-[4px] ${statusAccent} px-4 py-4 cursor-pointer" data-view="${idx}">
              <!-- top line -->
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 text-[11px] font-black uppercase tracking-[.18em] text-black/60">
                    <span>${esc(date)} · <button type="button" class="text-kkpink hover:underline" title="${esc(orderId)}">${truncateId(orderId)}</button></span>
                    ${channelBadge}
                  </div>

                  <div class="mt-2">
                    <div class="font-black uppercase tracking-[.06em] text-[12px]">
                      ${esc(customer)}
                    </div>
                  </div>
                </div>

                <div class="shrink-0 flex flex-col items-end gap-2">
                  <div class="flex flex-wrap items-center gap-1">
                    <span class="${statusPillClasses(labelStatus)}">
                      ${esc(displayStatus(labelStatus))}
                    </span>
                    ${refundBadgeHtml(r.refund)}
                    ${marketplaceObsBadgeHtml(r)}
                  </div>

                  <button
                    type="button"
                    data-edit="${idx}"
                    class="inline-flex items-center gap-2 border-[4px] border-black bg-white px-3 py-2
                           font-black uppercase tracking-[.14em] text-[11px]
                           hover:bg-black hover:text-white transition"
                    aria-label="Edit order"
                    title="Edit"
                  >
                    <span aria-hidden="true" class="text-[12px] leading-none">✎</span>
                    <span>Edit</span>
                  </button>
                </div>
              </div>

              <!-- stats grid -->
              <div class="mt-4 grid grid-cols-4 gap-3 text-sm">
                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Items</div>
                  <div class="mt-1 font-black">${esc(items)}</div>
                </div>

                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Paid</div>
                  <div class="mt-1 font-black">${esc(paid)}</div>
                </div>

                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Profit</div>
                  <div class="mt-1 font-black ${profitColor}">${esc(profit)}${channelFinanceBadgeHtml(r)}</div>
                </div>

                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Reviews</div>
                  <div class="mt-1">${reviewBadgeHtml(r.review_count)}</div>
                </div>
              </div>
              ${extras.mobileActionBlock}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

/* -------------------------
   DESKTOP RENDER (TABLE)
-------------------------- */
function renderDesktopRows(rows = [], getRowExtras = () => ({})) {
  return rows
    .map((r, idx) => {
      const extras = normalizeRowExtras(getRowExtras(r, idx));
      const ship = r.shipment;

      const customer =
        `${r.first_name || ""} ${r.last_name || ""}`.trim() || "—";

      const items = r.total_items ?? r.li_total_items ?? "—";

      const paid = moneyFromCents(r.total_paid_cents);
      const { cents: profitCents } = resolveChannelProfit(r);
      const profit = profitCents != null ? moneyFromCents(profitCents) : "—";
      const profitColor = profitCents == null ? 'text-amber-600' : (Number(profitCents) > 0 ? 'text-emerald-600' : 'text-red-600');

      const labelStatus = ship?.label_status || "pending";

      const date = formatDateShort(r.order_date);

      return `
        <tr class="align-top hover:bg-black/5 transition">
          <td class="px-4 py-3 text-sm whitespace-nowrap" title="${esc(r.order_date)}">
            ${esc(date)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap max-w-[160px]">
            <button
              type="button"
              data-view="${idx}"
              class="font-black text-kkpink hover:underline cursor-pointer"
              title="${esc(r.kk_order_id || '')} — Click to view details"
            >${truncateId(r.kk_order_id)}</button>
          </td>

          <td class="px-4 py-3 text-sm">
            <span class="font-black uppercase tracking-[.04em]">${esc(customer)}</span>
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap text-center">
            ${esc(items)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap font-black text-right">
            ${esc(paid)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap font-black text-right ${Number(profitCents) > 0 ? 'text-emerald-600' : 'text-red-600'}">
            ${esc(profit)}${channelFinanceBadgeHtml(r)}
          </td>

          <td class="px-4 py-3">
            <div class="flex flex-wrap items-center gap-1">
              <span class="${statusPillClasses(labelStatus)}">
                ${esc(displayStatus(labelStatus))}
              </span>
              ${refundBadgeHtml(r.refund)}
              ${marketplaceObsBadgeHtml(r)}
            </div>
          </td>

          <td class="px-4 py-3 text-center">
            ${reviewBadgeHtml(r.review_count)}
          </td>

          <td class="px-4 py-3 text-right whitespace-nowrap">
            <button
              type="button"
              data-edit="${idx}"
              class="inline-flex items-center gap-2 border-[4px] border-black bg-white px-3 py-2
                     font-black uppercase tracking-[.14em] text-[11px]
                     hover:bg-black hover:text-white transition"
              aria-label="Edit order"
              title="Edit"
            >
              <span aria-hidden="true" class="text-[12px] leading-none">✎</span>
              <span>Edit</span>
            </button>
            ${extras.desktopActionContent}
          </td>
        </tr>
      `;
    })
    .join("");
}

/* -------------------------
   MAIN
-------------------------- */
export function renderOrdersRows({ tbodyEl, rows = [], onEdit, onView, countLabelEl, getRowExtras } = {}) {
  const _getRowExtras = typeof getRowExtras === "function" ? getRowExtras : () => ({});
  if (!tbodyEl) return;

  if (countLabelEl) {
    countLabelEl.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;
  }

  if (!rows.length) {
    tbodyEl.innerHTML = `
      <tr>
        <td colspan="9" class="px-4 py-8">
          <div class="text-sm text-black/70">No orders found.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbodyEl.innerHTML = isMobile() ? renderMobileCards(rows, _getRowExtras) : renderDesktopRows(rows, _getRowExtras);

  // bind edit
  tbodyEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.getAttribute("data-edit"));
      const row = rows[idx];
      if (row) onEdit?.(row);
    });
  });

  // bind view
  tbodyEl.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(btn.getAttribute("data-view"));
      const row = rows[idx];
      if (row) onView?.(row);
    });
  });
}

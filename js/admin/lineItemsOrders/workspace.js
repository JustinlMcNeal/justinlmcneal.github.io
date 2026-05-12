// /js/admin/lineItemsOrders/workspace.js
// Phase 3: Unified Order Workspace — replaces separate view + edit modals.
// Exports: initWorkspace, openWorkspace, closeWorkspace
import {
  fetchOrderDetails,
  upsertFulfillmentShipment,
  issueRefund,
  updateRefundReason,
  buyShippingLabel,
  voidShippingLabel,
  fetchPackagePresets,
  getSignedLabelUrl,
} from "./api.js";
import {
  isoToLocalDatetimeValue,
  localDatetimeValueToIso,
  dollarsToCents,
  centsToDollars,
  setStatus,
} from "./dom.js";

// ── helpers ──────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function money(cents) {
  if (cents == null) return "—";
  return "$" + (Number(cents) / 100).toFixed(2);
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}
function sh(label) {
  return `<div class="flex items-center gap-3 mb-4 pl-3 border-l-[3px] border-kkpink">
    <span class="text-[11px] font-black uppercase tracking-[.25em]">${label}</span>
  </div>`;
}
function cleanStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}
function cleanInt(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ── state ────────────────────────────────────────────────────────
let _onSaved = null;
let _currentRow = null;
let _currentTab = "overview";
let _wsDirty = false;
let _detail = null;       // { order, lineItems, shipment }
let _focusTrigger = null; // element to restore focus to on close
let _presetsCache = null; // package presets — cached for session lifetime

const STATUS_COLORS = {
  pending: "bg-amber-500",
  label_purchased: "bg-blue-500",
  shipped: "bg-blue-600",
  delivered: "bg-emerald-500",
  voided: "bg-gray-500",
  returned: "bg-gray-500",
  refunded: "bg-red-500",
  partial_refund: "bg-red-500",
};

// ── public API ───────────────────────────────────────────────────

export function initWorkspace({ onSaved } = {}) {
  _onSaved = onSaved;

  document.getElementById("btnWsClose")?.addEventListener("click", _safeClose);
  document.getElementById("btnWsCancel")?.addEventListener("click", () => {
    _wsDirty = false;
    closeWorkspace();
  });
  document.getElementById("btnWsSave")?.addEventListener("click", _save);
  document
    .getElementById("orderWorkspace")
    ?.querySelector("[data-ws-backdrop]")
    ?.addEventListener("click", _safeClose);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const ws = document.getElementById("orderWorkspace");
      if (ws && !ws.classList.contains("hidden")) _safeClose();
    } else if (e.key === "Tab") {
      _trapFocus(e);
    }
  });
}

export async function openWorkspace(row, { tab = "overview" } = {}) {
  if (!row?.stripe_checkout_session_id) return;
  _currentRow = row;
  _currentTab = tab;
  _wsDirty = false;
  _detail = null;

  const ws = document.getElementById("orderWorkspace");
  // Capture triggering element — only on initial open, not internal re-renders
  if (ws?.classList.contains("hidden")) {
    _focusTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  ws?.classList.remove("hidden");
  ws?.removeAttribute("aria-hidden");
  document.body.classList.add("overflow-hidden");

  _populateHeader(row);
  _renderTabBar(tab);
  _setFooter(tab === "fulfillment");
  _setDirtyDot(false);

  const wsBody = document.getElementById("wsBody");
  if (wsBody) wsBody.innerHTML = '<div class="p-8 text-center text-gray-500">Loading…</div>';

  try {
    _detail = await fetchOrderDetails(row.stripe_checkout_session_id);
    _renderTabBody(tab);
    requestAnimationFrame(() => document.getElementById("btnWsClose")?.focus());
  } catch (err) {
    console.error(err);
    if (wsBody)
      wsBody.innerHTML = `<div class="text-red-600 p-6 font-black">${esc(
        err.message || "Failed to load order"
      )}</div>`;
  }
}

export function closeWorkspace() {
  const ws = document.getElementById("orderWorkspace");
  ws?.classList.add("hidden");
  ws?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("overflow-hidden");
  try { _focusTrigger?.focus(); } catch (_) {}
  _focusTrigger = null;
  _currentRow = null;
  _detail = null;
  _wsDirty = false;
}

// ── header ───────────────────────────────────────────────────────
function _populateHeader(row) {
  const status = row.shipment?.label_status || "pending";
  const color = STATUS_COLORS[status] || "bg-green-500";
  const source = row.source || "kk";
  const channelLabel =
    source === "amazon" ? "Amazon" : source === "ebay" ? "eBay" : "KK Store";

  const wsKicker = document.getElementById("wsKicker");
  const wsTitle = document.getElementById("wsTitle");
  const wsStatusBadge = document.getElementById("wsStatusBadge");
  const wsSubtitle = document.getElementById("wsSubtitle");

  if (wsKicker) {
    wsKicker.className = `inline-block ${color} text-white px-2 py-0.5 text-[8px] sm:text-[9px] font-black uppercase tracking-[.2em]`;
    wsKicker.textContent = channelLabel;
  }
  if (wsTitle) wsTitle.textContent = row.kk_order_id || "Order Details";
  if (wsStatusBadge) {
    wsStatusBadge.className = `inline-block ${color} text-white px-2 py-0.5 text-[9px] font-black uppercase tracking-[.2em]`;
    wsStatusBadge.textContent = status.replace(/_/g, " ").toUpperCase();
  }
  if (wsSubtitle) {
    const name = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    wsSubtitle.textContent = [name, row.email].filter(Boolean).join(" · ");
  }
}

// ── tab bar ──────────────────────────────────────────────────────
function _renderTabBar(activeTab) {
  const tabBar = document.getElementById("wsTabBar");
  if (!tabBar) return;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "financials", label: "Financials" },
    { id: "fulfillment", label: "Fulfillment" },
    { id: "ids", label: "IDs" },
  ];

  tabBar.innerHTML = tabs
    .map((t) => {
      const active = t.id === activeTab;
      const cls = active
        ? "bg-black text-white"
        : "text-gray-600 hover:bg-gray-100";
      const dirtyDot =
        t.id === "fulfillment"
          ? `<span id="wsDirtyDot" class="hidden ml-1.5 w-2 h-2 rounded-full bg-amber-400 inline-block align-middle"></span>`
          : "";
      return `<button type="button" data-tab="${t.id}" role="tab" aria-selected="${active}"
        class="px-4 py-3 text-[11px] font-black uppercase tracking-[.15em] whitespace-nowrap transition-colors flex-shrink-0 ${cls}">
        ${t.label}${dirtyDot}
      </button>`;
    })
    .join("");

  tabBar.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => _switchTab(btn.dataset.tab));
  });

  // Re-apply dirty dot state if currently on fulfillment
  if (activeTab === "fulfillment" && _wsDirty) _setDirtyDot(true);
}

function _switchTab(tab) {
  _currentTab = tab;
  _renderTabBar(tab);
  _setFooter(tab === "fulfillment");
  document.getElementById("wsBody")?.scrollTo?.(0, 0);
  _renderTabBody(tab);
}

// ── footer / dirty ───────────────────────────────────────────────
function _setFooter(show) {
  const footer = document.getElementById("wsFooter");
  if (!footer) return;
  footer.classList.toggle("hidden", !show);
  const btnSave = document.getElementById("btnWsSave");
  if (btnSave) {
    btnSave.disabled = false;
    btnSave.textContent = "Save Changes";
  }
}

function _setDirtyDot(on) {
  const dot = document.getElementById("wsDirtyDot");
  if (!dot) return;
  dot.classList.toggle("hidden", !on);
}

// ── tab body ─────────────────────────────────────────────────────
function _renderTabBody(tab) {
  const wsBody = document.getElementById("wsBody");
  if (!wsBody || !_detail) return;
  const { order, lineItems, shipment } = _detail;

  if (tab === "overview") wsBody.innerHTML = _renderOverview(order, lineItems);
  else if (tab === "financials") wsBody.innerHTML = _renderFinancials(order, shipment);
  else if (tab === "fulfillment") wsBody.innerHTML = _renderFulfillment(order, shipment);
  else if (tab === "ids") wsBody.innerHTML = _renderIds(order);

  if (tab === "fulfillment") {
    _populateFulfillmentFields(order, shipment);
    _wireRefundButtons(wsBody, order);
    _wireLabelButtons(wsBody, order, shipment);
    _trackDirty(wsBody);
  } else if (tab === "ids") {
    _wireCopyButtons(wsBody);
  }
}

// ── OVERVIEW tab ─────────────────────────────────────────────────
function _renderOverview(order, lineItems) {
  const customer = `${order.first_name || ""} ${order.last_name || ""}`.trim() || "—";
  const addr =
    [order.street_address, order.city, order.state, order.zip, order.country]
      .filter(Boolean)
      .join(", ") || "—";

  let html = '<div class="p-3 sm:p-6 space-y-6">';

  // Section 1: Customer Info
  html += `<section>
    ${sh("Customer Information")}
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Name</div>
        <div class="font-black text-lg">${esc(customer)}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Email</div>
        <div class="font-mono text-sm break-all">${esc(order.email || "—")}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Phone</div>
        <div class="font-mono text-sm">${esc(order.phone || "—")}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Order Date</div>
        <div class="text-sm">${esc(fmtDate(order.order_date))}</div>
      </div>
    </div>
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  // Section 2: Shipping Address
  html += `<section>
    ${sh("Shipping Address")}
    <div class="border-4 border-black p-4">
      <div class="text-sm leading-relaxed">${esc(addr)}</div>
    </div>
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  // Section 3: Items Ordered
  const itemsHtml =
    lineItems.length === 0
      ? '<div class="text-gray-500 text-sm">No line items found</div>'
      : lineItems
          .map((li) => {
            const qty = Number(li.quantity ?? 1);
            const unitCents = li.post_discount_unit_price_cents ?? li.unit_price_cents;
            const lineTotalCents = unitCents != null ? unitCents * qty : null;
            const imgHtml = li.product_image_url
              ? `<img src="${esc(li.product_image_url)}" class="w-12 h-12 sm:w-16 sm:h-16 object-cover border-2 border-black flex-shrink-0" onerror="this.outerHTML='<div class=\\'w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 border-2 border-black flex items-center justify-center text-[10px] text-gray-400 flex-shrink-0\\'>📦</div>'" />`
              : `<div class="w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 border-2 border-black flex items-center justify-center text-[10px] text-gray-400 flex-shrink-0">📦</div>`;
            return `<div class="border-4 border-black p-3 sm:p-4 flex gap-3 sm:gap-4">
              ${imgHtml}
              <div class="flex-1 min-w-0">
                ${
                  li.product_slug
                    ? `<a href="/pages/product.html?slug=${encodeURIComponent(li.product_slug)}" target="_blank" class="font-black text-sm line-clamp-2 text-kkpink hover:underline cursor-pointer">${esc(li.product_name || li.product_id || "Unknown Product")}</a>`
                    : `<span class="font-black text-sm line-clamp-2">${esc(li.product_name || li.product_id || "Unknown Product")}</span>`
                }
                ${li.variant ? `<div class="text-xs text-gray-500 mt-1">Variant: ${esc(li.variant)}</div>` : ""}
                <div class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 mt-2 text-xs sm:text-sm">
                  <span>Qty: <strong>${qty}</strong></span>
                  <span>Price: <strong>${money(unitCents)}</strong></span>
                  <span>Revenue: <strong>${money(lineTotalCents)}</strong></span>
                </div>
                ${
                  li.cpi_cents
                    ? `<div class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 mt-1 text-[11px] sm:text-xs text-red-600">
                  <span>CPI: ${money(li.cpi_cents)}/ea</span>
                  <span>×${qty} = <strong>${money(li.line_cost_cents)}</strong></span>
                </div>`
                    : ""
                }
              </div>
            </div>`;
          })
          .join("");

  html += `<section>
    ${sh(`Items Ordered (${lineItems.length})`)}
    <div class="space-y-3">${itemsHtml}</div>
  </section>`;

  html += "</div>";
  return html;
}

// ── FINANCIALS tab ───────────────────────────────────────────────
function _renderFinancials(order, shipment) {
  const isEbay = order.stripe_checkout_session_id?.startsWith("ebay_api_");
  const ef = order.ebay_financials;

  let html = '<div class="p-3 sm:p-6 space-y-6">';

  if (isEbay) {
    const finStatus = ef?.finance_status || "missing";
    const hasEarnings = ef?.ebay_order_earnings_cents != null;
    const isEstimated = finStatus === "estimated";

    const statusBadgeMap = {
      complete: '<span class="border-[2px] border-emerald-500 text-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">✓ COMPLETE</span>',
      estimated: '<span class="border-[2px] border-amber-400 text-amber-700 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ EST · Ad fee pending</span>',
      estimated_no_ad_fee: '<span class="border-[2px] border-amber-300 text-amber-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ EST · No ad fee</span>',
      partial: '<span class="border-[2px] border-amber-400 text-amber-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ PARTIAL</span>',
      pending_finances: '<span class="border-[2px] border-blue-300 text-blue-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">🕐 PENDING FINANCES</span>',
      missing: '<span class="border-[2px] border-gray-300 text-gray-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">? NO DATA</span>',
    };
    const statusBadge = statusBadgeMap[finStatus] || "";

    html += `<section>
      ${sh("eBay Order Summary")}
      <div class="mb-3 flex items-center gap-2">${statusBadge}</div>
      <div class="grid sm:grid-cols-3 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Buyer Subtotal</div>
          <div class="font-black text-lg">${money(order.subtotal_paid_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">From eBay Fulfillment API</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Tax (Buyer)</div>
          <div class="font-black text-lg text-gray-500">${money(order.tax_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">eBay collects &amp; remits — not our revenue</div>
        </div>
        <div class="border-4 border-black p-4 bg-black text-white">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-white/60 mb-1">Buyer Total</div>
          <div class="font-black text-lg">${money(order.total_paid_cents)}</div>
        </div>
      </div>
      ${
        hasEarnings
          ? `<div class="mt-4 grid sm:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Fees Total</div>
          <div class="font-black text-lg text-red-600">${money(ef.ebay_total_fee_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">FVF${ef.per_order_ad_fee_cents > 0 ? " + Promo" : ""}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Final Value Fee</div>
          <div class="font-black text-red-600">${money(ef.fee_final_value_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">In SALE transaction</div>
        </div>
        <div class="border-4 ${isEstimated ? "border-amber-300 bg-amber-50" : "border-black"} p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Promoted Listing</div>
          ${
            isEstimated
              ? `<div class="font-black text-amber-600">—</div><div class="text-[9px] text-amber-600 mt-1">Not yet billed (1-2 day lag)</div>`
              : `<div class="font-black text-red-600">${money(ef.per_order_ad_fee_cents || 0)}</div><div class="text-[9px] text-black/40 mt-1">Separate NON_SALE_CHARGE</div>`
          }
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Other Fees</div>
          <div class="font-black text-red-600">${money(
            (ef.fee_regulatory_cents || 0) +
              (ef.fee_international_cents || 0) +
              (ef.fee_other_cents || 0)
          )}</div>
          <div class="text-[9px] text-black/40 mt-1">Regulatory + Intl + Other</div>
        </div>
      </div>
      <div class="mt-3 border-4 ${isEstimated ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"} p-4 flex items-center justify-between">
        <div>
          <div class="text-[10px] font-black uppercase tracking-[.18em] ${isEstimated ? "text-amber-700/70" : "text-emerald-700/70"} mb-1">
            eBay Seller Earnings${isEstimated ? " (BEFORE promo fee)" : ""}
          </div>
          <div class="font-black text-xl ${isEstimated ? "text-amber-700" : "text-emerald-700"}">${money(ef.ebay_order_earnings_cents)}</div>
          <div class="text-[9px] ${isEstimated ? "text-amber-600/60" : "text-emerald-600/60"} mt-1">
            SALE.amount ${ef.per_order_ad_fee_cents > 0 ? "− Promoted listing fee" : ""} · ${ef.finance_synced_at ? new Date(ef.finance_synced_at).toLocaleDateString() : "—"}
          </div>
          ${isEstimated ? `<div class="text-[9px] text-amber-700 mt-1 font-black">⚠ Promoted listing fee not yet captured — final earnings will be lower</div>` : ""}
        </div>
        <div class="text-[10px] font-black uppercase tracking-[.18em] ${isEstimated ? "text-amber-700/50" : "text-emerald-700/50"}">
          = SALE − ${isEstimated ? "?" : "all"} fees
        </div>
      </div>`
          : `<div class="mt-4 border-4 border-blue-200 bg-blue-50 p-4">
        <div class="font-black text-sm text-blue-700 uppercase tracking-wider">eBay Finance Data Not Yet Available</div>
        <div class="text-xs text-blue-600 mt-1">eBay Finance API transactions are typically available 1–2 days after a sale. Run the eBay Finance sync to populate this data.</div>
      </div>`
      }
    </section>
    <div class="border-t-4 border-gray-100"></div>`;

    // eBay Cost & Profit
    const profitCents = order.profit_cents;
    const profitKnown = profitCents != null;
    const profitColor = Number(profitCents) > 0 ? "text-emerald-600" : "text-red-600";

    html += `<section>
      ${sh("Cost & eBay Net Profit")}
      ${
        isEstimated
          ? `<div class="mb-4 border-4 border-amber-400 bg-amber-50 p-3 flex items-center gap-3">
        <span class="text-lg">⚠</span>
        <div class="text-[11px] text-amber-800">
          <strong>Promoted listing fee pending</strong> — eBay typically bills the ad fee 1-2 days after a sale. Re-run the eBay Finance sync tomorrow.
        </div>
      </div>`
          : ""
      }
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Product CPI</div>
          <div class="font-black text-lg text-red-600">${money(order.product_cpi_cents)}</div>
          <div class="text-[9px] text-black/50 mt-1">Unit + China Ship</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">USPS Label</div>
          <div class="font-black text-lg text-red-600">${money(shipment?.label_cost_cents)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Earnings</div>
          <div class="font-black text-lg ${hasEarnings ? (isEstimated ? "text-amber-700" : "text-emerald-700") : "text-gray-400"}">
            ${hasEarnings ? money(ef.ebay_order_earnings_cents) : "—"}
          </div>
          <div class="text-[9px] text-black/50 mt-1">
            ${isEstimated ? "Before promo fee" : hasEarnings ? "After all eBay fees" : "Not yet synced"}
          </div>
        </div>
        <div class="border-4 border-black p-4 ${profitKnown ? "bg-emerald-50" : "bg-amber-50 border-amber-300"}">
          <div class="text-[10px] font-black uppercase tracking-[.18em] ${profitKnown ? "text-emerald-700/60" : "text-amber-700/70"} mb-1">
            ${profitKnown ? "Net Profit" : "Profit (pending)"}
          </div>
          <div class="font-black text-lg ${profitKnown ? profitColor : "text-amber-600"}">
            ${profitKnown ? money(profitCents) : "—"}
          </div>
          ${!profitKnown ? '<div class="text-[9px] text-amber-700 mt-1">Ad fee not yet captured</div>' : ""}
        </div>
      </div>
      ${
        profitKnown
          ? `<div class="mt-3 text-[10px] text-black/50 leading-relaxed">
        <strong>Formula:</strong> eBay earnings (${money(ef?.ebay_order_earnings_cents)}) − Product CPI (${money(order.product_cpi_cents)}) − USPS label (${money(shipment?.label_cost_cents)}) = <strong>${money(profitCents)}</strong>
      </div>`
          : `<div class="mt-3 text-[10px] text-amber-700 leading-relaxed border-l-4 border-amber-400 pl-3">
        Best case: ${money(ef?.ebay_order_earnings_cents)} − ${money(order.product_cpi_cents)} − ${money(shipment?.label_cost_cents)} = <strong>${money(
                  (ef?.ebay_order_earnings_cents || 0) -
                    (order.product_cpi_cents || 0) -
                    (shipment?.label_cost_cents || 0)
                )}</strong> (overstated until ad fee synced)
      </div>`
      }
    </section>`;
  } else {
    // Standard (non-eBay)
    html += `<section>
      ${sh("Order Summary")}
      <div class="grid sm:grid-cols-3 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Subtotal</div>
          <div class="font-black text-lg">${money(order.subtotal_paid_cents)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Shipping</div>
          <div class="font-black text-lg">${money(order.shipping_paid_cents)}</div>
        </div>
        <div class="border-4 border-black p-4 bg-black text-white">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-white/60 mb-1">Total Paid</div>
          <div class="font-black text-lg">${money(order.total_paid_cents)}</div>
        </div>
      </div>
    </section>
    <div class="border-t-4 border-gray-100"></div>`;

    const shippingMargin = (order.shipping_paid_cents || 0) - (shipment?.label_cost_cents || 0);
    const marginBg = shipment?.label_cost_cents
      ? shippingMargin >= 0
        ? "bg-emerald-50"
        : "bg-red-50"
      : "";
    const marginColor = shippingMargin >= 0 ? "text-emerald-600" : "text-red-600";

    html += `<section>
      ${sh("Cost & Profit")}
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Product CPI</div>
          <div class="font-black text-lg text-red-600">${money(order.product_cpi_cents)}</div>
          <div class="text-[9px] text-black/50 mt-1">Unit + China Ship</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">USPS Label</div>
          <div class="font-black text-lg text-red-600">${money(shipment?.label_cost_cents)}</div>
        </div>
        <div class="border-4 border-black p-4 ${marginBg}">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Shipping Margin</div>
          ${
            shipment?.label_cost_cents
              ? `<div class="font-black text-lg ${marginColor}">${money(shippingMargin)}</div>
               <div class="text-[9px] text-black/50 mt-1">${money(order.shipping_paid_cents)} paid − ${money(shipment.label_cost_cents)} label</div>`
              : `<div class="font-black text-lg text-gray-400">—</div>
               <div class="text-[9px] text-black/50 mt-1">${money(order.shipping_paid_cents)} paid · no label yet</div>`
          }
        </div>
        <div class="border-4 border-black p-4 bg-emerald-50">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700/60 mb-1">Profit</div>
          <div class="font-black text-lg text-emerald-600">${money(order.profit_cents)}</div>
        </div>
      </div>
    </section>`;
  }

  html += "</div>";
  return html;
}

// ── FULFILLMENT tab ──────────────────────────────────────────────
function _renderFulfillment(order, shipment) {
  const labelStatus = shipment?.label_status || "pending";
  const tracking = shipment?.tracking_number || "—";
  const carrier = shipment?.carrier || "—";

  let html = '<div class="p-3 sm:p-6 space-y-6">';

  // Fulfillment Status display
  html += `<section>
    ${sh("Fulfillment Status")}
    <div class="grid sm:grid-cols-3 gap-4">
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Status</div>
        <div class="font-black uppercase">${esc(labelStatus.replace(/_/g, " "))}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Carrier</div>
        <div class="font-black">${esc(carrier)}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Tracking</div>
        ${
          shipment?.tracking_url
            ? `<a href="${esc(shipment.tracking_url)}" target="_blank" class="font-mono text-sm break-all text-kkpink hover:underline">${esc(tracking)}</a>`
            : `<div class="font-mono text-sm break-all">${esc(tracking)}</div>`
        }
      </div>
    </div>

    ${(() => {
      if (
        labelStatus === "label_purchased" &&
        shipment?.label_purchased_at &&
        !shipment?.in_transit_at
      ) {
        const hoursAgo =
          (Date.now() - new Date(shipment.label_purchased_at).getTime()) / 3600000;
        if (hoursAgo > 24) {
          return `<div class="mt-4 border-4 border-amber-400 bg-amber-50 p-4 flex items-center gap-3">
            <span class="text-2xl">⚠️</span>
            <div>
              <div class="font-black text-sm text-amber-800 uppercase tracking-wider">Not Yet Scanned</div>
              <div class="text-xs text-amber-700 mt-1">Label purchased ${Math.floor(hoursAgo)}h ago — no carrier scan detected. Check if package was dropped off.</div>
            </div>
          </div>`;
        }
      }
      return "";
    })()}

    ${
      shipment?.in_transit_at || shipment?.delivered_at || shipment?.estimated_delivery
        ? `<div class="grid sm:grid-cols-3 gap-4 mt-4">
      ${
        shipment.in_transit_at
          ? `<div class="border-4 border-blue-200 p-4 bg-blue-50">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-blue-600/60 mb-1">Shipped</div>
        <div class="font-black text-sm text-blue-700">${new Date(shipment.in_transit_at).toLocaleDateString()}</div>
      </div>`
          : ""
      }
      ${
        shipment.estimated_delivery
          ? `<div class="border-4 border-amber-200 p-4 bg-amber-50">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-amber-600/60 mb-1">ETA</div>
        <div class="font-black text-sm text-amber-700">${new Date(shipment.estimated_delivery).toLocaleDateString()}</div>
      </div>`
          : ""
      }
      ${
        shipment.delivered_at
          ? `<div class="border-4 border-emerald-200 p-4 bg-emerald-50">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600/60 mb-1">Delivered</div>
        <div class="font-black text-sm text-emerald-700">${new Date(shipment.delivered_at).toLocaleDateString()}</div>
      </div>`
          : ""
      }
    </div>`
        : ""
    }

    <div class="mt-4 flex flex-wrap gap-3" data-label-actions>
      ${
        labelStatus === "pending" || labelStatus === "voided"
          ? `<div class="flex flex-wrap items-center gap-2">
          <select data-preset-select class="border-4 border-black px-3 py-2 text-xs font-black uppercase focus:border-kkpink outline-none bg-white">
            <option value="">Loading presets…</option>
          </select>
          <button data-buy-label class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white transition">
            🏷️ Buy Label
          </button>
        </div>`
          : ""
      }
      ${
        shipment?.label_url
          ? `<button data-print-label class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-blue-600 text-blue-700 hover:bg-blue-600 hover:text-white transition">
          🖨️ Print Label
        </button>
        <button data-reprint-label class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-gray-400 text-gray-600 hover:bg-gray-400 hover:text-white transition">
          🔄 Reprint
        </button>`
          : ""
      }
      ${
        shipment?.shippo_transaction_id && labelStatus === "label_purchased"
          ? `<button data-void-label class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-red-600 text-red-600 hover:bg-red-600 hover:text-white transition">
          ✕ Void Label
        </button>`
          : ""
      }
    </div>

    ${
      shipment?.label_cost_cents && labelStatus !== "voided"
        ? `<div class="mt-3 text-xs text-gray-500">Label cost: <strong>$${(shipment.label_cost_cents / 100).toFixed(2)}</strong> · ${esc(shipment.service || "")} · ${esc(shipment.carrier || "")}</div>`
        : ""
    }
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  // Edit Shipment Fields
  html += `<section>
    ${sh("Edit Shipment")}
    <div id="fMsg" class="hidden p-3 border-4 text-sm mb-4"></div>
    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <label for="fSessionId" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Stripe Session ID</label>
        <input id="fSessionId" type="text" readonly class="w-full border-[4px] border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none" />
      </div>
      <div>
        <label for="fKkOrderId" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">KK Order ID</label>
        <input id="fKkOrderId" type="text" readonly class="w-full border-[4px] border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none" />
      </div>
      <div>
        <label for="fLabelStatus" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Label Status</label>
        <select id="fLabelStatus" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none bg-white focus:border-kkpink transition-colors">
          <option value="pending">Pending</option>
          <option value="label_purchased">Label Purchased</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="voided">Voided</option>
          <option value="returned">Returned</option>
        </select>
      </div>
      <div>
        <label for="fTrackingNumber" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Tracking Number</label>
        <input id="fTrackingNumber" type="text" placeholder="9400…" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="fCarrier" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Carrier</label>
        <input id="fCarrier" type="text" placeholder="USPS / UPS / FedEx" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="fService" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Service</label>
        <input id="fService" type="text" placeholder="Ground Advantage, Priority…" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="fBatchId" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Batch ID</label>
        <input id="fBatchId" type="text" placeholder="2025-12-25-A" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="fPrintedAt" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Printed At</label>
        <input id="fPrintedAt" type="datetime-local" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="fLabelCost" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Label Cost ($)</label>
        <input id="fLabelCost" type="number" step="0.01" placeholder="4.23" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="fPackageWeightGFinal" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Final Package Weight (g)</label>
        <input id="fPackageWeightGFinal" type="number" step="1" placeholder="320" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div class="sm:col-span-2">
        <label for="fPirateShipShipmentId" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Pirate Ship Shipment ID</label>
        <input id="fPirateShipShipmentId" type="text" placeholder="pship_…" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div class="sm:col-span-2">
        <label for="fNotes" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Notes</label>
        <textarea id="fNotes" rows="3" placeholder="Any fulfillment notes…" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none resize-y focus:border-kkpink transition-colors"></textarea>
      </div>
    </div>
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  // Refund section
  html += _buildRefundSectionHtml(order);
  html += "</div>";
  return html;
}

// ── IDs tab ──────────────────────────────────────────────────────
function _renderIds(order) {
  const ids = [
    { label: "KK Order ID", value: order.kk_order_id },
    { label: "Stripe Session", value: order.stripe_checkout_session_id },
    { label: "Payment Intent", value: order.stripe_payment_intent_id },
    { label: "Stripe Customer", value: order.stripe_customer_id },
  ].filter((item) => item.value);

  let html = '<div class="p-3 sm:p-6">';
  html += sh("Technical IDs");
  html += '<div class="space-y-3">';

  if (ids.length === 0) {
    html += '<div class="text-gray-500 text-sm">No IDs available.</div>';
  } else {
    html += ids
      .map(
        (item) =>
          `<div class="border-4 border-black p-4 flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">${esc(item.label)}</div>
        <div class="font-mono text-sm break-all">${esc(item.value)}</div>
      </div>
      <button type="button" data-copy="${esc(item.value)}"
        class="flex-shrink-0 border-4 border-black bg-white px-3 py-1 text-[10px] font-black uppercase tracking-wider hover:bg-black hover:text-white transition-colors">
        Copy
      </button>
    </div>`
      )
      .join("");
  }

  html += "</div></div>";
  return html;
}

// ── REFUND section builder ────────────────────────────────────────
function _buildRefundSectionHtml(order) {
  let html = `<section>${sh("Refund")}`;

  if (order.refund_status) {
    const statusBorder =
      order.refund_status === "full"
        ? "border-red-400 bg-red-50"
        : "border-amber-400 bg-amber-50";
    const statusColor =
      order.refund_status === "full" ? "text-red-600" : "text-amber-600";
    const netRevenue = (order.total_paid_cents || 0) - (order.refund_amount_cents || 0);

    html += `<div class="grid sm:grid-cols-3 gap-4 mb-4">
      <div class="border-4 ${statusBorder} p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Status</div>
        <div class="font-black uppercase ${statusColor}">${esc(order.refund_status)} refund</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Refunded</div>
        <div class="font-black text-lg text-red-600">${money(order.refund_amount_cents)}</div>
      </div>
      <div class="border-4 border-black p-4 bg-emerald-50">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Net Revenue</div>
        <div class="font-black text-lg text-emerald-600">${money(netRevenue)}</div>
      </div>
    </div>`;

    html += `<div class="mb-4">
      <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-2">Refund Reason</div>
      <div class="flex flex-wrap gap-2">`;

    const reasons = [
      {
        key: "cancelled_before_ship",
        label: "🚫 Cancelled / Never Shipped",
        activeClass: "border-blue-600 bg-blue-600 text-white",
      },
      {
        key: "refunded_kept_item",
        label: "🎁 Refunded · Kept Item",
        activeClass: "border-amber-500 bg-amber-500 text-white",
      },
      {
        key: "returned",
        label: "📦 Returned",
        activeClass: "border-purple-600 bg-purple-600 text-white",
      },
    ];
    for (const r of reasons) {
      const cls =
        order.refund_reason === r.key
          ? r.activeClass
          : "border-gray-300 text-gray-600 hover:border-black";
      html += `<button data-set-reason="${r.key}" class="px-3 py-2 text-[11px] font-black uppercase tracking-wider border-4 transition ${cls}">${r.label}</button>`;
    }

    const explanations = {
      cancelled_before_ship: "Product never shipped → profit = $0 (no costs incurred)",
      refunded_kept_item: "Customer kept the item → product cost + shipping are real losses",
      returned: "Customer returned item → product cost is sunk, no shipping loss",
    };
    const explanation =
      explanations[order.refund_reason] ||
      "Select a reason to adjust how profit is calculated";
    html += `</div><div class="mt-2 text-[10px] text-gray-500">${explanation}</div></div>`;

    if (order.refunded_at) {
      html += `<div class="text-xs text-gray-500 mb-4">Refunded on ${fmtDate(order.refunded_at)}</div>`;
    }
  } else {
    html += '<div class="text-sm text-gray-400 mb-4">No refund issued.</div>';
  }

  if (order.source === "amazon") {
    html +=
      '<div class="text-xs text-gray-400 italic">Refunds for Amazon orders must be handled through Amazon Seller Central.</div>';
  } else {
    html += '<div class="mt-3">';
    if (!order.refund_status) {
      html += `<div class="mb-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-2">Refund Reason (required)</div>
        <select data-refund-reason-select class="border-4 border-black px-3 py-2 text-sm w-full sm:w-auto focus:border-kkpink outline-none">
          <option value="">— Select reason —</option>
          <option value="cancelled_before_ship">🚫 Cancelled / Never Shipped</option>
          <option value="refunded_kept_item">🎁 Refunded · Customer Keeps Item</option>
          <option value="returned">📦 Returned by Customer</option>
        </select>
      </div>`;
    }

    html += '<div class="flex flex-wrap gap-3">';
    const fullDisabled = order.refund_status === "full" ? "disabled" : "";
    const fullLabel =
      order.refund_status === "full" ? "Fully Refunded" : "Issue Full Refund";
    html += `<button data-refund-full class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-red-600 text-red-600 hover:bg-red-600 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed" ${fullDisabled}>${fullLabel}</button>`;
    if (order.refund_status !== "full") {
      html += `<div class="flex items-center gap-2">
        <span class="text-[10px] font-black uppercase text-black/60">$</span>
        <input data-refund-amount type="number" step="0.01" min="0.01" placeholder="Amount" class="w-24 border-4 border-black px-2 py-1 text-sm font-mono focus:outline-none focus:border-blue-600" />
        <button data-refund-partial class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-amber-500 text-amber-600 hover:bg-amber-500 hover:text-white transition">Partial Refund</button>
      </div>`;
    }
    html += "</div></div>";
  }

  html += "</section>";
  return html;
}

// ── populate fulfillment fields ───────────────────────────────────
function _populateFulfillmentFields(order, shipment) {
  const ship = shipment || {};
  const f = (id) => document.getElementById(id);

  const fSessionId = f("fSessionId");
  const fKkOrderId = f("fKkOrderId");
  const fLabelStatus = f("fLabelStatus");
  const fTrackingNumber = f("fTrackingNumber");
  const fCarrier = f("fCarrier");
  const fService = f("fService");
  const fBatchId = f("fBatchId");
  const fPrintedAt = f("fPrintedAt");
  const fLabelCost = f("fLabelCost");
  const fPackageWeightGFinal = f("fPackageWeightGFinal");
  const fPirateShipShipmentId = f("fPirateShipShipmentId");
  const fNotes = f("fNotes");

  if (fSessionId) fSessionId.value = order.stripe_checkout_session_id || "";
  if (fKkOrderId) fKkOrderId.value = order.kk_order_id || "";
  if (fLabelStatus) fLabelStatus.value = ship.label_status || "pending";
  if (fTrackingNumber) fTrackingNumber.value = ship.tracking_number || "";
  if (fCarrier) fCarrier.value = ship.carrier || "";
  if (fService) fService.value = ship.service || "";
  if (fBatchId) fBatchId.value = ship.batch_id || "";
  if (fPrintedAt) fPrintedAt.value = isoToLocalDatetimeValue(ship.printed_at);
  if (fLabelCost)
    fLabelCost.value =
      ship.label_cost_cents != null ? centsToDollars(ship.label_cost_cents) : "";
  if (fPackageWeightGFinal)
    fPackageWeightGFinal.value =
      ship.package_weight_g_final != null ? String(ship.package_weight_g_final) : "";
  if (fPirateShipShipmentId)
    fPirateShipShipmentId.value = ship.pirate_ship_shipment_id || "";
  if (fNotes) fNotes.value = ship.notes || "";
}

// ── track dirty state ─────────────────────────────────────────────
function _trackDirty(container) {
  container.querySelectorAll("input, select, textarea").forEach((el) => {
    if (el.readOnly) return;
    const markDirty = () => {
      _wsDirty = true;
      _setDirtyDot(true);
    };
    el.addEventListener("input", markDirty);
    el.addEventListener("change", markDirty);
  });
}

// ── save ─────────────────────────────────────────────────────────
async function _save() {
  if (!_currentRow) return;
  const btnSave = document.getElementById("btnWsSave");
  const fMsg = document.getElementById("fMsg");

  const showMsg = (text, isError = false) => {
    if (!fMsg) return;
    fMsg.textContent = text || "";
    fMsg.classList.toggle("hidden", !text);
    // Clear both sets of classes before applying
    fMsg.className = fMsg.className.replace(
      /\b(border-red-300|bg-red-50|text-red-700|border-emerald-300|bg-emerald-50|text-emerald-700)\b/g,
      ""
    );
    if (text) {
      if (isError) {
        fMsg.classList.add("border-red-300", "bg-red-50", "text-red-700");
      } else {
        fMsg.classList.add("border-emerald-300", "bg-emerald-50", "text-emerald-700");
      }
    }
  };

  const f = (id) => document.getElementById(id);

  try {
    showMsg("Saving…");
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = "Saving…";
    }

    const previousShipment = _detail?.shipment || null;
    const patch = {
      label_status: cleanStr(f("fLabelStatus")?.value) || "pending",
      tracking_number: cleanStr(f("fTrackingNumber")?.value),
      carrier: cleanStr(f("fCarrier")?.value),
      service: cleanStr(f("fService")?.value),
      batch_id: cleanStr(f("fBatchId")?.value),
      printed_at: localDatetimeValueToIso(f("fPrintedAt")?.value),
      label_cost_cents:
        f("fLabelCost")?.value === "" ? null : dollarsToCents(f("fLabelCost")?.value),
      package_weight_g_final: cleanInt(f("fPackageWeightGFinal")?.value),
      pirate_ship_shipment_id: cleanStr(f("fPirateShipShipmentId")?.value),
      notes: cleanStr(f("fNotes")?.value),
    };

    const saved = await upsertFulfillmentShipment({
      stripe_checkout_session_id: _currentRow.stripe_checkout_session_id,
      kk_order_id: _currentRow.kk_order_id,
      patch,
      previousShipment,
    });

    setStatus("Saved shipment ✓");
    if (_detail) _detail.shipment = saved;
    if (_currentRow) _currentRow.shipment = saved;
    _wsDirty = false;
    _setDirtyDot(false);

    if (btnSave) {
      btnSave.textContent = "✓ Saved";
      setTimeout(() => {
        if (btnSave) {
          btnSave.textContent = "Save Changes";
          btnSave.disabled = false;
        }
      }, 1500);
    }
    showMsg("Saved successfully ✓", false);
    setTimeout(() => showMsg(""), 3000);
    await _onSaved?.();
  } catch (e) {
    console.error(e);
    showMsg(`Save failed: ${e?.message || e}`, true);
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = "Save Changes";
    }
  }
}

// ── safe close ────────────────────────────────────────────────────
function _safeClose() {
  if (_wsDirty && !confirm("You have unsaved changes. Discard?")) return;
  _wsDirty = false;
  closeWorkspace();
}

// ── focus trap ────────────────────────────────────────────────
function _trapFocus(e) {
  const ws = document.getElementById("orderWorkspace");
  if (!ws || ws.classList.contains("hidden")) return;

  const focusable = Array.from(
    ws.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null);

  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first || !ws.contains(document.activeElement)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last || !ws.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ── dirty-state guard for workspace-refreshing actions ────────────────
function _warnIfDirty(actionLabel) {
  if (!_wsDirty) return true;
  return confirm(
    `⚠ You have unsaved shipment edits that will be discarded.\n\nContinue with ${actionLabel}?`
  );
}

// ── wire refund buttons ───────────────────────────────────────────
function _wireRefundButtons(container, order) {
  const btnFull = container.querySelector("[data-refund-full]");
  const btnPartial = container.querySelector("[data-refund-partial]");
  const amtInput = container.querySelector("[data-refund-amount]");
  const reasonSelect = container.querySelector("[data-refund-reason-select]");
  const totalCents = order.total_paid_cents || 0;
  const alreadyRefundedCents = order.refund_amount_cents || 0;
  const remainingCents = totalCents - alreadyRefundedCents;

  function requireReason() {
    const reason = reasonSelect?.value || null;
    if (!reason) {
      alert("Please select a refund reason before issuing the refund.");
      reasonSelect?.focus();
      return null;
    }
    return reason;
  }

  container.querySelectorAll("[data-set-reason]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reason = btn.getAttribute("data-set-reason");
      if (reason === order.refund_reason) return;
      if (!_warnIfDirty("changing the refund reason")) return;
      btn.textContent = "Saving…";
      try {
        await updateRefundReason(order.stripe_checkout_session_id, reason);
        openWorkspace(_currentRow, { tab: _currentTab });
      } catch (err) {
        alert("Failed to update reason: " + (err.message || err));
        openWorkspace(_currentRow, { tab: _currentTab });
      }
    });
  });

  if (btnFull && !btnFull.disabled) {
    btnFull.addEventListener("click", async () => {
      const reason = order.refund_status ? null : requireReason();
      if (!order.refund_status && !reason) return;
      const dollars = (remainingCents / 100).toFixed(2);
      if (
        !confirm(
          `Issue a FULL refund of $${dollars} for order ${order.kk_order_id || order.stripe_checkout_session_id}?\n\nReason: ${reason || order.refund_reason || "—"}\n\n${_wsDirty ? "⚠ Unsaved shipment edits will be lost.\n\n" : ""}This cannot be undone.`
        )
      )
        return;
      btnFull.disabled = true;
      btnFull.textContent = "Processing…";
      try {
        const result = await issueRefund(
          order.stripe_checkout_session_id,
          null,
          reason
        );
        alert(
          `Refund successful!\nRefund ID: ${result.refund_id}\nAmount: $${(result.amount_refunded_cents / 100).toFixed(2)}`
        );
        openWorkspace(_currentRow, { tab: _currentTab });
      } catch (err) {
        alert("Refund failed: " + (err.message || err));
        btnFull.disabled = false;
        btnFull.textContent = "Issue Full Refund";
      }
    });
  }

  if (btnPartial) {
    btnPartial.addEventListener("click", async () => {
      const reason = order.refund_status ? null : requireReason();
      if (!order.refund_status && !reason) return;
      const val = parseFloat(amtInput?.value);
      if (!val || val <= 0) {
        alert("Enter a valid refund amount.");
        amtInput?.focus();
        return;
      }
      const amountCents = Math.round(val * 100);
      if (amountCents > remainingCents) {
        alert(
          `Amount exceeds refundable balance of $${(remainingCents / 100).toFixed(2)}.`
        );
        return;
      }
      if (
        !confirm(
          `Issue a partial refund of $${val.toFixed(2)} for order ${order.kk_order_id || order.stripe_checkout_session_id}?\n\nReason: ${reason || order.refund_reason || "—"}\n\n${_wsDirty ? "⚠ Unsaved shipment edits will be lost.\n\n" : ""}This cannot be undone.`
        )
      )
        return;
      btnPartial.disabled = true;
      btnPartial.textContent = "Processing…";
      try {
        const result = await issueRefund(
          order.stripe_checkout_session_id,
          amountCents,
          reason
        );
        alert(
          `Partial refund successful!\nRefund ID: ${result.refund_id}\nAmount: $${(result.amount_refunded_cents / 100).toFixed(2)}`
        );
        openWorkspace(_currentRow, { tab: _currentTab });
      } catch (err) {
        alert("Refund failed: " + (err.message || err));
        btnPartial.disabled = false;
        btnPartial.textContent = "Partial Refund";
      }
    });
  }
}

// ── wire label buttons ────────────────────────────────────────────
async function _wireLabelButtons(container, order, shipment) {
  const sessionId = order.stripe_checkout_session_id;

  const presetSelect = container.querySelector("[data-preset-select]");
  if (presetSelect) {
    try {
      if (!_presetsCache) _presetsCache = await fetchPackagePresets();
      presetSelect.innerHTML = _presetsCache
        .map(
          (p) =>
            `<option value="${p.id}" ${p.is_default ? "selected" : ""}>${p.name} (${p.length_in}×${p.width_in}${p.height_in ? "×" + p.height_in : ""})</option>`
        )
        .join("");
    } catch {
      presetSelect.innerHTML = '<option value="">Failed to load</option>';
      _presetsCache = null; // allow retry on next open
    }
  }

  const btnBuy = container.querySelector("[data-buy-label]");
  if (btnBuy) {
    btnBuy.addEventListener("click", async () => {
      const presetId = presetSelect?.value || null;
      if (!_warnIfDirty("buying this label")) return;
      btnBuy.disabled = true;
      btnBuy.textContent = "⏳ Buying…";
      try {
        const result = await buyShippingLabel(sessionId, presetId);
        if (result.duplicate) {
          alert(`Label already exists!\nTracking: ${result.data.tracking_number}`);
        } else {
          alert(
            `Label purchased!\nTracking: ${result.data.tracking_number}\nCost: $${(result.data.label_cost_cents / 100).toFixed(2)}\nService: ${result.data.service}`
          );
        }
        openWorkspace(_currentRow, { tab: _currentTab });
        await _onSaved?.();
      } catch (err) {
        alert("Label purchase failed: " + (err.message || err));
        btnBuy.disabled = false;
        btnBuy.textContent = "🏷️ Buy Label";
      }
    });
  }

  const btnPrint = container.querySelector("[data-print-label]");
  const btnReprint = container.querySelector("[data-reprint-label]");
  const handlePrint = async (btn) => {
    if (!shipment?.label_url) return;
    const pw = window.open("", "printLabel", "width=500,height=750");
    if (!pw) {
      alert("Popup blocked — please allow popups for this site.");
      return;
    }
    pw.document.write(
      "<!DOCTYPE html><html><head><title>Loading label…</title></head><body><p>Loading label…</p></body></html>"
    );
    pw.document.close();
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⏳ Loading…";
    try {
      const url = await getSignedLabelUrl(shipment.label_url);
      const isPng = shipment.label_url.endsWith(".png");
      if (isPng) {
        pw.document.open();
        pw.document.write(
          `<!DOCTYPE html><html><head><title>Print Label</title><style>
  @page { size: 4in 6in; margin: 0; }
  * { margin: 0; padding: 0; }
  body { display: flex; justify-content: center; background: #222; }
  img { max-width: 100%; height: auto; }
  @media print { body { background: #fff; } img { width: 4in; height: 6in; object-fit: contain; } }
</style></head><body><img src="${url}" onload="setTimeout(function(){window.print();},400)"></body></html>`
        );
        pw.document.close();
      } else {
        pw.location.href = url;
      }
    } catch (err) {
      pw.close();
      alert("Failed to get label: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  };
  if (btnPrint) btnPrint.addEventListener("click", () => handlePrint(btnPrint));
  if (btnReprint) btnReprint.addEventListener("click", () => handlePrint(btnReprint));

  const btnVoid = container.querySelector("[data-void-label]");
  if (btnVoid) {
    btnVoid.addEventListener("click", async () => {
      if (
        !confirm(
          `Void label for order ${order.kk_order_id || sessionId}?\n\nTracking: ${shipment.tracking_number}\n\n${_wsDirty ? "⚠ Unsaved shipment edits will be lost.\n\n" : ""}This will request a refund from the carrier.`
        )
      )
        return;
      btnVoid.disabled = true;
      btnVoid.textContent = "⏳ Voiding…";
      try {
        const result = await voidShippingLabel(sessionId);
        alert(`Label voided!\nRefund status: ${result.data.refund_status}`);
        openWorkspace(_currentRow, { tab: _currentTab });
        await _onSaved?.();
      } catch (err) {
        alert("Void failed: " + (err.message || err));
        btnVoid.disabled = false;
        btnVoid.textContent = "✕ Void Label";
      }
    });
  }
}

// ── wire copy buttons ─────────────────────────────────────────────
function _wireCopyButtons(container) {
  container.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy");
      const orig = btn.textContent;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Fallback for browsers without clipboard API
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = orig), 1200);
    });
  });
}

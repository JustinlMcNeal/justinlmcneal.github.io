// /js/admin/lineItemsOrders/workspace.js
// Phase 3: Unified Order Workspace — replaces separate view + edit modals.
// Exports: initWorkspace, openWorkspace, closeWorkspace
import {
  fetchOrderDetails,
  fetchCtaLabelHistory,
  upsertFulfillmentShipment,
  finalizeKkOrderReservations,
  issueRefund,
  updateRefundReason,
  buyShippingLabel,
  updateOrderShippingAddress,
  validateOrderShippingAddress,
  confirmAmazonShipment,
  voidShippingLabel,
  fetchPackagePresets,
  getSignedLabelUrl,
} from "./api.js";
import {
  localAddressIssues,
  readShippingFieldsFromDom,
  populateShippingFields,
  renderAddressStatusHtml,
  customerDisplayName,
  splitPrintableFirstLast,
} from "./shippingAddress.js";
import { renderCustomerInfoSection } from "./workspaceOverview.js";
import {
  isoToLocalDatetimeValue,
  localDatetimeValueToIso,
  dollarsToCents,
  centsToDollars,
  setStatus,
  getOrderSource,
  esc,
} from "./dom.js";
import { renderOverview } from "./workspaceOverview.js";
import { renderFinancials } from "./workspaceFinancials.js";
import { renderFulfillment } from "./workspaceFulfillment.js";
import { renderLabels } from "./workspaceLabels.js";
import { renderIds } from "./workspaceIds.js";
import { printCtaForOrder } from "./ctaPrintFlow.js";
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
/** @type {{ sessionId: string, is_valid: boolean, messages?: object[], suggested?: object } | null} */
let _shippingValidation = null;
let _shippingAddrDirty = false;
let _lastSuggestedAddress = null;

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

let _focusLineItemId = null;

export async function openWorkspace(row, { tab = "overview", focusLineItemId = null } = {}) {
  if (!row?.stripe_checkout_session_id) return;
  _focusLineItemId = focusLineItemId;
  _currentRow = row;
  _currentTab = tab;
  _wsDirty = false;
  _shippingValidation = null;
  _shippingAddrDirty = false;
  _lastSuggestedAddress = null;
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
    try {
      _detail.ctaLabelHistory = await fetchCtaLabelHistory(row.stripe_checkout_session_id);
    } catch (historyErr) {
      console.warn("[workspace] CTA label history fetch failed:", historyErr);
      _detail.ctaLabelHistory = {
        prints: [],
        links: [],
        scans: [],
        scanCountsByPrintId: {},
        latestScanByPrintId: {},
        scanCountsByLinkId: {},
        latestScanByLinkId: {},
        linksByPrintId: {},
        error: historyErr?.message || String(historyErr),
      };
    }
    _renderTabBody(tab);
    if (_focusLineItemId) {
      requestAnimationFrame(() => _applyLineFocusAfterRender(tab));
    }
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
  _shippingValidation = null;
  _shippingAddrDirty = false;
  _lastSuggestedAddress = null;
  _focusLineItemId = null;
}

function _clearWorkspaceNotice() {
  document.getElementById("wsBody")?.querySelector("[data-ws-deeplink-notice]")?.remove();
}

function _showWorkspaceNotice(message, { variant = "warn", actionLabel = null, onAction = null } = {}) {
  const wsBody = document.getElementById("wsBody");
  if (!wsBody) return;
  _clearWorkspaceNotice();

  const notice = document.createElement("div");
  notice.setAttribute("data-ws-deeplink-notice", "1");
  notice.className =
    variant === "info"
      ? "mx-3 sm:mx-6 mt-3 border-4 border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-950"
      : "mx-3 sm:mx-6 mt-3 border-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950";
  notice.innerHTML = `<p class="font-bold">${esc(message)}</p>`;

  if (actionLabel && onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "mt-2 text-[10px] font-black uppercase text-indigo-800 hover:underline border-2 border-indigo-700 px-2 py-1";
    btn.textContent = actionLabel;
    btn.addEventListener("click", onAction);
    notice.appendChild(btn);
  }

  wsBody.prepend(notice);
}

/** @param {string} tab */
function _applyLineFocusAfterRender(tab) {
  if (!_focusLineItemId) return;

  if (tab !== "overview") {
    _showWorkspaceNotice(
      "Line highlight is available on the Overview tab.",
      {
        variant: "info",
        actionLabel: "Switch to Overview",
        onAction: () => {
          if (!_currentRow) return;
          void openWorkspace(_currentRow, { tab: "overview", focusLineItemId: _focusLineItemId });
        },
      },
    );
    return;
  }

  const found = _highlightLineItem(_focusLineItemId);
  if (!found) {
    _showWorkspaceNotice("Order opened, but line could not be found in the loaded items.");
  }
}

/** @param {string} lineItemId @returns {boolean} */
function _highlightLineItem(lineItemId) {
  if (!lineItemId) return false;
  const el = document.querySelector(`[data-ws-line-item="${CSS.escape(String(lineItemId))}"]`);
  if (!el) return false;

  el.classList.add("ring-4", "ring-kkpink", "ring-offset-2", "animate-pulse");
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  window.setTimeout(() => {
    el.classList.remove("animate-pulse");
    window.setTimeout(() => {
      el.classList.remove("ring-4", "ring-kkpink", "ring-offset-2");
    }, 2500);
  }, 3500);

  return true;
}

// ── header ───────────────────────────────────────────────────────
function _populateHeader(row) {
  const status = row.shipment?.label_status || "pending";
  const color = STATUS_COLORS[status] || "bg-green-500";
  const source = getOrderSource(row);
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
    { id: "labels", label: "Labels" },
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
  if (_focusLineItemId) {
    requestAnimationFrame(() => _applyLineFocusAfterRender(tab));
  }
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
  const { order, lineItems, shipment, ctaLabelHistory } = _detail;

  if (tab === "overview") wsBody.innerHTML = renderOverview(order, lineItems, { focusLineItemId: _focusLineItemId });
  else if (tab === "financials") wsBody.innerHTML = renderFinancials(order, shipment);
  else if (tab === "fulfillment") wsBody.innerHTML = renderFulfillment(order, shipment);
  else if (tab === "labels") wsBody.innerHTML = renderLabels(order, ctaLabelHistory);
  else if (tab === "ids") wsBody.innerHTML = renderIds(order);

  if (tab === "overview") {
    populateShippingFields(order, wsBody);
    _renderAddressStatusMount(wsBody);
    _wireShippingAddressButtons(wsBody, order);
    _wireOverviewCustomerActions(wsBody, order);
  } else if (tab === "fulfillment") {
    _populateFulfillmentFields(order, shipment);
    _renderFulfillmentAddrHint(wsBody);
    _wireRefundButtons(wsBody, order);
    _wireLabelButtons(wsBody, order, shipment);
    _wireCtaPrintButton(wsBody, order);
    _trackDirty(wsBody);
  } else if (tab === "labels") {
    _wireCopyButtons(wsBody);
  } else if (tab === "ids") {
    _wireCopyButtons(wsBody);
  }
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

    const prevStatus = previousShipment?.label_status || "pending";
    const nextStatus = saved?.label_status || patch.label_status || "pending";
    const finalizeStatuses = ["shipped", "delivered"];
    if (
      finalizeStatuses.includes(nextStatus) &&
      !finalizeStatuses.includes(prevStatus)
    ) {
      try {
        await finalizeKkOrderReservations({
          stripe_checkout_session_id: _currentRow.stripe_checkout_session_id,
          reference_id: saved?.tracking_number || _currentRow.stripe_checkout_session_id,
        });
      } catch (finErr) {
        console.warn("[workspace] KK reservation finalize failed (non-fatal):", finErr);
      }
    }

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

function _invalidateShippingValidation() {
  _shippingValidation = null;
  _lastSuggestedAddress = null;
}

function _setShippingValidation(apiResult, sessionId) {
  _shippingValidation = {
    sessionId,
    is_valid: Boolean(apiResult?.is_valid),
    messages: apiResult?.messages || [],
    local_issues: apiResult?.local_issues || [],
    suggested: apiResult?.suggested || null,
  };
  if (apiResult?.suggested) _lastSuggestedAddress = apiResult.suggested;
}

function _renderAddressStatusMount(container) {
  const mount = container.querySelector("#addrStatusMount");
  if (!mount) return;

  const order = _detail?.order;
  const sessionId = order?.stripe_checkout_session_id;
  const issues = localAddressIssues(order);

  if (_shippingAddrDirty) {
    mount.innerHTML = renderAddressStatusHtml({ pending: true });
    return;
  }

  if (
    _shippingValidation &&
    _shippingValidation.sessionId === sessionId
  ) {
    mount.innerHTML = renderAddressStatusHtml({
      isValid: _shippingValidation.is_valid,
      issues: _shippingValidation.local_issues || [],
      messages: _shippingValidation.messages || [],
      suggested: _shippingValidation.suggested,
    });
    const applyBtn = mount.querySelector("[data-apply-suggested-address]");
    if (applyBtn) applyBtn.addEventListener("click", () => _applySuggestedAddress(container));
    return;
  }

  if (issues.length) {
    mount.innerHTML = renderAddressStatusHtml({ issues, isValid: null });
    return;
  }

  mount.innerHTML = renderAddressStatusHtml({
    pending: true,
  });
}

function _renderFulfillmentAddrHint(container) {
  const mount = container.querySelector("#fulfillmentAddrHint");
  if (!mount) return;

  const order = _detail?.order;
  const sessionId = order?.stripe_checkout_session_id;
  const labelStatus = _detail?.shipment?.label_status || "pending";
  if (labelStatus !== "pending" && labelStatus !== "voided") {
    mount.innerHTML = "";
    return;
  }

  if (_shippingAddrDirty) {
    mount.innerHTML = renderAddressStatusHtml({ pending: true });
    return;
  }

  if (
    _shippingValidation &&
    _shippingValidation.sessionId === sessionId &&
    _shippingValidation.is_valid
  ) {
    mount.innerHTML = renderAddressStatusHtml({ isValid: true });
    return;
  }

  const issues = localAddressIssues(order);
  if (
    _shippingValidation &&
    _shippingValidation.sessionId === sessionId &&
    !_shippingValidation.is_valid
  ) {
    mount.innerHTML = renderAddressStatusHtml({
      isValid: false,
      issues: _shippingValidation.local_issues || issues,
      messages: _shippingValidation.messages || [],
      suggested: _shippingValidation.suggested,
    });
    return;
  }

  mount.innerHTML = renderAddressStatusHtml({
    issues: issues.length ? issues : ["Validate the shipping address on the Overview tab before buying a label."],
    isValid: issues.length ? null : false,
  });
}

function _showAddrActionMsg(text, isError = false) {
  const el = document.getElementById("addrActionMsg");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
  el.classList.toggle("text-red-600", Boolean(isError));
  el.classList.toggle("text-emerald-700", Boolean(text) && !isError);
}

function _mergeOrderAddress(patch) {
  if (!_detail?.order) return;
  Object.assign(_detail.order, patch);
  if (_currentRow) {
    for (const k of Object.keys(patch)) {
      if (k in _currentRow) _currentRow[k] = patch[k];
    }
  }
}

function _refreshCustomerInfoMount(container, order, { pendingSave = false } = {}) {
  const mount = container.querySelector("#customerInfoMount");
  if (!mount || !order) return;
  mount.innerHTML = renderCustomerInfoSection(order, { pendingSave });
  _wireOverviewCustomerActions(container, order);
}

function _orderFromShippingFields(container, baseOrder) {
  const fields = readShippingFieldsFromDom(container);
  return { ...baseOrder, ...fields };
}

function _focusNameForLabel(container) {
  container.querySelector("#shippingAddressSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => {
    container.querySelector("#addrFirstName")?.focus({ preventScroll: true });
  }, 280);
}

function _applyPrintableName(container, order) {
  const { first_name, last_name } = splitPrintableFirstLast(customerDisplayName(order));
  const firstEl = container.querySelector("#addrFirstName");
  const lastEl = container.querySelector("#addrLastName");
  if (firstEl) firstEl.value = first_name ?? "";
  if (lastEl) lastEl.value = last_name ?? "";
  _shippingAddrDirty = true;
  _invalidateShippingValidation();
  _renderAddressStatusMount(container);
  _refreshCustomerInfoMount(container, _orderFromShippingFields(container, order), { pendingSave: true });
  _showAddrActionMsg("Printable name applied — click Save Address, then Validate.", false);
  _focusNameForLabel(container);
}

function _wireOverviewCustomerActions(container, order) {
  container.querySelector("[data-edit-name-for-label]")?.addEventListener("click", () => {
    _focusNameForLabel(container);
  });
  container.querySelector("[data-use-printable-name]")?.addEventListener("click", () => {
    _applyPrintableName(container, _orderFromShippingFields(container, order));
  });
}

function _applySuggestedAddress(container) {
  const s = _lastSuggestedAddress;
  if (!s) return;
  if (s.street_address) container.querySelector("#addrStreet").value = s.street_address;
  if (s.city) container.querySelector("#addrCity").value = s.city;
  if (s.state) container.querySelector("#addrState").value = s.state;
  if (s.zip) container.querySelector("#addrZip").value = s.zip;
  if (s.country) container.querySelector("#addrCountry").value = s.country;
  _shippingAddrDirty = true;
  _invalidateShippingValidation();
  _renderAddressStatusMount(container);
  _showAddrActionMsg("Suggested address applied — click Save Address, then Validate.", false);
}

function _wireShippingAddressButtons(container, order) {
  const sessionId = order.stripe_checkout_session_id;
  const ids = ["addrFirstName", "addrLastName", "addrStreet", "addrCity", "addrState", "addrZip", "addrCountry"];

  for (const id of ids) {
    const el = container.querySelector(`#${id}`);
    if (!el) continue;
    el.addEventListener("input", () => {
      _shippingAddrDirty = true;
      _invalidateShippingValidation();
      _renderAddressStatusMount(container);
      if (id === "addrFirstName" || id === "addrLastName") {
        _refreshCustomerInfoMount(container, _orderFromShippingFields(container, order), {
          pendingSave: true,
        });
      }
      const hint = document.getElementById("fulfillmentAddrHint");
      if (hint) _renderFulfillmentAddrHint(document.getElementById("wsBody") || container);
    });
  }

  container.querySelector("[data-save-address]")?.addEventListener("click", async (btn) => {
    const fields = readShippingFieldsFromDom(container);
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "Saving…";
    _showAddrActionMsg("");
    try {
      const result = await updateOrderShippingAddress(sessionId, fields);
      _mergeOrderAddress(result.order || fields);
      _shippingAddrDirty = false;
      _invalidateShippingValidation();
      _renderAddressStatusMount(container);
      _refreshCustomerInfoMount(container, _detail?.order || order);
      _populateHeader(_currentRow || order);
      setStatus("Shipping address saved ✓");
      try {
        const validation = await validateOrderShippingAddress(sessionId);
        _setShippingValidation(validation, sessionId);
        _renderAddressStatusMount(container);
        if (validation.is_valid) {
          _showAddrActionMsg("Address saved and validated — OK to buy a label.", false);
        } else {
          _showAddrActionMsg(validation.error || "Saved, but address still needs review.", true);
        }
      } catch (valErr) {
        _showAddrActionMsg(
          "Address saved. Validate manually before buying a label.",
          false,
        );
        console.warn("[workspace] auto-validate after save:", valErr);
      }
      await _onSaved?.();
    } catch (err) {
      _showAddrActionMsg(err.message || "Save failed", true);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  container.querySelector("[data-validate-address]")?.addEventListener("click", async (btn) => {
    if (_shippingAddrDirty) {
      alert("Save the address before validating.");
      return;
    }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "Validating…";
    _showAddrActionMsg("");
    try {
      const result = await validateOrderShippingAddress(sessionId);
      _setShippingValidation(result, sessionId);
      _renderAddressStatusMount(container);
      if (_currentTab === "fulfillment") {
        _renderFulfillmentAddrHint(document.getElementById("wsBody") || container);
      }
      if (result.is_valid) {
        _showAddrActionMsg("Address validated — OK to buy a label.", false);
      } else {
        _showAddrActionMsg(result.error || "Address could not be validated.", true);
      }
    } catch (err) {
      _showAddrActionMsg(err.message || "Validation failed", true);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

function _buyLabelBlockedReason(sessionId, order) {
  if (_shippingAddrDirty) {
    return "Save the shipping address on the Overview tab before buying a label.";
  }
  if (
    !_shippingValidation ||
    _shippingValidation.sessionId !== sessionId ||
    !_shippingValidation.is_valid
  ) {
    const local = localAddressIssues(order);
    if (local.length) {
      return `Shipping address is not valid:\n\n${local.join("\n")}\n\nOverview → Save Address → Validate Address.`;
    }
    return "Validate the shipping address on the Overview tab before buying a label.";
  }
  return null;
}

async function _refreshCtaLabelHistory() {
  if (!_currentRow || !_detail) return;
  try {
    _detail.ctaLabelHistory = await fetchCtaLabelHistory(_currentRow.stripe_checkout_session_id);
    if (_currentTab === "labels") {
      _renderTabBody("labels");
    }
  } catch (err) {
    console.warn("[workspace] CTA label history refresh failed:", err);
  }
}

function _wireCtaPrintButton(container, order) {
  const btn = container.querySelector("[data-print-cta-workspace]");
  if (!btn) return;

  const statusEl = container.querySelector("[data-cta-print-status]");

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const result = await printCtaForOrder(order, { buttonEl: btn });
    setStatus(result.message, Boolean(result.isError));

    if (statusEl) {
      statusEl.textContent = result.message;
      statusEl.classList.toggle("hidden", !result.message);
      statusEl.classList.toggle("text-red-600", Boolean(result.isError));
      statusEl.classList.toggle("text-emerald-700", result.ok && !result.isError);
    }

    if (result.ok) {
      await _refreshCtaLabelHistory();
    }
  });
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

      const blockReason = _buyLabelBlockedReason(sessionId, order);
      if (blockReason) {
        alert(blockReason);
        return;
      }

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
        if (err.addressValidation) {
          _setShippingValidation(
            {
              is_valid: false,
              messages: err.addressValidation.messages,
              local_issues: err.addressValidation.local_issues,
              suggested: err.addressValidation.suggested,
            },
            sessionId,
          );
          _renderFulfillmentAddrHint(container);
        }
        const detail = err.detail ? `\n\n${err.detail}` : "";
        alert("Label purchase failed: " + (err.message || err) + detail);
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

  const btnPushAmazon = container.querySelector("[data-push-amazon-tracking]");
  if (btnPushAmazon) {
    btnPushAmazon.addEventListener("click", async () => {
      btnPushAmazon.disabled = true;
      btnPushAmazon.textContent = "⏳ Pushing…";
      try {
        await confirmAmazonShipment(sessionId);
        alert("Tracking confirmed on Amazon!");
        openWorkspace(_currentRow, { tab: _currentTab });
        await _onSaved?.();
      } catch (err) {
        alert("Amazon push failed: " + (err.message || err));
        btnPushAmazon.disabled = false;
        btnPushAmazon.textContent = "Push to Amazon";
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

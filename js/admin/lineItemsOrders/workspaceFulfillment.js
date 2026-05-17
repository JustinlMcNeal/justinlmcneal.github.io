// /js/admin/lineItemsOrders/workspaceFulfillment.js
// Renders the Fulfillment tab HTML for the order workspace.
// Owns: fulfillment status section, Shippo label action area, Edit Shipment form, Refund section.
// Note: _populateFulfillmentFields, _wireRefundButtons, _wireLabelButtons remain in workspace.js
//       because they interact with API calls and workspace state.
import { sh, fmtDate } from "./workspaceUtils.js";
import { esc, moneyFromCents, getOrderSource } from "./dom.js";

export function renderFulfillment(order, shipment) {
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
  html += buildRefundSectionHtml(order);
  html += "</div>";
  return html;
}

// ── Refund section builder (module-private) ───────────────────────
function buildRefundSectionHtml(order) {
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
        <div class="font-black text-lg text-red-600">${moneyFromCents(order.refund_amount_cents)}</div>
      </div>
      <div class="border-4 border-black p-4 bg-emerald-50">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Net Revenue</div>
        <div class="font-black text-lg text-emerald-600">${moneyFromCents(netRevenue)}</div>
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

  if (getOrderSource(order) === "amazon") {
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

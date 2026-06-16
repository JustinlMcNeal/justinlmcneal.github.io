/**
 * Shipped finalize audit modal (Phase 8E–8G).
 */

import { getDom } from "../dom.js";
import { esc } from "../utils/formatters.js";
import { fetchShippedFinalizeAuditRows } from "../api/shippedFinalizeAuditApi.js";
import { buildLineItemsOrdersUrl } from "../constants/orderLinks.js";
import { applyIssueTableFilter, showInventoryToast } from "../events.js";
import { manualFinalizeButtonHtml, promptManualFinalize } from "./manualFinalizePrompt.js";
import { openMappingAssistModal } from "./mappingAssistModal.js";

const STATUS_BADGE = {
  accounted_for: "bg-green-100 text-green-900 border-green-300",
  missing_finalize_record: "bg-red-100 text-red-900 border-red-300",
  missing_ledger: "bg-red-100 text-red-900 border-red-300",
  skipped_afn: "bg-gray-100 text-gray-600 border-gray-300",
  missing_variant: "bg-amber-100 text-amber-900 border-amber-300",
  refunded_after_ship: "bg-gray-100 text-gray-600 border-gray-300",
  manual_review: "bg-violet-100 text-violet-900 border-violet-300",
};

function closeModal() {
  const mount = getDom().shippedAuditModalMount;
  if (mount) mount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
}

function statusBadge(status) {
  const key = String(status || "manual_review");
  const cls = STATUS_BADGE[key] || STATUS_BADGE.manual_review;
  return `<span class="text-[9px] font-black uppercase border px-1.5 py-0.5 rounded ${cls}">${esc(key.replace(/_/g, " "))}</span>`;
}

/**
 * @param {import('../api/shippedFinalizeAuditApi.js').ShippedFinalizeAuditRow} row
 * @param {number} idx
 */
function auditRowHtml(row, idx) {
  const showMapLine =
    row.suggestedAuditStatus === "missing_variant" && row.sourceChannel === "ebay";

  return `
    <tr class="border-b border-gray-100 align-top" data-variant-id="${esc(row.variantId || "")}">
      <td class="py-2 pr-2 text-[11px]">
        <span class="font-bold block">${esc(row.title || row.productLabel)}</span>
        <span class="text-gray-500 font-mono">${esc(row.sourceChannel)} · ${esc(row.sku)}</span>
        ${statusBadge(row.suggestedAuditStatus)}
      </td>
      <td class="py-2 pr-2 text-[10px] text-gray-600">
        Qty ${row.quantity}<br>
        ${esc(row.fulfillmentStatus || row.orderStatus)}<br>
        ${esc(row.fulfillmentChannel)}
      </td>
      <td class="py-2 text-[10px] text-gray-600">${esc(row.reason)}</td>
      <td class="py-2 text-right whitespace-nowrap">
        <button type="button" data-audit-open-order="${idx}" class="block text-[10px] font-black uppercase text-teal-800 hover:underline mb-1">Order line</button>
        ${
          showMapLine
            ? `<button type="button" data-audit-map-line="${idx}" class="block text-[10px] font-black uppercase text-violet-800 hover:underline mb-1">Map Line →</button>`
            : ""
        }
        ${
          row.variantId
            ? `<button type="button" data-audit-open-variant="${esc(row.variantId)}" class="block text-[10px] font-black uppercase text-gray-700 hover:underline mb-1">Inventory</button>
               <button type="button" data-audit-adjust="${esc(row.variantId)}" class="block text-[10px] font-black uppercase text-amber-800 hover:underline mb-1">Adjust</button>`
            : ""
        }
        ${manualFinalizeButtonHtml(row, idx)}
      </td>
    </tr>`;
}

/**
 * @param {HTMLElement} panel
 * @param {import('../api/shippedFinalizeAuditApi.js').ShippedFinalizeAuditRow[]} rows
 * @param {{ needsAuditOnly?: boolean }} opts
 */
function wirePanel(panel, rows, opts) {
  panel.querySelector("#shippedAuditEbayWorklistBtn")?.addEventListener("click", () => {
    closeModal();
    import("./ebayMappingWorklistModal.js").then((mod) => mod.openEbayMappingWorklistModal());
  });

  panel.querySelectorAll("[data-shipped-audit-close]").forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  panel.querySelectorAll("[data-audit-open-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-audit-open-order"));
      const row = rows[idx];
      if (!row?.sourceOrderId) return;
      window.location.assign(
        buildLineItemsOrdersUrl({
          sessionId: row.sourceOrderId,
          lineId: row.sourceOrderItemId || undefined,
          channel: row.sourceChannel || undefined,
          tab: "overview",
        }),
      );
    });
  });

  panel.querySelectorAll("[data-audit-map-line]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-audit-map-line"));
      const row = rows[idx];
      if (!row) return;
      closeModal();
      void openMappingAssistModal(null, {
        issueType: "unmapped_order_line",
        sourceOrderId: row.sourceOrderId,
        sourceOrderItemId: row.sourceOrderItemId,
      }, {
        fromShippedAudit: true,
        onComplete: () => void openShippedFinalizeAuditModal(opts),
      });
    });
  });

  panel.querySelectorAll("[data-audit-open-variant]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyIssueTableFilter({ tab: "all", issueType: "" });
      closeModal();
      showInventoryToast("Scroll to variant in inventory table.", { variant: "info" });
    });
  });

  panel.querySelectorAll("[data-audit-adjust]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const variantId = btn.getAttribute("data-audit-adjust");
      if (!variantId) return;
      const ok = window.confirm(
        "Open manual adjustment?\n\nOnly adjust if you confirmed this shipped order was never deducted from on-hand stock.",
      );
      if (!ok) return;
      closeModal();
      import("./adjustModal.js").then((mod) => mod.openAdjustModal(variantId));
    });
  });

  panel.querySelectorAll("[data-manual-finalize]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-manual-finalize"));
      const candidate = rows[idx];
      if (!candidate) return;
      void promptManualFinalize(candidate, {
        onComplete: () => void openShippedFinalizeAuditModal(opts),
      });
    });
  });
}

function renderPanel(panel, rows, opts) {
  const needsCount = rows.filter((r) => r.needsAuditIssue).length;
  const eligibleCount = rows.filter((r) => r.isFinalizeEligible).length;
  const ebayMissingVariant = rows.filter(
    (r) => r.suggestedAuditStatus === "missing_variant" && r.sourceChannel === "ebay",
  ).length;

  panel.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Shipped Finalize Audit</p>
        <h2 class="text-lg font-black">Inventory Accounting Review</h2>
        <p class="text-xs text-gray-600">${needsCount} need audit · ${eligibleCount} finalize-eligible · ${ebayMissingVariant} eBay unmapped in sample.</p>
      </div>
      <button type="button" data-shipped-audit-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase">Close</button>
    </div>
    <p class="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
      Map eBay lines first, then use Manual Finalize only if you confirmed stock was never deducted.
      Mapping does not change stock or auto-finalize.
    </p>
    <button type="button" id="shippedAuditEbayWorklistBtn" class="w-full border-2 border-violet-700 text-violet-900 px-3 py-2 text-xs font-black uppercase min-h-[44px]">
      Open eBay Mapping Worklist
    </button>
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm min-w-[520px]">
        <thead>
          <tr class="border-b border-gray-200 text-left text-[9px] font-black uppercase text-gray-400">
            <th class="py-1 pr-2">Line</th>
            <th class="py-1 pr-2">Status</th>
            <th class="py-1 pr-2">Reason</th>
            <th class="py-1 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>${rows.length ? rows.map((r, i) => auditRowHtml(r, i)).join("") : `<tr><td colspan="4" class="py-6 text-center text-xs text-gray-400">No shipped audit rows found.</td></tr>`}</tbody>
      </table>
    </div>`;

  wirePanel(panel, rows, opts);
}

/** @param {{ needsAuditOnly?: boolean, filterOrderId?: string, filterOrderItemId?: string }} [opts] */
export async function openShippedFinalizeAuditModal(opts = {}) {
  const mount = getDom().shippedAuditModalMount;
  if (!mount) return;

  document.body.classList.add("overflow-hidden");
  mount.innerHTML = `
    <div class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <button type="button" class="absolute inset-0 bg-black/50" data-shipped-audit-close aria-label="Close"></button>
      <div class="relative bg-white w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl p-4 space-y-3">
        <p class="text-xs text-gray-500" role="status">Loading audit rows…</p>
      </div>
    </div>`;

  mount.querySelector("[data-shipped-audit-close]")?.addEventListener("click", closeModal);

  let rows = [];
  try {
    rows = await fetchShippedFinalizeAuditRows({
      limit: 40,
      needsAuditOnly: opts.needsAuditOnly ?? false,
    });
    if (opts.filterOrderId) {
      rows = rows.filter((row) => {
        if (row.sourceOrderId !== opts.filterOrderId) return false;
        if (opts.filterOrderItemId && row.sourceOrderItemId !== opts.filterOrderItemId) return false;
        return true;
      });
    }
  } catch (err) {
    const panel = mount.querySelector(".relative");
    if (panel) {
      panel.innerHTML = `<p class="text-red-700 text-sm">${esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
    return;
  }

  const panel = mount.querySelector(".relative");
  if (!panel) return;

  renderPanel(panel, rows, opts);
}

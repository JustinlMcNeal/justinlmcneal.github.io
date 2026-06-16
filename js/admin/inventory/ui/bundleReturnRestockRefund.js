/**
 * Refund observability UI for Bundle Return/Restock panel (Phase 10K/10M/10N).
 */

import { esc } from "../utils/formatters.js";
import { formatCents } from "../api/bundleReturnRestockApi.js";
import {
  refreshOrderRefundDetails,
  refreshMarketplaceObservations,
  REFUND_GUIDANCE_LABELS,
  REFUND_CONFIDENCE_LABELS,
  REFUND_SOURCE_LABELS,
  MARKETPLACE_SYNC_SOURCE_LABELS,
  MARKETPLACE_EVIDENCE_LABELS,
  PANEL_ACTION_LABELS,
} from "../api/refundRefreshApi.js";
import { showInventoryToast } from "../events.js";

/** @typedef {import('../api/returnWorkflowApi.js').ReturnWorkflowGuidanceRow} ReturnWorkflowGuidanceRow */

const MARKETPLACE_GUIDANCE = new Set([
  "marketplace_refund_review",
  "cancellation_detected",
  "return_detected",
  "afn_external_fulfillment_review",
]);

/** @param {ReturnWorkflowGuidanceRow} row */
function isStripeRefreshEligible(row) {
  const ch = row.refundSourceChannel || row.orderChannel;
  return ch === "stripe" || ch === "kk" || row.sourceOrderId?.startsWith("cs_");
}

/** @param {ReturnWorkflowGuidanceRow} row */
function isMarketplaceOrder(row) {
  return (
    row.refundSourceChannel === "ebay" ||
    row.refundSourceChannel === "amazon" ||
    row.orderChannel === "ebay" ||
    row.orderChannel === "amazon"
  );
}

/** @param {string|null|undefined} iso */
function formatFreshness(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

/** @param {ReturnWorkflowGuidanceRow} row */
export function renderRefundBlock(row) {
  const rgStatus = row.refundGuidanceStatus || "no_refund";
  const rgLabel = REFUND_GUIDANCE_LABELS[rgStatus] || rgStatus || "—";
  const sourceLabel =
    REFUND_SOURCE_LABELS[row.refundSourceChannel] ||
    REFUND_SOURCE_LABELS[row.orderChannel] ||
    row.refundSourceChannel ||
    "—";
  const confLabel =
    REFUND_CONFIDENCE_LABELS[row.marketplaceLineConfidence || row.refundConfidence] ||
    row.refundConfidence ||
    "—";
  const syncLabel = row.marketplaceSyncSource
    ? MARKETPLACE_SYNC_SOURCE_LABELS[row.marketplaceSyncSource] || row.marketplaceSyncSource
    : null;
  const lineEvidence =
    row.marketplaceLineConfidence === "line_confirmed"
      ? "Finance/order line reference"
      : row.marketplaceLineConfidence === "sku_inferred"
        ? "SKU inferred — manual review"
        : rgStatus === "cancellation_detected"
          ? row.orderChannel === "amazon"
            ? "Amazon canceled order retained"
            : "eBay cancellation update"
          : null;
  const panelHint = row.suggestedPanelAction
    ? PANEL_ACTION_LABELS[row.suggestedPanelAction] || row.suggestedPanelAction
    : null;
  const refundDate = row.latestPersistedObsAt || row.latestRefundAt || row.orderRefundedAt || row.latestMarketplaceObsAt;
  const isPartial =
    rgStatus === "partial_refund_detected" || row.guidanceStatus === "partial_refund_review";
  const isMarketplace = isMarketplaceOrder(row);
  const showMarketplaceCopy = isMarketplace;
  const showAfnCopy = row.isAmazonAfn && rgStatus === "afn_external_fulfillment_review";

  return `
    <div class="border border-sky-200 bg-sky-50/70 rounded p-1.5 space-y-1">
      <p class="text-[9px] font-black uppercase text-sky-900">
        Refund · ${esc(sourceLabel)} · ${esc(rgLabel)}
      </p>
      <p class="text-[9px] text-sky-800">
        ${row.refundedAmountCents != null ? formatCents(row.refundedAmountCents) : "—"}
        of ${formatCents(row.orderTotalCents)}
        · ${esc(row.refundStatus || "none")}
        · confidence: ${esc(confLabel)}
        ${refundDate ? ` · observed ${esc(formatFreshness(refundDate) || refundDate)}` : ""}
        ${syncLabel && isMarketplace ? ` · sync: ${esc(syncLabel)}` : ""}
        ${row.refundDetailCount != null && row.refundSourceChannel === "stripe" ? ` · ${row.refundDetailCount} Stripe detail row(s)` : ""}
        ${row.persistedObservationCount != null && row.persistedObservationCount > 0 ? ` · ${row.persistedObservationCount} persisted obs.` : ""}
        ${row.marketplaceObservationCount != null && isMarketplace && !row.persistedObservationCount ? ` · ${row.marketplaceObservationCount} marketplace obs.` : ""}
      </p>
      ${lineEvidence && isMarketplace ? `<p class="text-[9px] text-sky-900">Evidence: ${esc(lineEvidence)}</p>` : ""}
      ${
        showMarketplaceCopy
          ? `<p class="text-[9px] text-amber-900 bg-amber-50 border border-amber-100 rounded p-1">Marketplace refund data is observational and may be order-level. Confirm physical return before restocking.</p>`
          : ""
      }
      ${
        showAfnCopy
          ? `<p class="text-[9px] text-purple-900 bg-purple-50 border border-purple-100 rounded p-1">Amazon AFN/FBA fulfillment — local inventory return/restock requires manual review.</p>`
          : ""
      }
      ${
        isPartial
          ? `<p class="text-[9px] text-orange-900 bg-orange-50 border border-orange-100 rounded p-1">Manual review — refund may not represent returned quantity.</p>`
          : ""
      }
      ${
        rgStatus === "full_refund_detected" && !row.workflowId
          ? `<p class="text-[9px] text-amber-900 bg-amber-50 border border-amber-100 rounded p-1">Suggested: create return workflow after confirming physical return.</p>`
          : ""
      }
      ${panelHint ? `<p class="text-[9px] font-bold text-sky-950">${esc(panelHint)}</p>` : ""}
      ${
        isStripeRefreshEligible(row)
          ? `<button type="button" data-refresh-refund="${esc(row.sourceOrderId)}"
        class="border border-sky-700 text-sky-900 px-1.5 py-0.5 text-[8px] font-black uppercase">Refresh Stripe Refund Data</button>`
          : ""
      }
      ${
        isMarketplace
          ? `<button type="button" data-refresh-marketplace="${esc(row.sourceOrderId)}"
        class="border border-amber-700 text-amber-950 px-1.5 py-0.5 text-[8px] font-black uppercase ml-1">Refresh Marketplace Observations</button>`
          : ""
      }
    </div>`;
}

/** @param {HTMLElement} container @param {() => Promise<void>} reload */
export function wireRefundPanelActions(container, reload) {
  container.querySelectorAll("[data-refresh-refund]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const orderId = btn.getAttribute("data-refresh-refund");
      if (!orderId) return;
      btn.setAttribute("disabled", "true");
      try {
        await refreshOrderRefundDetails(orderId);
        showInventoryToast("Stripe refund data refreshed.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      } finally {
        btn.removeAttribute("disabled");
      }
    });
  });

  container.querySelectorAll("[data-refresh-marketplace]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const orderId = btn.getAttribute("data-refresh-marketplace");
      if (!orderId) return;
      btn.setAttribute("disabled", "true");
      try {
        const channel = orderId.startsWith("amazon_") ? "amazon" : "ebay";
        const result = await refreshMarketplaceObservations({ channel, sourceOrderId: orderId });
        const ins = result?.inserted ?? 0;
        const upd = result?.updated ?? 0;
        const conf = result?.confidence_counts ?? {};
        showInventoryToast(
          `Observations refreshed (${ins} new, ${upd} updated).` +
            (conf.line_confirmed ? ` Line confirmed: ${conf.line_confirmed}.` : ""),
          { variant: "success" },
        );
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      } finally {
        btn.removeAttribute("disabled");
      }
    });
  });

  container.querySelectorAll("[data-copy-order-ref]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(btn.getAttribute("data-copy-order-ref") || "");
        showInventoryToast("Order reference copied.", { variant: "success" });
      } catch {
        showInventoryToast("Could not copy to clipboard.", { variant: "error" });
      }
    });
  });
}

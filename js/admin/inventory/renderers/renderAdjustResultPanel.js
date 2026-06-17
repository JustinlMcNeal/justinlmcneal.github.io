/**
 * Adjust orchestration result panel markup (Phase 059A.4 — render only).
 */

import { esc } from "../utils/formatters.js";
import { AMAZON_LISTINGS_PAGE, EBAY_LISTINGS_PAGE } from "../constants/channelLinks.js";
import {
  ADJUST_KK_SUCCESS_COPY,
  ADJUST_NO_ROLLBACK_COPY,
  ADJUST_PARTIAL_BANNER_TITLE,
  ADJUST_PARTIAL_CHANNEL_FAILURE_COPY,
  hasPartialChannelFailure,
} from "../services/adjustOrchestratorSummary.js";

const STATUS_LABEL = {
  success: "Success",
  failed: "Failed",
  skipped: "Skipped",
  next_step: "Manual step",
  pending: "Pending",
  manual: "Manual review required",
  dry_run: "Preview only",
};

const STATUS_TONE = {
  success: "border-green-200 bg-green-50 text-green-900",
  failed: "border-red-200 bg-red-50 text-red-900",
  skipped: "border-gray-200 bg-gray-50 text-gray-700",
  next_step: "border-amber-200 bg-amber-50 text-amber-950",
  pending: "border-blue-200 bg-blue-50 text-blue-900",
  manual: "border-amber-200 bg-amber-50 text-amber-950",
  dry_run: "border-amber-200 bg-amber-50 text-amber-950",
};

/**
 * @param {{ label: string, status: string, message: string, runId?: string|null, detail?: string|null, links?: Array<{ label: string, action: string, href?: string }> }} card
 */
function renderResultCard(card) {
  const tone = STATUS_TONE[card.status] || STATUS_TONE.skipped;
  const statusLabel = STATUS_LABEL[card.status] || card.status;
  const links = (card.links || [])
    .map(
      (l) => `
        <button
          type="button"
          class="text-[11px] font-bold underline underline-offset-2 hover:opacity-80 min-h-[32px]"
          data-adjust-result-link="${esc(l.action)}"
          ${l.href ? `data-adjust-result-href="${esc(l.href)}"` : ""}
          aria-label="${esc(l.label)}"
        >${esc(l.label)}</button>
      `,
    )
    .join('<span class="text-gray-300 mx-1">·</span>');

  return `
    <div class="rounded-lg border px-3 py-2.5 ${tone}" data-adjust-result-card="${esc(card.label.toLowerCase())}">
      <div class="flex items-start justify-between gap-2">
        <p class="text-[10px] font-black uppercase tracking-wide opacity-70">${esc(card.label)}</p>
        <span class="text-[10px] font-black uppercase tracking-wide" data-adjust-result-status="${esc(card.status)}" aria-label="Status: ${esc(statusLabel)}">${esc(statusLabel)}</span>
      </div>
      <p class="text-xs font-bold leading-snug mt-1">${esc(card.message)}</p>
      ${card.detail ? `<p class="text-[11px] text-gray-600 mt-1 leading-snug">${esc(card.detail)}</p>` : ""}
      ${card.runId ? `<p class="text-[10px] font-mono text-gray-600 mt-1">Run: ${esc(card.runId)}</p>` : ""}
      ${links ? `<div class="flex flex-wrap items-center gap-0.5 mt-2">${links}</div>` : ""}
    </div>
  `;
}

/**
 * @param {import('../services/adjustChannelOrchestrator.js').AdjustOrchestrationResult} result
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow} row
 */
export function renderAdjustResultPanel(result, row) {
  const sign = result.kk.delta > 0 ? "+" : "";
  const kkDetail =
    result.kk.status === "success"
      ? `${sign}${result.kk.delta} → ${result.kk.stockAfter} on hand`
      : result.kk.message;

  const partialBanner = hasPartialChannelFailure(result)
    ? `
      <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1 text-xs text-amber-950" data-adjust-result-partial role="alert">
        <p class="font-black">${esc(ADJUST_PARTIAL_BANNER_TITLE)}</p>
        <p class="font-bold">${esc(ADJUST_PARTIAL_CHANNEL_FAILURE_COPY)}</p>
        <p class="text-[11px] font-medium text-amber-900">${esc(ADJUST_NO_ROLLBACK_COPY)}</p>
      </div>
    `
    : "";

  const warnings = result.warnings.length
    ? `
      <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1" data-adjust-result-warnings>
        <p class="text-[10px] font-black uppercase tracking-wide text-amber-800">Warnings</p>
        ${result.warnings.map((w) => `<p class="text-xs text-amber-950">${esc(w)}</p>`).join("")}
      </div>
    `
    : "";

  const errors = result.errors.length
    ? `
      <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-1" data-adjust-result-errors>
        <p class="text-[10px] font-black uppercase tracking-wide text-red-800">Errors</p>
        ${result.errors.map((e) => `<p class="text-xs text-red-900">${esc(e)}</p>`).join("")}
      </div>
    `
    : "";

  const channelLinks = (step, channel) => {
    /** @type {Array<{ label: string, action: string, href?: string }>} */
    const links = [];
    const add = (link) => {
      if (!links.some((l) => l.action === link.action && l.label === link.label)) links.push(link);
    };

    if (step.status === "failed") {
      add({ label: "Retry via Sync Channels", action: "sync-channels" });
      if (channel === "amazon") {
        add({
          label: "Amazon Listings",
          action: "amazon-admin",
          href: step.nextStepUrl || AMAZON_LISTINGS_PAGE,
        });
      }
      if (channel === "ebay") {
        add({
          label: "eBay Listings",
          action: "ebay-admin",
          href: step.nextStepUrl || EBAY_LISTINGS_PAGE,
        });
      }
    }

    if (step.status === "dry_run") {
      add({ label: "Sync Channels", action: "sync-channels" });
      if (channel === "amazon") {
        add({ label: "Amazon Listings", action: "amazon-admin", href: AMAZON_LISTINGS_PAGE });
      }
      if (channel === "ebay" && step.action === "ended_needs_relist") {
        add({
          label: "eBay Relist Assist",
          action: "ebay-relist",
          href: step.nextStepUrl || EBAY_LISTINGS_PAGE,
        });
      } else if (channel === "ebay" && step.action === "variation_group_relist") {
        add({
          label: "eBay Relist Assist",
          action: "ebay-relist",
          href: step.nextStepUrl || EBAY_LISTINGS_PAGE,
        });
        add({
          label: "eBay Listings",
          action: "ebay-admin",
          href: step.nextStepUrl || EBAY_LISTINGS_PAGE,
        });
      } else if (channel === "ebay" && step.action === "variation_update_qty") {
        add({
          label: "eBay Listings",
          action: "ebay-admin",
          href: step.nextStepUrl || EBAY_LISTINGS_PAGE,
        });
      } else if (channel === "ebay") {
        add({
          label: "eBay Listings",
          action: "ebay-admin",
          href: step.nextStepUrl || EBAY_LISTINGS_PAGE,
        });
      }
    }

    if (step.status === "manual" || step.status === "next_step") {
      if (channel === "ebay" && step.action === "ended_needs_relist" && step.nextStepUrl) {
        add({ label: "Open Relist Assist", action: "ebay-relist", href: step.nextStepUrl });
      } else if (channel === "ebay" && step.action === "variation_group_relist" && step.nextStepUrl) {
        add({ label: "Open Relist Assist", action: "ebay-relist", href: step.nextStepUrl });
        add({ label: "eBay Listings", action: "ebay-admin", href: step.nextStepUrl });
      } else if (channel === "ebay" && step.action === "variation_update_qty" && step.nextStepUrl) {
        add({ label: "eBay Listings", action: "ebay-admin", href: step.nextStepUrl });
      } else if (channel === "ebay" && step.action === "variation_qty_cache_missing") {
        add({ label: "Open Sync Channels", action: "sync-channels" });
        add({ label: "eBay Listings", action: "ebay-admin", href: EBAY_LISTINGS_PAGE });
      } else if (channel === "ebay" && step.action === "unsupported_variation") {
        add({
          label: "Open Relist Assist",
          action: "ebay-relist",
          href: step.nextStepUrl || EBAY_LISTINGS_PAGE,
        });
        add({ label: "eBay Listings", action: "ebay-admin", href: EBAY_LISTINGS_PAGE });
      } else if (channel === "amazon" && step.nextStepUrl) {
        add({ label: "Amazon Listings", action: "amazon-admin", href: step.nextStepUrl });
      } else if (channel === "ebay" && step.nextStepUrl) {
        add({ label: "eBay Listings", action: "ebay-admin", href: step.nextStepUrl });
      }
      add({ label: "Open Sync Channels", action: "sync-channels" });
    }

    if (
      channel === "ebay" &&
      (step.action === "ended_needs_relist" || step.action === "variation_group_relist") &&
      step.status === "failed" &&
      step.nextStepUrl
    ) {
      add({ label: "eBay Relist Assist", action: "ebay-relist", href: step.nextStepUrl });
    }

    if (channel === "ebay" && step.action === "variation_update_qty" && step.status === "failed") {
      add({ label: "Retry via Sync Channels", action: "sync-channels" });
      add({
        label: "eBay Listings",
        action: "ebay-admin",
        href: step.nextStepUrl || EBAY_LISTINGS_PAGE,
      });
    }

    return links;
  };

  const ebayDetail = (() => {
    const parts = [];
    if (result.ebay.detail) parts.push(result.ebay.detail);
    if (result.ebay.groupKey) parts.push(`Group: ${result.ebay.groupKey}`);
    if (result.ebay.listingId) parts.push(`Listing: ${result.ebay.listingId}`);
    if (result.ebay.offerId) parts.push(`Offer: ${result.ebay.offerId}`);
    return parts.length ? parts.join(" · ") : null;
  })();

  const cards = [
    {
      label: "KK",
      status: result.kk.status,
      message:
        result.kk.status === "success" ? ADJUST_KK_SUCCESS_COPY : result.kk.message || kkDetail,
      runId: null,
      links: [{ label: "Find in inventory", action: "inventory-row" }],
    },
    {
      label: "Amazon",
      status: result.amazon.status,
      message: result.amazon.message,
      runId: result.amazon.runId || null,
      links: channelLinks(result.amazon, "amazon"),
    },
    {
      label: "eBay",
      status: result.ebay.status,
      message: result.ebay.message,
      detail: ebayDetail,
      runId: result.ebay.runId || null,
      links: channelLinks(result.ebay, "ebay"),
    },
  ];

  return `
    <div class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" data-adjust-result-overlay>
      <div class="absolute inset-0 bg-black/50" data-adjust-result-close aria-hidden="true"></div>
      <div
        class="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl max-h-[92vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventoryAdjustResultTitle"
        data-adjust-result-panel
      >
        <header class="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-[10px] font-black uppercase tracking-[.16em] text-gray-500">Adjustment complete</p>
            <h2 id="inventoryAdjustResultTitle" class="text-base font-black text-gray-900 mt-0.5">Results</h2>
          </div>
          <button type="button" data-adjust-result-close class="p-2 text-gray-500 hover:text-gray-900 min-h-[44px] min-w-[44px]" aria-label="Close">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="p-4 space-y-4">
          <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p class="font-bold text-sm text-gray-900">${esc(row.title)}</p>
            <p class="text-xs text-gray-600 mt-0.5">${esc(row.variantDetail || row.variant)}</p>
            <p class="text-[11px] font-mono text-gray-500 mt-1">${esc(row.internalSku)}</p>
            ${result.kk.status === "success" ? `<p class="text-xs text-gray-700 mt-2 font-mono tabular-nums">${esc(kkDetail)}</p>` : ""}
          </div>

          ${partialBanner}
          ${warnings}
          ${errors}

          <div class="space-y-2" data-adjust-result-cards>
            ${cards.map((c) => renderResultCard(c)).join("")}
          </div>

          <div class="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[11px] text-gray-600 space-y-0.5 font-mono" data-adjust-result-meta>
            ${result.orchestrationId ? `<p>Orchestration: <span class="select-all">${esc(result.orchestrationId)}</span></p>` : ""}
            ${result.kk.ledgerId ? `<p>Ledger: <span class="select-all">${esc(result.kk.ledgerId)}</span></p>` : ""}
          </div>

          <button
            type="button"
            data-adjust-result-done
            class="w-full border-4 border-black bg-black text-white font-black text-sm py-3 min-h-[48px] hover:bg-gray-900"
            aria-label="Done — close results"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  `;
}

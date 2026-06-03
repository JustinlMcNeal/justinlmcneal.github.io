import { qs, show } from "./dom.js";
import { closeAmazonModals } from "./modals.js";
import { formatListingMoney } from "./listingProfit.js";
import {
  getFulfillmentBadge,
  getFulfillmentChannelLabel,
  isFbaListing,
} from "./listingFulfillment.js";
import {
  getHealthBadge,
  getHealthReasons,
  getHealthSummaryText,
  getOpenIssueCount,
} from "./listingHealth.js";
import { escapeHtml } from "./renderListings.js";
import { listingDisplayPrice } from "./listingOfferPrice.js";

/** @param {unknown} value */
function formatSyncedDate(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** @param {unknown} value */
function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function setDetail(id, value) {
  const el = qs(`#${id}`);
  if (el) el.textContent = value;
}

/** @param {Record<string, unknown>} row */
export function hydrateAmazonListingDetailsModal(row) {
  const title = String(row.kk_product_title || row.amazon_title || "Untitled Amazon Listing");
  const badge = getHealthBadge(row);
  const fulfillmentBadge = getFulfillmentBadge(row);
  const reasons = getHealthReasons(row);
  const openIssues = getOpenIssueCount(row);

  setDetail("amazonDetailsTitle", title);
  setDetail("amazonDetailsAsin", String(row.asin || "—"));
  setDetail("amazonDetailsSku", String(row.kk_sku || row.seller_sku || "—"));
  setDetail("amazonDetailsStatus", String(row.listing_status || "—"));
  setDetail("amazonDetailsPrice", formatListingMoney(listingDisplayPrice(row), row.currency));
  setDetail("amazonDetailsInventory", String(row.amazon_fulfillable_qty ?? row.fbm_quantity ?? "—"));
  setDetail("amazonDetailsFulfillment", `${fulfillmentBadge.label} · ${getFulfillmentChannelLabel(row)}`);
  setDetail("amazonDetailsFbaFulfillable", isFbaListing(row)
    ? String(row.fba_fulfillable_quantity ?? "—")
    : "n/a");
  setDetail("amazonDetailsFbaReserved", isFbaListing(row)
    ? String(row.fba_reserved_quantity ?? "0")
    : "n/a");
  setDetail("amazonDetailsFbaInbound", isFbaListing(row)
    ? String(row.fba_inbound_quantity ?? "0")
    : "n/a");
  setDetail("amazonDetailsKkStock", String(row.kk_stock ?? "—"));
  setDetail("amazonDetailsSynced", formatSyncedDate(row.last_synced_at));
  const errorCount = Number(row.error_issue_count || 0);
  const warningCount = Number(row.warning_issue_count || 0);
  let issueCountText = openIssues > 0 ? `${openIssues} open` : "None";
  if (openIssues > 0 && (errorCount > 0 || warningCount > 0)) {
    const parts = [];
    if (errorCount > 0) parts.push(`${errorCount} error`);
    if (warningCount > 0) parts.push(`${warningCount} warning`);
    issueCountText = `${openIssues} open (${parts.join(", ")})`;
  }
  setDetail("amazonDetailsIssueCount", issueCountText);
  setDetail("amazonDetailsLatestIssue", row.latest_issue_message
    ? String(row.latest_issue_message)
    : "—");
  setDetail("amazonDetailsLatestIssueMeta", row.latest_issue_code
    ? `${row.latest_issue_code}${row.latest_issue_source ? ` · ${row.latest_issue_source}` : ""}${row.latest_issue_at ? ` · ${formatDateTime(row.latest_issue_at)}` : ""}`
    : "—");
  setDetail("amazonDetailsSyncError", row.latest_sync_error_message
    ? String(row.latest_sync_error_message)
    : "—");
  setDetail("amazonDetailsSyncErrorMeta", Number(row.recent_sync_error_count || 0) > 0
    ? `${row.recent_sync_error_count} in last 7 days${row.latest_sync_error_at ? ` · ${formatDateTime(row.latest_sync_error_at)}` : ""}`
    : "None in last 7 days");
  setDetail("amazonDetailsSummary", getHealthSummaryText(row));

  const reasonsEl = qs("#amazonDetailsReasons");
  if (reasonsEl) {
    if (reasons.length === 0) {
      reasonsEl.innerHTML = '<p class="text-xs text-gray-400">No health reasons recorded.</p>';
    } else {
      reasonsEl.innerHTML = reasons.map((reason) =>
        `<span class="inline-flex px-2 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 mr-1 mb-1">${escapeHtml(reason)}</span>`,
      ).join("");
    }
  }

  const healthBadgeEl = qs("#amazonDetailsHealthBadge");
  if (healthBadgeEl) {
    healthBadgeEl.className = `inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${badge.className}`;
    healthBadgeEl.textContent = badge.label;
  }
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ focus?: "issues" }} [options]
 */
export function openAmazonListingDetailsModal(row, options = {}) {
  const modal = qs("#amazonListingDetailsModal");
  if (!modal) return;

  closeAmazonModals();
  hydrateAmazonListingDetailsModal(row);

  const focusIssues = options.focus === "issues";
  const titleEl = qs("#amazonListingDetailsModalTitle");
  const descEl = qs("#amazonListingDetailsModalDesc");
  const issueSection = qs("#amazonDetailsIssueSection");
  const issueHeading = qs("#amazonDetailsIssueHeading");

  if (titleEl) {
    titleEl.textContent = focusIssues ? "Issue Details" : "Listing Details";
  }
  if (descEl) {
    descEl.textContent = focusIssues
      ? "Open Amazon issues reported during the latest sync for this listing."
      : "Read-only health and sync summary for this Amazon listing.";
  }
  issueSection?.classList.toggle("border-red-300", focusIssues);
  issueSection?.classList.toggle("bg-red-50/40", focusIssues);

  show(modal);
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  if (focusIssues) {
    issueSection?.scrollIntoView({ block: "nearest" });
    issueHeading?.focus?.({ preventScroll: true });
  } else {
    titleEl?.focus?.({ preventScroll: true });
  }
}

export function initAmazonListingDetails() {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-action="close-listing-details-modal"]')) {
      closeAmazonModals();
    }
  });

  return { openAmazonListingDetailsModal };
}

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
  setDetail("amazonDetailsPrice", formatListingMoney(row.price, row.currency));
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
  setDetail("amazonDetailsIssueCount", openIssues > 0 ? `${openIssues} open` : "None");
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

/** @param {Record<string, unknown>} row */
export function openAmazonListingDetailsModal(row) {
  const modal = qs("#amazonListingDetailsModal");
  if (!modal) return;

  closeAmazonModals();
  hydrateAmazonListingDetailsModal(row);
  show(modal);
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  const title = qs("#amazonListingDetailsModalTitle");
  title?.focus?.({ preventScroll: true });
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

/**
 * Adjust orchestration result panel controller (Phase 059A.4).
 */

import { renderAdjustResultPanel } from "../renderers/renderAdjustResultPanel.js";
import { AMAZON_LISTINGS_PAGE, EBAY_LISTINGS_PAGE } from "../constants/channelLinks.js";
import { kkEbayListingsAdminUrl } from "../api/ebayRelistAssistApi.js";

/**
 * @param {HTMLElement} mount
 * @param {import('../services/adjustChannelOrchestrator.js').AdjustOrchestrationResult} result
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow} row
 * @param {{ onDone: () => void }} handlers
 */
export function showAdjustResultPanel(mount, result, row, { onDone }) {
  mount.innerHTML = renderAdjustResultPanel(result, row);
  wireAdjustResultPanelActions(mount, result, row, { onDone });
}

/**
 * @param {HTMLElement} mount
 * @param {import('../services/adjustChannelOrchestrator.js').AdjustOrchestrationResult} result
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow} row
 * @param {{ onDone: () => void }} handlers
 */
function wireAdjustResultPanelActions(mount, result, row, { onDone }) {
  const close = () => onDone();

  mount.querySelectorAll("[data-adjust-result-close], [data-adjust-result-done]").forEach((el) => {
    el.addEventListener("click", close);
  });

  mount.querySelectorAll("[data-adjust-result-link]").forEach((el) => {
    el.addEventListener("click", () => {
      const action = el.getAttribute("data-adjust-result-link");
      const href = el.getAttribute("data-adjust-result-href");
      handleResultLink(action, href, row, result);
    });
  });
}

/**
 * @param {string|null} action
 * @param {string|null} href
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow} row
 * @param {import('../services/adjustChannelOrchestrator.js').AdjustOrchestrationResult} result
 */
function handleResultLink(action, href, row, result) {
  switch (action) {
    case "sync-channels":
      void import("./syncDryRunModal.js").then((mod) =>
        mod.openSyncDryRunModal({
          highlightSku: row.shortSku || row.internalSku || undefined,
          highlightVariantId: row.id,
          contextNote: result.orchestrationId
            ? `Retry after adjust orchestration ${result.orchestrationId}`
            : "Retry channel sync after adjust",
        }),
      );
      break;
    case "amazon-admin":
      window.open(href || AMAZON_LISTINGS_PAGE, "_blank", "noopener,noreferrer");
      break;
    case "ebay-admin":
      window.open(href || EBAY_LISTINGS_PAGE, "_blank", "noopener,noreferrer");
      break;
    case "ebay-relist": {
      const productCode = String(row.shortSku || row.internalSku || "").trim();
      const url = href || (productCode ? kkEbayListingsAdminUrl(productCode) : EBAY_LISTINGS_PAGE);
      window.open(url, "_blank", "noopener,noreferrer");
      break;
    }
    case "inventory-row":
      window.location.hash = `variant-${row.id}`;
      break;
    default:
      break;
  }
}

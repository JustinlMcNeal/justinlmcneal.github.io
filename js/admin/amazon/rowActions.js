import { qs, qsa, setExpanded } from "./dom.js";
import { closeAmazonModals, isAmazonModalOpen } from "./modals.js";
import { syncAmazonListingSku } from "./api.js";
import { amazonProductUrl } from "./listingsExport.js";
import { showAmazonNotification } from "./notifications.js";

/** @type {HTMLElement | null} */
let popoverEl = null;

/** @type {HTMLButtonElement | null} */
let activeTrigger = null;

/** @type {boolean} */
let syncingSku = false;

const MENU_ITEM_CLASS =
  "block w-full text-left px-3 py-2.5 text-xs font-bold text-gray-800 hover:bg-kkpeach/50 border-b border-gray-100 last:border-b-0 focus:outline-none focus:bg-kkpeach/40";

const COMING_SOON_ACTIONS = new Set([
  "continue-draft",
  "preview-issues",
  "preview-amazon-issues",
  "submit-later",
  "resolve-issue",
  "view-issue-details",
]);

function closePopover() {
  if (!popoverEl) return;

  popoverEl.remove();
  popoverEl = null;

  if (activeTrigger) {
    setExpanded(activeTrigger, false);
    activeTrigger = null;
  }
}

/**
 * @param {DOMRect} rect
 * @param {number} menuWidth
 * @param {number} menuHeight
 */
function positionPopover(rect, menuWidth, menuHeight) {
  if (!popoverEl) return;

  const padding = 8;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let top = rect.bottom + padding;
  let left = rect.right - menuWidth;

  if (left < padding) left = padding;
  if (left + menuWidth > viewportW - padding) {
    left = viewportW - menuWidth - padding;
  }

  if (top + menuHeight > viewportH - padding) {
    top = rect.top - menuHeight - padding;
  }
  if (top < padding) top = padding;

  popoverEl.style.top = `${top}px`;
  popoverEl.style.left = `${left}px`;
}

/**
 * @param {HTMLButtonElement} trigger
 * @param {Record<string, unknown>} options
 */
async function handleRowAction(action, trigger, options) {
  const listingId = trigger.dataset.listingId || "";
  const row = options.getRowById?.(listingId);

  if (action === "view-details") {
    if (row) {
      options.openListingDetails?.(row);
    } else {
      showAmazonNotification("Listing details unavailable.", { tone: "warning" });
    }
    return;
  }

  if (action === "view-on-amazon") {
    const url = amazonProductUrl(
      row?.marketplace_id || trigger.dataset.marketplaceId,
      row?.asin || trigger.dataset.asin,
    );
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      showAmazonNotification("No ASIN available for this listing.", { tone: "warning" });
    }
    return;
  }

  if (action === "edit-listing" || action === "update-inventory") {
    const auth = options.getAuthState?.();
    if (!auth?.connected || auth?.tokenStatus !== "active") {
      showAmazonNotification("Connect Amazon before editing listings.", { tone: "warning" });
      return;
    }
    if (!row) {
      showAmazonNotification("Listing unavailable.", { tone: "warning" });
      return;
    }
    options.openPatchModal?.(row, action === "update-inventory" ? "inventory" : "edit");
    return;
  }

  if (action === "delete-draft") {
    const draftId = String(trigger.dataset.draftId || row?.draft_id || "").trim();
    if (!draftId) {
      showAmazonNotification("No draft linked to this listing.", { tone: "warning" });
      return;
    }
    options.deleteDraft?.(draftId, {
      draftStatus: trigger.dataset.draftStatus || String(row?.draft_status || ""),
      title: String(row?.kk_product_title || row?.kk_sku || trigger.dataset.sku || ""),
    });
    return;
  }

  if (action === "sync-sku") {
    const auth = options.getAuthState?.();
    if (!auth?.connected || auth?.tokenStatus !== "active") {
      showAmazonNotification("Connect Amazon before syncing a SKU.", { tone: "warning" });
      return;
    }

    const sellerSku = String(row?.seller_sku || row?.kk_sku || trigger.dataset.sellerSku || "").trim();
    if (!sellerSku) {
      showAmazonNotification("No seller SKU available to sync.", { tone: "warning" });
      return;
    }

    if (syncingSku) {
      showAmazonNotification("Another SKU sync is already running.", { tone: "warning" });
      return;
    }

    syncingSku = true;
    try {
      const result = await syncAmazonListingSku(sellerSku);
      const updated = Number(result.recordsUpdated || 0);
      const failed = Number(result.recordsFailed || 0);
      const status = String(result.status || "success");

      if (status === "failed" || result.ok === false) {
        showAmazonNotification(`Sync failed for SKU ${sellerSku}.`, { tone: "error" });
      } else if (failed > 0) {
        showAmazonNotification(`Sync finished with errors for SKU ${sellerSku}.`, { tone: "warning" });
      } else {
        showAmazonNotification(
          `Synced SKU ${sellerSku}${updated ? ` — ${updated} row updated` : ""}.`,
          { tone: "success" },
        );
      }

      await options.onSyncComplete?.();
    } catch (err) {
      const code = err?.code || "request_failed";
      const messages = {
        amazon_not_connected: "Amazon is not connected.",
        token_refresh_failed: "Amazon token refresh failed. Try reconnecting.",
        sp_api_request_failed: "Amazon sync request failed.",
        server_misconfigured: "Amazon sync is not configured on the server.",
        unauthorized: "Please sign in as an admin to sync Amazon.",
      };
      showAmazonNotification(messages[code] || "SKU sync failed.", { tone: "error" });
    } finally {
      syncingSku = false;
    }
    return;
  }

  if (COMING_SOON_ACTIONS.has(action)) {
    showAmazonNotification("That action is coming soon.", { tone: "info" });
    return;
  }

  showAmazonNotification("Unknown action.", { tone: "warning" });
}

/**
 * @param {HTMLButtonElement} trigger
 * @param {{ beforeOpen?: () => void, getRowById?: (id: string) => Record<string, unknown> | null, getAuthState?: () => Record<string, unknown> | null, onSyncComplete?: () => Promise<void> | void }} options
 */
function openPopover(trigger, options = {}) {
  const template = qs("#amazonRowActionMenuTemplate");
  if (!template) return;

  const status = trigger.dataset.status || "active";
  const sourceMenu = template.content.querySelector(`[data-menu-status="${status}"]`);
  if (!sourceMenu) return;

  if (activeTrigger === trigger && popoverEl) {
    closePopover();
    return;
  }

  options.beforeOpen?.();
  closePopover();
  closeAmazonModals();

  const menu = /** @type {HTMLElement} */ (sourceMenu.cloneNode(true));
  menu.classList.add("amazon-row-popover__menu");

  qsa("button", menu).forEach((btn) => {
    btn.removeAttribute("disabled");
    btn.removeAttribute("aria-disabled");
    btn.className = MENU_ITEM_CLASS;
    btn.setAttribute("role", "menuitem");
    btn.setAttribute("tabindex", "-1");
  });

  popoverEl = document.createElement("div");
  popoverEl.id = "amazonRowActionPopover";
  popoverEl.className = "amazon-row-popover";
  popoverEl.setAttribute("role", "presentation");
  popoverEl.appendChild(menu);
  document.body.appendChild(popoverEl);

  activeTrigger = trigger;
  setExpanded(trigger, true);

  const rect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  positionPopover(rect, menuRect.width, menuRect.height);

  menu.addEventListener("click", (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest("[data-action]");
    if (!item || item === menu) return;
    event.preventDefault();
    const action = item.dataset.action || "";
    handleRowAction(action, trigger, options).catch(() => {});
    closePopover();
  });
}

/**
 * @param {{
 *   beforeOpen?: () => void,
 *   getRowById?: (id: string) => Record<string, unknown> | null,
 *   getAuthState?: () => Record<string, unknown> | null,
 *   onSyncComplete?: () => Promise<void> | void,
 *   openPatchModal?: (row: Record<string, unknown>, mode: "edit" | "inventory") => void,
 *   openListingDetails?: (row: Record<string, unknown>) => void,
 *   deleteDraft?: (draftId: string, context?: { draftStatus?: string, title?: string }) => void | Promise<void>,
 * }} [options]
 * @returns {() => void}
 */
export function initAmazonRowActions(options = {}) {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const trigger = target.closest('[data-action="row-menu"]');
    if (!(trigger instanceof HTMLButtonElement)) return;
    event.stopPropagation();
    openPopover(trigger, options);
  });

  document.addEventListener("click", (event) => {
    if (!popoverEl) return;
    const target = /** @type {HTMLElement} */ (event.target);
    if (popoverEl.contains(target) || target.closest('[data-action="row-menu"]')) return;
    closePopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !popoverEl || isAmazonModalOpen()) return;
    event.preventDefault();
    closePopover();
  });

  window.addEventListener(
    "scroll",
    () => {
      closePopover();
    },
    true,
  );

  return closePopover;
}

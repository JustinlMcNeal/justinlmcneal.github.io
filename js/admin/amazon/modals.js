import { qs, qsa, show, hide } from "./dom.js";

/** @type {HTMLElement | null} */
let openModalEl = null;

/** @type {HTMLElement | null} */
let lastTrigger = null;

/**
 * @param {HTMLElement | null | undefined} modal
 * @param {HTMLElement | null | undefined} trigger
 */
function focusModal(modal, trigger) {
  const dialog = modal?.querySelector('[role="dialog"]');
  const title = modal?.querySelector("h2[id]");
  const target = title || dialog;
  if (!target) return;

  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  lastTrigger = trigger || null;
}

function lockBodyScroll() {
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll() {
  document.body.style.overflow = "";
}

export function closeAmazonModals() {
  /** @type {Array<HTMLElement | null>} */
  const modals = [
    openModalEl,
    qs("#amazonListingDetailsModal"),
    qs("#amazonTableSettingsModal"),
  ];

  for (const modal of modals) {
    if (!modal || modal.classList.contains("hidden")) continue;
    hide(modal);
    modal.setAttribute("aria-hidden", "true");
  }

  openModalEl = null;
  unlockBodyScroll();

  if (lastTrigger?.focus) {
    lastTrigger.focus({ preventScroll: true });
  }
  lastTrigger = null;
}

/** @returns {boolean} */
export function isAmazonModalOpen() {
  if (openModalEl) return true;
  const detailsModal = qs("#amazonListingDetailsModal");
  if (detailsModal && !detailsModal.classList.contains("hidden")) return true;
  const tableSettingsModal = qs("#amazonTableSettingsModal");
  return Boolean(tableSettingsModal && !tableSettingsModal.classList.contains("hidden"));
}

/**
 * @param {HTMLElement} modal
 * @param {HTMLElement | null | undefined} trigger
 */
function openModal(modal, trigger) {
  closeAmazonModals();
  show(modal);
  modal.setAttribute("aria-hidden", "false");
  openModalEl = modal;
  lockBodyScroll();
  focusModal(modal, trigger);
}

/**
 * @param {{ hydratePushModal?: Function, hydrateMappingModal?: Function, hydratePatchModal?: Function, openProductPicker?: Function }} hydration
 * @param {{ beforeOpen?: () => void }} [options]
 * @returns {() => void}
 */
export function initAmazonModals(hydration = {}, options = {}) {
  const pushModal = qs("#amazonPushModal");
  const mappingModal = qs("#amazonMappingModal");
  const patchModal = qs("#amazonPatchModal");
  const bulkPatchModal = qs("#amazonBulkPatchModal");
  const { beforeOpen } = options;

  /** @param {HTMLElement | null | undefined} trigger @param {{ draftMode?: boolean }} [opts] */
  async function openPush(trigger, opts = {}) {
    if (!pushModal) return;
    beforeOpen?.();
    await Promise.resolve(hydration.hydratePushModal?.(trigger, opts));
    openModal(pushModal, trigger);
  }

  /** @param {HTMLElement | null | undefined} trigger */
  function openMapping(trigger) {
    if (!mappingModal) return;
    beforeOpen?.();
    hydration.hydrateMappingModal?.(trigger);
    openModal(mappingModal, trigger);
  }

  /** @param {Record<string, unknown>} row @param {"edit" | "inventory"} mode */
  function openPatch(row, mode = "edit") {
    if (!patchModal) return;
    beforeOpen?.();
    hydration.hydratePatchModal?.(row, mode);
    openModal(patchModal, null);
  }

  function openBulkPatch() {
    if (!bulkPatchModal) return;
    beforeOpen?.();
    openModal(bulkPatchModal, null);
  }

  document.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const actionEl = target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    switch (action) {
      case "push-kk-product":
        event.preventDefault();
        if (hydration.openProductPicker) {
          hydration.openProductPicker(actionEl);
        } else {
          openPush(actionEl).catch(() => {});
        }
        break;
      case "import-map-existing":
        openMapping(actionEl);
        break;
      case "push-product-to-amazon":
        openPush(actionEl).catch(() => {});
        break;
      case "create-amazon-draft":
        openPush(actionEl, { draftMode: true }).catch(() => {});
        break;
      case "map-existing-listing":
        openMapping(actionEl);
        break;
      case "continue-amazon-draft":
      case "view-amazon-details":
        openPush(actionEl).catch(() => {});
        break;
      case "close-push-modal":
        if (openModalEl === pushModal) closeAmazonModals();
        break;
      case "close-mapping-modal":
        if (openModalEl === mappingModal) closeAmazonModals();
        break;
      case "close-patch-modal":
        if (openModalEl === patchModal) closeAmazonModals();
        break;
      case "close-bulk-patch-modal":
        if (openModalEl === bulkPatchModal) closeAmazonModals();
        break;
      case "close-listing-details-modal":
        closeAmazonModals();
        break;
      case "close-table-settings-modal":
        closeAmazonModals();
        break;
      default:
        break;
    }
  });

  qsa("[data-modal-backdrop]").forEach((backdrop) => {
    backdrop.addEventListener("click", () => {
      closeAmazonModals();
    });
  });

  [pushModal, mappingModal, patchModal, bulkPatchModal, qs("#amazonListingDetailsModal"), qs("#amazonTableSettingsModal")].forEach((modal) => {
    modal?.addEventListener("click", (event) => {
      const dialog = modal.querySelector('[role="dialog"]');
      if (dialog && !dialog.contains(/** @type {Node} */ (event.target))) {
        closeAmazonModals();
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isAmazonModalOpen()) return;
    event.preventDefault();
    closeAmazonModals();
  });

  return { closeAmazonModals, openPush, openMapping, openPatch, openBulkPatch };
}

/**
 * actionDispatcher.js — Product action dispatcher factory.
 *
 * Reads data-action / data-code / data-offer-id / data-group-key from a
 * delegated click event and routes to the appropriate injected callback.
 * No action implementations live here — only routing logic.
 */

/**
 * @param {object} deps
 * @param {function} deps.openPush          - (code) => void
 * @param {function} deps.openEdit          - (code) => void
 * @param {function} deps.openSalesHistory  - (product) => void
 * @param {function} deps.relinkEbayListing - (code) => void
 * @param {function} deps.clearStaleEbayLink- (code) => void
 * @param {function} deps.diagnoseEbayMapping- (code) => void
 * @param {function} deps.doWithdraw        - (code, offerId, groupKey) => void
 * @param {function} deps.doPublish         - (code, offerId, groupKey) => void
 * @param {function} deps.discardDraft      - (code, offerId, groupKey) => void
 * @param {function} deps.getProducts       - () => product[]  (lazy accessor for allProducts)
 * @returns {function} handleProductAction  - delegated click handler
 */
export function createProductActionDispatcher({
  openPush,
  openEdit,
  openSalesHistory,
  relinkEbayListing,
  clearStaleEbayLink,
  diagnoseEbayMapping,
  doWithdraw,
  doPublish,
  discardDraft,
  getProducts,
}) {
  return function handleProductAction(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action   = btn.dataset.action;
    const code     = btn.dataset.code;
    if (!code) return;
    const offerId  = btn.dataset.offerId  ?? "";
    const groupKey = btn.dataset.groupKey ?? "";
    if (action === "push") {
      openPush(code);
    } else if (action === "edit") {
      openEdit(code);
    } else if (action === "open-sales") {
      const product = getProducts().find(p => p.code === code);
      if (product) openSalesHistory(product);
    } else if (action === "relink") {
      relinkEbayListing(code);
    } else if (action === "clear-stale") {
      clearStaleEbayLink(code);
    } else if (action === "diagnose-mapping") {
      diagnoseEbayMapping?.(code);
    } else if (action === "withdraw") {
      doWithdraw(code, offerId, groupKey);
    } else if (action === "publish") {
      doPublish(code, offerId, groupKey);
    } else if (action === "discard-draft") {
      discardDraft(code, offerId, groupKey);
    }
  };
}

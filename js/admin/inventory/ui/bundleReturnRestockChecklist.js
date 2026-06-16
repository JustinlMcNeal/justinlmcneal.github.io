/**
 * Post-restock channel sync checklist (Phase 10H/10T — delegates to follow-up module).
 */

import { showPostRestockFollowupChecklist } from "./restockFollowupChecklist.js";

/**
 * @param {HTMLElement} container
 * @param {Object} ctx
 * @param {string} [ctx.componentSku]
 * @param {string|null} [ctx.parentBundleVariantId]
 * @param {number} [ctx.restockQty]
 * @param {string} [ctx.restockActionId]
 * @param {string} [ctx.ledgerId]
 * @param {() => void} [ctx.onDismiss]
 */
export function showPostRestockChecklist(container, ctx) {
  void showPostRestockFollowupChecklist(container, {
    componentSku: ctx.componentSku,
    parentBundleVariantId: ctx.parentBundleVariantId,
    restockQty: ctx.restockQty,
    restockActionId: ctx.restockActionId,
    ledgerId: ctx.ledgerId,
  }).then(() => {
    const el = container.querySelector("[data-post-restock-checklist]");
    el?.querySelector("[data-followup-dismiss]")?.addEventListener("click", () => ctx.onDismiss?.(), {
      once: true,
    });
  });
}

/** @param {HTMLElement} section @param {Object} lastRestock @param {() => void} onDismiss */
export function restorePostRestockChecklist(section, lastRestock, onDismiss) {
  if (!lastRestock) return;
  const reservationId = String(lastRestock.reservationId || lastRestock.reservation_id || "");
  const candidate = section.querySelector(`[data-return-candidate="${CSS.escape(reservationId)}"]`);
  showPostRestockChecklist(section, {
    componentSku: candidate?.getAttribute("data-component-sku") || undefined,
    parentBundleVariantId: candidate?.getAttribute("data-parent-bundle") || null,
    restockQty: Number(lastRestock.restock_qty) || undefined,
    restockActionId: lastRestock.audit_id ? String(lastRestock.audit_id) : undefined,
    ledgerId: lastRestock.ledger_id ? String(lastRestock.ledger_id) : undefined,
    onDismiss,
  });
}

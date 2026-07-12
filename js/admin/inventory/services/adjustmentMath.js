/**
 * Manual adjustment quantity helpers.
 */

/** @typedef {'add'|'remove'|'set'} AdjustmentMode */

/**
 * @param {AdjustmentMode} mode
 * @param {number} currentStock
 * @param {number} quantity
 * @param {{ allowUnchangedSet?: boolean }} [opts]
 *   When `allowUnchangedSet` is true, Set Exact to the current stock is valid
 *   (marketplace re-sync without changing KK on-hand).
 */
export function computeAdjustment(mode, currentStock, quantity, opts = {}) {
  const qty = Number(quantity);
  const current = Number(currentStock) || 0;
  const allowUnchangedSet = opts.allowUnchangedSet === true;

  if (!Number.isFinite(qty) || qty < 0) {
    return { delta: 0, newStock: current, valid: false, unchanged: false, error: "Enter a valid quantity." };
  }

  if (mode === "add") {
    if (qty === 0) {
      return { delta: 0, newStock: current, valid: false, unchanged: false, error: "Quantity must be greater than zero." };
    }
    return { delta: qty, newStock: current + qty, valid: true, unchanged: false, error: null };
  }

  if (mode === "remove") {
    if (qty === 0) {
      return { delta: 0, newStock: current, valid: false, unchanged: false, error: "Quantity must be greater than zero." };
    }
    return { delta: -qty, newStock: current - qty, valid: true, unchanged: false, error: null };
  }

  if (mode === "set") {
    const delta = qty - current;
    if (delta === 0) {
      if (allowUnchangedSet) {
        return { delta: 0, newStock: current, valid: true, unchanged: true, error: null };
      }
      return {
        delta: 0,
        newStock: current,
        valid: false,
        unchanged: false,
        error: "New stock equals current stock. Turn on marketplace sync to push this qty to eBay/Amazon.",
      };
    }
    return { delta, newStock: qty, valid: true, unchanged: false, error: null };
  }

  return { delta: 0, newStock: current, valid: false, unchanged: false, error: "Unknown adjustment mode." };
}

/** @param {number} delta @param {number} newStock */
export function noteRequiredForAdjustment(delta, newStock) {
  return delta < 0 || newStock < 0;
}

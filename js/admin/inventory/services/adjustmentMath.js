/**
 * Manual adjustment quantity helpers.
 */

/** @typedef {'add'|'remove'|'set'} AdjustmentMode */

/**
 * @param {AdjustmentMode} mode
 * @param {number} currentStock
 * @param {number} quantity
 */
export function computeAdjustment(mode, currentStock, quantity) {
  const qty = Number(quantity);
  const current = Number(currentStock) || 0;

  if (!Number.isFinite(qty) || qty < 0) {
    return { delta: 0, newStock: current, valid: false, error: "Enter a valid quantity." };
  }

  if (mode === "add") {
    if (qty === 0) return { delta: 0, newStock: current, valid: false, error: "Quantity must be greater than zero." };
    return { delta: qty, newStock: current + qty, valid: true, error: null };
  }

  if (mode === "remove") {
    if (qty === 0) return { delta: 0, newStock: current, valid: false, error: "Quantity must be greater than zero." };
    return { delta: -qty, newStock: current - qty, valid: true, error: null };
  }

  if (mode === "set") {
    const delta = qty - current;
    if (delta === 0) {
      return { delta: 0, newStock: current, valid: false, error: "New stock equals current stock." };
    }
    return { delta, newStock: qty, valid: true, error: null };
  }

  return { delta: 0, newStock: current, valid: false, error: "Unknown adjustment mode." };
}

/** @param {number} delta @param {number} newStock */
export function noteRequiredForAdjustment(delta, newStock) {
  return delta < 0 || newStock < 0;
}

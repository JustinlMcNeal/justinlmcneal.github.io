/** Weight-based parcel fee allocation (pure helpers, Phase 4). */

/**
 * Line weight for allocation: item weight × quantity when both exist.
 * @param {object} item
 */
export function lineAllocationWeight(item) {
  const w = item.itemWeightGrams;
  const qty = item.quantity;
  if (w == null || w <= 0) return 0;
  if (qty != null && qty > 0) return w * qty;
  return w;
}

/**
 * @param {object[]} items
 */
export function buildWeightAllocation(items) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<number, number>} */
  const rowWeights = new Map();
  let totalWeight = 0;
  let missingCount = 0;

  items.forEach((item) => {
    const lw = lineAllocationWeight(item);
    rowWeights.set(item.rowNumber, lw);
    if (lw > 0) totalWeight += lw;
    else missingCount++;
  });

  let method = "weight";

  if (totalWeight <= 0 && items.length > 0) {
    method = "equal";
    const share = 1 / items.length;
    items.forEach((item) => rowWeights.set(item.rowNumber, share));
    totalWeight = 1;
    warnings.push(
      "All rows lack usable weight — parcel fees split equally across rows.",
    );
  } else if (missingCount > 0) {
    warnings.push(
      `${missingCount} row(s) have missing/zero weight and are excluded from the allocation denominator.`,
    );
  }

  return { rowWeights, totalWeight, method, warnings, missingCount };
}

/**
 * @param {number | null} feeCny
 * @param {number} lineWeight
 * @param {number} totalAllocWeight
 */
export function allocateFeeByWeight(feeCny, lineWeight, totalAllocWeight) {
  const fee = feeCny ?? 0;
  if (fee <= 0 || totalAllocWeight <= 0 || lineWeight <= 0) return 0;
  return (fee * lineWeight) / totalAllocWeight;
}

/**
 * @param {number | null} feeCny
 * @param {number} lineWeight
 * @param {number} totalAllocWeight
 * @param {string} method
 * @param {number} rowCount
 */
export function allocateFee(feeCny, lineWeight, totalAllocWeight, method, rowCount) {
  if (method === "equal") {
    const fee = feeCny ?? 0;
    if (fee <= 0 || rowCount <= 0) return 0;
    return fee / rowCount;
  }
  return allocateFeeByWeight(feeCny, lineWeight, totalAllocWeight);
}

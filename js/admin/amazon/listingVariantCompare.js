/** Variant-aware KK compare labels for Synced tab (Phase 7A.3). */

/** @param {Record<string, unknown>} row */
export function kkVariantCompareLabel(row) {
  const label = String(row.kk_variant_label || "").trim();
  return label || null;
}

/** @param {Record<string, unknown>} row @param {string} [fallback] */
export function kkCompareScopeLabel(row, fallback = "KK") {
  const variant = kkVariantCompareLabel(row);
  return variant ? `${fallback} · ${variant}` : fallback;
}

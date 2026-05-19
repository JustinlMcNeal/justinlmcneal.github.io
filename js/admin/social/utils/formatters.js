// /js/admin/social/utils/formatters.js
// Pure number / percent formatters (no DOM side effects)

/**
 * Compact count for analytics summary cards (e.g. 1200 → "1.2k").
 * @param {number} n
 * @returns {string}
 */
export function formatCompactNumber(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : n.toString();
}

/**
 * Fixed-decimal metric with null/NaN guard (tables, scores).
 * @param {number | null | undefined} n
 * @param {number} [digits=1]
 * @returns {string}
 */
export function formatMetricNumber(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(digits);
}

/**
 * Percent string with null/NaN guard.
 * @param {number | null | undefined} n
 * @param {number} [digits=2]
 * @returns {string}
 */
export function formatPercent(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Number(n).toFixed(digits)}%`;
}

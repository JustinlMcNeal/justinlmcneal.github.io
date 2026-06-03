/**
 * Client-side search for Ready to Push rows (loaded batch, then filtered).
 * @param {Record<string, unknown>} row
 * @param {string} trimmed Lowercased, non-empty query.
 */
function matchesReadyToPushSearch(row, trimmed) {
  const haystack = [
    row.kk_product_title,
    row.kk_sku,
    row.suggested_seller_sku,
    row.kk_variant_label,
    row.kk_product_id,
    row.kk_variant_id,
    row.product_type,
    row.draft_status,
    row.ready_row_kind,
    row.eligibility_status,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return haystack.includes(trimmed);
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} query
 */
export function filterReadyToPushRows(rows, query) {
  const trimmed = String(query || "").trim().toLowerCase();
  if (!trimmed) return rows;
  return rows.filter((row) => matchesReadyToPushSearch(row, trimmed));
}

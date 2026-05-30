/** KK vs Amazon price comparison helpers (Phase 5C). */

const DEFAULT_CURRENCY = "USD";

/** @param {unknown} value */
function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** @param {number | null | undefined} amount @param {unknown} currency */
export function formatCompareMoney(amount, currency = DEFAULT_CURRENCY) {
  const num = asNumber(amount);
  if (num === null) return "—";
  const code = String(currency || DEFAULT_CURRENCY);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

/** @param {Record<string, unknown>} row */
export function hasPriceMismatch(row) {
  return row.has_price_mismatch === true;
}

/** @param {Array<Record<string, unknown>>} rows */
export function countPriceMismatches(rows) {
  return rows.filter((row) => hasPriceMismatch(row)).length;
}

/** @param {Record<string, unknown>} row */
export function priceCompareStatus(row) {
  return String(row.price_compare_status || "");
}

/** @param {Record<string, unknown>} row */
export function priceRowHighlightClass(row) {
  const status = priceCompareStatus(row);
  if (status === "amazon_higher") {
    return "amazon-row-price-mismatch amazon-row-price-amazon-higher";
  }
  if (status === "amazon_lower") {
    return "amazon-row-price-mismatch amazon-row-price-amazon-lower";
  }
  return "";
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function priceColumnMarkup(row, escapeHtml) {
  const amazon = formatCompareMoney(row.price, row.currency);
  const kk = asNumber(row.kk_price);
  const status = priceCompareStatus(row);

  if (status === "missing_amazon_price" || !asNumber(row.price)) {
    return `<span class="text-gray-400">—</span><span class="text-[10px] text-gray-400 block">No Amazon price</span>`;
  }

  if (status === "missing_kk_price" || status === "unmapped" || kk === null || kk <= 0) {
    return `<span class="font-bold">${escapeHtml(amazon)}</span><span class="text-[10px] text-gray-400 block">KK price N/A</span>`;
  }

  if (status === "match") {
    return `<span class="font-bold">${escapeHtml(amazon)}</span><span class="text-[10px] text-green-600 block">Matches KK</span>`;
  }

  const delta = asNumber(row.price_delta);
  const deltaPct = asNumber(row.price_delta_pct);
  const kkText = formatCompareMoney(kk, row.currency);
  const deltaText = delta === null
    ? ""
    : `${delta > 0 ? "+" : ""}${formatCompareMoney(delta, row.currency)}`;
  const pctText = deltaPct === null ? "" : ` (${deltaPct > 0 ? "+" : ""}${deltaPct}%)`;

  const tone = status === "amazon_higher"
    ? "text-amber-700"
    : "text-sky-700";
  const label = status === "amazon_higher" ? "Amazon higher" : "Amazon lower";

  return `
    <span class="font-bold ${tone}">${escapeHtml(amazon)}</span>
    <span class="text-[10px] text-gray-500 block">KK ${escapeHtml(kkText)}</span>
    <span class="inline-flex mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${status === "amazon_higher" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}">${label}${escapeHtml(deltaText)}${escapeHtml(pctText)}</span>
  `;
}

/** @param {Record<string, unknown>} row */
export function priceMismatchSummaryLine(row) {
  if (!hasPriceMismatch(row)) return "";
  const delta = asNumber(row.price_delta);
  if (delta === null) return " · Price mismatch";
  const dir = delta > 0 ? "Amazon higher" : "Amazon lower";
  return ` · ${dir} by ${formatCompareMoney(Math.abs(delta), row.currency)}`;
}

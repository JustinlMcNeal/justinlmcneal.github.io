/** Estimated profit display helpers (Phase 5A view + Phase 5B Product Fees API). */

import { getListingFeeEstimate } from "./listingFees.js";

const DEFAULT_CURRENCY = "USD";

/** @param {unknown} value */
function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** @param {number | null | undefined} amount @param {unknown} currency */
export function formatListingMoney(amount, currency = DEFAULT_CURRENCY) {
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
export function isProfitComplete(row) {
  return String(row.profit_calc_status || "") === "complete";
}

/** @param {Record<string, unknown>} row */
function resolvedFees(row) {
  const listingId = String(row.amazon_listing_id || "");
  const api = getListingFeeEstimate(listingId);
  if (api?.status === "success" && asNumber(api.totalFees) !== null) {
    return {
      total: asNumber(api.totalFees),
      currency: String(api.currency || row.currency || DEFAULT_CURRENCY),
      source: "api",
      details: api.feeDetails,
    };
  }

  return {
    total: asNumber(row.est_amazon_fees),
    currency: String(row.currency || DEFAULT_CURRENCY),
    source: "referral_fallback",
    details: null,
  };
}

/** @param {Record<string, unknown>} row */
function resolvedProfit(row) {
  const fees = resolvedFees(row);
  const price = asNumber(row.price);
  const cogs = asNumber(row.kk_cogs);
  if (price === null || fees.total === null || cogs === null) return null;

  const api = getListingFeeEstimate(String(row.amazon_listing_id || ""));
  if (api?.status === "success" && asNumber(api.estProfit) !== null) {
    return asNumber(api.estProfit);
  }

  return Math.round((price - cogs - fees.total) * 100) / 100;
}

/** @param {Record<string, unknown>} row */
export function profitSortValue(row) {
  if (!isProfitComplete(row)) return Number.NEGATIVE_INFINITY;
  return resolvedProfit(row) ?? Number.NEGATIVE_INFINITY;
}

/** @param {Record<string, unknown>} row */
function profitHint(row) {
  const status = String(row.profit_calc_status || "");
  if (status === "missing_cogs") {
    return '<span class="text-[10px] text-gray-400 block">Set unit cost</span>';
  }
  if (status === "missing_price") {
    return '<span class="text-[10px] text-gray-400 block">No Amazon price</span>';
  }
  if (status === "unmapped") {
    return '<span class="text-[10px] text-gray-400 block">Unmapped</span>';
  }
  return "";
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ compact?: boolean }} [options]
 */
export function feeColumnMarkup(row, options = {}) {
  const compact = options.compact === true;
  if (!isProfitComplete(row)) {
    return `<span class="text-gray-400">—</span>${profitHint(row)}`;
  }

  const listingId = String(row.amazon_listing_id || "");
  const fees = resolvedFees(row);
  const feeText = formatListingMoney(fees.total, fees.currency);
  const note = fees.source === "api"
    ? '<span class="text-[10px] text-gray-400 block">SP-API est.</span>'
    : '<span class="text-[10px] text-gray-400 block">15% fallback</span>';

  const breakdownBtn = fees.source === "api"
    ? `<span class="text-[10px] font-black uppercase tracking-wide text-sky-700 mt-0.5 block">Tap for breakdown</span>`
    : `<span class="text-[10px] text-gray-400 block">Loading SP-API…</span>`;

  if (compact) {
    const hint = fees.source === "api" ? "SP-API fee · tap for breakdown" : "15% referral estimate";
    return `
      <button type="button" data-action="show-fee-breakdown" data-listing-id="${listingId}" class="text-right w-full hover:bg-gray-100 rounded px-0.5 min-h-[36px]" title="${hint}">
        <span class="font-medium text-gray-700 text-xs">${feeText}</span>
      </button>
    `;
  }

  return `
    <button type="button" data-action="show-fee-breakdown" data-listing-id="${listingId}" class="text-right w-full hover:bg-gray-100 rounded px-1 -mx-1 min-h-[44px]" title="Amazon fee estimate">
      <span class="font-medium text-gray-700">${feeText}</span>
      ${note}
      ${breakdownBtn}
    </button>
  `;
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ compact?: boolean }} [options]
 */
export function profitColumnMarkup(row, options = {}) {
  const compact = options.compact === true;
  if (!isProfitComplete(row)) {
    return `<span class="text-gray-400">—</span>${profitHint(row)}`;
  }

  const profit = resolvedProfit(row) ?? 0;
  const text = formatListingMoney(profit, row.currency);
  let className = "font-bold text-green-700";
  if (profit <= 0) className = "font-bold text-red-700";
  else if (profit < 5) className = "font-bold text-amber-600";

  const cogs = formatListingMoney(row.kk_cogs, row.currency);
  const fees = resolvedFees(row);
  const feeLabel = fees.source === "api" ? "SP-API fees" : "Est. fees";

  if (compact) {
    return `<span class="${className} text-sm" title="COGS ${cogs} · ${feeLabel}">${text}</span>`;
  }

  return `<span class="${className}">${text}</span><span class="text-[10px] text-gray-400 block">COGS ${cogs} · ${feeLabel}</span>`;
}

/** @param {Record<string, unknown>} row */
export function profitSummaryLine(row) {
  if (!isProfitComplete(row)) return "";
  const profit = formatListingMoney(resolvedProfit(row), row.currency);
  const fees = formatListingMoney(resolvedFees(row).total, row.currency);
  return ` · Est. profit ${profit} (fees ${fees})`;
}

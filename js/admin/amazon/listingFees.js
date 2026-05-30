import { estimateAmazonListingFees } from "./api.js";
import { escapeHtml } from "./renderListings.js";

const BATCH_SIZE = 20;

function formatMoney(amount, currency = "USD") {
  const num = Number(amount);
  if (!Number.isFinite(num)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

/** @type {Map<string, Record<string, unknown>>} */
const feeCache = new Map();

/** @type {boolean} */
let fetching = false;

/** @type {string | null} */
let openListingId = null;

/** @type {{ getVisibleRows?: () => Array<Record<string, unknown>>, getAuthState?: () => Record<string, unknown> | null, onUpdate?: () => void }} */
let deps = {};

/** @param {string} listingId */
export function getListingFeeEstimate(listingId) {
  return feeCache.get(String(listingId)) || null;
}

export function clearListingFeeCache() {
  feeCache.clear();
  closeFeeTooltip();
}

function closeFeeTooltip() {
  openListingId = null;
  const el = document.getElementById("amazonFeeTooltip");
  if (el) {
    el.remove();
  }
}

/** @param {Record<string, unknown>} estimate @param {Record<string, unknown>} row */
function renderTooltipContent(estimate, row) {
  const details = Array.isArray(estimate.feeDetails) ? estimate.feeDetails : [];
  const lines = details.length
    ? details.map((line) => {
      const label = escapeHtml(String(line.label || line.feeType || "Fee"));
      const amount = formatMoney(line.amount, line.currency || row.currency);
      return `<li class="flex justify-between gap-3"><span>${label}</span><span class="font-mono">${amount}</span></li>`;
    }).join("")
    : `<li class="text-gray-500">No fee line items returned.</li>`;

  const total = formatMoney(estimate.totalFees, estimate.currency || row.currency);
  const profit = estimate.estProfit !== null && estimate.estProfit !== undefined
    ? formatMoney(estimate.estProfit, row.currency)
    : null;

  return `
    <p class="text-xs font-black uppercase tracking-wide">Amazon fee estimate</p>
    <p class="text-[11px] text-gray-500 mt-1">Product Fees API · not guaranteed</p>
    <ul class="mt-3 space-y-1 text-xs">${lines}</ul>
    <p class="mt-3 text-xs flex justify-between gap-3 border-t border-gray-200 pt-2">
      <span class="font-bold">Total fees</span>
      <span class="font-mono font-bold">${total}</span>
    </p>
    ${profit ? `<p class="mt-1 text-xs flex justify-between gap-3"><span class="font-bold">Est. profit</span><span class="font-mono font-bold text-green-700">${profit}</span></p>` : ""}
  `;
}

/** @param {HTMLElement} anchor @param {Record<string, unknown>} estimate @param {Record<string, unknown>} row */
function openFeeTooltip(anchor, estimate, row) {
  closeFeeTooltip();
  const listingId = String(row.amazon_listing_id || "");
  openListingId = listingId;

  const popover = document.createElement("div");
  popover.id = "amazonFeeTooltip";
  popover.className = "amazon-fee-tooltip";
  popover.setAttribute("role", "dialog");
  popover.innerHTML = `
    <div class="amazon-fee-tooltip__inner">
      <button type="button" class="amazon-fee-tooltip__close" data-action="close-fee-tooltip" aria-label="Close fee breakdown">×</button>
      ${renderTooltipContent(estimate, row)}
    </div>
  `;

  document.body.appendChild(popover);

  const rect = anchor.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = rect.right - popRect.width;
  if (left < 8) left = 8;
  if (left + popRect.width > window.innerWidth - 8) {
    left = window.innerWidth - popRect.width - 8;
  }
  if (top + popRect.height > window.innerHeight - 8) {
    top = rect.top - popRect.height - 8;
  }

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

/** @param {Array<Record<string, unknown>>} rows */
async function prefetchListingFees(rows) {
  const auth = deps.getAuthState?.();
  if (!auth?.connected || auth?.tokenStatus !== "active") return;

  const ids = rows
    .filter((row) => String(row.profit_calc_status) === "complete")
    .map((row) => String(row.amazon_listing_id || ""))
    .filter((id) => id && !feeCache.has(id));

  if (!ids.length || fetching) return;

  fetching = true;
  try {
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BATCH_SIZE);
      const result = await estimateAmazonListingFees(batch);
      for (const entry of result.results || []) {
        const id = String(entry.amazonListingId || "");
        if (id) feeCache.set(id, entry);
      }
    }
    deps.onUpdate?.();
  } catch {
    // Silent fail — 5A fallback remains visible
  } finally {
    fetching = false;
  }
}

/**
 * @param {{
 *   getVisibleRows?: () => Array<Record<string, unknown>>,
 *   getAuthState?: () => Record<string, unknown> | null,
 *   onUpdate?: () => void,
 * }} options
 */
export function initAmazonListingFees(options = {}) {
  deps = options;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-action="close-fee-tooltip"]')) {
      event.preventDefault();
      closeFeeTooltip();
      return;
    }

    const trigger = target.closest('[data-action="show-fee-breakdown"]');
    if (trigger instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      const listingId = trigger.dataset.listingId || "";
      const row = deps.getVisibleRows?.().find((entry) =>
        String(entry.amazon_listing_id) === listingId,
      ) || { amazon_listing_id: listingId, currency: "USD" };

      (async () => {
        let estimate = getListingFeeEstimate(listingId);
        if (estimate?.status !== "success") {
          await prefetchListingFees([row]);
          estimate = getListingFeeEstimate(listingId);
        }

        if (estimate?.status === "success") {
          if (openListingId === listingId) {
            closeFeeTooltip();
          } else {
            openFeeTooltip(trigger, estimate, row);
          }
        }
      })().catch(() => {});
      return;
    }

    const tooltip = document.getElementById("amazonFeeTooltip");
    if (tooltip && !tooltip.contains(target) && !target.closest('[data-action="show-fee-breakdown"]')) {
      closeFeeTooltip();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openListingId) {
      closeFeeTooltip();
    }
  });

  return {
    prefetchVisible: () => {
      prefetchListingFees(deps.getVisibleRows?.() || []).catch(() => {});
    },
    clearListingFeeCache,
  };
}

import { SHIPPING_RATES } from "../state/constants.js";

/**
 * @param {number} amount
 */
function formatRate(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

/**
 * @param {string} value
 * @param {string} label
 * @param {string} [valueClass]
 */
function statTile(value, label, valueClass = "") {
  return `
    <div class="bg-white border-4 border-black p-5 sm:p-6 text-center shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
      <div class="font-black text-2xl sm:text-3xl mb-1 ${valueClass}">${value}</div>
      <div class="text-[11px] font-black uppercase tracking-[.12em] text-black/70">${label}</div>
    </div>
  `;
}

/**
 * @param {HTMLElement | null} container
 * @param {{ statSublabel?: string }} display
 */
export function renderStatsGrid(container, display = {}) {
  if (!container) return;

  const freeSublabel = display.statSublabel || "Orders $50+";

  container.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      ${statTile(formatRate(SHIPPING_RATES.standard), "Standard")}
      ${statTile("FREE", freeSublabel, "text-kkpink")}
      ${statTile("1–2", "Ship-Out Days")}
      ${statTile("US", "Shipping Only")}
    </div>
  `;
}

/**
 * volPricing.js — Volume (quantity) pricing tier UI helpers.
 *
 * Each tier is a <div class="vol-tier"> row with qty + pct inputs.
 * The `prefix` argument matches the modal prefix ("modal" or "edit").
 */

/**
 * Append a new volume-pricing tier row to the `${prefix}VolTiers` container.
 *
 * @param {"modal"|"edit"} prefix
 * @param {number} qty  - Initial minimum-quantity value (default 2)
 * @param {number} pct  - Initial percentage-off value   (default 5)
 */
export function addVolTier(prefix, qty = 2, pct = 5) {
  const container = document.getElementById(`${prefix}VolTiers`);
  const div = document.createElement("div");
  div.className = "vol-tier flex items-center gap-2 mb-1";
  div.innerHTML =
    `<span class="text-[9px] text-gray-500">Buy</span>` +
    `<input type="number" min="2" value="${qty}" class="vol-qty w-14 border-2 border-gray-300 px-2 py-1 text-xs outline-none focus:border-kkpink" />` +
    `<span class="text-[9px] text-gray-500">+, get</span>` +
    `<input type="number" min="1" max="99" step="1" value="${pct}" class="vol-pct w-14 border-2 border-gray-300 px-2 py-1 text-xs outline-none focus:border-kkpink" />` +
    `<span class="text-[9px] text-gray-500">% off</span>` +
    `<button type="button" class="vol-remove text-red-400 hover:text-red-600 text-xs font-bold" title="Remove tier">✕</button>`;
  div.querySelector(".vol-remove").addEventListener("click", () => div.remove());
  container.appendChild(div);
}

/**
 * Collect all tier rows into an array of `{ minQuantity, percentOff }` objects,
 * sorted ascending by minQuantity.  Rows with pct ≤ 0 are skipped.
 *
 * @param {"modal"|"edit"} prefix
 * @returns {{ minQuantity: number, percentOff: number }[]}
 */
export function getVolTiers(prefix) {
  const tiers = [];
  document.querySelectorAll(`#${prefix}VolTiers .vol-tier`).forEach(row => {
    const qty = parseInt(row.querySelector(".vol-qty").value) || 2;
    const pct = parseFloat(row.querySelector(".vol-pct").value) || 0;
    if (pct > 0) tiers.push({ minQuantity: qty, percentOff: pct });
  });
  return tiers.sort((a, b) => a.minQuantity - b.minQuantity);
}

/**
 * Populate tier rows from an existing eBay promotion's discountRules array
 * (or a plain `{ minQuantity, percentOff }` array).  Skips duplicates.
 *
 * @param {"modal"|"edit"} prefix
 * @param {object[]} tiers - eBay discountRules or plain tier objects
 */
export function setVolTiers(prefix, tiers) {
  const container = document.getElementById(`${prefix}VolTiers`);
  container.innerHTML = "";
  const seen = new Set();
  tiers.forEach(t => {
    const qty = t.discountSpecification?.minQuantity ?? t.minQuantity ?? 2;
    const pct = parseFloat(
      t.discountBenefit?.percentageOffOrder ??
      t.discountBenefit?.percentageOffItem  ??
      t.percentOff ?? 0
    ) || 0;
    if (qty <= 1 || pct <= 0) return;
    if (seen.has(qty)) return;
    seen.add(qty);
    addVolTier(prefix, qty, pct);
  });
}

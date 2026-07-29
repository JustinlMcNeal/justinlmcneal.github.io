import {
  CARRIER_LABEL,
  SHIPPING_RATES,
  TRANSIT_WINDOWS,
} from "../state/constants.js";
import { sectionHeading } from "../utils/sectionHeading.js";

/**
 * @param {number} amount
 */
function formatRate(amount) {
  return amount === 0 ? "$0" : `$${Number(amount).toFixed(2)}`;
}

/**
 * @param {string} label
 */
function chip(label) {
  return `<span class="inline-block bg-black text-white text-[10px] font-black uppercase tracking-[.12em] px-2 py-0.5">${label}</span>`;
}

/**
 * @param {{
 *   title: string;
 *   chipLabel: string;
 *   price: string;
 *   transit: string;
 *   description: string;
 *   showCarrier?: boolean;
 * }} card
 */
function rateCard(card) {
  const { title, chipLabel, price, transit, description, showCarrier = true } = card;

  return `
    <article class="bg-white border-4 border-black p-5 sm:p-6 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
      <div class="flex flex-wrap items-start justify-between gap-4 mb-3">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-black uppercase text-sm tracking-[.12em]">${title}</h3>
          ${chip(chipLabel)}
        </div>
        <div class="text-right shrink-0">
          <div class="font-black text-xl sm:text-2xl">${price}</div>
          <div class="text-[11px] font-black uppercase tracking-[.12em] text-black/70 mt-0.5">${transit}</div>
        </div>
      </div>
      <p class="text-sm text-gray-600">${description}</p>
      ${showCarrier ? `<p class="text-[11px] font-black uppercase tracking-[.12em] text-black/50 mt-2">${CARRIER_LABEL}</p>` : ""}
    </article>
  `;
}

/**
 * @param {HTMLElement | null} container
 * @param {{ qualifierCopy?: string }} display
 */
export function renderRatesSection(container, display = {}) {
  if (!container) return;

  const qualifier =
    display.qualifierCopy ||
    "Available when your order subtotal qualifies for free standard shipping or when a free-shipping promotion applies.";

  container.innerHTML = `
    <div class="border-t-4 border-black pt-8">
      ${sectionHeading("Shipping Rates", "Choose your option at checkout.")}
      <div class="space-y-4">
        ${rateCard({
          title: "Free Shipping",
          chipLabel: "FREE",
          price: formatRate(SHIPPING_RATES.free),
          transit: TRANSIT_WINDOWS.standard,
          description: qualifier,
          showCarrier: true,
        })}
        ${rateCard({
          title: "Standard Shipping",
          chipLabel: "STANDARD",
          price: formatRate(SHIPPING_RATES.standard),
          transit: TRANSIT_WINDOWS.standard,
          description: "Default option for most orders. Reliable USPS delivery to your door.",
        })}
        ${rateCard({
          title: "Express Shipping",
          chipLabel: "EXPRESS",
          price: formatRate(SHIPPING_RATES.express),
          transit: TRANSIT_WINDOWS.express,
          description: "Faster option when you need your order sooner.",
        })}
      </div>
      <p class="text-xs text-gray-500 mt-4">
        Delivery estimates are in business days and start after your order ships.
      </p>
      <div class="border-t-4 border-black mt-8" aria-hidden="true"></div>
    </div>
  `;
}

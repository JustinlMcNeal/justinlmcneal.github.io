import { SHIP_OUT_WINDOWS } from "../state/constants.js";
import { sectionHeading } from "../utils/sectionHeading.js";

/**
 * @param {string} title
 * @param {string} body
 */
function infoTile(title, body) {
  return `
    <article class="bg-white border-4 border-black p-5 sm:p-6 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
      <h3 class="font-black uppercase text-sm tracking-[.12em] mb-2">${title}</h3>
      <p class="text-sm text-gray-600">${body}</p>
    </article>
  `;
}

/**
 * @param {{ amount?: string; enabled?: boolean; ordersOverLabel?: string }} display
 */
function freeShippingTileCopy(display = {}) {
  const amount = display.amount || "50";
  const ordersOver = display.ordersOverLabel || `Orders $${amount}+`;

  if (display.enabled !== false) {
    return `${ordersOver} qualify for free standard shipping (before shipping is added at checkout). Threshold may change during promotions.`;
  }

  return `Free shipping may be offered during promotions. When active, ${ordersOver.toLowerCase()} qualify for free standard shipping.`;
}

/**
 * @param {HTMLElement | null} container
 * @param {{ amount?: string; enabled?: boolean; ordersOverLabel?: string }} display
 */
export function renderNeedToKnowSection(container, display = {}) {
  if (!container) return;

  container.innerHTML = `
    <div class="border-t-4 border-black pt-8">
      ${sectionHeading("Need to Know", "Policies and details for website orders.")}
      <div class="grid md:grid-cols-2 gap-4">
        ${infoTile(
          "United States Only",
          "We ship to US addresses only. International shipping is not available at checkout.",
        )}
        ${infoTile("Free Shipping Threshold", freeShippingTileCopy(display))}
        ${infoTile(
          "Backorders & Made-to-Order",
          `Some items ship in ${SHIP_OUT_WINDOWS.backorder} when marked backorder or made-to-order on the product page.`,
        )}
        ${infoTile(
          "Tracking",
          'Look up tracking on <a href="my-orders.html" class="font-bold text-black underline decoration-kkpink decoration-2 underline-offset-2 hover:text-kkpink focus-visible:outline focus-visible:outline-4 focus-visible:outline-kkpink focus-visible:outline-offset-4">My Orders</a> using your checkout email. Shipped and delivered updates are sent by SMS when a mobile number is provided.',
        )}
        ${infoTile(
          "Shipping Address",
          "Double-check your address in Stripe checkout. We may not be able to change it after your order is placed.",
        )}
        ${infoTile(
          "Business Days",
          "Processing and delivery times use business days (Monday–Friday, excluding holidays).",
        )}
      </div>
      <div class="border-t-4 border-black mt-8" aria-hidden="true"></div>
    </div>
  `;
}

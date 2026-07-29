import {
  CARRIER_LABEL,
  SHIP_OUT_WINDOWS,
  TRANSIT_WINDOWS,
} from "../state/constants.js";
import { sectionHeading } from "../utils/sectionHeading.js";

/**
 * @param {string} title
 * @param {string} body
 * @param {boolean} [isLast]
 */
function timelineStep(title, body, isLast = false) {
  return `
    <div class="relative ${isLast ? "" : "pb-8"}">
      <div class="absolute -left-[1.625rem] top-1.5 w-3 h-3 rounded-full bg-black border-2 border-black" aria-hidden="true"></div>
      <h3 class="font-black uppercase text-sm tracking-[.12em]">${title}</h3>
      <p class="text-sm text-gray-600 mt-1">${body}</p>
    </div>
  `;
}

/**
 * @param {HTMLElement | null} container
 */
export function renderTimelineSection(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="pt-8 mb-8">
      ${sectionHeading("Fulfillment Timeline", "What happens after you check out.")}
      <div class="bg-white border-4 border-black p-5 sm:p-6 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
        <div class="relative pl-8 border-l-2 border-black/20">
          ${timelineStep(
            "Order Placed",
            "You'll receive confirmation when your checkout is complete.",
          )}
          ${timelineStep(
            "Processing",
            `In-stock items ship in ${SHIP_OUT_WINDOWS.inStock}. Backorder or made-to-order items ship in ${SHIP_OUT_WINDOWS.backorder}.`,
          )}
          ${timelineStep(
            "Shipped",
            `${CARRIER_LABEL} label created and tracking added to your order.`,
          )}
          ${timelineStep(
            "In Transit",
            `${TRANSIT_WINDOWS.standard} for standard or free shipping, or ${TRANSIT_WINDOWS.express} for Express Shipping.`,
          )}
          ${timelineStep(
            "Delivered",
            "You'll get an SMS notification when your package is delivered.",
            true,
          )}
        </div>
      </div>
    </div>
  `;
}

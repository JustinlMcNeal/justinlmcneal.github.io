import { sectionHeading } from "../utils/sectionHeading.js";

/**
 * @param {HTMLElement | null} container
 */
export function renderMarketplaceSection(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="pt-8 mb-8">
      ${sectionHeading("eBay & Amazon Orders", "Marketplace purchases use each platform’s own process.")}
      <div class="bg-white border-4 border-black p-5 sm:p-6 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
        <p class="text-sm text-gray-600 mb-3">
          If you bought from us on <strong class="text-black">eBay</strong> or <strong class="text-black">Amazon</strong>,
          returns and refunds are handled through that marketplace — not through this website policy.
        </p>
        <p class="text-sm text-gray-600">
          Use the order tools in your eBay or Amazon account (or their buyer protection / A-to-z process) to open a return or refund request.
        </p>
      </div>
      <div class="border-t-4 border-black mt-8" aria-hidden="true"></div>
    </div>
  `;
}

import { POLICY_DETAILS } from "../state/constants.js";
import { sectionHeading } from "../utils/sectionHeading.js";

/**
 * @param {HTMLElement | null} container
 */
export function renderPolicySection(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="border-t-4 border-black pt-8">
      ${sectionHeading("Our Policy", "Clear rules for karrykraze.com orders.")}
      <div class="grid md:grid-cols-2 gap-4">
        ${POLICY_DETAILS.map(
          (item) => `
          <article class="bg-white border-4 border-black p-5 sm:p-6 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
            <h3 class="font-black uppercase text-sm tracking-[.12em] mb-2">${item.title}</h3>
            <p class="text-sm text-gray-600">${item.body}</p>
          </article>
        `,
        ).join("")}
      </div>
      <div class="border-t-4 border-black mt-8" aria-hidden="true"></div>
    </div>
  `;
}

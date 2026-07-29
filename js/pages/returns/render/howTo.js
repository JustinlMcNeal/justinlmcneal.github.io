import { HOW_TO_STEPS } from "../state/constants.js";
import { sectionHeading } from "../utils/sectionHeading.js";

/**
 * @param {HTMLElement | null} container
 */
export function renderHowToSection(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="pt-8">
      ${sectionHeading("How to Request a Refund", "Three quick steps — no return shipping required.")}
      <ol class="grid md:grid-cols-3 gap-4 list-none p-0 m-0">
        ${HOW_TO_STEPS.map(
          (item) => `
          <li class="bg-white border-4 border-black p-5 sm:p-6 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
            <div class="inline-flex items-center justify-center w-8 h-8 bg-black text-white font-black text-sm mb-3">${item.step}</div>
            <h3 class="font-black uppercase text-sm tracking-[.12em] mb-2">${item.title}</h3>
            <p class="text-sm text-gray-600">${item.body}</p>
          </li>
        `,
        ).join("")}
      </ol>
      <div class="border-t-4 border-black mt-8" aria-hidden="true"></div>
    </div>
  `;
}

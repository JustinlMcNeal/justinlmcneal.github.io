import { POLICY_HIGHLIGHTS } from "../state/constants.js";

/**
 * @param {HTMLElement | null} container
 */
export function renderHighlights(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="grid sm:grid-cols-3 gap-4">
      ${POLICY_HIGHLIGHTS.map(
        (item) => `
        <article class="bg-white border-4 border-black p-5 sm:p-6 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
          <h2 class="font-black uppercase text-sm tracking-[.12em] mb-2">${item.title}</h2>
          <p class="text-sm text-gray-600">${item.body}</p>
        </article>
      `,
      ).join("")}
    </div>
  `;
}

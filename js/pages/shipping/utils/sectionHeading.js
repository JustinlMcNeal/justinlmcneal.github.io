/**
 * KK section heading with pink squiggle underline (matches home category strip).
 * @param {string} title
 * @param {string} [subtitle]
 */
export function sectionHeading(title, subtitle = "") {
  return `
    <div class="mb-6">
      <h2 class="font-black text-2xl uppercase tracking-tighter leading-none relative inline-block">
        ${title}
        <span class="absolute -bottom-2 left-0 w-full h-3 text-kkpink" aria-hidden="true">
          <svg viewBox="0 0 100 20" preserveAspectRatio="none" class="w-full h-full">
            <path d="M0 10 Q 25 20, 50 10 T 100 10" stroke="currentColor" stroke-width="4" fill="none" />
          </svg>
        </span>
      </h2>
      ${subtitle ? `<p class="mt-4 text-sm text-gray-500 font-medium">${subtitle}</p>` : ""}
    </div>
  `;
}

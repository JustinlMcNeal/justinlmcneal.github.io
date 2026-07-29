/**
 * @param {string} href
 * @param {string} label
 * @param {"primary" | "secondary"} variant
 */
function ctaButton(href, label, variant = "primary") {
  const base =
    "inline-flex items-center justify-center px-6 py-3 font-black uppercase tracking-[.12em] text-xs transition-all " +
    "focus-visible:outline focus-visible:outline-4 focus-visible:outline-kkpink focus-visible:outline-offset-4";

  if (variant === "secondary") {
    return `
      <a href="${href}" class="${base} border-4 border-white text-white hover:bg-white hover:text-black">
        ${label}
      </a>
    `;
  }

  return `
    <a href="${href}" class="${base} border-4 border-white bg-white text-black hover:bg-kkpink hover:border-kkpink hover:text-black">
      ${label}
    </a>
  `;
}

/**
 * @param {HTMLElement | null} container
 */
export function renderPeakSeasonSection(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="pt-8 mb-8">
      <div class="bg-white border-4 border-black p-5 sm:p-6 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
        <div class="inline-block bg-yellow-400 text-black px-3 py-1 text-[10px] font-black uppercase tracking-[.25em] -skew-x-6 mb-4">
          <span class="inline-block skew-x-6">Peak Seasons</span>
        </div>
        <h3 class="font-black uppercase text-sm tracking-[.12em] mb-2">Possible Delays</h3>
        <p class="text-sm text-gray-600">
          During holidays and sale events, processing may take an extra 1–2 business days.
          Delivery estimates still start after your order ships — we'll keep you updated by SMS.
        </p>
      </div>
    </div>
  `;
}

/**
 * @param {HTMLElement | null} container
 */
export function renderQuestionsCta(container) {
  if (!container) return;

  container.innerHTML = `
    <section class="text-center pb-4">
      <div class="border-4 border-black bg-black text-white p-6 sm:p-8 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
        <h2 class="text-2xl font-black uppercase tracking-tighter mb-2">Have Questions?</h2>
        <p class="text-gray-300 text-sm mb-6 max-w-md mx-auto">
          We're here to help with any shipping questions.
        </p>
        <div class="flex flex-wrap justify-center gap-4">
          ${ctaButton("contact.html", "Contact Us", "primary")}
          ${ctaButton("faq.html", "View FAQ", "secondary")}
          ${ctaButton("my-orders.html", "My Orders", "secondary")}
        </div>
      </div>
    </section>
  `;
}

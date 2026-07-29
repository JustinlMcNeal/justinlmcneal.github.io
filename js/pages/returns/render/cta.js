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
export function renderQuestionsCta(container) {
  if (!container) return;

  container.innerHTML = `
    <section class="text-center pb-4">
      <div class="border-4 border-black bg-black text-white p-6 sm:p-8 shadow-[6px_6px_0_0_rgba(0,0,0,.08)]">
        <h2 class="text-2xl font-black uppercase tracking-tighter mb-2">Need a Refund?</h2>
        <p class="text-gray-300 text-sm mb-6 max-w-md mx-auto">
          Contact us with your order number. We don’t accept returns — refund requests only.
        </p>
        <div class="flex flex-wrap justify-center gap-4">
          ${ctaButton("/pages/contact.html", "Contact Us", "primary")}
          ${ctaButton("/pages/my-orders.html", "My Orders", "secondary")}
          ${ctaButton("/pages/faq.html", "View FAQ", "secondary")}
        </div>
      </div>
    </section>
  `;
}

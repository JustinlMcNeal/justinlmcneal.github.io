// renderCard.js
function formatPrice(num) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
  } catch {
    return `$${Number(num).toFixed(2)}`;
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getColorVariants(product) {
  const variants = product.variants || [];
  return variants
    .filter((v) => (v.option_name || "").toLowerCase() === "color")
    .filter((v) => (v.stock ?? 0) > 0)
    .map((v) => (v.option_value || "").trim())
    .filter(Boolean);
}

export function renderProductCard(product) {
  const href = `/pages/product.html?sku=${encodeURIComponent(product.slug)}`;

  const img = product.images?.catalog || "";
  const hover = product.images?.hover || img;

  const colors = getColorVariants(product);
  const shown = colors.slice(0, 3);
  const extra = Math.max(0, colors.length - shown.length);

  const dotsHtml = shown
    .map((c) => {
      // Just display the dot; your CSS can color-map names later if you want.
      return `<span class="inline-block w-3 h-3 rounded-full border border-black/15" title="${escapeHtml(c)}"></span>`;
    })
    .join("");

  const extraHtml =
    extra > 0
      ? `<span class="text-xs text-black/60 ml-1">+${extra}</span>`
      : "";

  return `
    <a href="${href}" class="block group">
      <div class="relative overflow-hidden bg-white border border-black/10">
        <img 
          src="${escapeHtml(img)}"
          data-hover="${escapeHtml(hover)}"
          data-default="${escapeHtml(img)}"
          alt="${escapeHtml(product.name)}"
          class="w-full aspect-square object-contain bg-white transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
      </div>

      <div class="pt-3">
        <div class="text-[11px] tracking-wide font-semibold uppercase line-clamp-2">
          ${escapeHtml(product.name)}
        </div>

        <div class="mt-1 text-sm font-semibold">
          ${formatPrice(product.price)}
        </div>

        ${
          colors.length
            ? `<div class="mt-2 flex items-center gap-1">${dotsHtml}${extraHtml}</div>`
            : `<div class="mt-2 text-[11px] uppercase tracking-wide text-black/45">Select a color to add to cart</div>`
        }
      </div>
    </a>
  `;
}

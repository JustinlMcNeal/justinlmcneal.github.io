// /js/shared/components/productCardHome.js

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function toSwatchColor(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";

  const map = {
    black: "#000000",
    white: "#ffffff",
    red: "#ef4444",
    blue: "#3b82f6",
    green: "#22c55e",
    pink: "#f472b6",
    purple: "#a855f7",
    yellow: "#eab308",
    orange: "#f97316",
    brown: "#8b5e34",
    tan: "#d2b48c",
    beige: "#e7d7c1",
    gray: "#9ca3af",
    grey: "#9ca3af",
    silver: "#c0c0c0",
    gold: "#d4af37"
  };

  if (map[v]) return map[v];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  return v; // try CSS color name
}

function pickVariants(variants = []) {
  if (!Array.isArray(variants) || !variants.length) return [];
  const colors = variants.filter(v => String(v.option_name || "").toLowerCase().trim() === "color");
  return colors.length ? colors : variants;
}

export function renderHomeCard(product, variants = [], opts = {}) {
  const variantLimit = Number.isFinite(opts.variantLimit) ? opts.variantLimit : 6;

  const slug = product?.slug || "";
  const href = slug ? `/pages/product.html?slug=${encodeURIComponent(slug)}` : "#";

  const img =
    product?.catalog_image_url ||
    product?.primary_image_url ||
    product?.catalog_hover_url ||
    "";

  const name = product?.name || "Product";
  const price = money(product?.price);

  const vlist = pickVariants(variants);
  const shown = vlist.slice(0, variantLimit);
  const moreCount = Math.max(0, vlist.length - shown.length);

  const swatchesHtml = shown.map(v => {
    const color = toSwatchColor(v.option_value);
    const oos = Number(v.stock || 0) <= 0;
    const style = color ? `style="background:${esc(color)}"` : "";
    return `<span class="kk-pcard-swatch ${oos ? "is-oos" : ""}" title="${esc(v.option_value)}" ${style}></span>`;
  }).join("");

  const moreHtml = moreCount > 0 ? `<span class="kk-pcard-more">+${moreCount}</span>` : "";

  const variantsRow = (shown.length || moreCount)
    ? `<div class="kk-pcard-variants">${swatchesHtml}${moreHtml}</div>`
    : "";

  return `
    <a class="kk-pcard kk-pcard-home" href="${href}">
      <div class="kk-pcard-media">
        ${img
          ? `<img src="${esc(img)}" alt="${esc(name)}" loading="lazy" decoding="async">`
          : `<div style="width:100%;height:100%;background:rgba(0,0,0,.06)"></div>`
        }
      </div>

      <div class="kk-pcard-body">
        <div class="kk-pcard-name">${esc(name)}</div>
        <div class="kk-pcard-price">${esc(price)}</div>
        ${variantsRow}
      </div>
    </a>
  `;
}

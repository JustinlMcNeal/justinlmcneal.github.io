// /js/shared/components/productCard99c.js

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

export function render99cCard(product) {
  const slug = product?.slug || "";
  const href = slug ? `/pages/product.html?slug=${encodeURIComponent(slug)}` : "#";

  const img =
    product?.catalog_image_url ||
    product?.primary_image_url ||
    product?.catalog_hover_url ||
    "";

  const name = product?.name || "Product";
  const price = money(product?.price);

  return `
    <a class="kk-pcard kk-pcard-99c" href="${href}">
      <div class="kk-pcard-media">
        ${img
          ? `<img src="${esc(img)}" alt="${esc(name)}" loading="lazy" decoding="async">`
          : `<div style="width:100%;height:100%;background:rgba(0,0,0,.06)"></div>`
        }
      </div>

      <div class="kk-pcard-body">
        <div class="kk-pcard-name">${esc(name)}</div>
        <div class="kk-pcard-price">${esc(price)}</div>
      </div>
    </a>
  `;
}

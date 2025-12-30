// /js/home/renderGrid.js
import { renderHomeCard } from "../shared/components/productCardHome.js";

export function renderHomeGrid(products = [], variantMap = new Map()) {
  const grid = document.getElementById("homeProductGrid");
  if (!grid) return;

  if (!Array.isArray(products) || products.length === 0) {
    grid.innerHTML = `
      <div class="kk-sub" style="opacity:.75; padding: 10px 2px;">
        No products found.
      </div>
    `;
    return;
  }

  grid.innerHTML = products.map((p) => {
    const variants = variantMap?.get?.(p.id) || [];
    return `<article class="kk-home-card">${renderHomeCard(p, variants, { variantLimit: 6 })}</article>`;
  }).join("");
}

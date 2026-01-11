import { renderHomeCard } from "../shared/components/productCardHome.js";

export function renderHomeGrid(products = [], variantMap = new Map()) {
  const grid = document.getElementById("homeProductGrid");
  if (!grid) return;

  if (!Array.isArray(products) || products.length === 0) {
    grid.innerHTML = `<div class="opacity-75 py-[10px] px-[2px]">No products found.</div>`;
    return;
  }

  // Tailwind Grid: 2 cols on mobile, 4 on medium, 5 on large
  grid.className = "grid gap-[14px] grid-cols-2 md:grid-cols-4 lg:grid-cols-5";

  grid.innerHTML = products.map((p) => {
    const variants = variantMap?.get?.(p.id) || [];
    return `
      <article class="bg-transparent border-none overflow-hidden flex flex-col h-full">
        ${renderHomeCard(p, variants, { variantLimit: 6 })}
      </article>
    `;
  }).join("");
}
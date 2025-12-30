// renderGrid.js
import { renderProductCard } from "./renderCard.js";

export function renderGrid(gridEl, products) {
  if (!gridEl) return;

  gridEl.innerHTML = (products || []).map(renderProductCard).join("");

  // Hover swap
  gridEl.querySelectorAll("img[data-hover]").forEach((img) => {
    const onEnter = () => {
      const hover = img.getAttribute("data-hover");
      if (hover) img.src = hover;
    };
    const onLeave = () => {
      const def = img.getAttribute("data-default");
      if (def) img.src = def;
    };

    img.addEventListener("mouseenter", onEnter);
    img.addEventListener("mouseleave", onLeave);

    // touch devices: don't spam swaps
  });
}

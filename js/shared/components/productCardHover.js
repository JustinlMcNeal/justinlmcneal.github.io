// Delegated hover swap for catalog / home product cards.
export function bindProductCardImageHover(rootEl) {
  if (!rootEl || rootEl.dataset.imageHoverBound === "true") return;
  rootEl.dataset.imageHoverBound = "true";

  rootEl.addEventListener("mouseover", (e) => {
    const link = e.target.closest?.(".product-card-image");
    if (!link || !rootEl.contains(link)) return;

    const img = link.querySelector("img[data-hover]");
    if (!img) return;

    const hover = img.getAttribute("data-hover");
    if (hover) img.src = hover;
  });

  rootEl.addEventListener("mouseout", (e) => {
    const link = e.target.closest?.(".product-card-image");
    if (!link || !rootEl.contains(link)) return;

    const next = e.relatedTarget;
    if (next && link.contains(next)) return;

    const img = link.querySelector("img[data-hover]");
    if (!img) return;

    const def = img.getAttribute("data-default");
    if (def) img.src = def;
  });
}

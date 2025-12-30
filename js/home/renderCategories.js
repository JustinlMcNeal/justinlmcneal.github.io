// /js/home/renderCategories.js

/**
 * Renders chips into #homeCategoryChips
 * Emits onChange({ mode: "best"|"category", categoryId: uuid|null })
 */
export function renderHomeCategories({
  categories = [],
  active = { mode: "best", categoryId: null },
  onChange
}) {
  const mount = document.getElementById("homeCategoryChips");
  if (!mount) return;

  mount.innerHTML = "";

  // Best Seller chip
  mount.appendChild(
    makeChip({
      label: "Best Seller",
      active: active?.mode === "best",
      onClick: () => onChange?.({ mode: "best", categoryId: null })
    })
  );

  // Category chips
  for (const c of categories) {
    mount.appendChild(
      makeChip({
        label: c.name,
        active: active?.mode === "category" && c.id === active?.categoryId,
        onClick: () => onChange?.({ mode: "category", categoryId: c.id })
      })
    );
  }
}

function makeChip({ label, active, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `kk-chip ${active ? "is-active" : ""}`;
  btn.textContent = label;
  btn.addEventListener("click", () => onClick?.());
  return btn;
}

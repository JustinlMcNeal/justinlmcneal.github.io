export function renderHomeCategories({
  categories = [],
  active = { mode: "best", categoryId: null },
  onChange
}) {
  const mount = document.getElementById("homeCategoryChips");
  if (!mount) return;
  mount.innerHTML = "";

  // Container styling for the chips track
  mount.className = "flex gap-2 md:gap-3 overflow-x-auto pb-2 md:overflow-x-visible scrollbar-hide";

  // Best Seller chip
  mount.appendChild(makeChip({
    label: "Best Seller",
    active: active?.mode === "best",
    onClick: () => onChange?.({ mode: "best", categoryId: null })
  }));

  for (const c of categories) {
    mount.appendChild(makeChip({
      label: c.name,
      active: active?.mode === "category" && c.id === active?.categoryId,
      onClick: () => onChange?.({ mode: "category", categoryId: c.id })
    }));
  }
}

function makeChip({ label, active, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  // Tailwind Classes for Chips
  const baseClasses = "px-4 py-2 border-[3px] border-black uppercase font-black text-[11px] tracking-widest whitespace-nowrap transition-colors";
  const activeClasses = "bg-black text-white";
  const inactiveClasses = "bg-white text-black hover:bg-black/5";
  
  btn.className = `${baseClasses} ${active ? activeClasses : inactiveClasses}`;
  btn.textContent = label;
  btn.addEventListener("click", () => onClick?.());
  return btn;
}
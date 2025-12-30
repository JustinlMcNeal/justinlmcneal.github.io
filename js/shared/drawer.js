// js/shared/drawer.js

let openName = null;

function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function initDrawer() {
  const overlay = document.querySelector("[data-kk-overlay]");
  const drawers = qsa(".kk-drawer");

  // If this page doesn't include drawer markup, do nothing (prevents crashes)
  if (!overlay || !drawers.length) return;

  function closeAll() {
    drawers.forEach((d) => {
      d.classList.remove("is-open");
      d.setAttribute("aria-hidden", "true");
    });
    overlay.hidden = true;
    document.body.style.overflow = "";
    openName = null;
  }

  function openDrawer(name) {
    closeAll();
    const drawer = document.querySelector(`[data-kk-drawer="${name}"]`);
    if (!drawer) return;

    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    openName = name;
  }

  qsa("[data-kk-open]").forEach((btn) => {
    btn.addEventListener("click", () => openDrawer(btn.dataset.kkOpen));
  });

  qsa("[data-kk-close]").forEach((btn) => {
    btn.addEventListener("click", closeAll);
  });

  overlay.addEventListener("click", closeAll);

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openName) closeAll();
  });

  /* ----- swipe to close ----- */
  drawers.forEach((drawer) => {
    let startX = 0;

    drawer.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
    });

    drawer.addEventListener("touchend", (e) => {
      const endX = e.changedTouches[0].clientX;
      if (Math.abs(endX - startX) > 60) closeAll();
    });
  });
}

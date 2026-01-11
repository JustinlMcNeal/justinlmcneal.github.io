// /js/shared/drawer.js
let openName = null;

function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function isRightDrawer(drawer) {
  // right drawer if it has "right-0" or it's the cart drawer
  // (your cart drawer uses data-kk-drawer="cart")
  const name = drawer?.getAttribute("data-kk-drawer") || "";
  return name === "cart" || drawer.classList.contains("right-0");
}

function setDrawerOpen(drawer, open) {
  if (!drawer) return;

  const right = isRightDrawer(drawer);

  // Closed classes:
  //  - left drawer: -translate-x-[110%]
  //  - right drawer: translate-x-[110%]
  //
  // Open class: translate-x-0
  drawer.classList.add("transition-transform", "duration-200", "ease-out");

  if (open) {
    drawer.classList.add("translate-x-0");
    drawer.classList.remove(right ? "translate-x-[110%]" : "-translate-x-[110%]");
    drawer.setAttribute("aria-hidden", "false");
  } else {
    drawer.classList.remove("translate-x-0");
    drawer.classList.add(right ? "translate-x-[110%]" : "-translate-x-[110%]");
    drawer.setAttribute("aria-hidden", "true");
  }
}

export function initDrawer() {
  const overlay = document.querySelector("[data-kk-overlay]");
  const drawers = qsa("[data-kk-drawer]");

  // If this page doesn't include drawer markup, do nothing
  if (!overlay || !drawers.length) return;

  function closeAll() {
    drawers.forEach((d) => setDrawerOpen(d, false));
    overlay.hidden = true;
    document.body.style.overflow = "";
    openName = null;
  }

  function openDrawer(name) {
    closeAll();
    const drawer = document.querySelector(`[data-kk-drawer="${name}"]`);
    if (!drawer) return;

    setDrawerOpen(drawer, true);
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    openName = name;
  }

  // Open buttons
  qsa("[data-kk-open]").forEach((btn) => {
    if (btn.__kkBound) return;
    btn.__kkBound = true;

    btn.addEventListener("click", () => openDrawer(btn.dataset.kkOpen));
  });

  // Close buttons
  qsa("[data-kk-close]").forEach((btn) => {
    if (btn.__kkBound) return;
    btn.__kkBound = true;

    btn.addEventListener("click", closeAll);
  });

  // Overlay click closes
  overlay.addEventListener("click", closeAll);

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openName) closeAll();
  });

  /* ----- swipe to close ----- */
  drawers.forEach((drawer) => {
    let startX = 0;
    let startY = 0;

    drawer.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });

    drawer.addEventListener("touchend", (e) => {
      const endX = e.changedTouches[0].clientX;
      if (Math.abs(endX - startX) > 60) closeAll();
    });
    
    // Prevent background scroll when touching non-scrollable areas of drawer
    drawer.addEventListener("touchmove", (e) => {
      const target = e.target;
      
      // Find if we're inside a scrollable container
      let scrollableParent = target.closest('.overflow-auto, .overflow-y-auto, .overflow-scroll, [data-kk-cart-items]');
      
      // If we're in a scrollable area, check if it can actually scroll
      if (scrollableParent) {
        const { scrollTop, scrollHeight, clientHeight } = scrollableParent;
        const deltaY = startY - e.touches[0].clientY;
        
        // Allow scroll if there's room to scroll in the direction of movement
        const canScrollUp = scrollTop > 0 && deltaY < 0;
        const canScrollDown = scrollTop + clientHeight < scrollHeight && deltaY > 0;
        
        if (canScrollUp || canScrollDown) {
          // Let the scroll happen naturally
          return;
        }
      }
      
      // Prevent default to stop background scrolling
      e.preventDefault();
    }, { passive: false });
  });

  // Ensure everything starts closed (prevents flash)
  closeAll();

  // Listen for programmatic requests
  window.addEventListener("kk-open-cart-request", () => {
    openDrawer("cart");
  });

  window.addEventListener("kk-open-menu-request", () => {
    openDrawer("menu");
  });
}

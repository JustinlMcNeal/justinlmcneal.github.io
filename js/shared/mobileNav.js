// /js/shared/mobileNav.js
// Mobile bottom navigation bar

import { getCart } from "./cartStore.js";

/**
 * Initialize mobile bottom navigation
 * Only shows on mobile devices (< 768px)
 */
export function initMobileNav() {
  // Don't show on admin pages
  if (window.location.pathname.includes("/admin/")) return;

  // Check if mobile
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  if (!isMobile) return;

  // Don't duplicate
  if (document.getElementById("kkMobileNav")) return;

  const nav = document.createElement("nav");
  nav.id = "kkMobileNav";
  nav.className = `
    fixed bottom-0 left-0 right-0 z-[85]
    bg-white border-t-4 border-black
    flex items-center justify-around
    py-2 px-4
    safe-area-pb
  `.replace(/\s+/g, " ").trim();

  nav.innerHTML = `
    <a href="/index.html" class="flex flex-col items-center gap-1 p-2 min-w-[60px]" aria-label="Home">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
      </svg>
      <span class="text-[10px] font-black uppercase tracking-wide">Home</span>
    </a>

    <a href="/pages/catalog.html" class="flex flex-col items-center gap-1 p-2 min-w-[60px]" aria-label="Shop">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      <span class="text-[10px] font-black uppercase tracking-wide">Shop</span>
    </a>

    <button 
      type="button" 
      id="kkMobileCartBtn"
      class="flex flex-col items-center gap-1 p-2 min-w-[60px] relative"
      aria-label="Cart"
    >
      <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
      </svg>
      <span class="text-[10px] font-black uppercase tracking-wide">Cart</span>
      <span 
        id="kkMobileCartCount"
        class="absolute top-0 right-1 min-w-[18px] h-[18px] bg-black text-white text-[10px] font-black rounded-full flex items-center justify-center"
      >0</span>
    </button>

    <button 
      type="button" 
      id="kkMobileMenuBtn"
      class="flex flex-col items-center gap-1 p-2 min-w-[60px]"
      aria-label="Menu"
    >
      <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
      </svg>
      <span class="text-[10px] font-black uppercase tracking-wide">Menu</span>
    </button>
  `;

  // Add safe area padding for iPhone notch
  const style = document.createElement("style");
  style.textContent = `
    .safe-area-pb {
      padding-bottom: max(8px, env(safe-area-inset-bottom));
    }
    /* Add bottom padding to body so content isn't hidden behind nav */
    @media (max-width: 767px) {
      body {
        padding-bottom: 80px !important;
      }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(nav);

  // Bind cart button to open cart drawer
  const cartBtn = document.getElementById("kkMobileCartBtn");
  if (cartBtn) {
    cartBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("kk-open-cart-request"));
    });
  }

  // Bind menu button to open menu drawer
  const menuBtn = document.getElementById("kkMobileMenuBtn");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("kk-open-menu-request"));
    });
  }

  // Update cart count
  updateMobileCartCount();

  // Listen for cart changes (correct event name)
  window.addEventListener("kk-cart-updated", updateMobileCartCount);
}

function updateMobileCartCount() {
  const countEl = document.getElementById("kkMobileCartCount");
  if (!countEl) return;

  const items = getCart();
  const total = items.reduce((sum, it) => sum + Math.max(1, Number(it.qty || 1)), 0);
  
  countEl.textContent = String(total);
  countEl.style.display = total > 0 ? "flex" : "none";
}

// Re-check on resize
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const nav = document.getElementById("kkMobileNav");
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    
    if (isMobile && !nav) {
      initMobileNav();
    } else if (!isMobile && nav) {
      nav.remove();
    }
  }, 200);
});

// /js/home/index.js
import { initNavbar } from "/js/shared/navbar.js";
import { initFooter } from "/js/shared/footer.js";

import { init99CentSection } from "./99cent.js";
import { initHomeCategoryStrip } from "./categoryStrip.js";
import { initShopTheLook } from "./shopTheLook.js";

import {
  fetchHomePromos,
  fetchCategories,
  fetchHomeProducts,
  fetchVariantsForProducts,
  fetchHomeBestSellers
} from "./api.js";

import { 
  fetchActivePromotions, 
  checkPromotionApplies, 
  calculatePromotionDiscount 
} from "/js/shared/promotionLoader.js";

import { renderHomeBanner } from "./banner/index.js";
import { renderHomeCategories } from "./renderCategories.js";
import { renderHomeGrid } from "./renderGrid.js";
import { getProductCardSkeleton, getBannerSkeleton, getCategoryChipSkeleton, repeatSkeleton } from "/js/shared/components/skeletons.js";

const state = {
  active: { mode: "best", categoryId: null }, // ✅ default
  categories: [],
  loading: false
};

async function loadInsert(mountId, path) {
  const mount = document.getElementById(mountId);
  if (!mount) {
    console.warn(`[loadInsert] Mount element not found: ${mountId}`);
    return;
  }

  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);

    const html = await res.text();
    mount.innerHTML = html;
    console.log(`[loadInsert] Loaded ${path} into ${mountId}, content length: ${html.length}`);
  } catch (err) {
    console.error(`[loadInsert] Error loading ${path}:`, err);
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;

  const grid = document.getElementById("homeProductGrid");
  if (grid) {
    grid.style.opacity = isLoading ? "0.65" : "1";
    grid.style.pointerEvents = isLoading ? "none" : "auto";
  }
}

async function loadBanner() {
  const track = document.getElementById("promoSliderTrack");
  if(track) track.innerHTML = getBannerSkeleton();

  const promos = await fetchHomePromos();
  // If we only have 1 promo, wait 1s extra to minimize layout jump? 
  // No, just render immediately.
  renderHomeBanner(promos);
}

function renderCategoriesUI() {
  renderHomeCategories({
    categories: state.categories,
    active: state.active,
    onChange: handleCategoryChange
  });
}

async function handleCategoryChange(next) {
  if (
    state.active?.mode === next?.mode &&
    state.active?.categoryId === next?.categoryId
  ) return;

  state.active = next;
  renderCategoriesUI();
  await loadGrid();
}

async function loadCategories() {
  const mount = document.getElementById("homeCategoryChips");
  if(mount) {
    mount.className = "flex gap-2 md:gap-3 overflow-x-auto pb-2 md:overflow-x-visible scrollbar-hide";
    mount.innerHTML = repeatSkeleton(getCategoryChipSkeleton, 6);
  }

  const categories = await fetchCategories();
  state.categories = categories || [];
  renderCategoriesUI();
}

async function loadGrid() {
  try {
    setLoading(true);

    // Render Skeletons immediately if empty
    const grid = document.getElementById("homeProductGrid");
    if (grid && (!grid.children.length || grid.innerHTML.trim() === "")) {
      // Apply the same grid classes as renderHomeGrid uses
      grid.className = "grid gap-[14px] grid-cols-2 md:grid-cols-4 lg:grid-cols-5";
      
      // Use a grid layout for skeletons matching the real grid
      grid.innerHTML = repeatSkeleton(getProductCardSkeleton, 10); 
    }

    const isBest = state?.active?.mode === "best";
    const categoryId = state?.active?.categoryId ?? null;

    const products = isBest
      ? await fetchHomeBestSellers({ limit: 10 })
      : await fetchHomeProducts({ categoryId, limit: 10 });

    const ids = (products || []).map(p => p.id).filter(Boolean);
    
    // START: Apply Promotions to Grid Products
    try {
      // 1. Fetch all active promotions (cached)
      const allPromos = await fetchActivePromotions();
      
      // 2. Filter for auto-apply only (no code needed)
      const autoPromos = allPromos.filter(p => !p.requires_code && !p.code);

      // 3. Apply best discount to each product
      for (const p of products) {
        // Map Supabase nested join structure back to simple array of tag IDs
        // structure: product_tags: [ { tag_id: "..." }, { tag_id: "..." } ]
        const tagIds = (p.product_tags || []).map(row => row.tag_id).filter(Boolean);

        const itemContext = {
          product_id: p.id,
          category_ids: p.category_id ? [p.category_id] : [],
          tag_ids: tagIds
        };

        const applicable = autoPromos.filter(promo => checkPromotionApplies(promo, itemContext));
        
        // Use existing engine to calculate stackable discounts
        const { totalDiscount } = calculatePromotionDiscount(applicable, p.price);
        
        if (totalDiscount > 0) {
          // If we have a discount, treat original price as "compare_at"
          // Only set compare_at if it wasn't already manually set (or if manual set is lower? usually we prefer higher original)
          // Here we assume dynamic promo overrides static price for display
          if (!p.compare_at_price || Number(p.compare_at_price) < Number(p.price)) {
             p.compare_at_price = p.price;
          }
          p.price = Math.max(0, Number(p.price) - totalDiscount);
        }
      }
    } catch (err) {
      console.warn("[home] Failed to apply promotions to grid:", err);
    }
    // END: Promotions

    const variantMap = await fetchVariantsForProducts(ids);

    renderHomeGrid(products || [], variantMap);
  } catch (err) {
    console.error("[home] grid load error:", err);
    renderHomeGrid([], new Map());
  } finally {
    setLoading(false);
  }
}


async function boot() {

// Place this inside your boot() or at top level of index.js
document.body.addEventListener("click", (e) => {
  const swatch = e.target.closest(".swatch-trigger");
  if (!swatch) return;

  e.preventDefault();
  e.stopPropagation();

  const card = swatch.closest(".product-card");
  const mainImg = card?.querySelector("[data-main-img]");
  const newSrc = swatch.getAttribute("data-variant-img");

  if (mainImg && newSrc) {
    // 1. Swap Image
    mainImg.src = newSrc;

    // 2. Visual Feedback (Borders)
    card.querySelectorAll(".swatch-trigger").forEach(btn => {
      btn.classList.remove("border-black", "ring-1", "ring-black");
      btn.classList.add("border-black/25");
    });
    swatch.classList.add("border-black", "ring-1", "ring-black");
    swatch.classList.remove("border-black/25");
  }
});

  // 1) Navbar first
  await initNavbar();

  // 2) Load inserts BEFORE any renderers that rely on IDs inside inserts
  await Promise.all([
    loadInsert("homeBannerMount", "../../page_inserts/home/banner.html"),
    // categoryStrip generates its own HTML now - no insert needed
    loadInsert("kkHome99CentMount", "../../page_inserts/home/99cent.html"),
    loadInsert("kkHomeCatalogMount", "../../page_inserts/home/catalog.html")
  ]);

  // 3) Render promo + chips + category strip + 99¢ slider (PARALLEL is key for LCP)
  // We don't need to wait for anything to start loading the grid.
  // We launch all tasks in parallel.
  
  const pBanner = loadBanner().catch(e => console.error("Banner failed", e));
  const pCats = loadCategories().then(() => initHomeCategoryStrip()).catch(e => console.error("Cats failed", e));
  const pSTL = initShopTheLook().catch(e => console.error("STL failed", e));
  const p99 = init99CentSection().catch(e => console.error("99c failed", e));
  const pGrid = loadGrid().catch(e => console.error("Grid failed", e));

  // 4) Load footer
  await initFooter();

  // No await needed. The UI will pop in as data arrives.
  // This allows the browser to prioritize what it can.
}

boot().catch((err) => {
  console.error("[home] fatal init error:", err);
});

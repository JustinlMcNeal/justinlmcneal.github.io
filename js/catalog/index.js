// js/catalog/index.js
import { initNavbar } from "../shared/navbar.js";
import { initFooter } from "../shared/footer.js";
import { fetchActiveProducts, fetchCategories, fetchBestSellerTagIds } from "./api.js";
import { fetchVariantsForProducts } from "../home/api.js";  
import { 
  fetchActivePromotions, 
  checkPromotionApplies, 
  calculatePromotionDiscount 
} from "../shared/promotionLoader.js";
import { renderHomeCard } from "../shared/components/productCardHome.js";
import { addToCart, openCartDrawer } from "../shared/cartStore.js";

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]
  ));
}

document.addEventListener("DOMContentLoaded", async () => {
  initNavbar();
  initFooter();

  const els = {
    search: document.getElementById("catalogSearch"),
    predictive: document.getElementById("predictiveResults"),
    chips: document.getElementById("categoryChips"),
    grid: document.getElementById("productGrid"),
    count: document.getElementById("catalogCount"),
    sort: document.getElementById("catalogSort"),
    catStart: document.getElementById("catContext"),
    catTitle: document.getElementById("catContextTitle"),
    catDesc: document.getElementById("catContextDesc"),
  };

  let allProducts = [];
  let allCategories = [];
  let allPromotions = [];
  let variantMap = new Map();
  let bestSellerTagIds = [];
  
  // State
  let activeCategoryId = "all";
  let activeSort = "newest";
  
  // Infinite Scroll State
  let filteredProducts = [];
  let displayedCount = 0;
  const PAGE_SIZE = 12;
  let observer = null;

  // --- URL State Management ---
  function updateURL() {
    const url = new URL(window.location);
    if (activeCategoryId && activeCategoryId !== "all") {
      url.searchParams.set("cat", activeCategoryId);
    } else {
      url.searchParams.delete("cat");
    }

    if (activeSort && activeSort !== "newest") {
      url.searchParams.set("sort", activeSort);
    } else {
      url.searchParams.delete("sort");
    }
    
    // Only push if changed
    if (url.toString() !== window.location.href) {
      window.history.pushState({}, "", url);
    }
  }

  function readURL() {
    const params = new URLSearchParams(window.location.search);
    activeCategoryId = params.get("cat") || "all";
    activeSort = params.get("sort") || "newest";
    if (els.sort) els.sort.value = activeSort;
  }

  // --- Category UI ---
  function updateCategoryHeader() {
    if (!els.catStart) return;
    
    let title = "";
    let desc = "";

    if (activeCategoryId === "all") {
      title = "All Products";
      desc = "Explore our entire collection of premium streetwear.";
    } else if (activeCategoryId.startsWith("promo:")) {
      const pid = activeCategoryId.replace("promo:", "");
      const p = allPromotions.find(x => String(x.id) === pid);
      if (p) {
        title = p.name;
        desc = p.description || "Limited time offer.";
      }
    } else {
      const c = allCategories.find(x => String(x.id) === activeCategoryId);
      if (c) {
        title = c.name;
        desc = c.description || "";
      }
    }

    if (title && activeCategoryId !== "all") {
      els.catTitle.textContent = title;
      els.catDesc.textContent = desc;
      els.catStart.classList.remove("hidden");
    } else {
      els.catStart.classList.add("hidden");
    }
  }

  function renderChips() {
    if (!els.chips) return;

    // "Deals"
    const dealChips = allPromotions
      .filter(p => !p.requires_code && !p.code)
      .map(p => ({
        id: `promo:${p.id}`,
        name: p.name || "Deal",
        isPromo: true
      }));

    const chips = [
      { id: "all", name: "All Items", isPromo: false },
      ...dealChips,
      ...allCategories.map((c) => ({ id: String(c.id), name: c.name, isPromo: false })),
    ];

    els.chips.innerHTML = chips
      .map((c) => {
        const active = String(activeCategoryId) === String(c.id);
        const baseClass = "border-2 border-black font-extrabold text-[11px] uppercase tracking-wider px-3 py-1.5 cursor-pointer whitespace-nowrap transition-all select-none rounded-[1px]";
        let colorClass = "";

        if (active) {
          colorClass = "bg-black text-white hover:bg-black/90 shadow-md";
        } else if (c.isPromo) {
           colorClass = "bg-red-50 text-red-600 border-red-200 hover:bg-red-100 hover:border-red-300";
        } else {
           colorClass = "bg-transparent text-black hover:bg-black/5 opacity-60 hover:opacity-100";
        }
        
        return `
          <button
            type="button"
            class="${baseClass} ${colorClass}"
            data-cat="${escapeHtml(c.id)}"
          >
            ${escapeHtml(c.name)}
          </button>
        `;
      })
      .join("");

    els.chips.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCategoryId = btn.dataset.cat;
        updateURL();
        updateCategoryHeader();
        renderChips();
        resetAndRenderGrid();
      });
    });
  }

  // --- Filtering & Sorting ---
  function filterProducts(source = allProducts) {
    const q = (els.search?.value || "").trim().toLowerCase();

    return source.filter((p) => {
      let matchesCat = true;

      if (activeCategoryId.startsWith("promo:")) {
        const promoId = activeCategoryId.replace("promo:", "");
        const promo = allPromotions.find(x => String(x.id) === promoId);
        
        const tagIds = (p.product_tags || []).map(row => row.tag_id).filter(Boolean);
        const itemContext = {
          product_id: p.id,
          category_ids: p.category_id ? [p.category_id] : [],
          tag_ids: tagIds
        };
        matchesCat = checkPromotionApplies(promo, itemContext);

      } else {
        matchesCat = activeCategoryId === "all" || String(p.category_id) === String(activeCategoryId);
      }

      if (!matchesCat) return false;
      if (!q) return true;

      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.slug || "").toLowerCase().includes(q)
      );
    });
  }

  function getProductWithPromotions(product) {
    const p = { ...product };
    const autoPromos = allPromotions.filter(promo => !promo.requires_code && !promo.code);

    const tagIds = (p.product_tags || []).map(row => row.tag_id).filter(Boolean);
    const itemContext = {
      product_id: p.id,
      category_ids: p.category_id ? [p.category_id] : [],
      tag_ids: tagIds
    };

    const applicable = autoPromos.filter(promo => checkPromotionApplies(promo, itemContext));
    const { totalDiscount } = calculatePromotionDiscount(applicable, p.price);

    if (totalDiscount > 0) {
      if (!p.compare_at_price || Number(p.compare_at_price) < Number(p.price)) {
         p.compare_at_price = p.price;
      }
      p.price = Math.max(0, Number(p.price) - totalDiscount);
    }
    return p;
  }

  function sortProducts(items) {
    if (!activeSort) return items;

    return [...items].sort((a, b) => {
      switch (activeSort) {
        case "best_seller": {
           const aTags = (a.product_tags || []).map(r => r.tag_id);
           const bTags = (b.product_tags || []).map(r => r.tag_id);
           const aIsBest = aTags.some(id => bestSellerTagIds.includes(id));
           const bIsBest = bTags.some(id => bestSellerTagIds.includes(id));
           if (aIsBest && !bIsBest) return -1;
           if (!aIsBest && bIsBest) return 1;
           return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        }
        case "price_asc":
          return Number(a.price || 0) - Number(b.price || 0);
        case "price_desc":
          return Number(b.price || 0) - Number(a.price || 0);
        case "name_asc":
          return (a.name || "").localeCompare(b.name || "");
        case "name_desc":
          return (b.name || "").localeCompare(a.name || "");
        case "newest":
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });
  }

  // --- Rendering & Infinite Scroll ---

  function resetAndRenderGrid() {
    // 1. Filter, Map Promos, Sort
    const filtered = filterProducts();
    const mapped = filtered.map(getProductWithPromotions);
    filteredProducts = sortProducts(mapped);
    
    // 2. Reset scroll state
    displayedCount = 0;
    
    if (els.count) {
      els.count.textContent = `${filteredProducts.length} item${filteredProducts.length === 1 ? "" : "s"}`;
    }

    if (els.grid) {
      els.grid.innerHTML = ""; // Clear
    }
    
    // 3. Render initial chunk
    renderNextChunk();
  }

  function renderNextChunk() {
    if (!els.grid) return;

    // Handle "Smart Zero Results"
    if (filteredProducts.length === 0) {
      // Show empty state then Best Sellers
      els.grid.innerHTML = `
        <div class="col-span-full py-12 text-center">
            <p class="text-lg font-bold uppercase tracking-widest text-neutral-400">No results found.</p>
            <p class="text-sm text-neutral-500 mt-2">Try adjusting your filters or search.</p>
            <div class="mt-8 border-t border-neutral-200 pt-8" id="suggested-grid">
               <h3 class="font-black text-xl mb-6">Popular Right Now</h3>
               <div id="best-seller-fallback" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-8 text-left"></div>
            </div>
        </div>
      `;
      // Render best sellers into fallback
      const fallbackGrid = document.getElementById("best-seller-fallback");
      if (fallbackGrid) {
         // Get top 4 best sellers
         // Note: We need 'new' best sellers, not sorted by activeSort
         const mappedAll = allProducts.map(getProductWithPromotions);
         // Find best sellers manually
         const best = mappedAll.filter(p => {
             const t = (p.product_tags || []).map(r => r.tag_id);
             return t.some(id => bestSellerTagIds.includes(id));
         }).slice(0, 4);
         
         const toRender = best.length ? best : mappedAll.slice(0, 4);
         
         fallbackGrid.innerHTML = toRender.map(p => {
            const v = variantMap.get(p.id) || [];
            return renderHomeCard(p, v, { variantLimit: 4 });
         }).join("");
      }
      return;
    }

    const nextBatch = filteredProducts.slice(displayedCount, displayedCount + PAGE_SIZE);
    if (nextBatch.length === 0) return;

    const fragment = document.createDocumentFragment();
    
    nextBatch.forEach((product, idx) => {
      const variants = variantMap.get(product.id) || [];
      if (!product.catalog_image_url && product.images?.catalog) {
        product.catalog_image_url = product.images.catalog;
      }
      
      const el = document.createElement("div");
      // Use CSS Grid/Flex wrapper if needed, or just return the HTML string wrapped in a logic
      // But renderHomeCard returns a string.
      // So let's insertHTML relative to a temp container then append children
      const temp = document.createElement('div');
      
      // Feature: Staggered Animation
      const delay = (idx % PAGE_SIZE) * 50; // ms
      temp.innerHTML = renderHomeCard(product, variants, { 
        variantLimit: 4,
        style: `style="animation-delay: ${delay}ms; animation-fill-mode: backwards;"`
      });
      
      while (temp.firstChild) {
        fragment.appendChild(temp.firstChild);
      }
    });

    els.grid.appendChild(fragment);
    displayedCount += nextBatch.length;

    // Sentinel for Infinite Scroll
    setupSentinel();
  }

  function setupSentinel() {
    // Remove old sentinel
    const old = document.getElementById("scroll-sentinel");
    if (old) old.remove();

    if (displayedCount < filteredProducts.length) {
      const sentinel = document.createElement("div");
      sentinel.id = "scroll-sentinel";
      sentinel.className = "col-span-full h-20 w-full flex items-center justify-center";
      sentinel.innerHTML = `<div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div>`;
      els.grid.appendChild(sentinel);

      if (!observer) {
        observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
             // slight delay for effect
             setTimeout(() => renderNextChunk(), 300);
          }
        }, { rootMargin: "200px" });
      }
      observer.observe(sentinel);
    }
  }

  // --- Quick Add Handler ---
  function handleQuickAdd(btn) {
    const pid = btn.dataset.id;
    const hasVariants = btn.dataset.hasVariants === "true";

    if (hasVariants) {
      // Redirect
      const product = allProducts.find(x => String(x.id) === String(pid));
      if (product && product.slug) {
        window.location.href = `/pages/product.html?slug=${encodeURIComponent(product.slug)}`;
      }
      return;
    }

    // Direct Add
    btn.classList.add("animate-pulse"); 
    btn.textContent = "Adding...";
    
    // Find product & its single variant
    const product = allProducts.find(x => String(x.id) === String(pid));
    const variants = variantMap.get(pid) || [];
    
    // Fallback: If no variants found, try to use the product as its own 'variant' (for Simple Products)
    // Or just default to the first one found.
    const isValidVariant = variants.length > 0;
    const variantId = isValidVariant ? variants[0].id : product.id; 
    const variantName = isValidVariant ? (variants[0].option_value || "Standard") : "Standard";

    if (product) {
       // getProductWithPromotions calculates the current price
       const promoP = getProductWithPromotions(product);
       
       addToCart({
         id: variantId, 
         product_id: product.code || product.id, // SKU
         variant: variantName,
         name: product.name,
         price: promoP.price,
         image: product.catalog_image_url || product.primary_image_url
       });

       setTimeout(() => {
          btn.textContent = "Added!";
          openCartDrawer();
          setTimeout(() => {
             btn.textContent = "Add to Cart +";
             btn.classList.remove("animate-pulse");
          }, 2000);
       }, 500);
    } else {
       console.error("Product not found for quick add");
       btn.textContent = "Error";
    }
  }

  // Event Delegation
  document.addEventListener("click", (e) => {
    // Swatch
    const swatch = e.target.closest(".swatch-trigger");
    if (swatch) {
      const card = swatch.closest(".product-card");
      const mainImg = card?.querySelector("[data-main-img]");
      const newSrc = swatch.getAttribute("data-variant-img");
      if (mainImg && newSrc) {
        mainImg.src = newSrc;
        card.querySelectorAll(".swatch-trigger").forEach(btn => {
          btn.classList.remove("border-black", "ring-1", "ring-black", "scale-110");
          btn.classList.add("border-black/20");
        });
        swatch.classList.add("border-black", "ring-1", "ring-black", "scale-110");
        swatch.classList.remove("border-black/20");
      }
      return;
    }

    // Quick Add
    const qaBtn = e.target.closest(".quick-add-btn");
    if (qaBtn) {
       e.preventDefault();
       e.stopPropagation();
       handleQuickAdd(qaBtn);
    }
    
    // Predictive Result Link
    const pLink = e.target.closest(".predictive-item");
    if (pLink) {
       // Navigation happens naturally via href, but we can track click here
    }
  });


  // --- Predictive Search ---
  if (els.search && els.predictive) {
     els.search.addEventListener("input", (e) => {
        const val = e.target.value.trim().toLowerCase();
        
        // Live update grid too
        // Debounce slightly if heavy? For now direct
        
        // Update predictive dropdown
        if (val.length < 2) {
           els.predictive.classList.add("hidden");
           resetAndRenderGrid(); // Restore grid if cleared
           return;
        }

        // Search in all products (limit 5)
        const matches = allProducts.filter(p => 
           (p.name || "").toLowerCase().includes(val) ||
           (p.slug || "").toLowerCase().includes(val)
        ).slice(0, 5);

        if (matches.length > 0) {
           els.predictive.innerHTML = matches.map(p => {
              const img = p.catalog_image_url || p.primary_image_url || "";
              return `
                 <a href="/pages/product.html?slug=${encodeURIComponent(p.slug)}" class="predictive-item flex items-center gap-3 p-3 hover:bg-neutral-50 transition-colors border-b last:border-0 border-neutral-100">
                    <img src="${img}" class="w-10 h-10 object-cover bg-neutral-100" alt="">
                    <div>
                       <div class="font-bold text-xs uppercase leading-tight">${p.name}</div>
                       <div class="text-[10px] text-neutral-500 font-mono">${money(p.price)}</div>
                    </div>
                 </a>
              `;
           }).join("");
           els.predictive.classList.remove("hidden");
        } else {
           els.predictive.innerHTML = `<div class="p-4 text-xs font-bold text-neutral-400 uppercase text-center">No matches</div>`;
           els.predictive.classList.remove("hidden");
        }
        
        // Also update regular grid
        resetAndRenderGrid();
     });

     // Hide predictive when clicking outside
     document.addEventListener("click", (e) => {
        if (!els.search.contains(e.target) && !els.predictive.contains(e.target)) {
           els.predictive.classList.add("hidden");
        }
     });
     
     // Focus in shows it again if value exists
     els.search.addEventListener("focus", () => {
        if (els.search.value.trim().length >= 2) {
           els.predictive.classList.remove("hidden");
        }
     });
  }


  // --- Init ---
  async function init() {
    try {
      if (els.grid) els.grid.innerHTML = `<div class="col-span-full text-center py-12 font-black uppercase tracking-widest text-sm animate-pulse">Loading products…</div>`;

      // Read URL first
      readURL();

      const [_products, _categories, _promos, _bestSellerIds] = await Promise.all([
        fetchActiveProducts(),
        fetchCategories(),
        fetchActivePromotions(),
        fetchBestSellerTagIds()
      ]);
      
      allProducts = _products || [];
      allCategories = _categories || [];
      allPromotions = _promos || [];
      bestSellerTagIds = _bestSellerIds || [];
      
      const ids = allProducts.map(p => p.id);
      if (ids.length) {
         variantMap = await fetchVariantsForProducts(ids);
      }

      updateCategoryHeader();
      renderChips();
      resetAndRenderGrid();

      els.sort?.addEventListener("change", (e) => {
        activeSort = e.target.value;
        updateURL();
        resetAndRenderGrid();
      });
      
      // Global popstate for back button
      window.addEventListener("popstate", () => {
         readURL();
         renderChips();
         updateCategoryHeader();
         resetAndRenderGrid();
      });

    } catch (err) {
      console.error(err);
      if (els.grid) {
        els.grid.innerHTML = `<div class="col-span-full text-center py-10 text-red-600 font-bold text-sm">Failed to load catalog.<br><span class="text-xs opacity-70 font-normal">${escapeHtml(err?.message || err)}</span></div>`;
      }
    }
  }

  function money(n) {
     return Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  init();
});


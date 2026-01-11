// /js/home/shopTheLook.js
import { getSupabaseClient } from "../shared/supabaseClient.js";
import { fetchVariantsForProducts } from "./api.js";
import { fetchActivePromotions, checkPromotionApplies, calculatePromotionDiscount } from "../shared/promotionLoader.js";
import { initBannerScroll } from "./banner/engine.js";
import { parseColorValue } from "../shared/colorUtils.js";

const supabase = getSupabaseClient();
let activePromos = [];

export async function initShopTheLook() {
  const mount = document.getElementById("kkShopTheLookMount");
  if (!mount) return;

  // 1. Fetch ALL Active Looks
  const { data: looks } = await supabase
    .from("shop_looks")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (!looks || !looks.length) {
    mount.innerHTML = ""; 
    return;
  }

  // 2. Fetch Promos first
  activePromos = await fetchActivePromotions().catch(() => []);

  // 3. Prepare Data for all looks (Parallel fetching)
  const looksData = await Promise.all(looks.map(async (look) => {
      // Fetch items for this look
      const { data: items } = await supabase
        .from("shop_look_items")
        .select("*, product:products(*)")
        .eq("look_id", look.id);
      
      if(!items || !items.length) return null;

      // Fetch variants context
      const productIds = items.map(i => i.product_id);
      const variantMap = await fetchVariantsForProducts(productIds);

      // Apply promos
      items.forEach(item => {
        if(item.product) applyPromoToProduct(item.product, activePromos);
      });

      return {
          look,
          items,
          variantMap
      };
  }));

  const validLooks = looksData.filter(x => x !== null);
  if(!validLooks.length) return;

  // 4. Inject Container Template
  await loadInsert(mount);
  
  // 5. Render Carousel
  renderCarousel(validLooks);
}

async function loadInsert(container) {
  container.innerHTML = `
    <section class="max-w-6xl mx-auto px-4 mb-16 md:mb-24 mt-8 md:mt-12 hidden relative group/main select-none" id="shopTheLookSection">
        
        <!-- STATIC HEADER: Outside the Scroll Track -->
        <div class="mb-6 md:mb-8 flex flex-col items-center text-center relative z-20">
            <h2 class="font-black text-3xl md:text-5xl uppercase tracking-tighter leading-none relative inline-block">
                SHOP THE LOOK
                <div class="absolute -bottom-3 md:-bottom-4 left-0 w-full h-3 md:h-4 text-kkpink">
                    <svg viewBox="0 0 100 20" preserveAspectRatio="none" class="w-full h-full">
                        <path d="M0 10 Q 25 20, 50 10 T 100 10" stroke="currentColor" stroke-width="4" fill="none" />
                    </svg>
                </div>
            </h2>
            <p class="mt-4 text-sm text-gray-500 font-medium">Complete outfits curated for you</p>
        </div>

        <!-- Main Carousel Track -->
        <div class="overflow-hidden relative w-full max-w-full">
            <div id="stlTrack" class="flex w-full snap-x snap-mandatory overflow-x-auto no-scrollbar pb-2 md:pb-4" style="max-width: 100vw;">
                <!-- Slides Injected Here -->
            </div>
        </div>

        <!-- Navigation Dots (Shop The Look Level) -->
        <div id="stlDots" class="flex justify-center gap-2 mt-3 md:mt-4 z-20 relative"></div>
    </section>
    
    <style>
        .stl-dot {
            position: absolute;
            width: 32px;
            height: 32px;
            transform: translate(-50%, -50%);
            background-color: rgba(0, 0, 0, 0.6); 
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            z-index: 50;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        @media (min-width: 768px) {
            .stl-dot {
                width: 40px;
                height: 40px;
                border-radius: 50%;
            }
        }
        .stl-dot::after {
            content: '';
            width: 10px;
            height: 10px;
            background: white;
            border-radius: 50%;
            transition: all 0.3s;
        }
        @media (min-width: 768px) {
            .stl-dot::after {
                width: 14px;
                height: 14px;
                border-radius: 50%;
            }
        }
        .stl-dot:hover {
            transform: translate(-50%, -50%) scale(1.1);
            background-color: rgba(0, 0, 0, 0.7);
        }
        .stl-dot.active {
            background-color: rgba(0, 0, 0, 0.9);
            transform: translate(-50%, -50%) scale(1.15);
            border-color: white;
        }
        .stl-dot.active::after {
            width: 12px;
            height: 12px;
        }
        @media (min-width: 768px) {
            .stl-dot.active::after {
                width: 16px;
                height: 16px;
            }
        }

        /* Banner Style Dots */
        .slider-dot {
            width: 8px; height: 8px; border-radius: 50%; 
            background: rgba(0,0,0,0.2); transition: all 0.3s;
        }
        @media (min-width: 768px) {
            .slider-dot {
                width: 10px; height: 10px;
            }
        }
        .slider-dot.active {
            background: black; transform: scale(1.2);
        }
        
        /* Line clamp for mobile */
        .line-clamp-2 {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        
        /* Slide animations - STL specific overrides */
        .stl-slide {
            filter: none !important;
            transition: transform 0.4s ease-out, opacity 0.4s ease-out !important;
        }
        .stl-slide:not(.active) {
            opacity: 0.5 !important;
            transform: scale(0.95) !important;
        }
        .stl-slide.active {
            opacity: 1 !important;
            transform: scale(1) !important;
        }
        
        /* Disable transitions during teleport */
        .no-transition .stl-slide,
        .no-transition .stl-product-card,
        .no-transition .stl-card-inner {
            transition: none !important;
        }
        
        /* Product card styling */
        .stl-product-card {
            opacity: 0.7;
            transform: scale(0.92);
            transition: transform 0.3s ease-out, opacity 0.3s ease-out;
        }
        .stl-card-inner {
            transition: box-shadow 0.3s ease-out;
        }
        .stl-product-card.active,
        .stl-slide.active .stl-product-card:first-child {
            opacity: 1;
            transform: scale(1);
        }
        .stl-product-card.active .stl-card-inner,
        .stl-slide.active .stl-product-card:first-child .stl-card-inner {
            box-shadow: 0 4px 20px rgba(0,0,0,0.12);
        }
        
        /* Hotspot dots styling */
        .stl-dot {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }
    </style>
  `;
}

function renderCarousel(looksData) {
    const section = document.getElementById("shopTheLookSection");
    const track = document.getElementById("stlTrack");
    const dotsContainer = document.getElementById("stlDots");
    
    if(!section || !track) return;
    section.classList.remove("hidden");

    // Cloning Logic for Infinite Loop (if > 1)
    let renderList = looksData.map(d => ({ ...d, isClone: false }));
    let cloneCount = 0;
    const isLooping = looksData.length > 1;

    if (isLooping) {
        const clonesRequired = 2; // Min clones
        cloneCount = clonesRequired;
        
        const leftClones = [];
        for(let i=0; i<clonesRequired; i++) {
             const orig = looksData[(looksData.length - 1 - i + looksData.length * 10) % looksData.length];
             leftClones.unshift({ ...orig, isClone: true });
        }
        const rightClones = [];
        for(let i=0; i<clonesRequired; i++) {
             const orig = looksData[i % looksData.length];
             rightClones.push({ ...orig, isClone: true });
        }
        renderList = [...leftClones, ...looksData.map(d => ({ ...d, isClone: false })), ...rightClones];
    }

    // Build HTML
    track.innerHTML = renderList.map((data, i) => buildSlideHTML(data, i, data.isClone)).join("");
    
    // Render Navigation Dots (Global Level)
    if (isLooping) {
         dotsContainer.innerHTML = looksData.map((_, i) => `
            <button class="slider-dot" data-idx="${i}" aria-label="Go to look ${i+1}"></button>
         `).join("");
    }

    // Initialize Global Banner Scroller
    initBannerScroll(track, dotsContainer, looksData.length, cloneCount);

    // Initialize Internal Interactions for EACH slide
    Array.from(track.children).forEach((slideEl, i) => {
        // Find internal elements
        const hotspots = slideEl.querySelector(".stl-hotspots-layer");
        const productSlider = slideEl.querySelector(".stl-product-mount");
        
        if (hotspots && productSlider) {
            setupSliderInteractions(hotspots, productSlider, null); 
        }
    });
}

function buildSlideHTML({ look, items, variantMap }, uniqueIdx, isClone = false) {
    // Generate inner Product Cards
    const productsHTML = items.map((item, idx) => {
        const product = item.product;
        if (!product) return "";
        const variants = variantMap.get(product.id) || [];
        const productHref = product.slug ? `/pages/product.html?slug=${encodeURIComponent(product.slug)}` : "#";
        
        return `
          <div class="stl-product-card w-[160px] md:w-full snap-center shrink-0 flex justify-center items-start px-1 py-2 md:py-4" 
               data-slide-idx="${idx}" 
               data-product-href="${productHref}"
               id="stl-slide-${uniqueIdx}-${idx}">
              <div class="stl-card-inner w-full md:max-w-[280px] bg-white md:bg-transparent rounded-lg md:rounded-none p-2 md:p-0 text-center cursor-pointer shadow-sm md:shadow-none transition-shadow duration-300">
                  <!-- Product Image -->
                  <div class="aspect-square mb-2 md:mb-4 relative overflow-hidden rounded-md md:rounded-none">
                      <img src="${product.primary_image_url}" class="w-full h-full object-cover select-none transition-transform duration-300 hover:scale-105" draggable="false">
                  </div>
                  
                  <!-- Info -->
                  <h3 class="font-bold text-sm md:text-lg leading-tight uppercase mb-1 hover:text-kkpink transition-colors line-clamp-2">${product.name}</h3>
                  <div class="mb-2 md:mb-3 font-bold text-sm md:text-base">
                    ${ product.compare_at_price && Number(product.compare_at_price) > Number(product.price) 
                       ? `<span class="text-red-500">$${product.price}</span> <span class="text-gray-400 line-through text-xs ml-1">$${product.compare_at_price}</span>`
                       : `<span>$${product.price}</span>` 
                    }
                  </div>
                  
                  <!-- Swatches -->
                  <div class="flex justify-center gap-1 pb-2">
                      ${renderSwatchesSimple(variants, idx, uniqueIdx)}
                  </div>
              </div>
          </div>
        `;
    }).join("");

    // Generate Hotspots
    const hotspotsHTML = items.map((item, idx) => {
       const x = item.x_position ?? 50;
       const y = item.y_position ?? 50;
       const slug = item.product?.slug || "";
       const href = slug ? `/pages/product.html?slug=${encodeURIComponent(slug)}` : "#";

       return `
       <button class="stl-dot" 
               style="left: ${x}%; top: ${y}%;"
               data-idx="${idx}"
               data-href="${href}"
               aria-label="View ${item.product?.name}">
       </button>
       `;
    }).join("");

// Full Slide Layout
    // HEADER REMOVED from here
    const cloneClass = isClone ? ' is-clone' : '';
    return `
    <div class="stl-slide${cloneClass} min-w-full w-full flex-shrink-0 snap-center px-2 !shadow-none overflow-hidden" data-slide-index="${uniqueIdx}" style="scroll-snap-align: center;">
        <!-- Content -->
        <div class="flex flex-col md:flex-row gap-4 md:gap-8 lg:gap-12 items-start md:items-center justify-center w-full">
            
            <!-- Left: Interactive Image -->
            <div class="w-full md:w-3/5 md:max-w-3xl relative group select-none overflow-hidden">
               <div class="relative w-full" style="max-height: 70vh;">
                   <img src="${look.image_url}" class="stl-look-image w-full h-auto max-h-[70vh] object-contain md:object-cover rounded-lg md:rounded-none border border-gray-100" alt="Shop The Look" draggable="false">
                   <div class="stl-hotspots-layer absolute inset-0 z-10 block">
                      ${hotspotsHTML}
                   </div>
               </div>

               <!-- Mobile Hint -->
               <div class="absolute bottom-4 left-4 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-sm md:hidden pointer-events-none z-20">
                  Tap dots to view items
               </div>
            </div>

            <!-- Right: Product Slider -->
            <div class="w-full md:w-2/5 md:max-w-sm h-fit">
               <!-- Mobile horizontal scroll products -->
               <div class="relative">
                   <div class="stl-product-mount flex overflow-x-auto snap-x snap-mandatory gap-3 md:gap-0 pb-2 md:pb-4 px-0 md:px-0 cursor-grab active:cursor-grabbing select-none items-start no-scrollbar" style="scroll-behavior: smooth; -webkit-overflow-scrolling: touch;">
                      ${productsHTML}
                   </div>
                   <!-- Mobile scroll indicator -->
                   <div class="flex justify-center gap-1.5 mt-2 md:hidden" id="stl-product-dots-${uniqueIdx}"></div>
               </div>
            </div>
        </div>
    </div>
    `;
}

function applyPromoToProduct(p, promos) {
    const autoPromos = promos.filter(pr => !pr.requires_code && !pr.code);
    const context = { product_id: p.id, category_ids: [p.category_id], tag_ids: [] };
    const applicable = autoPromos.filter(promo => checkPromotionApplies(promo, context));
    const { totalDiscount } = calculatePromotionDiscount(applicable, p.price);

    if (totalDiscount > 0) {
        if (!p.compare_at_price || Number(p.compare_at_price) < Number(p.price)) {
            p.compare_at_price = p.price;
        }
        // Round to 2 decimal places to avoid floating point issues
        p.price = Math.round(Math.max(0, Number(p.price) - totalDiscount) * 100) / 100;
    }
}

function renderSwatchesSimple(variants, slideIdx, uniqueIdx) {
    const colors = variants.filter(v => v.option_name === 'Color').slice(0, 5);
    if(!colors.length) return "";
    
    return colors.map(v => {
        const imgUrl = v.preview_image_url; 
        const { background, isMultiColor } = parseColorValue(v.option_value);
        
        // Check if this is a light color that needs a visible border
        const colorLower = String(v.option_value || "").toLowerCase();
        const isLight = colorLower.includes("white") || colorLower.includes("cream") || colorLower.includes("ivory");
        const borderClass = isLight && !isMultiColor ? "ring-1 ring-inset ring-black/20" : "";
        
        // Scope selector to specific slide within specific loop index
        const clickHandler = imgUrl 
          ? `event.preventDefault(); event.stopPropagation(); const img = document.querySelector('#stl-slide-${uniqueIdx}-${slideIdx} img'); if(img) img.src = '${imgUrl}';`
          : `event.preventDefault(); event.stopPropagation();`; 

        return `
        <button class="w-6 h-4 rounded-md border border-gray-300 hover:scale-110 transition-transform focus:outline-none focus:ring-1 focus:ring-black ${borderClass}" 
                style="background: ${background};" 
                title="${v.option_value}"
                onclick="${clickHandler}"
        ></button>
    `;
    }).join("") + (variants.length > 5 ? `<span class="text-[10px] self-center ml-1">+${variants.length - 5}</span>` : "");
}

function setupSliderInteractions(dotsContainer, slider, pagination) {
    // This function runs LOCALLY for each slide's internal product slider
    // dotsContainer = the hotspots layer
    // slider = the product mount
    
    const dots = dotsContainer.querySelectorAll(".stl-dot");
    // Pagination is null now
    
    let isDown = false;
    let hasMoved = false; 
    let startX;
    let scrollLeft;

    const startDrag = (e) => {
        isDown = true;
        hasMoved = false;
        slider.style.cursor = 'grabbing';
        slider.style.scrollBehavior = 'auto'; 
        slider.style.scrollSnapType = 'none'; 
        startX = (e.pageX || e.touches[0].pageX) - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
        
        // STOP PROPAGATION so we don't drag the parent Banner Carousel
        e.stopPropagation(); 
    };

    const stopDrag = (e) => {
        if(!isDown) return;
        isDown = false;
        slider.style.cursor = 'grab';

        if (!hasMoved) { 
             slider.style.scrollSnapType = 'x mandatory'; 
             slider.style.scrollBehavior = 'smooth';
             return; 
        }

        const firstInfo = slider.firstElementChild ? slider.firstElementChild.getBoundingClientRect() : { width: slider.clientWidth };
        const gap = 0; 
        const stride = firstInfo.width + gap;
        
        const nearestIndex = Math.round(slider.scrollLeft / stride);
        
        slider.scrollTo({
            left: nearestIndex * stride,
            behavior: 'smooth'
        });

        setTimeout(() => {
           slider.style.scrollSnapType = 'x mandatory'; 
           slider.style.scrollBehavior = 'smooth';
        }, 500);
    };

    const doDrag = (e) => {
        if(!isDown) return;
        
         // STOP PROPAGATION to prevent parent drag
        e.stopPropagation();

        const x = (e.pageX || e.touches[0].pageX) - slider.offsetLeft;
        const walk = (x - startX);
        
        if (Math.abs(walk) > 5) {
            hasMoved = true;
            // Prevent browser scroll
            if(e.cancelable && !e.defaultPrevented && Math.abs(walk) > 10) e.preventDefault(); 
            
            const moveSpeed = walk * 1.5; 
            slider.scrollLeft = scrollLeft - moveSpeed;
        }
    };

    slider.addEventListener('mousedown', startDrag);
    slider.addEventListener('mouseleave', stopDrag);
    slider.addEventListener('mouseup', stopDrag);
    slider.addEventListener('mousemove', doDrag);
    
    // Touch Events: Note we use passive: false to allow preventDefault
    slider.addEventListener('touchstart', startDrag, { passive: false });
    slider.addEventListener('touchend', stopDrag);
    slider.addEventListener('touchmove', doDrag, { passive: false });
    
    // Local Dot Interactions
    dots.forEach(dot => {
        dot.addEventListener("mouseenter", () => {
             const idx = dot.dataset.idx;
             // Scope internal scroll
             const targetSlide = slider.querySelector(`[data-slide-idx="${idx}"]`);
             if (targetSlide) {
                // Calculate position to center the slide manually to avoid scrollIntoView bubbling
                const sliderWidth = slider.clientWidth;
                const slideWidth = targetSlide.offsetWidth;
                const targetLeft = targetSlide.offsetLeft;
                
                const scrollPos = targetLeft - (sliderWidth / 2) + (slideWidth / 2);

                slider.scrollTo({ 
                    left: scrollPos,
                    behavior: 'smooth' 
                });
             }
        });

        dot.addEventListener("click", (e) => {
             e.preventDefault(); 
             const href = dot.dataset.href;
             if(href && href !== '#') {
                 window.location.href = href;
             }
        });
    });

    // Product Card Click Navigation
    const productCards = slider.querySelectorAll(".stl-product-card");
    productCards.forEach(card => {
        card.addEventListener("click", (e) => {
            // Only navigate if user didn't drag
            if (hasMoved) return;
            
            // Don't navigate if clicking a swatch button
            if (e.target.closest("button")) return;
            
            const href = card.dataset.productHref;
            if (href && href !== "#") {
                window.location.href = href;
            }
        });
    });

    // Intersection Observer for highlighting dots (Local)
    // We scope observer to this specific slider instance
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const idx = entry.target.dataset.slideIdx;
                // Only highlight dots in THIS container
                highlightDot(dots, idx);
            }
        });
    }, { root: slider, threshold: 0.6 });

    slider.querySelectorAll("[data-slide-idx]").forEach(el => observer.observe(el));
}

function highlightDot(dots, activeIdx) {
    dots.forEach(d => {
        if (d.dataset.idx === activeIdx) {
            d.classList.add("active");
        } else {
            d.classList.remove("active");
        }
    });
}


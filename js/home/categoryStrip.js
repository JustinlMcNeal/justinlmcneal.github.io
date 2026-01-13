// /js/home/categoryStrip.js
// Generates the entire category strip section - no HTML insert needed
import { fetchHomeCategoryStrip } from "./api.js";
import { getOptimizedImageUrl, IMAGE_SIZES } from "../shared/imageOptimizer.js";

function esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function titleCase(s) {
  const x = String(s ?? "").trim();
  if (!x) return "";
  return x.charAt(0).toUpperCase() + x.slice(1);
}

// ========== GENERATE SECTION HTML ==========
function generateSectionHTML() {
  return `
    <section class="max-w-6xl mx-auto px-4 mt-12 mb-16" id="categoryStripSection">
      
      <!-- Header -->
      <div class="mb-8 flex flex-col items-center text-center">
        <h2 class="font-black text-3xl md:text-5xl uppercase tracking-tighter leading-none relative inline-block">
          Shop by Category
          <div class="absolute -bottom-3 md:-bottom-4 left-0 w-full h-3 md:h-4 text-kkpink">
            <svg viewBox="0 0 100 20" preserveAspectRatio="none" class="w-full h-full">
              <path d="M0 10 Q 25 20, 50 10 T 100 10" stroke="currentColor" stroke-width="4" fill="none" />
            </svg>
          </div>
        </h2>
        <p class="mt-4 text-sm text-gray-500 font-medium">Find exactly what you're looking for</p>
      </div>

      <!-- Carousel Container -->
      <div class="relative group/carousel">
        
        <!-- Left Arrow -->
        <button 
          id="catStripLeftBtn"
          class="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-20 w-12 h-12 bg-white border-2 border-black items-center justify-center shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-all hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Scroll left"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>

        <!-- Cards Track -->
        <div 
          id="catStripTrack"
          class="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 scroll-smooth"
          style="-ms-overflow-style: none; scrollbar-width: none;"
        >
          <!-- Skeleton Loaders (replaced when data loads) -->
          <div class="w-[260px] sm:w-[280px] lg:w-[300px] shrink-0 aspect-[10/14] bg-gray-200 animate-pulse rounded-lg"></div>
          <div class="w-[260px] sm:w-[280px] lg:w-[300px] shrink-0 aspect-[10/14] bg-gray-200 animate-pulse rounded-lg"></div>
          <div class="w-[260px] sm:w-[280px] lg:w-[300px] shrink-0 aspect-[10/14] bg-gray-200 animate-pulse rounded-lg"></div>
          <div class="w-[260px] sm:w-[280px] lg:w-[300px] shrink-0 aspect-[10/14] bg-gray-200 animate-pulse rounded-lg"></div>
        </div>

        <!-- Right Arrow -->
        <button 
          id="catStripRightBtn"
          class="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-20 w-12 h-12 bg-white border-2 border-black items-center justify-center shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-all hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Scroll right"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
          </svg>
        </button>
      </div>

      <!-- Progress Dots -->
      <div id="catStripDots" class="flex justify-center gap-2 mt-4"></div>

      <!-- Mobile View All Button -->
      <div class="sm:hidden mt-6 text-center">
        <a href="/pages/catalog.html" class="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest border-2 border-black px-6 py-3 hover:bg-black hover:text-white transition-all">
          View All Categories
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
          </svg>
        </a>
      </div>
    </section>
    
    <style>
      #catStripTrack::-webkit-scrollbar { display: none; }
      @keyframes catFadeIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .cat-card { animation: catFadeIn 0.5s ease-out both; }
    </style>
  `;
}

// ========== RENDER CATEGORY CARD ==========
function renderCategoryCard(c, index) {
  const name = titleCase(c.name);
  const count = Number(c.product_count || 0);
  const href = `/pages/catalog.html?cat=${encodeURIComponent(c.id)}`;
  const rawImg = c.home_image_url || c.home_image_path || "";
  // Optimize category images (300x400 WebP)
  const img = getOptimizedImageUrl(rawImg, IMAGE_SIZES.categoryStrip);

  return `
    <a class="cat-card relative w-[260px] sm:w-[280px] lg:w-[300px] shrink-0 snap-start no-underline text-white block overflow-hidden aspect-[10/14] group rounded-lg shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1" 
       href="${href}" 
       aria-label="All ${esc(name)}"
       style="animation-delay: ${index * 0.1}s;">
      
      ${img 
        ? `<img src="${esc(img)}" alt="${esc(name)}" loading="lazy" decoding="async" class="w-full h-full object-cover block transition-transform duration-700 group-hover:scale-110" />`
        : `<div class="w-full h-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-gray-500 text-6xl">📷</div>`
      }

      <!-- Text Overlay -->
      <div class="absolute left-1/2 bottom-6 -translate-x-1/2 z-10 flex flex-col gap-1 text-center uppercase tracking-[0.12em] w-full px-4">
        <div class="inline-flex items-center justify-center gap-2 leading-none" style="text-shadow: 0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.6), 0 0 3px rgba(0,0,0,0.9);">
          <span class="font-black text-[22px] sm:text-[24px]">All</span>
          <span class="bg-white/20 backdrop-blur-sm text-white text-[14px] font-bold px-2 py-0.5 rounded-full">${count}</span>
        </div>
        <div class="font-light text-[1.4rem] sm:text-[1.5rem] tracking-wider leading-[1.02]" style="text-shadow: 0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.6), 0 0 3px rgba(0,0,0,0.9);">${esc(name)}</div>
      </div>
      
      <!-- Hover Border Glow -->
      <div class="absolute inset-0 border-4 border-transparent group-hover:border-white/50 transition-all duration-300 rounded-lg pointer-events-none"></div>
    </a>
  `;
}

// ========== RENDER VIEW ALL CARD ==========
function renderViewAllCard(index) {
  return `
    <a class="cat-card relative w-[260px] sm:w-[280px] lg:w-[300px] shrink-0 snap-start no-underline block overflow-hidden aspect-[10/14] group rounded-lg border-2 border-dashed border-gray-300 hover:border-black transition-all duration-300 bg-gray-50 hover:bg-gray-100" 
       href="/pages/catalog.html"
       aria-label="View all categories"
       style="animation-delay: ${index * 0.1}s;">
      <div class="w-full h-full flex flex-col items-center justify-center text-center p-6">
        <div class="w-16 h-16 mb-4 rounded-full bg-black text-white flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
          →
        </div>
        <div class="font-black uppercase tracking-widest text-sm text-gray-600 group-hover:text-black">View All</div>
        <div class="text-xs text-gray-400 mt-1">Browse full catalog</div>
      </div>
    </a>
  `;
}

// ========== SETUP SCROLL ARROWS ==========
function setupScrollArrows(track) {
  const leftBtn = document.getElementById("catStripLeftBtn");
  const rightBtn = document.getElementById("catStripRightBtn");
  
  if (!leftBtn || !rightBtn || !track) return;
  
  const cardWidth = 300 + 16;
  
  function updateArrows() {
    leftBtn.disabled = track.scrollLeft <= 10;
    rightBtn.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 10;
  }
  
  leftBtn.addEventListener("click", () => {
    track.scrollBy({ left: -cardWidth * 2, behavior: "smooth" });
  });
  
  rightBtn.addEventListener("click", () => {
    track.scrollBy({ left: cardWidth * 2, behavior: "smooth" });
  });
  
  track.addEventListener("scroll", updateArrows);
  updateArrows();
}

// ========== SETUP PROGRESS DOTS ==========
function setupProgressDots(track, count) {
  const dotsContainer = document.getElementById("catStripDots");
  if (!dotsContainer || count <= 1) return;
  
  const dotCount = Math.min(count, 5);
  dotsContainer.innerHTML = Array(dotCount).fill(0).map((_, i) => 
    `<button class="catstrip-dot w-2 h-2 rounded-full transition-all ${i === 0 ? 'bg-black w-6' : 'bg-gray-300 hover:bg-gray-400'}" data-dot="${i}"></button>`
  ).join("");
  
  const dots = dotsContainer.querySelectorAll(".catstrip-dot");
  
  function updateDots() {
    const scrollPercent = track.scrollLeft / (track.scrollWidth - track.clientWidth);
    const activeIndex = Math.round(scrollPercent * (dotCount - 1));
    
    dots.forEach((dot, i) => {
      if (i === activeIndex) {
        dot.classList.add("bg-black", "w-6");
        dot.classList.remove("bg-gray-300");
      } else {
        dot.classList.remove("bg-black", "w-6");
        dot.classList.add("bg-gray-300");
      }
    });
  }
  
  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      const scrollTarget = (track.scrollWidth - track.clientWidth) * (i / (dotCount - 1));
      track.scrollTo({ left: scrollTarget, behavior: "smooth" });
    });
  });
  
  track.addEventListener("scroll", updateDots);
}

// ========== INIT ==========
export async function initHomeCategoryStrip() {
  const mount = document.getElementById("kkHomeCategoryStripMount");
  if (!mount) {
    console.warn("[categoryStrip] Mount point not found");
    return;
  }

  // Inject the section HTML directly (no insert file needed)
  mount.innerHTML = generateSectionHTML();
  
  // Get the track
  const track = document.getElementById("catStripTrack");
  if (!track) {
    console.warn("[categoryStrip] Track not found after injection");
    return;
  }

  try {
    // Fetch categories
    const cats = await fetchHomeCategoryStrip();
    
    if (!cats || cats.length === 0) {
      track.innerHTML = `<div class="text-gray-500 p-8">No categories found</div>`;
      return;
    }
    
    // Render cards
    const cards = cats.map((c, i) => renderCategoryCard(c, i));
    cards.push(renderViewAllCard(cats.length));
    
    track.innerHTML = cards.join("");
    
    // Setup interactivity
    setupScrollArrows(track);
    setupProgressDots(track, cats.length + 1);
    
    console.log("[categoryStrip] Rendered", cats.length, "categories");
    
  } catch (e) {
    console.error("[categoryStrip] Failed to load:", e);
    track.innerHTML = `<div class="text-gray-500 p-8">Failed to load categories</div>`;
  }
}
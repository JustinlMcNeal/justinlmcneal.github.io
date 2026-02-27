// /js/product/reviewSection.js
// Renders a full reviews feed + star breakdown for the current product.

import { getSupabaseClient } from "../shared/supabaseClient.js";
import { renderStarRating } from "../shared/components/starRating.js";

const supabase = getSupabaseClient();

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Render the star breakdown bar chart.
 * @param {Array<{rating: number}>} reviews
 * @returns {string} HTML
 */
function renderBreakdown(reviews) {
  const counts = [0, 0, 0, 0, 0]; // index 0 = 1-star, index 4 = 5-star
  for (const r of reviews) {
    const idx = Math.min(4, Math.max(0, Math.round(r.rating) - 1));
    counts[idx]++;
  }
  const total = reviews.length || 1;

  const rows = [5, 4, 3, 2, 1]
    .map((star) => {
      const count = counts[star - 1];
      const pct = Math.round((count / total) * 100);
      return `
        <div class="flex items-center gap-2 text-xs">
          <span class="w-6 text-right font-bold text-black/50">${star}★</span>
          <div class="flex-1 h-2 bg-black/5 rounded-full overflow-hidden">
            <div class="h-full bg-amber-400 rounded-full transition-all duration-500" style="width:${pct}%"></div>
          </div>
          <span class="w-8 text-right font-semibold text-black/40">${count}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="space-y-1.5">${rows}</div>`;
}

/**
 * Render a single review card.
 */
function renderReviewCard(review) {
  const name = esc(review.reviewer_name || "Verified Buyer");
  const date = formatDate(review.created_at);
  const title = esc(review.title || "");
  const body = esc(review.body || "");
  const stars = renderStarRating(review.rating, 1, { size: "sm", showCount: false });
  const photo = review.photo_url || "";

  return `
    <div class="border-b border-black/5 pb-6 last:border-0">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div>
          ${stars}
          ${title ? `<div class="font-bold text-sm mt-1">${title}</div>` : ""}
        </div>
        <span class="text-[10px] text-black/30 font-bold uppercase tracking-wider whitespace-nowrap">${esc(date)}</span>
      </div>
      ${body ? `<p class="text-sm text-black/60 leading-relaxed mb-2">${body}</p>` : ""}
      ${photo ? `<img src="${esc(photo)}" alt="Review photo" class="js-review-photo w-24 h-24 object-cover rounded-lg border border-black/10 mb-2 cursor-pointer hover:opacity-80 transition-opacity" data-full="${esc(photo)}" loading="lazy">` : ""}
      <div class="text-xs font-bold text-black/40 uppercase tracking-wider">${name}</div>
    </div>
  `;
}

/**
 * Render photo gallery strip (thumbnails of all review photos).
 */
function renderPhotoGallery(reviews) {
  const photos = reviews
    .filter((r) => r.photo_url)
    .map((r) => ({ url: r.photo_url, name: r.reviewer_name || "Verified Buyer" }));
  if (!photos.length) return "";

  return `
    <div class="mb-6">
      <div class="text-[10px] font-black uppercase tracking-widest text-black/40 mb-2">Customer Photos (${photos.length})</div>
      <div class="flex gap-2 overflow-x-auto pb-2
                  [&::-webkit-scrollbar]:h-[4px]
                  [&::-webkit-scrollbar-track]:bg-gray-100
                  [&::-webkit-scrollbar-thumb]:bg-black/30"
           style="scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.3) #f3f4f6;">
        ${photos.map((p) => `
          <img src="${esc(p.url)}" alt="Photo by ${esc(p.name)}"
               class="js-review-photo w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border-2 border-black/10 shrink-0 cursor-pointer hover:border-black/40 hover:scale-105 transition-all"
               data-full="${esc(p.url)}" loading="lazy" />
        `).join("")}
      </div>
    </div>
  `;
}

/**
 * Create and mount the photo lightbox overlay.
 */
function mountLightbox(container) {
  const lightbox = document.createElement("div");
  lightbox.id = "reviewPhotoLightbox";
  lightbox.className = "fixed inset-0 z-[9999] hidden items-center justify-center bg-black/80 backdrop-blur-sm";
  lightbox.innerHTML = `
    <button class="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/40 rounded-full text-white text-xl font-bold transition-colors z-10" id="lightboxClose">&times;</button>
    <img id="lightboxImg" src="" alt="Review photo" class="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl" />
  `;
  document.body.appendChild(lightbox);

  const img = lightbox.querySelector("#lightboxImg");
  const close = lightbox.querySelector("#lightboxClose");

  function openLightbox(src) {
    img.src = src;
    lightbox.classList.remove("hidden");
    lightbox.classList.add("flex");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.add("hidden");
    lightbox.classList.remove("flex");
    img.src = "";
    document.body.style.overflow = "";
  }

  close.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.classList.contains("hidden")) closeLightbox();
  });

  // Delegate clicks on review photos
  container.addEventListener("click", (e) => {
    const photo = e.target.closest(".js-review-photo");
    if (photo?.dataset.full) openLightbox(photo.dataset.full);
  });
}

/**
 * Mount the review section for a given product code.
 * @param {string} productCode - e.g. "KK-1013"
 * @param {HTMLElement} mountEl - Element to render into
 */
export async function initProductReviewSection(productCode, mountEl) {
  if (!mountEl || !productCode) return;

  try {
    const { data: reviews, error } = await supabase
      .from("reviews")
      .select("id, reviewer_name, rating, title, body, photo_url, created_at")
      .eq("product_id", productCode)
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[reviewSection] fetch error:", error.message);
      return;
    }

    if (!reviews || reviews.length === 0) {
      // Show empty state with CTA
      mountEl.innerHTML = `
        <section class="mt-12 pt-8 border-t-4 border-black/5">
          <h2 class="font-black text-2xl md:text-3xl uppercase tracking-tight mb-6">Customer Reviews</h2>
          <div class="text-center py-12 bg-black/[0.02] rounded-xl">
            <div class="text-4xl mb-3">📝</div>
            <p class="font-bold text-black/40 uppercase tracking-wider text-sm">No reviews yet</p>
            <p class="text-sm text-black/30 mt-1">Be the first to share your thoughts!</p>
          </div>
        </section>
      `;
      return;
    }

    // Calculate aggregate stats
    const total = reviews.length;
    const sum = reviews.reduce((s, r) => s + Number(r.rating || 0), 0);
    const avg = Math.round((sum / total) * 10) / 10;

    const aggregateStars = renderStarRating(avg, total, { size: "lg", showCount: true });
    const breakdown = renderBreakdown(reviews);
    const photoGallery = renderPhotoGallery(reviews);

    // Initially show first 5 reviews
    const INITIAL_SHOW = 5;
    const hasMore = reviews.length > INITIAL_SHOW;

    const reviewCards = reviews.map(renderReviewCard).join("");

    mountEl.innerHTML = `
      <section class="mt-12 pt-8 border-t-4 border-black/5" id="reviews">
        <h2 class="font-black text-2xl md:text-3xl uppercase tracking-tight mb-6">Customer Reviews</h2>

        <!-- Summary Row -->
        <div class="flex flex-col sm:flex-row gap-6 sm:gap-10 mb-8 p-6 bg-black/[0.02] rounded-xl">
          <!-- Left: Aggregate -->
          <div class="flex flex-col items-center sm:items-start gap-2 shrink-0">
            <div class="text-5xl font-black tracking-tight">${avg.toFixed(1)}</div>
            ${aggregateStars}
          </div>
          <!-- Right: Breakdown -->
          <div class="flex-1 min-w-[200px]">
            ${breakdown}
          </div>
        </div>

        <!-- Photo Gallery -->
        ${photoGallery}

        <!-- Reviews List -->
        <div id="reviewsList" class="space-y-6">
          ${reviewCards}
        </div>

        ${hasMore ? `
          <div class="mt-6 text-center" id="reviewsShowMoreWrap">
            <button
              id="reviewsShowMore"
              class="text-xs font-black uppercase tracking-widest border-2 border-black px-6 py-2.5 hover:bg-black hover:text-white transition-all"
            >
              Show all ${total} reviews
            </button>
          </div>
        ` : ""}
      </section>
    `;

    // Wire photo lightbox
    mountLightbox(mountEl);

    // Wire show more / collapse
    if (hasMore) {
      const list = mountEl.querySelector("#reviewsList");
      const btnWrap = mountEl.querySelector("#reviewsShowMoreWrap");
      const btn = mountEl.querySelector("#reviewsShowMore");

      // Initially hide overflow
      const items = list.children;
      for (let i = INITIAL_SHOW; i < items.length; i++) {
        items[i].style.display = "none";
      }

      let expanded = false;
      btn.addEventListener("click", () => {
        expanded = !expanded;
        for (let i = INITIAL_SHOW; i < items.length; i++) {
          items[i].style.display = expanded ? "" : "none";
        }
        btn.textContent = expanded ? "Show less" : `Show all ${total} reviews`;
      });
    }
  } catch (err) {
    console.warn("[reviewSection] init error:", err);
  }
}

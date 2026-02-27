// /js/home/reviewsCarousel.js
// "What Customers Say" — horizontal swipeable carousel of approved reviews

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

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function truncate(text, max = 120) {
  if (!text || text.length <= max) return text || "";
  return text.slice(0, max).trimEnd() + "…";
}

/**
 * Build a single review card HTML
 */
function buildReviewCard(review) {
  const name = esc(review.reviewer_name || "Verified Buyer");
  const product = esc(review.product_name || "");
  const title = esc(review.title || "");
  const body = esc(truncate(review.body, 140));
  const stars = renderStarRating(review.rating, 1, { size: "sm", showCount: false });
  const ago = timeAgo(review.created_at);
  const productLink = review.product_id
    ? `/pages/product.html?sku=${encodeURIComponent(review.product_id)}`
    : "";

  return `
    <div class="review-carousel-card shrink-0 snap-center w-[280px] sm:w-[320px] bg-white border-2 border-black/5 rounded-xl p-5 flex flex-col gap-3 select-none">
      <!-- Stars + Time -->
      <div class="flex items-center justify-between">
        ${stars}
        <span class="text-[10px] text-black/30 font-bold uppercase tracking-wider">${esc(ago)}</span>
      </div>

      <!-- Title -->
      ${title ? `<div class="font-bold text-sm leading-tight line-clamp-1">${title}</div>` : ""}

      <!-- Body -->
      ${body ? `<p class="text-sm text-black/60 leading-relaxed line-clamp-3">${body}</p>` : ""}

      <!-- Footer: Name + Product -->
      <div class="mt-auto pt-2 border-t border-black/5 flex items-center justify-between gap-2">
        <span class="font-bold text-xs uppercase tracking-wider text-black/70">${name}</span>
        ${product && productLink
          ? `<a href="${productLink}" class="text-[10px] font-bold text-black/40 hover:text-black/70 uppercase tracking-wider truncate max-w-[120px] transition-colors">${product}</a>`
          : product
            ? `<span class="text-[10px] font-bold text-black/40 uppercase tracking-wider truncate max-w-[120px]">${product}</span>`
            : ""
        }
      </div>
    </div>
  `;
}

/**
 * Initialize the reviews carousel on the home page
 */
export async function initReviewsCarousel() {
  const mount = document.getElementById("kkReviewsCarouselMount");
  if (!mount) return;

  try {
    // Fetch latest approved reviews (limit 15)
    const { data: reviews, error } = await supabase
      .from("reviews")
      .select("id, product_id, product_name, reviewer_name, rating, title, body, created_at")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(15);

    if (error) {
      console.warn("[reviewsCarousel] fetch error:", error.message);
      return;
    }

    if (!reviews || reviews.length === 0) return;

    // Build section HTML
    mount.innerHTML = `
      <section class="mt-[40px] mb-[20px] max-w-6xl mx-auto px-4" id="reviewsCarouselSection">
        <!-- Header (matches 99¢ Deals style) -->
        <div class="flex items-center justify-between gap-3 mb-[16px] border-b-[4px] border-black/10 pb-2">
          <div>
            <h2 class="inline-block bg-amber-400 text-black px-3 py-1 uppercase font-[1000] text-2xl sm:text-3xl tracking-tight transform -skew-x-6">
              <span class="block transform skew-x-6">⭐ Reviews</span>
            </h2>
            <p class="mt-2 text-[13px] font-bold uppercase tracking-wider opacity-60">
              What our customers are saying
            </p>
          </div>

          <!-- All Reviews Button -->
          <a href="/pages/reviews.html" class="hidden sm:inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest border-2 border-black px-4 py-2 hover:bg-black hover:text-white transition-all group">
            All Reviews
            <svg class="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
          </a>
        </div>

        <!-- Carousel Track (visible scrollbar like 99¢ section) -->
        <div
          id="reviewsCarouselTrack"
          class="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth py-[6px] px-[2px] pb-[20px]
                 [&::-webkit-scrollbar]:h-[6px]
                 [&::-webkit-scrollbar-track]:bg-gray-100
                 [&::-webkit-scrollbar-thumb]:bg-black
                 [&::-webkit-scrollbar-thumb]:hover:bg-amber-400"
          style="scrollbar-width: thin; scrollbar-color: #000 #f3f4f6;"
        >
          ${reviews.map(r => buildReviewCard(r)).join("")}
        </div>

        <!-- Mobile "See All" link -->
        <div class="sm:hidden mt-4 text-center">
          <a href="/pages/reviews.html" class="text-xs font-black uppercase tracking-widest text-black/50 hover:text-black transition-colors">
            See all reviews &rarr;
          </a>
        </div>
      </section>
    `;
  } catch (err) {
    console.warn("[reviewsCarousel] init error:", err);
  }
}

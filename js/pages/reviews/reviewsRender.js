import {
  $,
  hide,
  REVIEWS_SELECTORS,
  setHtml,
  setText,
  show,
} from "./reviewsDom.js";
import {
  PAGE_SIZE,
  reviewsState,
  setDisplayCount,
} from "./reviewsState.js";
import { escHtml, formatDate, starsHtml } from "./reviewsUtils.js";

export function renderLoadError() {
  setHtml($("reviewsFeed"), `<div class="text-center text-sm text-gray-400 py-8">Could not load reviews.</div>`);
}

export function renderAggregate() {
  const { allReviews } = reviewsState;
  if (!allReviews.length) return;

  const total = allReviews.length;
  const sum = allReviews.reduce((s, r) => s + (r.rating || 0), 0);
  const avg = Math.round((sum / total) * 10) / 10;

  setText($("avgRating"), avg.toFixed(1));
  setText($("totalCount"), total);
  setHtml($("avgStars"), starsHtml(Math.round(avg)));
  show($("aggregateStats"));
}

export function renderPhotoGallery() {
  const photos = reviewsState.allReviews.filter((r) => r.photo_url);
  if (!photos.length) return;

  setHtml($("photoStrip"), photos.map((r) => `
    <img src="${escHtml(r.photo_url)}" alt="Photo by ${escHtml(r.reviewer_name || 'Customer')}"
         class="js-lightbox-photo w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border-2 border-black/10 shrink-0 cursor-pointer hover:border-black/40 hover:scale-105 transition-all"
         data-full="${escHtml(r.photo_url)}" loading="lazy" />
  `).join(""));

  show($("photoGallery"));
}

export function renderMoreReviews() {
  const feed = $("reviewsFeed");
  if (!feed) return;

  const end = Math.min(reviewsState.displayCount + PAGE_SIZE, reviewsState.filtered.length);

  if (reviewsState.displayCount === 0) {
    feed.innerHTML = "";
  }

  if (!reviewsState.filtered.length) {
    feed.innerHTML = `
      <div class="text-center py-12">
        <div class="text-3xl mb-2">💬</div>
        <div class="text-sm text-gray-500">No reviews found.</div>
      </div>`;
    hide($("loadMoreWrap"));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let i = reviewsState.displayCount; i < end; i++) {
    fragment.appendChild(buildReviewCard(reviewsState.filtered[i]));
  }
  feed.appendChild(fragment);
  setDisplayCount(end);

  if (reviewsState.displayCount >= reviewsState.filtered.length) {
    hide($("loadMoreWrap"));
  } else {
    show($("loadMoreWrap"));
  }
}

export function updateActiveFilterButton(activeButton) {
  document.querySelectorAll(REVIEWS_SELECTORS.filterButton).forEach((btn) => {
    btn.classList.remove("bg-black", "text-white");
    btn.classList.add("bg-white", "text-black");
  });

  activeButton.classList.remove("bg-white", "text-black");
  activeButton.classList.add("bg-black", "text-white");
}

export function openLightbox(src) {
  const lightbox = $("reviewPhotoLightbox");
  const img = $("lightboxImg");
  if (!lightbox || !img) return;

  img.src = src;
  lightbox.classList.remove("hidden");
  lightbox.classList.add("flex");
  document.body.style.overflow = "hidden";
}

export function closeLightbox() {
  const lightbox = $("reviewPhotoLightbox");
  const img = $("lightboxImg");
  if (!lightbox || !img) return;

  lightbox.classList.add("hidden");
  lightbox.classList.remove("flex");
  img.src = "";
  document.body.style.overflow = "";
}

function buildReviewCard(r) {
  const div = document.createElement("div");
  div.className = "bg-white border-2 border-gray-200 p-5 hover:border-black transition-colors slide-up";

  div.innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-3">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="font-bold text-sm">${escHtml(r.reviewer_name || "Customer")}</span>
          <span class="text-[10px] text-green-600 font-bold uppercase bg-green-50 px-1.5 py-0.5 rounded">✓ Verified Purchase</span>
        </div>
        <div class="flex gap-0.5">${starsHtml(r.rating)}</div>
      </div>
      <div class="text-[10px] text-gray-400 whitespace-nowrap">${formatDate(r.created_at)}</div>
    </div>
    ${r.title ? `<div class="font-bold text-sm mb-1">${escHtml(r.title)}</div>` : ""}
    ${r.body ? `<div class="text-sm text-gray-700 leading-relaxed mb-2">${escHtml(r.body)}</div>` : ""}
    ${r.photo_url ? `<img src="${escHtml(r.photo_url)}" alt="Review photo" class="js-lightbox-photo mt-2 w-24 h-24 object-cover border-2 border-gray-200 rounded cursor-pointer hover:opacity-80 transition-opacity" data-full="${escHtml(r.photo_url)}" loading="lazy" />` : ""}
    ${r.product_name ? `<div class="text-[10px] text-gray-400 mt-3 uppercase tracking-wider">Product: ${escHtml(r.product_name)}</div>` : ""}
  `;

  return div;
}

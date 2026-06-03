import { initFooter } from "/js/shared/footer.js";
import { initNavbar } from "/js/shared/navbar.js";
import { fetchApprovedReviews } from "./reviewsApi.js";
import { initReviewsCouponFeatures } from "./reviewsCoupon.js";
import { $, REVIEWS_SELECTORS } from "./reviewsDom.js";
import { readReviewsQueryParams } from "./reviewsOrder.js";
import {
  closeLightbox,
  openLightbox,
  renderAggregate,
  renderLoadError,
  renderMoreReviews,
  renderPhotoGallery,
  updateActiveFilterButton,
} from "./reviewsRender.js";
import {
  markPageInitialized,
  resetDisplayCount,
  reviewsState,
  setActiveFilter,
  setActiveSort,
  setFilteredReviews,
  setReviews,
  setSearchQuery,
} from "./reviewsState.js";
import { debounce } from "./reviewsUtils.js";
import {
  normalizeRatingFilter,
  normalizeSearchQuery,
  normalizeSort,
} from "./reviewsValidation.js";

async function initReviewsPage() {
  if (!markPageInitialized()) return;

  await initNavbar();
  initFooter();
  readReviewsQueryParams();
  initReviewsCouponFeatures();
  initLightbox();
  initFilters();
  initSort();
  initSearch();

  $("btnLoadMore")?.addEventListener("click", renderMoreReviews);

  await loadReviews();
}

async function loadReviews() {
  try {
    const reviews = await fetchApprovedReviews();
    setReviews(reviews);
    applyFilters();
    renderAggregate();
    renderPhotoGallery();
  } catch (err) {
    console.error("[browse] load error:", err);
    renderLoadError();
  }
}

function applyFilters() {
  let result = [...reviewsState.allReviews];

  if (reviewsState.activeFilter) {
    result = result.filter((r) => r.rating === reviewsState.activeFilter);
  }

  if (reviewsState.searchQuery) {
    const q = reviewsState.searchQuery.toLowerCase();
    result = result.filter((r) =>
      (r.product_name || "").toLowerCase().includes(q) ||
      (r.title || "").toLowerCase().includes(q) ||
      (r.body || "").toLowerCase().includes(q)
    );
  }

  if (reviewsState.activeSort === "highest") {
    result.sort((a, b) => b.rating - a.rating || new Date(b.created_at) - new Date(a.created_at));
  } else if (reviewsState.activeSort === "lowest") {
    result.sort((a, b) => a.rating - b.rating || new Date(b.created_at) - new Date(a.created_at));
  } else {
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  setFilteredReviews(result);
  resetDisplayCount();
  renderMoreReviews();
}

function initLightbox() {
  const lightbox = $("reviewPhotoLightbox");
  const closeBtn = $("lightboxClose");

  closeBtn?.addEventListener("click", closeLightbox);
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox?.classList.contains("hidden")) closeLightbox();
  });

  document.addEventListener("click", (e) => {
    const photo = e.target.closest(REVIEWS_SELECTORS.lightboxPhoto);
    if (photo?.dataset.full) openLightbox(photo.dataset.full);
  });
}

function initFilters() {
  document.querySelectorAll(REVIEWS_SELECTORS.filterButton).forEach((btn) => {
    btn.addEventListener("click", () => {
      updateActiveFilterButton(btn);
      setActiveFilter(normalizeRatingFilter(btn.dataset.filter));
      applyFilters();
    });
  });
}

function initSort() {
  $("reviewSort")?.addEventListener("change", (e) => {
    setActiveSort(normalizeSort(e.target.value));
    applyFilters();
  });
}

function initSearch() {
  $("reviewSearch")?.addEventListener("input", debounce((e) => {
    setSearchQuery(normalizeSearchQuery(e.target.value));
    applyFilters();
  }, 300));
}

document.addEventListener("DOMContentLoaded", initReviewsPage, { once: true });

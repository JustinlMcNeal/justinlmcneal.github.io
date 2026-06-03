// DOM IDs and selectors used by pages/reviews.html.

export const REVIEWS_DOM_IDS = Object.freeze({
  aggregateStats: "aggregateStats",
  avgRating: "avgRating",
  avgStars: "avgStars",
  totalCount: "totalCount",
  photoGallery: "photoGallery",
  photoStrip: "photoStrip",
  reviewSort: "reviewSort",
  reviewSearch: "reviewSearch",
  reviewsFeed: "reviewsFeed",
  loadMoreWrap: "loadMoreWrap",
  btnLoadMore: "btnLoadMore",
  reviewPhotoLightbox: "reviewPhotoLightbox",
  lightboxImg: "lightboxImg",
  lightboxClose: "lightboxClose",
});

export const REVIEWS_SELECTORS = Object.freeze({
  filterButton: ".review-filter-btn",
  lightboxPhoto: ".js-lightbox-photo",
});

export function $(id) {
  return document.getElementById(id);
}

export function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

export function show(el) {
  el?.classList.remove("hidden");
}

export function hide(el) {
  el?.classList.add("hidden");
}

export function setText(el, value) {
  if (el) el.textContent = value;
}

export function setHtml(el, value) {
  if (el) el.innerHTML = value;
}

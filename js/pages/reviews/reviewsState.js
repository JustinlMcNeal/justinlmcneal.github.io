export const PAGE_SIZE = 20;

export const reviewsState = {
  initialized: false,
  allReviews: [],
  filtered: [],
  displayCount: 0,
  activeFilter: null,
  activeSort: "newest",
  searchQuery: "",
};

export function markPageInitialized() {
  if (reviewsState.initialized) return false;
  reviewsState.initialized = true;
  return true;
}

export function setReviews(reviews) {
  reviewsState.allReviews = Array.isArray(reviews) ? reviews : [];
}

export function setFilteredReviews(reviews) {
  reviewsState.filtered = Array.isArray(reviews) ? reviews : [];
}

export function resetDisplayCount() {
  reviewsState.displayCount = 0;
}

export function setDisplayCount(count) {
  reviewsState.displayCount = count;
}

export function setActiveFilter(filter) {
  reviewsState.activeFilter = filter;
}

export function setActiveSort(sort) {
  reviewsState.activeSort = sort || "newest";
}

export function setSearchQuery(query) {
  reviewsState.searchQuery = query || "";
}

// reviews.html is a browse-only page. Order/session/CTA review submission flows live on leave-review.html.

export function readReviewsQueryParams(search = window.location.search) {
  return new URLSearchParams(search);
}

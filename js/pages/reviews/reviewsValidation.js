export function normalizeRatingFilter(value) {
  if (value === "all") return null;
  const rating = parseInt(value, 10);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

export function normalizeSearchQuery(value) {
  return String(value || "").trim();
}

export function normalizeSort(value) {
  return ["newest", "highest", "lowest"].includes(value) ? value : "newest";
}

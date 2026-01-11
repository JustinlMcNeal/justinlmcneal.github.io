// search.js
export function matchesQuery(product, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    product.name,
    product.slug,
    product.category,
    ...(product.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

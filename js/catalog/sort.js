// sort.js
export function sortProducts(products, sortKey) {
  const sort = sortKey || "newest";
  const arr = [...(products || [])];

  switch (sort) {
    case "price_asc":
      return arr.sort((a, b) => a.price - b.price);
    case "price_desc":
      return arr.sort((a, b) => b.price - a.price);
    case "name_asc":
      return arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    case "name_desc":
      return arr.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
    case "newest":
    default:
      // Already ordered by created_at desc from DB, keep stable
      return arr;
  }
}

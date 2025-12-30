// filters.js
export function filterProducts(products, { category, query }, { matchesQuery }) {
  const cat = (category || "").trim().toLowerCase();

  return (products || []).filter((p) => {
    const categoryOk = cat ? (p.category || "").toLowerCase() === cat : true;
    const queryOk = matchesQuery(p, query);
    return categoryOk && queryOk;
  });
}

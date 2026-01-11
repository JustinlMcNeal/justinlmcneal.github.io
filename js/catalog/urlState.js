// urlState.js
export function readUrlState() {
  const url = new URL(window.location.href);
  const category = (url.searchParams.get("category") || "").trim();
  const q = (url.searchParams.get("q") || "").trim();
  const sort = (url.searchParams.get("sort") || "").trim();

  return {
    category,
    query: q,
    sort: sort || "newest",
  };
}

export function writeUrlState({ category, query, sort }, { replace = true } = {}) {
  const url = new URL(window.location.href);

  // category
  if (category) url.searchParams.set("category", category);
  else url.searchParams.delete("category");

  // query
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");

  // sort
  if (sort && sort !== "newest") url.searchParams.set("sort", sort);
  else url.searchParams.delete("sort");

  const nextUrl = url.toString();

  if (replace) window.history.replaceState({}, "", nextUrl);
  else window.history.pushState({}, "", nextUrl);
}

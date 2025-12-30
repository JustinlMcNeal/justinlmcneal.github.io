// state.js
export function createCatalogState() {
  const state = {
    isLoading: false,
    error: null,

    // Raw data
    products: [],

    // UI state
    query: "",
    category: "", // ex: "headwear"
    sort: "newest", // newest | price_asc | price_desc | name_asc | name_desc
  };

  const listeners = new Set();

  function getState() {
    return structuredClone(state);
  }

  function setState(patch) {
    Object.assign(state, patch);
    listeners.forEach((fn) => fn(getState()));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { getState, setState, subscribe };
}

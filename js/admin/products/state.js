export const state = {
  categories: [],
  products: [],
  editing: null, // { product, variants, gallery, tags }
  
  // Sorting state
  sortColumn: null,   // 'name', 'code', 'category', 'price', 'status'
  sortDirection: 'asc', // 'asc' or 'desc'
};

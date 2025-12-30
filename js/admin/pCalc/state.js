export function createState() {
  const state = {
    products: [],
    selectedCode: "",
    view: "both",

    unit_cost: 0,
    supplier_ship_per_unit: 0, // kept for display; not used in sheet math
    weight_g: 0,
    stcc: 0,

    start: 5,
    end: 150,
    step: 5,
  };

  return {
    get: () => state,

    setProducts(products) {
      state.products = Array.isArray(products) ? products : [];
      if (!state.selectedCode && state.products.length) {
        state.selectedCode = state.products[0].code;
      }
    },

    setSelectedCode(code) { state.selectedCode = String(code || ""); },
    setView(v) { state.view = String(v || "both"); },

    setInputs({ unit_cost, supplier_ship_per_unit, weight_g, stcc }) {
      if (unit_cost != null) state.unit_cost = Number(unit_cost) || 0;
      if (supplier_ship_per_unit != null) state.supplier_ship_per_unit = Number(supplier_ship_per_unit) || 0;
      if (weight_g != null) state.weight_g = Number(weight_g) || 0;
      if (stcc != null) state.stcc = Number(stcc) || 0;
    },

    setRange({ start, end, step }) {
      state.start = Math.max(1, Number(start) || 1);
      state.end = Math.max(1, Number(end) || 1);
      state.step = Math.max(1, Number(step) || 1);
    },

    findSelected() {
      return state.products.find(p => p.code === state.selectedCode) || null;
    }
  };
}

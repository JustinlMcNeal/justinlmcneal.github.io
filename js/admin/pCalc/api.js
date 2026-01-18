import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { PRODUCT_SELECT } from "/js/shared/productContract.js";
import { getSupplierShippingDetails } from "/js/admin/pStorage/profitCalc.js";

export async function fetchProductsWithCosts() {
  const sb = getSupabaseClient();

  // Use the shared contract for products columns (includes weight_g and unit_cost)
  const { data, error } = await sb
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((p) => {
    // unit_cost is stored directly on products table (set via products.html)
    const unit_cost = num(p.unit_cost);
    const weight_g = num(p.weight_g);
    
    // Calculate supplier_ship_per_unit from weight using the formula
    // Uses default qty of 30 for bulk shipping calculation
    const shipDetails = getSupplierShippingDetails(weight_g, 30);
    const supplier_ship_per_unit = shipDetails.perUnitUSD || 0;

    return {
      id: p.id,
      code: p.code || "",
      slug: p.slug || "",
      name: p.name || "",
      price: num(p.price),

      // effective fields for calculator
      unit_cost,
      supplier_ship_per_unit,
      weight_g,
      stcc: 0, // Will be auto-calculated from weight in UI
    };
  });
}

function num(x) {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { PRODUCT_SELECT } from "/js/shared/productContract.js";

export async function fetchProductsWithCosts() {
  const sb = getSupabaseClient();

  // Use the shared contract for products columns (includes weight_g)
  const { data, error } = await sb
    .from("products")
    .select(`
      ${PRODUCT_SELECT},
      product_costs (
        product_id,
        unit_cost,
        supplier_ship_per_unit,
        weight_oz_override,
        stcc_override,
        notes,
        updated_at
      )
    `)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((p) => {
    // product_costs can come back as [] or object depending on relationships
    const pcRaw = p.product_costs;
    const pc = Array.isArray(pcRaw) ? pcRaw[0] : pcRaw;

    const unit_cost = num(pc?.unit_cost);
    const supplier_ship_per_unit = num(pc?.supplier_ship_per_unit);

    // ✅ grams: products.weight_g
    // legacy override field name (weight_oz_override) is treated as GRAMS override
    const weight_g = num(pc?.weight_oz_override ?? p.weight_g);

    // ✅ STCC override (per unit)
    const stcc = num(pc?.stcc_override);

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
      stcc,

      notes: pc?.notes || "",
      cost_updated_at: pc?.updated_at || null,
    };
  });
}

function num(x) {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}

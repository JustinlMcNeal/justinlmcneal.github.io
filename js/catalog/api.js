import { getSupabaseClient } from "../shared/supabaseClient.js";
import { PRODUCT_SELECT } from "../shared/productContract.js";

export async function fetchActiveProducts() {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchCategories() {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("categories")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

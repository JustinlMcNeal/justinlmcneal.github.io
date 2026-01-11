import { getSupabaseClient } from "../shared/supabaseClient.js";
import { PRODUCT_SELECT } from "../shared/productContract.js";

export async function fetchActiveProducts() {
  const sb = getSupabaseClient();

  // combine base select with tags join
  const selectQuery = `${PRODUCT_SELECT}, product_tags(tag_id)`;

  const { data, error } = await sb
    .from("products")
    .select(selectQuery)
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

export async function fetchBestSellerTagIds() {
  const sb = getSupabaseClient();
  // We match flexible naming just in case
  const { data, error } = await sb
    .from("tags")
    .select("id")
    .or("name.eq.bestseller,name.eq.best seller,name.eq.Best Seller");

  if (error) {
     console.warn("Error fetching bestseller tags", error);
     return []; 
  }
  return (data || []).map(row => row.id);
}

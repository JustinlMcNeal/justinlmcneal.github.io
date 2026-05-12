// /js/product/api.js
import { getSupabaseClient } from "../shared/supabaseClient.js";
import { PRODUCT_SELECT } from "../shared/productContract.js";

export async function fetchProductBySlug(slug) {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function fetchProductByCode(code) {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("code", code)
    .eq("is_active", true)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function fetchCategoryName(categoryId) {
  if (!categoryId) return "";
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("categories")
    .select("id, name")
    .eq("id", categoryId)
    .single();

  if (error) return "";
  return data?.name || "";
}

export async function fetchVariants(productId) {
  const sb = getSupabaseClient();

  // Phase 1 (sizes foundation): includes new columns added by
  // 20260718_product_variants_phase1_schema.sql. Existing consumers
  // receive these fields transparently — rendering code still reads
  // option_value / option_name as before. New fields (title, option_values,
  // sku, is_default) are used by variantUtils.js helpers and future phases.
  //
  // Safety fallback: if the extended query fails (e.g. migration not yet
  // applied on this environment), falls back to the legacy column set so the
  // product page remains functional. The new fields will simply be absent
  // until the migration runs.
  const { data, error } = await sb
    .from("product_variants")
    .select(
      "id, product_id, option_name, option_value, sku, title, option_values, " +
      "stock, preview_image_url, sort_order, is_active, is_default"
    )
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  if (!error) return data || [];

  // Fallback: query only the legacy columns that are guaranteed to exist.
  // This keeps the product page functional if new columns are not yet migrated.
  const { data: fallback } = await sb
    .from("product_variants")
    .select("id, product_id, option_name, option_value, stock, preview_image_url, sort_order, is_active")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  return fallback || [];
}

export async function fetchGallery(productId) {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("product_gallery_images")
    .select("id, product_id, url, position")
    .eq("product_id", productId)
    .order("position", { ascending: true });

  if (error) return [];
  return data || [];
}

export async function fetchTags(productId) {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("product_tags")
    .select("tag_id, tags:tag_id ( id, name )")
    .eq("product_id", productId);

  if (error) return [];

  return (data || [])
    .map((row) => row.tags)
    .filter(Boolean)
    .map((t) => ({ id: t.id, name: t.name }));
}

export async function fetchSectionItems(productId) {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("product_section_items")
    .select("section, content, position")
    .eq("product_id", productId)
    .order("section", { ascending: true })
    .order("position", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Pairs well with: other products in same category
 */
export async function fetchProductsByCategory(
  categoryId,
  { limit = 12, excludeId = null } = {}
) {
  if (!categoryId) return [];

  const sb = getSupabaseClient();

  let q = sb
    .from("products")
    .select("id, slug, name, price, primary_image_url, catalog_image_url, category_id")
    .eq("category_id", categoryId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (excludeId) q = q.neq("id", excludeId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

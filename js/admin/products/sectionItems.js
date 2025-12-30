// sectionItems.js
// Handles product_section_items table (description / sizing / care)

import { getSupabaseClient } from "../../shared/supabaseClient.js";

const sb = () => {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");
  return client;
};

async function must(ok, error, context = "Request failed") {
  if (error) {
    const msg = error?.message || String(error);
    throw new Error(`${context}: ${msg}`);
  }
  return ok;
}

/**
 * Fetch all section items for a product.
 */
export async function fetchSectionItemsForProduct(productId) {
  if (!productId) return [];

  const { data, error } = await sb()
    .from("product_section_items")
    .select("id, section, content, position")
    .eq("product_id", productId)
    .order("section", { ascending: true })
    .order("position", { ascending: true });

  await must(true, error, "Fetch product section items failed");
  return data || [];
}

/**
 * Replace section items for a product
 * (delete + insert avoids unique(position) collisions)
 */
export async function upsertSectionItemsForProduct(productId, items) {
  if (!productId) throw new Error("Missing productId");

  const safeItems = Array.isArray(items) ? items : [];

  // 1) Clear existing
  const { error: delErr } = await sb()
    .from("product_section_items")
    .delete()
    .eq("product_id", productId);

  await must(true, delErr, "Clear product section items failed");

  // 2) Insert new
  if (!safeItems.length) return;

  const rows = safeItems.map((it) => ({
    product_id: productId,
    section: it.section,   // description | sizing | care
    content: it.content,
    position: Number(it.position || 0),
  }));

  const { error: insErr } = await sb()
    .from("product_section_items")
    .insert(rows);

  await must(true, insErr, "Save product section items failed");
}

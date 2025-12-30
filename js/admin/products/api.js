import { getSupabaseClient } from "../../shared/supabaseClient.js";
import { PRODUCT_SELECT } from "../../shared/productContract.js";

const sb = () => {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized. Check /js/shared/supabaseClient.js and /js/config/env.js");
  return client;
};

async function must(ok, error, context = "Request failed") {
  if (error) {
    const msg = error?.message || String(error);
    throw new Error(`${context}: ${msg}`);
  }
  return ok;
}

export async function signIn(email, password) {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  return must(data, error, "Login failed");
}

export async function signOut() {
  const { error } = await sb().auth.signOut();
  return must(true, error, "Logout failed");
}

export async function getSession() {
  const { data, error } = await sb().auth.getSession();
  await must(true, error, "Session check failed");
  return data.session;
}

export async function fetchCategories() {
  const { data, error } = await sb().from("categories").select("id,name").order("name");
  await must(true, error, "Fetch categories failed");
  return data || [];
}

export async function fetchProducts() {
  const { data, error } = await sb()
    .from("products")
    .select(PRODUCT_SELECT)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchProductFull(productId) {
  const { data: product, error: pErr } = await sb()
.from("products")
.select(PRODUCT_SELECT)
.eq("id", productId)
.single();

  await must(true, pErr, "Fetch product failed");

  const { data: variants, error: vErr } = await sb()
    .from("product_variants")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("option_value", { ascending: true });

  await must(true, vErr, "Fetch variants failed");

  const { data: gallery, error: gErr } = await sb()
    .from("product_gallery_images")
    .select("*")
    .eq("product_id", productId)
    .order("position", { ascending: true });

  await must(true, gErr, "Fetch gallery failed");

  const { data: pt, error: ptErr } = await sb().from("product_tags").select("tag_id").eq("product_id", productId);
  await must(true, ptErr, "Fetch product tags failed");

  const tagIds = (pt || []).map((x) => x.tag_id);
  let tags = [];

  if (tagIds.length) {
    const { data: t, error: tErr } = await sb().from("tags").select("id,name").in("id", tagIds);
    await must(true, tErr, "Fetch tags failed");
    tags = t || [];
  }

  return { product, variants: variants || [], gallery: gallery || [], tags };
}

export async function upsertProduct(payload) {
  const { data, error } = await sb().from("products").upsert(payload, { onConflict: "id" }).select("*").single();
  await must(true, error, "Save product failed");
  return data;
}

export async function setProductActive(productId, isActive) {
  const { error } = await sb().from("products").update({ is_active: isActive }).eq("id", productId);
  await must(true, error, "Update active flag failed");
}

export async function replaceVariants(productId, variants) {
  const { error: delErr } = await sb().from("product_variants").delete().eq("product_id", productId);
  await must(true, delErr, "Clear variants failed");

  if (!variants.length) return;

  const rows = variants.map((v, idx) => ({
    product_id: productId,
    option_name: "Color",
    option_value: v.option_value,
    stock: Number(v.stock || 0),
    preview_image_url: v.preview_image_url || null,
    sort_order: Number(v.sort_order ?? idx),
    is_active: true,
  }));

  const { error } = await sb().from("product_variants").insert(rows);
  await must(true, error, "Save variants failed");
}

export async function replaceGallery(productId, gallery) {
  const { error: delErr } = await sb().from("product_gallery_images").delete().eq("product_id", productId);
  await must(true, delErr, "Clear gallery failed");

  if (!gallery.length) return;

  const rows = gallery.map((g, idx) => ({
    product_id: productId,
    url: g.url,
    position: Number(g.position ?? idx + 1),
    is_active: true,
  }));

  const { error } = await sb().from("product_gallery_images").insert(rows);
  await must(true, error, "Save gallery failed");
}

export async function ensureTags(tagNames) {
  const names = (tagNames || []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!names.length) return [];

  const out = [];
  for (const name of names) {
    const { data, error } = await sb().from("tags").upsert({ name }, { onConflict: "name" }).select("id,name").single();
    await must(true, error, `Save tag "${name}" failed`);
    out.push(data);
  }
  return out;
}

export async function replaceProductTags(productId, tagNames) {
  const { error: delErr } = await sb().from("product_tags").delete().eq("product_id", productId);
  await must(true, delErr, "Clear product tags failed");

  const tags = await ensureTags(tagNames);
  if (!tags.length) return;

  const rows = tags.map((t) => ({ product_id: productId, tag_id: t.id }));
  const { error } = await sb().from("product_tags").insert(rows);
  await must(true, error, "Save product tags failed");
}
export async function hardDeleteProduct(productId) {
  const client = sb();

  // delete children first (avoids FK constraint issues)
  await must(true, (await client.from("product_variants").delete().eq("product_id", productId)).error, "Delete variants failed");
  await must(true, (await client.from("product_gallery_images").delete().eq("product_id", productId)).error, "Delete gallery failed");
  await must(true, (await client.from("product_tags").delete().eq("product_id", productId)).error, "Delete product tags failed");

  // delete product last
  await must(true, (await client.from("products").delete().eq("id", productId)).error, "Delete product failed");
}

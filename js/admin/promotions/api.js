import { getSupabaseClient } from "../../shared/supabaseClient.js";

const supabase = getSupabaseClient();

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session;
}

export async function fetchPromotions() {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function fetchPromotionFull(promotionId) {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("id", promotionId)
    .single();

  if (error) throw error;
  return data;
}

export async function upsertPromotion(payload) {
  const cleanPayload = { ...payload };

  // Normalize promo code: empty → null
  if ("code" in cleanPayload) {
    const c = String(cleanPayload.code ?? "").trim();
    cleanPayload.code = c ? c.toUpperCase() : null;
  }

  if (cleanPayload.id === undefined) {
    delete cleanPayload.id;
  }

  const { data, error } = await supabase
    .from("promotions")
    .upsert([cleanPayload])
    .select()
    .single();

  if (error) throw error;
  return data;
}


export async function deletePromotion(promotionId) {
  const { error } = await supabase
    .from("promotions")
    .delete()
    .eq("id", promotionId);

  if (error) throw error;
}

export async function togglePromotionActive(promotionId, isActive) {
  const { data, error } = await supabase
    .from("promotions")
    .update({ is_active: isActive })
    .eq("id", promotionId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function fetchTags() {
  const { data, error } = await supabase
    .from("tags")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function fetchProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, code")
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

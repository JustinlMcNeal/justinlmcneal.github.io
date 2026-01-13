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

/**
 * Upload a banner file (image, video, or gif) to Supabase Storage
 * @param {File} file - The file to upload
 * @returns {Promise<{url: string, size: number}>} - The public URL and file size
 */
export async function uploadBannerFile(file) {
  if (!file) throw new Error("No file provided");
  
  // Generate unique filename
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const filename = `promo_${timestamp}_${randomStr}.${ext}`;
  const filePath = `promotion/${filename}`;
  
  // Upload to Supabase Storage (banners bucket)
  const { data, error } = await supabase.storage
    .from("banners")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });
  
  if (error) throw error;
  
  // Get public URL
  const { data: urlData } = supabase.storage
    .from("banners")
    .getPublicUrl(filePath);
  
  return {
    url: urlData?.publicUrl || "",
    size: file.size,
    path: filePath,
  };
}

/**
 * Format file size to human readable string
 * @param {number} bytes - File size in bytes
 * @returns {string} - Formatted size string
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

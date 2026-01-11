// /js/admin/social/api.js
// API functions for social media management

import { getSupabaseClient } from "../../shared/supabaseClient.js";

const sb = () => {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");
  return client;
};

// ============================================
// Products (for linking)
// ============================================

export async function fetchProducts() {
  const { data, error } = await sb()
    .from("products")
    .select("id, name, slug, category_id, catalog_image_url")
    .eq("is_active", true)
    .order("name");
  
  if (error) throw error;
  return data || [];
}

// ============================================
// Categories (for hashtag lookup)
// ============================================

export async function fetchCategories() {
  const { data, error } = await sb()
    .from("categories")
    .select("id, name")
    .order("name");
  
  if (error) throw error;
  return data || [];
}

// ============================================
// Social Assets
// ============================================

export async function fetchAssets() {
  const { data, error } = await sb()
    .from("social_assets")
    .select(`
      *,
      product:products(id, name, slug, category_id)
    `)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  
  if (error) throw error;
  return data || [];
}

export async function createAsset(asset) {
  const { data, error } = await sb()
    .from("social_assets")
    .insert(asset)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function deleteAsset(assetId) {
  const { error } = await sb()
    .from("social_assets")
    .update({ is_active: false })
    .eq("id", assetId);
  
  if (error) throw error;
}

// ============================================
// Social Variations
// ============================================

export async function fetchVariationsForAsset(assetId) {
  const { data, error } = await sb()
    .from("social_variations")
    .select("*")
    .eq("asset_id", assetId)
    .order("created_at");
  
  if (error) throw error;
  return data || [];
}

export async function createVariation(variation) {
  const { data, error } = await sb()
    .from("social_variations")
    .insert(variation)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function createVariations(variations) {
  const { data, error } = await sb()
    .from("social_variations")
    .insert(variations)
    .select();
  
  if (error) throw error;
  return data || [];
}

// ============================================
// Social Posts
// ============================================

export async function fetchPosts(filters = {}) {
  let query = sb()
    .from("social_posts")
    .select(`
      *,
      variation:social_variations(
        *,
        asset:social_assets(*, product:products(id, name, slug, category_id))
      )
    `)
    .order("scheduled_for", { ascending: true });
  
  if (filters.platform) {
    query = query.eq("platform", filters.platform);
  }
  
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  
  if (filters.startDate) {
    query = query.gte("scheduled_for", filters.startDate);
  }
  
  if (filters.endDate) {
    query = query.lte("scheduled_for", filters.endDate);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return data || [];
}

export async function fetchQueuedPosts() {
  return fetchPosts({ status: "queued" });
}

export async function createPost(post) {
  const { data, error } = await sb()
    .from("social_posts")
    .insert(post)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function createPosts(posts) {
  const { data, error } = await sb()
    .from("social_posts")
    .insert(posts)
    .select();
  
  if (error) throw error;
  return data || [];
}

export async function updatePost(postId, updates) {
  const { data, error } = await sb()
    .from("social_posts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", postId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function deletePost(postId) {
  const { error } = await sb()
    .from("social_posts")
    .delete()
    .eq("id", postId);
  
  if (error) throw error;
}

// Clear or recalculate a product's last_social_post_at when posts are deleted
export async function recalculateProductPostDate(productId) {
  if (!productId) return;
  
  // Find the most recent post for this product (if any remain)
  const { data: remainingPosts } = await sb()
    .from("social_posts")
    .select(`
      scheduled_for,
      variation:social_variations(
        asset:social_assets(product_id)
      )
    `)
    .not("status", "eq", "failed")
    .order("scheduled_for", { ascending: false })
    .limit(50);
  
  // Filter to posts for this product
  const productPosts = (remainingPosts || []).filter(p => 
    p.variation?.asset?.product_id === productId
  );
  
  // Update product with most recent post date, or null if no posts
  const lastPostDate = productPosts.length > 0 
    ? productPosts[0].scheduled_for 
    : null;
  
  const { error } = await sb()
    .from("products")
    .update({ last_social_post_at: lastPostDate })
    .eq("id", productId);
  
  if (error) console.error("Failed to update product post date:", error);
}

// ============================================
// Caption Templates
// ============================================

export async function fetchTemplates(tone = null) {
  let query = sb()
    .from("social_caption_templates")
    .select("*")
    .eq("is_active", true)
    .order("created_at");
  
  if (tone) {
    query = query.eq("tone", tone);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return data || [];
}

export async function createTemplate(template) {
  const { data, error } = await sb()
    .from("social_caption_templates")
    .insert(template)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function updateTemplate(templateId, updates) {
  const { data, error } = await sb()
    .from("social_caption_templates")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", templateId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function deleteTemplate(templateId) {
  const { error } = await sb()
    .from("social_caption_templates")
    .update({ is_active: false })
    .eq("id", templateId);
  
  if (error) throw error;
}

// ============================================
// Category Hashtags
// ============================================

export async function fetchHashtags() {
  const { data, error } = await sb()
    .from("social_category_hashtags")
    .select("*");
  
  if (error) throw error;
  return data || [];
}

export async function getHashtagsForCategory(categoryId, categoryName) {
  const defaultHashtags = ["#karrykraze", "#fashion", "#style", "#shopnow"];
  
  try {
    // First try to get by category_id
    if (categoryId) {
      const { data, error } = await sb()
        .from("social_category_hashtags")
        .select("hashtags")
        .eq("category_id", categoryId)
        .single();
      
      // Ignore 406 errors (table might not exist)
      if (!error && data?.hashtags) return data.hashtags;
    }
    
    // Then try by category name (case-insensitive)
    if (categoryName) {
      const { data, error } = await sb()
        .from("social_category_hashtags")
        .select("hashtags")
        .ilike("category_name", categoryName)
        .single();
      
      if (!error && data?.hashtags) return data.hashtags;
    }
    
    // Fall back to global hashtags
    const { data: globalData, error: globalError } = await sb()
      .from("social_category_hashtags")
      .select("hashtags")
      .eq("category_name", "_global")
      .single();
    
    if (!globalError && globalData?.hashtags) return globalData.hashtags;
  } catch (e) {
    console.log("[Hashtags] Table may not exist, using defaults:", e.message);
  }
  
  return defaultHashtags;
}

// ============================================
// Pinterest Boards
// ============================================

export async function fetchBoards() {
  const { data, error } = await sb()
    .from("pinterest_boards")
    .select(`
      *,
      category:categories(id, name)
    `)
    .order("name");
  
  if (error) throw error;
  return data || [];
}

export async function createBoard(board) {
  const { data, error } = await sb()
    .from("pinterest_boards")
    .insert(board)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function updateBoard(boardId, updates) {
  const { data, error } = await sb()
    .from("pinterest_boards")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", boardId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function deleteBoard(boardId) {
  const { error } = await sb()
    .from("pinterest_boards")
    .delete()
    .eq("id", boardId);
  
  if (error) throw error;
}

export async function getBoardForCategory(categoryId) {
  // Try to find a board mapped to this category
  if (categoryId) {
    const { data } = await sb()
      .from("pinterest_boards")
      .select("*")
      .eq("category_id", categoryId)
      .single();
    
    if (data) return data;
  }
  
  // Fall back to default board
  const { data: defaultBoard } = await sb()
    .from("pinterest_boards")
    .select("*")
    .eq("is_default", true)
    .single();
  
  return defaultBoard || null;
}

// ============================================
// Settings
// ============================================

export async function fetchSettings() {
  const { data, error } = await sb()
    .from("social_settings")
    .select("*");
  
  if (error) throw error;
  
  // Convert to object keyed by setting_key
  const settings = {};
  (data || []).forEach(row => {
    settings[row.setting_key] = row.setting_value;
  });
  
  return settings;
}

export async function updateSetting(key, value) {
  const { data, error } = await sb()
    .from("social_settings")
    .upsert({
      setting_key: key,
      setting_value: value,
      updated_at: new Date().toISOString()
    }, { onConflict: "setting_key" })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// ============================================
// Storage
// ============================================

export async function uploadImage(file, path) {
  const { data, error } = await sb()
    .storage
    .from("social-media")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false
    });
  
  if (error) throw error;
  return data.path;
}

export function getPublicUrl(path) {
  if (!path) {
    console.warn("getPublicUrl called with empty path");
    return "/imgs/placeholder.jpg";
  }
  
  // If path is already a full URL, return it directly
  if (path.startsWith("http://") || path.startsWith("https://")) {
    console.log("[getPublicUrl] path is already full URL:", path);
    return path;
  }
  
  const { data } = sb()
    .storage
    .from("social-media")
    .getPublicUrl(path);
  
  console.log("[getPublicUrl] path:", path, "-> url:", data?.publicUrl);
  return data?.publicUrl || "/imgs/placeholder.jpg";
}

// ============================================
// Stats
// ============================================

export async function fetchStats() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  
  // Queued posts
  const { count: queued } = await sb()
    .from("social_posts")
    .select("*", { count: "exact", head: true })
    .in("status", ["queued", "approved"]);
  
  // Posted today
  const { count: postedToday } = await sb()
    .from("social_posts")
    .select("*", { count: "exact", head: true })
    .eq("status", "posted")
    .gte("posted_at", startOfDay)
    .lt("posted_at", endOfDay);
  
  // Total Instagram posts
  const { count: instagram } = await sb()
    .from("social_posts")
    .select("*", { count: "exact", head: true })
    .eq("platform", "instagram")
    .eq("status", "posted");
  
  // Total Pinterest posts
  const { count: pinterest } = await sb()
    .from("social_posts")
    .select("*", { count: "exact", head: true })
    .eq("platform", "pinterest")
    .eq("status", "posted");
  
  return {
    queued: queued || 0,
    postedToday: postedToday || 0,
    instagram: instagram || 0,
    pinterest: pinterest || 0
  };
}

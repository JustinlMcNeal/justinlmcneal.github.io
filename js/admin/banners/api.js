import { getSupabaseClient } from '/js/shared/supabaseClient.js';

const supabase = getSupabaseClient();

export async function fetchBanners() {
  const { data, error } = await supabase
    .from('banners')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// --- Promotion Integration ---

export async function fetchPromotablePromotions() {
  const now = new Date().toISOString();
  
  // Fetch promotions that are ACTIVE
  // Removed image filter so we can see incomplete ones too
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('is_active', true)
    // .not("banner_image_path", "is", null) // <-- Removed to debug/show all
    .or(`start_date.is.null,start_date.lte.${now}`)
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function togglePromotionVisibility(id, isPublic) {
  const { data, error } = await supabase
    .from('promotions')
    .update({ is_public: isPublic })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}


export async function createBanner(banner) {
  // Get max sort order
  const { data: max } = await supabase
    .from('banners')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const nextOrder = (max?.sort_order || 0) + 1;

  const { data, error } = await supabase
    .from('banners')
    .insert([{ ...banner, sort_order: nextOrder }])
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

export async function updateBanner(id, updates) {
  const { data, error } = await supabase
    .from('banners')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function reorderBanners(orderedIds) {
  // We have to update each row. 
  // Efficient way: Upsert with new sort_orders.
  const updates = orderedIds.map((id, index) => ({
      id,
      sort_order: index + 1,
      // We need to provide enough info to satisfy constraints if any, but upsert on ID works partly?
      // Actually supbase-js upsert works best if we provide all required fields or Partial update where generic upsert might fail on missing non-nulls.
      // Safer: Loop update or RPC. 
      // Since manual loop is slow, let's try parallel promises. It's a small list (banners).
  }));

  // Batch update is tricky without a dedicated RPC or complete objects.
  // Using Promise.all for now as list is small (< 20 banners)
  const promises = updates.map(u => 
     supabase.from('banners').update({ sort_order: u.sort_order }).eq('id', u.id)
  );
  
  await Promise.all(promises);
}

export async function deleteBanner(id) {
  const { error } = await supabase
    .from('banners')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function uploadBannerImage(file) {
  const ext = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
  const filePath = `uploads/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('banners')
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from('banners')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

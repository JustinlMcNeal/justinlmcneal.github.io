import { getSupabaseClient } from "/js/shared/supabaseClient.js";

export async function fetchApprovedReviews() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("reviews")
    .select("id, product_id, product_name, reviewer_name, rating, title, body, photo_url, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return data || [];
}

// js/admin/reviews/api.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── Review Settings (key-value JSONB: "coupon" + "moderation") ── */
export async function fetchSettings() {
  const { data, error } = await supabase
    .from("review_settings")
    .select("key, value");

  if (error) throw error;

  // Merge into a flat object for UI convenience
  const coupon = data?.find((r) => r.key === "coupon")?.value || {};
  const moderation = data?.find((r) => r.key === "moderation")?.value || {};

  return {
    coupon_enabled: coupon.enabled ?? true,
    default_discount_value: coupon.value ?? 5,
    default_discount_type: coupon.type ?? "percentage",
    coupon_prefix: coupon.prefix ?? "THANKS",
    coupon_expiry_days: coupon.expiry_days ?? 30,
    single_use: coupon.single_use ?? true,
    min_order_amount: coupon.min_order_amount ?? 0,
    auto_approve: moderation.auto_approve ?? false,
  };
}

export async function updateSettings(payload) {
  // Split back into the two key-value rows
  const couponValue = {
    enabled: payload.coupon_enabled,
    type: payload.default_discount_type,
    value: payload.default_discount_value,
    prefix: payload.coupon_prefix,
    expiry_days: payload.coupon_expiry_days,
    single_use: payload.single_use,
    min_order_amount: payload.min_order_amount ?? 0,
  };

  const moderationValue = {
    auto_approve: payload.auto_approve,
    notify_admin: true,
  };

  const { error: e1 } = await supabase
    .from("review_settings")
    .update({ value: couponValue, updated_at: new Date().toISOString() })
    .eq("key", "coupon");
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from("review_settings")
    .update({ value: moderationValue, updated_at: new Date().toISOString() })
    .eq("key", "moderation");
  if (e2) throw e2;
}

/* ── Reviews ── */
export async function fetchReviews(statusFilter = null) {
  let query = supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function updateReview(id, payload) {
  const { error } = await supabase
    .from("reviews")
    .update(payload)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteReview(id) {
  const { error } = await supabase
    .from("reviews")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function insertReview(payload) {
  const { data, error } = await supabase
    .from("reviews")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* ── Coupons ── */
export async function fetchCoupons() {
  const { data, error } = await supabase
    .from("review_coupons")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

// /js/admin/customers/api.js
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

function normalizeSort(sortBy) {
  switch (sortBy) {
    case "total_spent": return { col: "total_spent_cents", asc: false };
    case "order_count": return { col: "order_count", asc: false };
    case "name": return { col: "last_name", asc: true };
    case "last_order":
    default: return { col: "last_order_at", asc: false };
  }
}

export async function getCustomersList({ q = "", sortBy = "last_order", limit = 25, offset = 0 } = {}) {
  const supabase = getSupabaseClient();
  const sort = normalizeSort(sortBy);

  let query = supabase
    .from("v_customers_summary")
    .select("*", { count: "exact" });

  if (q) {
    const like = `%${q}%`;
    query = query.or([
      `email.ilike.${like}`,
      `first_name.ilike.${like}`,
      `last_name.ilike.${like}`,
      `phone.ilike.${like}`,
      `city.ilike.${like}`,
      `state.ilike.${like}`,
      `zip.ilike.${like}`,
      `street_address.ilike.${like}`
    ].join(","));
  }

  query = query
    .order(sort.col, { ascending: sort.asc, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return { rows: data || [], total: count ?? null };
}

export async function upsertCustomerProfile(payload) {
  const supabase = getSupabaseClient();
  const row = {
    email: payload.email?.trim() || null,
    stripe_customer_id: payload.stripe_customer_id || null,
    first_name: payload.first_name || null,
    last_name: payload.last_name || null,
    phone: payload.phone || null,
    street_address: payload.street_address || null,
    city: payload.city || null,
    state: payload.state || null,
    zip: payload.zip || null,
    country: payload.country || null,
    notes: payload.notes || null
  };

  if (!row.email) throw new Error("Email is required.");

  const { error } = await supabase
    .from("customers")
    .upsert(row, { onConflict: "email" });

  if (error) throw error;
}

export async function getCustomerOrderHistory(email) {
  const supabase = getSupabaseClient();
  const key = (email || "").trim().toLowerCase();
  if (!key) return [];

  const tryView = async (viewName) => {
    const { data, error } = await supabase
      .from(viewName)
      .select("stripe_checkout_session_id,kk_order_id,order_date,total_items,total_paid_cents,label_status,tracking_number,carrier,service")
      .eq("customer_key", key)
      .order("order_date", { ascending: false })
      .limit(200);

    if (error) throw error;
    return data || [];
  };

  try {
    return await tryView("v_order_summary_with_ship");
  } catch {
    const { data, error } = await supabase
      .from("v_order_summary")
      .select("stripe_checkout_session_id,kk_order_id,order_date,total_items,total_paid_cents")
      .eq("customer_key", key)
      .order("order_date", { ascending: false })
      .limit(200);

    if (error) throw error;
    return (data || []).map((r) => ({
      ...r,
      label_status: null,
      tracking_number: null,
      carrier: null,
      service: null,
    }));
  }
}

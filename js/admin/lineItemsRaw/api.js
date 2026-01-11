// /js/admin/lineItemsRaw/api.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

// Server-side search + pagination (offset-based)
export async function fetchOrderLinesPaged({ query = "", offset = 0, limit = 100 } = {}) {
  const q = String(query ?? "").trim();

  // Avoid breaking PostgREST `or=` syntax with commas/percent
  const qSafe = q.replace(/[,%]/g, " ").trim();

  let req = supabase
    .from("v_order_lines")
    .select("*")
    .order("order_date", { ascending: false })
    .order("line_item_row_id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (qSafe) {
    // OR search across key columns
    req = req.or(
      [
        `kk_order_id.ilike.%${qSafe}%`,
        `email.ilike.%${qSafe}%`,
        `product_id.ilike.%${qSafe}%`,
        `product_name.ilike.%${qSafe}%`,
        `variant.ilike.%${qSafe}%`,
        `stripe_line_item_id.ilike.%${qSafe}%`,
        `stripe_checkout_session_id.ilike.%${qSafe}%`,
      ].join(",")
    );
  }

  const { data, error } = await req;
  if (error) throw error;

  return data || [];
}

// Edit only the raw line item row by id
export async function updateLineItemRaw(line_item_row_id, patch) {
  const { data, error } = await supabase
    .from("line_items_raw")
    .update(patch)
    .eq("id", line_item_row_id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteLineItemRaw(line_item_row_id) {
  const { error } = await supabase.from("line_items_raw").delete().eq("id", line_item_row_id);
  if (error) throw error;
  return true;
}

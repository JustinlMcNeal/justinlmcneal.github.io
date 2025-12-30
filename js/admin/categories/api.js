import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function fetchCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("home_sort_order", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function upsertCategory(cat) {
  const { error } = await supabase
    .from("categories")
    .upsert(cat);

  if (error) throw error;
}

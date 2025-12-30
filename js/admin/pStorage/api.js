const TABLE = "product_storage";

export const STORAGE_SELECT = `
  id,
  product_id,
  name,
  url,
  stage,
  target_price,
  unit_cost,
  supplier_ship_per_unit,
  stcc,
  weight_g,
  bulk_qty,
  tags,
  notes,
  created_at,
  updated_at
`.replace(/\s+/g, " ").trim();

export function makeApi(supabase) {
  return {
    async list() {
      const { data, error } = await supabase
        .from(TABLE)
        .select(STORAGE_SELECT)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },

    async upsert(payload) {
      const { data, error } = await supabase
        .from(TABLE)
        .upsert(payload, { onConflict: "id" })
        .select(STORAGE_SELECT)
        .single();

      if (error) throw error;
      return data;
    },

    async archive(id) {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ stage: "archived" })
        .eq("id", id)
        .select(STORAGE_SELECT)
        .single();

      if (error) throw error;
      return data;
    },

    async remove(id) {
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      return true;
    }
  };
}

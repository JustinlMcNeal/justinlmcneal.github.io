/** Product + variant lookup for parcel item mapping (Phase 7). */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { requireAuthenticatedSession } from "./parcelImportsApi.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PRODUCT_SELECT =
  "id, name, code, unit_cost, weight_g, supplier_url, category_id";

const VARIANT_SELECT =
  "id, product_id, title, sku, option_name, option_value, stock, unit_cost_override_cents, sort_order, is_active";

/**
 * @param {string} query
 */
export async function searchProducts(query) {
  await requireAuthenticatedSession();

  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) return [];

  const safe = trimmed.replace(/[%_,]/g, " ").trim();
  if (!safe) return [];

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .or(`name.ilike.%${safe}%,code.ilike.%${safe}%`)
    .order("name")
    .limit(20);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * @param {string} productId
 */
export async function loadProductVariants(productId) {
  await requireAuthenticatedSession();

  const id = String(productId || "").trim();
  if (!id) return [];

  const { data, error } = await supabase
    .from("product_variants")
    .select(VARIANT_SELECT)
    .eq("product_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("option_value", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * @param {string} productId
 */
export async function getProductWithVariants(productId) {
  await requireAuthenticatedSession();

  const id = String(productId || "").trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from("products")
    .select(`${PRODUCT_SELECT}, product_variants(${VARIANT_SELECT})`)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const variants = Array.isArray(data.product_variants)
    ? [...data.product_variants]
        .filter((v) => v?.is_active !== false)
        .sort((a, b) => {
          const ao = Number(a.sort_order ?? 0);
          const bo = Number(b.sort_order ?? 0);
          if (ao !== bo) return ao - bo;
          return String(a.option_value || "").localeCompare(
            String(b.option_value || ""),
          );
        })
    : [];

  return { ...data, variants };
}

/**
 * @param {object | null} variant
 */
export function formatVariantLabel(variant) {
  if (!variant) return "—";
  if (variant.title) return variant.title;
  if (variant.option_name && variant.option_value) {
    return `${variant.option_name}: ${variant.option_value}`;
  }
  if (variant.option_value) return variant.option_value;
  if (variant.sku) return variant.sku;
  return "—";
}

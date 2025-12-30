// /js/home/api.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEBUG = false;
function log(...args) { if (DEBUG) console.log("[home/api]", ...args); }

function todayISO() {
  // Supabase/Postgres compares timestamps server-side; we just use filters
  return new Date().toISOString();
}

/** Prefer view v_home_active_promo; fallback to promotions query */
export async function fetchHomePromo() {
  // 1) Try the view
  try {
    const { data, error } = await supabase
      .from("v_home_active_promo")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      log("promo via view", data);
      return data;
    }
  } catch (e) {
    log("view v_home_active_promo not available (ok)", e);
  }

  // 2) Fallback: compute a “best promo” from promotions table
  const now = todayISO();

  const { data, error } = await supabase
    .from("promotions")
    .select(
      [
        "id",
        "name",
        "description",
        "code",
        "type",
        "value",
        "scope_type",
        "scope_data",
        "min_order_amount",
        "requires_code",
        "start_date",
        "end_date",
        "created_at",
        // ✅ NEW
        "banner_image_path",
      ].join(",")
    )
    .eq("is_active", true)
    .eq("is_public", true)

    // ✅ Only automatic promos (no coupon codes)
    .eq("requires_code", false)
    .is("code", null)

    .or(`start_date.is.null,start_date.lte.${now}`)
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order("end_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const row = (data && data[0]) || null;
  if (!row) return null;

  // Build a view-like shape so renderers can stay consistent
  const badge = promoBadge(row);
  return {
    ...row,

    // ✅ expose for banner renderer
    banner_image_path: row.banner_image_path || null,

    banner_title: row.name,
    banner_subtitle: row.description?.trim() || promoSubtitleFallback(row),
    banner_badge: badge
  };
}

function promoSubtitleFallback(p) {
  switch (p.type) {
    case "percentage": return "Limited-time percentage discount on eligible items.";
    case "fixed": return "Limited-time discount on eligible items.";
    case "bogo": return "Buy one, get one deal on eligible items.";
    case "free-shipping": return "Free shipping promotion is currently live.";
    default: return "Limited-time promotion is currently live.";
  }
}

function promoBadge(p) {
  const val = Number(p.value || 0);
  if (p.type === "percentage") return `SAVE ${stripZeros(val)}%`;
  if (p.type === "fixed") return `$${stripZeros(val)} OFF`;
  if (p.type === "bogo") return "BOGO";
  if (p.type === "free-shipping") return "FREE SHIPPING";
  return "PROMO";
}

function stripZeros(n) {
  const s = Number(n).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** Prefer view v_categories_public; fallback to categories table */
export async function fetchCategories() {
  // 1) Try the view
  try {
    const { data, error } = await supabase
      .from("v_categories_public")
      .select("id,name,slug")
      .order("name", { ascending: true });

    if (!error && Array.isArray(data)) return data;
  } catch (e) {
    // ok
  }

  // 2) Fallback: table
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,slug")
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Fetch up to 10 products for a category.
 * If categoryId is null => “All”
 */
export async function fetchHomeProducts({ categoryId = null, limit = 10 }) {
  // ✅ Special case: Best Seller chip
  if (categoryId === "__bestseller__") {
    const { data, error } = await supabase
      .from("v_products_with_tags")
      .select("id,slug,name,price,catalog_image_url,catalog_hover_url,primary_image_url,category_id,is_active,tags")
      .eq("is_active", true)
      .contains("tags", ["bestseller"])
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  // ✅ Normal category filtering
  let q = supabase
    .from("products")
    .select("id,slug,name,price,catalog_image_url,catalog_hover_url,primary_image_url,category_id,is_active,shipping_status,created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (categoryId) q = q.eq("category_id", categoryId);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}


/**
 * Fetch variants for a list of product IDs (one query).
 * Returns: Map<product_id, Array<variant>>
 *
 * We prioritize "color" option_name, but we also return others.
 */
export async function fetchVariantsForProducts(productIds = []) {
  const ids = Array.from(new Set((productIds || []).filter(Boolean)));
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from("product_variants")
    .select("id,product_id,option_name,option_value,stock,preview_image_url,sort_order,is_active")
    .in("product_id", ids)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  const map = new Map();
  for (const row of (data || [])) {
    const key = row.product_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}
/** Fetch products priced at $0.99 (active only). */
export async function fetch99CentProducts({ limit = 20 } = {}) {
  // Safer than eq() for numeric fields: capture 0.99 up to (but not including) 1.00
  const { data, error } = await supabase
    .from("products")
    .select("id,slug,name,price,catalog_image_url,catalog_hover_url,primary_image_url,is_active")
    .eq("is_active", true)
    .gte("price", 0.99)
    .lt("price", 1.00)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}
// /js/home/api.js  (add or replace this function)
export async function fetchHomeCategoryStrip() {
  const { data, error } = await supabase
    .from("v_home_categories")
    .select("id,name,slug,home_image_path,product_count,home_sort_order")
    .order("home_sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;

  const BUCKET = "site"; // <-- IMPORTANT: change this to YOUR bucket name

  return (data || []).map((c) => {
    const url = resolveImageUrl(c.home_image_path, BUCKET);
    return {
      ...c,
      home_image_url: url
    };
  });
}

function resolveImageUrl(pathOrUrl, bucket) {
  const v = (pathOrUrl || "").trim();
  if (!v) return "";

  // already full URL
  if (/^https?:\/\//i.test(v)) return v;

  // already an absolute website path (/imgs/...)
  if (v.startsWith("/")) return v;

  // otherwise assume it's a Supabase Storage object path
  const { data } = supabase.storage.from(bucket).getPublicUrl(v);
  return data?.publicUrl || "";
}

// /js/home/api.js
export async function fetchHomeBestSellers({ limit = 10 } = {}) {
  // 1) Find the tag id (support both "bestseller" and "best seller")
  const { data: tagRows, error: tagErr } = await supabase
    .from("tags")
    .select("id,name")
    .in("name", ["bestseller", "best seller"]); // if your tag is lowercase

  // If your tags are not stored lowercase, use this instead:
  // .or("name.ilike.%bestseller%,name.ilike.%best seller%")

  if (tagErr) throw tagErr;

  const tagId = tagRows?.[0]?.id || null;
  if (!tagId) return []; // no such tag in tags table

  // 2) Get product_ids for that tag (limit a bit higher, then fetch products)
  const { data: ptRows, error: ptErr } = await supabase
    .from("product_tags")
    .select("product_id")
    .eq("tag_id", tagId)
    .limit(limit * 3);

  if (ptErr) throw ptErr;

  const productIds = (ptRows || []).map(r => r.product_id).filter(Boolean);
  if (!productIds.length) return [];

  // 3) Fetch the products (keep only active)
  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("id,slug,name,price,catalog_image_url,catalog_hover_url,primary_image_url,category_id,is_active,shipping_status,created_at")
    .in("id", productIds)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (prodErr) throw prodErr;

  // 4) Preserve the tag order (optional)
  const order = new Map(productIds.map((id, idx) => [id, idx]));
  return (products || []).sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
}


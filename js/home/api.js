// /js/home/api.js
import { getSupabaseClient } from "../shared/supabaseClient.js";

const supabase = getSupabaseClient();

const DEBUG = false;
function log(...args) { if (DEBUG) console.log("[home/api]", ...args); }

function todayISO() {
  // Supabase/Postgres compares timestamps server-side; we just use filters
  return new Date().toISOString();
}

export async function fetchHomePromos() {
  const now = todayISO();

  // 1. Fetch Manual Banners
  const bannerReq = supabase
    .from("banners")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  // 2. Fetch Active Promotions (that are public and have images)
  const promoReq = supabase
    .from("promotions")
    .select("*")
    .eq("is_active", true)      // Must be running
    .eq("is_public", true)      // Must be toggled ON for banner
    .not("banner_image_path", "is", null) // Must have visuals
    .or(`start_date.is.null,start_date.lte.${now}`)
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order("created_at", { ascending: false });

  const [bannerRes, promoRes] = await Promise.all([bannerReq, promoReq]);

  if (bannerRes.error) console.error("fetchHomeBanners error:", bannerRes.error);
  if (promoRes.error) console.error("fetchHomePromos error:", promoRes.error);

  const banners = (bannerRes.data || []).map(b => ({
      id: b.id,
      banner_title: b.title,
      banner_subtitle: b.subtitle,
      banner_image_path: b.image_url,
      link_url: b.link_url,
      btn_text: b.btn_text,
      label: b.label,
      end_date: null,
      type: 'manual' 
  }));

  const promotions = (promoRes.data || []).map(p => ({
      id: p.id,
      banner_title: p.name,
      banner_subtitle: p.description, // fallback handled in UI if empty
      banner_image_path: p.banner_image_path,
      link_url: null, // Let DOM builder generate promo link
      btn_text: null, // Let DOM builder generate based on discount
      label: 'Special Offer',
      end_date: p.end_date,
      type: p.type,
      value: p.value
  }));

  // Merge: Banners first, then Promotions
  return [...banners, ...promotions];
}

/** Legacy support if needed */
export async function fetchHomePromo() {
  const promos = await fetchHomePromos();
  return promos[0] || null;
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
    .select("id,slug,name,price,catalog_image_url,catalog_hover_url,primary_image_url,category_id,is_active,shipping_status,created_at, product_tags(tag_id)")
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
  // Query categories with product count via foreign key relation
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,slug,home_image_path,home_sort_order,is_active,products(count)")
    .eq("is_active", true)
    .order("home_sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[fetchHomeCategoryStrip] Error:", error);
    throw error;
  }

  console.log("[fetchHomeCategoryStrip] Got categories:", data?.length);

  const BUCKET = "looks"; // Category images stored in looks/categories/

  return (data || []).map((c) => {
    const url = resolveImageUrl(c.home_image_path, BUCKET);
    // Extract count from the products relation
    const productCount = c.products?.[0]?.count || 0;
    return {
      ...c,
      home_image_url: url,
      product_count: productCount
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
    .select("id,slug,name,price,catalog_image_url,catalog_hover_url,primary_image_url,category_id,is_active,shipping_status,created_at, product_tags(tag_id)")
    .in("id", productIds)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (prodErr) throw prodErr;

  // 4) Preserve the tag order (optional)
  const order = new Map(productIds.map((id, idx) => [id, idx]));
  return (products || []).sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
}


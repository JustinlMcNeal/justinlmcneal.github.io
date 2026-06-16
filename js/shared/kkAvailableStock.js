/**
 * KK storefront available stock helpers (Phase 7B).
 * Sellable qty = on_hand - reserved; exposed as variant.stock for customer UI.
 *
 * Backorder policy: available <= 0 is orderable (3–4 week backlog), not blocked.
 */

/** Shared storefront shipping copy (product + checkout). */
export const KK_BACKORDER_WEEKS = "3–4 weeks";
export const KK_IN_STOCK_SHIP = "1–2 business days";

/** @param {number|null|undefined} available */
export function isBackorderAvailable(available) {
  return available != null && Number(available) <= 0;
}

/** @param {boolean} isBackorder */
export function kkProductShippingLine(isBackorder) {
  return isBackorder
    ? `⏳ Backorder · ships in ${KK_BACKORDER_WEEKS}`
    : `🚀 In stock · ships in ${KK_IN_STOCK_SHIP}`;
}

export function kkCheckoutItemShipNote() {
  return `⏳ Backorder — ships in ${KK_BACKORDER_WEEKS}`;
}

/** @param {boolean} hasBackorder */
export function kkCheckoutShipTimeText(hasBackorder) {
  return hasBackorder
    ? `Ships in ${KK_BACKORDER_WEEKS} (backorder)`
    : `Ships in ${KK_IN_STOCK_SHIP}`;
}

export function kkBackorderTooltipSuffix() {
  return ` (${KK_BACKORDER_WEEKS} backorder)`;
}

function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

/** @param {boolean} hasBackorder */
export function kkEstimatedDeliveryRange(hasBackorder) {
  const now = new Date();
  const fmt = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (hasBackorder) {
    // 3–4 weeks ≈ 15–20 business days from order
    const from = addBusinessDays(now, 15);
    const to = addBusinessDays(now, 20);
    return `${fmt(from)} – ${fmt(to)}`;
  }

  // In stock: ships 1–2 business days; ~3–5 total to doorstep
  const from = addBusinessDays(now, 3);
  const to = addBusinessDays(now, 5);
  return `${fmt(from)} – ${fmt(to)}`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Array<{ id?: string }>} variants
 */
export async function enrichVariantsWithAvailableStock(supabase, variants = []) {
  if (!variants?.length) return variants;

  const ids = variants.map((v) => v.id).filter(Boolean);
  if (!ids.length) return variants;

  const { data, error } = await supabase
    .from("v_kk_variant_available_stock")
    .select(
      "variant_id, on_hand, reserved, available, available_display, is_available, low_stock",
    )
    .in("variant_id", ids);

  if (error) {
    console.warn("[kkAvailableStock] view unavailable, using on-hand:", error.message);
    return variants;
  }

  const map = new Map((data || []).map((r) => [r.variant_id, r]));
  return variants.map((v) => {
    const a = map.get(v.id);
    if (!a) return v;
    return {
      ...v,
      on_hand: a.on_hand,
      reserved: a.reserved,
      available: a.available,
      stock: a.available_display,
      is_available: a.is_available,
      low_stock: a.low_stock,
    };
  });
}

/**
 * Build availability maps for checkout validation.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string[]} productIds product UUIDs
 * @returns {Promise<{ byVariantId: Map<string, number>, byProductVariant: Map<string, number>, mtoProductIds: Set<string> }>}
 */
export async function fetchCheckoutAvailabilityMaps(supabase, productIds = []) {
  const byVariantId = new Map();
  const byProductVariant = new Map();
  const mtoProductIds = new Set();

  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) {
    return { byVariantId, byProductVariant, mtoProductIds };
  }

  const [availRes, productsRes] = await Promise.all([
    supabase
      .from("v_kk_variant_available_stock")
      .select("variant_id, product_id, option_value, available_display")
      .in("product_id", ids),
    supabase.from("products").select("id, shipping_status").in("id", ids),
  ]);

  for (const row of availRes.data || []) {
    byVariantId.set(String(row.variant_id), Number(row.available_display ?? 0));
    const key = `${row.product_id}::${normVariantKey(row.option_value)}`;
    byProductVariant.set(key, Number(row.available_display ?? 0));
  }

  for (const row of productsRes.data || []) {
    if (row.shipping_status === "mto") mtoProductIds.add(String(row.id));
  }

  return { byVariantId, byProductVariant, mtoProductIds };
}

/** @param {unknown} v */
export function normVariantKey(v) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : "";
}

/**
 * @param {Array<{ id: string, variant?: string, variant_id?: string, qty?: number, name?: string }>} cart
 * @param {{ byVariantId: Map<string, number>, byProductVariant: Map<string, number>, mtoProductIds: Set<string> }} maps
 */
export function validateCartAvailability(cart, maps) {
  const errors = [];
  for (const item of cart || []) {
    if (maps.mtoProductIds.has(String(item.id))) continue;

    const qty = Math.max(1, Number(item.qty || 1));
    let available = null;

    if (item.variant_id && maps.byVariantId.has(String(item.variant_id))) {
      available = maps.byVariantId.get(String(item.variant_id));
    } else {
      const key = `${item.id}::${normVariantKey(item.variant)}`;
      if (maps.byProductVariant.has(key)) available = maps.byProductVariant.get(key);
    }

    if (available == null) continue;

    const label = item.name || "Item";
    if (available > 0 && qty > available) {
      errors.push(`${label}: only ${available} available (cart has ${qty}).`);
    }
  }
  return errors;
}

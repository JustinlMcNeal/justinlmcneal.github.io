/** Relist candidate + product loaders (Phase 059D.2). */

export type RelistCandidateRow = {
  variant_id: string;
  product_id: string;
  relist_action: string;
  available_qty: number;
  old_ebay_listing_id: string | null;
  old_ebay_offer_id: string | null;
  ebay_sku: string | null;
  product_code: string | null;
  ebay_category_id: string | null;
  ebay_price_cents: number | null;
  ebay_item_group_key: string | null;
  product_active_variant_count: number | null;
  required_fields_missing: string[] | null;
};

export async function loadRelistCandidate(
  // deno-lint-ignore no-explicit-any
  client: any,
  productId: string,
  variantId: string,
): Promise<RelistCandidateRow | null> {
  const { data, error } = await client
    .from("v_inventory_ebay_relist_candidates")
    .select([
      "variant_id", "product_id", "relist_action", "available_qty",
      "old_ebay_listing_id", "old_ebay_offer_id", "ebay_sku", "product_code",
      "ebay_category_id", "ebay_price_cents", "ebay_item_group_key",
      "product_active_variant_count", "required_fields_missing",
    ].join(","))
    .eq("product_id", productId)
    .eq("variant_id", variantId)
    .maybeSingle();
  if (error) throw new Error("database_error");
  return data as RelistCandidateRow | null;
}

export async function loadChannelSyncAction(
  // deno-lint-ignore no-explicit-any
  client: any,
  variantId: string,
): Promise<string | null> {
  const { data } = await client
    .from("v_inventory_channel_sync_candidates")
    .select("ebay_sync_action")
    .eq("variant_id", variantId)
    .maybeSingle();
  return data?.ebay_sync_action ?? null;
}

export async function loadProductForRelist(
  // deno-lint-ignore no-explicit-any
  client: any,
  productId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("products")
    .select(
      "id, code, name, description, price, weight_g, ebay_sku, ebay_offer_id, ebay_listing_id, ebay_status, ebay_category_id, ebay_price_cents, ebay_item_group_key, catalog_image_url, catalog_hover_url, primary_image_url, product_gallery_images(url, position, is_active)",
    )
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error("database_error");
  return data as Record<string, unknown> | null;
}

export function resolveSellerSku(
  product: Record<string, unknown>,
  candidate: RelistCandidateRow,
): string | null {
  return String(product.ebay_sku || candidate.ebay_sku || product.code || candidate.product_code || "").trim() || null;
}

export function resolvePriceCents(
  product: Record<string, unknown>,
  candidate: RelistCandidateRow,
): number | null {
  const fromProduct = Number(product.ebay_price_cents ?? candidate.ebay_price_cents ?? 0);
  if (Number.isFinite(fromProduct) && fromProduct > 0) return Math.round(fromProduct);
  const fromPrice = Number(product.price ?? 0);
  if (Number.isFinite(fromPrice) && fromPrice > 0) return Math.round(fromPrice * 100);
  return null;
}

export function isVariationBlocked(candidate: RelistCandidateRow): boolean {
  return candidate.relist_action === "unsupported_variation"
    || Boolean(candidate.ebay_item_group_key && Number(candidate.product_active_variant_count || 0) > 1);
}

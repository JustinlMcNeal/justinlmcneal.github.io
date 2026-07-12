// Resolve eBay Fulfillment line items to human KK variant labels.
// Prefer seller SKU (e.g. KK-0023-BLUE) over legacyVariationId (numeric eBay ID).

export type EbayVariantResolveInput = {
  sellerSku?: string | null;
  legacyVariationId?: string | null;
  productCode?: string | null;
};

export type ProductVariantHint = {
  id: string;
  product_code: string;
  sku: string | null;
  option_value: string | null;
  option_name: string | null;
  title: string | null;
};

export type EbayVariantResolveResult = {
  /** Display field used by admin orders UI (`line_items_raw.variant`). */
  variant: string | null;
  variant_sku: string | null;
  variant_title: string | null;
  variant_id: string | null;
  selected_options: Record<string, string> | null;
};

// deno-lint-ignore no-explicit-any
type DbClient = any;

function trimOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

function normalizeSkuKey(value: string): string {
  return value.trim().toUpperCase();
}

/** Match pushModal suffix: option_value → UPPER alnum, first 6 chars. */
export function ebayOptionSuffix(optionValue: string | null | undefined): string {
  return String(optionValue ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .substring(0, 6);
}

/** Extract COLOR-like suffix from `KK-0023-BLUE` given product code `KK-0023`. */
export function ebaySkuSuffix(productCode: string, sellerSku: string): string | null {
  const code = normalizeSkuKey(productCode);
  const sku = normalizeSkuKey(sellerSku);
  const prefix = `${code}-`;
  if (!sku.startsWith(prefix)) return null;
  const suffix = sku.slice(prefix.length);
  if (!suffix || suffix === "GROUP") return null;
  return suffix;
}

function titleCaseSuffix(suffix: string): string {
  const lower = suffix.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function buildFromHint(
  hint: ProductVariantHint,
  sellerSku: string | null,
): EbayVariantResolveResult {
  const label = trimOrNull(hint.title) || trimOrNull(hint.option_value) || sellerSku;
  const optionName = trimOrNull(hint.option_name) || "Color";
  const optionValue = trimOrNull(hint.option_value);
  return {
    variant: label,
    variant_sku: sellerSku || trimOrNull(hint.sku),
    variant_title: label,
    variant_id: hint.id || null,
    selected_options: optionValue ? { [optionName]: optionValue } : null,
  };
}

/**
 * Resolve a displayable variant label from eBay line fields + local variant hints.
 * Preference: matched option_value → humanized SKU suffix → seller SKU → legacyVariationId.
 */
export function resolveEbayOrderVariant(
  input: EbayVariantResolveInput,
  variants: ProductVariantHint[] = [],
): EbayVariantResolveResult {
  const sellerSku = trimOrNull(input.sellerSku);
  const legacyId = trimOrNull(input.legacyVariationId);
  const productCode = trimOrNull(input.productCode);

  const forProduct = productCode
    ? variants.filter((v) => v.product_code === productCode)
    : variants;

  if (sellerSku) {
    const skuKey = normalizeSkuKey(sellerSku);
    const bySku = forProduct.find(
      (v) => v.sku && normalizeSkuKey(v.sku) === skuKey,
    );
    if (bySku) return buildFromHint(bySku, sellerSku);

    if (productCode) {
      const suffix = ebaySkuSuffix(productCode, sellerSku);
      if (suffix) {
        const bySuffix = forProduct.find(
          (v) => ebayOptionSuffix(v.option_value) === suffix,
        );
        if (bySuffix) return buildFromHint(bySuffix, sellerSku);

        const humanized = titleCaseSuffix(suffix);
        return {
          variant: humanized,
          variant_sku: sellerSku,
          variant_title: humanized,
          variant_id: null,
          selected_options: null,
        };
      }
    }

    return {
      variant: sellerSku,
      variant_sku: sellerSku,
      variant_title: sellerSku,
      variant_id: null,
      selected_options: null,
    };
  }

  return {
    variant: legacyId,
    variant_sku: null,
    variant_title: null,
    variant_id: null,
    selected_options: null,
  };
}

/** Resolve from a raw eBay Fulfillment lineItem. */
export function resolveEbayLineItemVariant(
  item: Record<string, unknown>,
  productCode: string | null,
  variants: ProductVariantHint[] = [],
): EbayVariantResolveResult {
  return resolveEbayOrderVariant(
    {
      sellerSku: (item.sku as string) || null,
      legacyVariationId: (item.legacyVariationId as string) || null,
      productCode,
    },
    variants,
  );
}

/** True when stored variant looks like eBay's numeric legacyVariationId. */
export function looksLikeLegacyVariationId(value: unknown): boolean {
  const s = String(value ?? "").trim();
  return /^\d{6,}$/.test(s);
}

/** Load active product_variants with parent product codes for SKU/option matching. */
export async function loadEbayVariantHints(
  supabase: DbClient,
): Promise<ProductVariantHint[]> {
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, sku, option_value, option_name, title, products!inner(code)")
    .eq("is_active", true);

  if (error) {
    console.error("[ebay-variant-resolve] Failed to load variants:", error.message);
    return [];
  }

  const hints: ProductVariantHint[] = [];
  for (const row of data || []) {
    const products = row.products as { code?: string } | { code?: string }[] | null;
    const code = Array.isArray(products)
      ? products[0]?.code
      : products?.code;
    if (!code) continue;
    hints.push({
      id: String(row.id),
      product_code: String(code),
      sku: trimOrNull(row.sku),
      option_value: trimOrNull(row.option_value),
      option_name: trimOrNull(row.option_name),
      title: trimOrNull(row.title),
    });
  }
  return hints;
}

/**
 * Patch existing eBay line_items_raw rows when sync revisits an order.
 * Fixes rows that still store legacyVariationId instead of SKU/option labels.
 */
export async function repairEbayLineItemVariants(
  supabase: DbClient,
  sessionId: string,
  order: Record<string, unknown>,
  resolveProductCode: (title: string) => string | null,
  variants: ProductVariantHint[],
): Promise<number> {
  const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
  if (!lineItems.length) return 0;

  let repaired = 0;
  for (const item of lineItems) {
    const lineItemId = String(item.lineItemId || "").trim();
    if (!lineItemId) continue;

    const stripeLineItemId = `ebay_li_${lineItemId}`;
    const { data: existing } = await supabase
      .from("line_items_raw")
      .select("stripe_line_item_id, variant, variant_sku, variant_id, product_id")
      .eq("stripe_checkout_session_id", sessionId)
      .eq("stripe_line_item_id", stripeLineItemId)
      .maybeSingle();

    if (!existing) continue;

    const ebayTitle = String(item.title || "Unknown");
    const productCode =
      resolveProductCode(ebayTitle) ||
      (typeof existing.product_id === "string" ? existing.product_id : null);

    const resolved = resolveEbayLineItemVariant(item, productCode, variants);
    if (!resolved.variant && !resolved.variant_sku) continue;

    const needsRepair =
      looksLikeLegacyVariationId(existing.variant) ||
      (!existing.variant_sku && !!resolved.variant_sku) ||
      (!existing.variant_id && !!resolved.variant_id);

    if (!needsRepair) continue;

    const patch: Record<string, unknown> = {
      variant: resolved.variant,
      variant_sku: resolved.variant_sku,
      variant_title: resolved.variant_title,
    };
    if (resolved.variant_id) patch.variant_id = resolved.variant_id;
    if (resolved.selected_options) patch.selected_options = resolved.selected_options;
    if (productCode && !existing.product_id) patch.product_id = productCode;

    const { error } = await supabase
      .from("line_items_raw")
      .update(patch)
      .eq("stripe_checkout_session_id", sessionId)
      .eq("stripe_line_item_id", stripeLineItemId);

    if (error) {
      console.error(
        `[ebay-variant-resolve] Repair failed for ${stripeLineItemId}:`,
        error.message,
      );
      continue;
    }
    repaired++;
  }

  return repaired;
}

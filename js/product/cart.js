// /js/product/cart.js
import { effectiveOptionValues } from "../shared/variantUtils.js";

export function wireQtyControls(els, { maxQty = null } = {}) {
  if (!els?.qty || !els?.qtyMinus || !els?.qtyPlus) return;

  els.qtyMinus.onclick = () => {
    const v = Math.max(1, Number(els.qty.value || 1) - 1);
    els.qty.value = v;
  };

  els.qtyPlus.onclick = () => {
    const current = Math.max(1, Number(els.qty.value || 1));
    const cap = maxQty != null && Number.isFinite(maxQty) ? Math.max(0, maxQty) : null;
    const next = cap != null ? Math.min(current + 1, cap) : current + 1;
    els.qty.value = Math.max(1, next);
  };
}

export function buildCartPayload(els, product, tags = [], selectedVariant = null) {
  const qty = Math.max(1, Number(els.qty?.value || 1));

  // Use variant image if available, otherwise fall back to product images
  const image = selectedVariant?.preview_image_url 
    || product.primary_image_url 
    || product.catalog_image_url 
    || null;

  return {
    source: "product-page",

    id: product.id,
    product_id: product.code,
    product_uuid: product.id,
    slug: product.slug,

    name: product.name,
    price: Number(product.price || 0),
    image,
    variant: selectedVariant?.option_value || "",
    variant_id: selectedVariant?.id || null,
    // Phase 4: include full identity fields for Phase 2 pipeline alignment.
    variant_sku: selectedVariant?.sku || null,
    variant_title: selectedVariant?.title || selectedVariant?.option_value || null,
    selected_options: selectedVariant ? effectiveOptionValues(selectedVariant) : null,
    qty,

    category_id: product.category_id || null,
    category_ids: product.category_id ? [product.category_id] : [],

    tags: (tags || []).map((t) => t?.name).filter(Boolean),
    tag_ids: (tags || []).map((t) => t?.id).filter(Boolean),
  };
}

export function emitAddToCart(payload) {
  window.dispatchEvent(new CustomEvent("kk:addToCart", { detail: payload }));
}

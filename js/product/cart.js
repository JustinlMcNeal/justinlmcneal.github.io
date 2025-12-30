// /js/product/cart.js

export function wireQtyControls(els) {
  if (!els?.qty || !els?.qtyMinus || !els?.qtyPlus) return;

  els.qtyMinus.onclick = () => {
    const v = Math.max(1, Number(els.qty.value || 1) - 1);
    els.qty.value = v;
  };

  els.qtyPlus.onclick = () => {
    const v = Math.max(1, Number(els.qty.value || 1) + 1);
    els.qty.value = v;
  };
}

export function buildCartPayload(els, product, tags = [], selectedVariant = null) {
  const qty = Math.max(1, Number(els.qty?.value || 1));

  return {
    source: "product-page",

    id: product.id,
    product_id: product.code,
    product_uuid: product.id,
    slug: product.slug,

    name: product.name,
    price: Number(product.price || 0),
    image: product.primary_image_url || product.catalog_image_url || null,
    variant: selectedVariant?.option_value || "",
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

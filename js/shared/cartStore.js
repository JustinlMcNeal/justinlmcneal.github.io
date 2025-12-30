/**
 * /js/shared/cartStore.js
 * Simple localStorage-backed cart store
 */

const STORAGE_KEY = "kk_cart_v1";
let cart = loadCart();

/* =========================
   LOAD / SAVE
========================= */

function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  window.dispatchEvent(new CustomEvent("kk-cart-updated", { detail: { cart } }));
}

/* =========================
   HELPERS
========================= */

function normVariant(v) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : "";
}

function lineKey(id, variant) {
  return `${String(id)}::${normVariant(variant)}`;
}

function findLineIndex(id, variant) {
  const key = lineKey(id, variant);
  return cart.findIndex((it) => lineKey(it.id, it.variant) === key);
}

/* =========================
   PUBLIC API
========================= */

export function getCart() {
  return cart;
}

export function cartSubtotal() {
  return cart.reduce(
    (sum, it) => sum + Number(it.price || 0) * Math.max(1, Number(it.qty || 1)),
    0
  );
}

export function clearCart() {
  cart = [];
  saveCart();
}

/* =========================
   MUTATIONS
========================= */

export function addToCart(payload) {
  if (!payload) return;

  // 🔑 Internal cart line identifier = UUID
  const id = payload.id;
  if (!id) return;

  // 🏷️ Human-facing product id = SKU (KK-1001)
  const sku = (payload.product_id ?? "").toString().trim() || null;

  const variant = normVariant(payload.variant);
  const qtyToAdd = Math.max(1, Number(payload.qty || 1));

  const idx = findLineIndex(id, variant);

  if (idx >= 0) {
    cart[idx].qty = Math.max(1, Number(cart[idx].qty || 1) + qtyToAdd);
  } else {
    cart.push({
      // identifiers
      id,                     // UUID (internal)
      product_id: sku,        // ✅ SKU (KK-1001)
      product_uuid: id,       // optional but useful later

      // display
      name: payload.name || "Item",
      price: Number(payload.price || 0),
      image: payload.image || "",
      variant,

      // qty
      qty: qtyToAdd,

      // optional metadata (promos, analytics)
      category_id: payload.category_id ?? null,
      category_ids: payload.category_ids ?? null,
      tag_ids: payload.tag_ids ?? null,
      tags: payload.tags ?? null,
      slug: payload.slug ?? null,
      source: payload.source ?? null,
    });
  }

  saveCart();
}

export function removeFromCart(index) {
  const i = Number(index);
  if (Number.isNaN(i) || i < 0 || i >= cart.length) return;
  cart.splice(i, 1);
  saveCart();
}

export function removeItem(id, variant = "") {
  const idx = findLineIndex(id, variant);
  if (idx >= 0) {
    cart.splice(idx, 1);
    saveCart();
  }
}

export function setQty(id, variant = "", qty = 1) {
  const idx = findLineIndex(id, variant);
  if (idx < 0) return;

  const q = Math.floor(Number(qty));
  if (!Number.isFinite(q) || q < 1) {
    cart.splice(idx, 1);
  } else {
    cart[idx].qty = q;
  }
  saveCart();
}

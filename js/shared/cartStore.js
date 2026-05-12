/**
 * /js/shared/cartStore.js
 * Simple localStorage-backed cart store
 */

import { SUPABASE_URL } from "/js/config/env.js";

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

/**
 * Find a cart line by identity.
 *
 * Phase 2: prefers variant_id (UUID) when provided and present on an existing
 * line. Falls back to the legacy product-UUID + variant-text key so old carts
 * without variant_id still resolve correctly.
 *
 * @param {string} id         - product UUID
 * @param {string} variant    - variant text (e.g. "Black")
 * @param {string|null} variantId - variant UUID (optional, preferred)
 */
function findLineIndex(id, variant, variantId = null) {
  // Prefer direct variant UUID match when both sides carry it
  if (variantId) {
    const byUuid = cart.findIndex((it) => it.variant_id && it.variant_id === variantId);
    if (byUuid >= 0) return byUuid;
  }
  // Legacy fallback: product UUID + normalized variant text
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

  // Phase 2: durable variant identity fields. Preserved when sent by
  // buildCartPayload() (product page) and any other caller that supplies them.
  // Absent in legacy add-to-cart calls → stored as null, handled gracefully.
  const variantId    = payload.variant_id    ?? null;
  const variantSku   = payload.variant_sku   ?? null;
  const variantTitle = payload.variant_title ?? null;
  // selected_options must be a plain object or null — do not store other types
  const selectedOptions =
    payload.selected_options &&
    typeof payload.selected_options === "object" &&
    !Array.isArray(payload.selected_options)
      ? payload.selected_options
      : null;

  const qtyToAdd = Math.max(1, Number(payload.qty || 1));

  const idx = findLineIndex(id, variant, variantId);

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

      // Phase 2: durable variant identity
      variant_id:      variantId,
      variant_sku:     variantSku,
      variant_title:   variantTitle,
      selected_options: selectedOptions,

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

/**
 * Remove a cart line by identity.
 * Phase 2: accepts optional variantId (UUID) for preferred exact-match lookup.
 * Falls back to legacy id::variant key when variantId is absent.
 *
 * @param {string} id
 * @param {string} [variant]
 * @param {string|null} [variantId]
 */
export function removeItem(id, variant = "", variantId = null) {
  const idx = findLineIndex(id, variant, variantId);
  if (idx >= 0) {
    cart.splice(idx, 1);
    saveCart();
  }
}

/**
 * Set quantity for a cart line.
 * Phase 2: accepts optional variantId (UUID) for preferred exact-match lookup.
 * Falls back to legacy id::variant key when variantId is absent.
 *
 * @param {string} id
 * @param {string} [variant]
 * @param {number} [qty]
 * @param {string|null} [variantId]
 */
export function setQty(id, variant = "", qty = 1, variantId = null) {
  const idx = findLineIndex(id, variant, variantId);
  if (idx < 0) return;

  const q = Math.floor(Number(qty));
  if (!Number.isFinite(q) || q < 1) {
    cart.splice(idx, 1);
  } else {
    cart[idx].qty = q;
  }
  saveCart();
}

/**
 * Trigger the UI to open the cart drawer.
 * This relies on the drawer system (shared/drawer.js) being initialized 
 * and a button with data-kk-open="cart" existing in the DOM.
 */
export function openCartDrawer() {
  const btn = document.querySelector('[data-kk-open="cart"]');
  if (btn) {
    btn.click();
  } else {
    // Fallback: Dispatch an event in case generic listeners are added
    window.dispatchEvent(new CustomEvent("kk-open-cart-request"));
  }
}

/* =========================
   CART SYNC (Abandoned Cart)
   Debounced sync to Supabase for SMS subscribers
========================= */

let _syncTimer = null;
const SYNC_DEBOUNCE_MS = 5000;
const CART_SYNC_URL = `${SUPABASE_URL}/functions/v1/cart-sync`;

function syncCartToServer() {
  const contactId = localStorage.getItem("kk_sms_contact_id");
  if (!contactId) return; // Not an SMS subscriber — skip

  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    try {
      await fetch(CART_SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, cart }),
      });
    } catch (_) {
      // Silent fail — cart sync is best-effort
    }
  }, SYNC_DEBOUNCE_MS);
}

// Listen for cart mutations and sync
window.addEventListener("kk-cart-updated", syncCartToServer);

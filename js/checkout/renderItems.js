// js/checkout/renderItems.js
// Renders cart items as checkout review cards with qty controls, remove, low stock badge

import { setQty, removeItem } from "../shared/cartStore.js";
import { getSupabaseClient } from "../shared/supabaseClient.js";
import {
  fetchCheckoutAvailabilityMaps,
  normVariantKey,
  validateCartAvailability,
  isBackorderAvailable,
  kkCheckoutItemShipNote,
} from "../shared/kkAvailableStock.js";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ── Stock & shipping status lookup ── */
let stockMap = null;
let mtoSet = null;
let availabilityMaps = null;

async function fetchStockLevels(items) {
  if (stockMap) return stockMap;
  stockMap = {};
  mtoSet = new Set();
  availabilityMaps = null;
  try {
    const supabase = getSupabaseClient();
    const ids = [...new Set(items.map((it) => it.id).filter(Boolean))];
    if (!ids.length) return stockMap;

    availabilityMaps = await fetchCheckoutAvailabilityMaps(supabase, ids);
    mtoSet = availabilityMaps.mtoProductIds;

    for (const [key, qty] of availabilityMaps.byProductVariant) {
      stockMap[key] = qty;
    }
  } catch {
    // silently skip — don't block checkout UI
  }
  return stockMap;
}

function isMto(productId) {
  return mtoSet?.has(String(productId)) ?? false;
}

function lookupAvailable(item) {
  if (!availabilityMaps) return null;
  if (item.variant_id && availabilityMaps.byVariantId.has(String(item.variant_id))) {
    return availabilityMaps.byVariantId.get(String(item.variant_id));
  }
  const key = `${item.id}::${normVariantKey(item.variant)}`;
  if (availabilityMaps.byProductVariant.has(key)) {
    return availabilityMaps.byProductVariant.get(key);
  }
  return null;
}

/* ── Render a single item card ── */
function renderItemCard(item, stock, madeToOrder) {
  const id = String(item.id || "");
  const variant = normVariantKey(item.variant);
  const variantLabel = normVariantKey(item.variant_title) || variant;
  const variantId = String(item.variant_id || "");
  const qty = Math.max(1, Number(item.qty || 1));
  const img = item.image || "/imgs/placeholder.png";
  const name = esc(item.name || "Item");
  const unit = Number(item.price || 0);
  const lineTotal = unit * qty;
  const slug = item.slug || "";

  const qtyExceeds = typeof stock === "number" && stock > 0 && qty > stock;
  const isBackorder = madeToOrder || isBackorderAvailable(stock);
  const badgeLabel = "BACKORDER";
  const shipNote = kkCheckoutItemShipNote();
  const lowStock = typeof stock === "number" && stock > 0 && stock <= 5;

  return `
<article class="bg-white rounded-xl p-4 shadow-sm border border-black/5${qtyExceeds ? " border-red-200" : ""}">
  <div class="flex gap-4">
    <!-- Image -->
    <a href="/pages/product.html?slug=${esc(slug)}" class="block w-24 h-24 sm:w-28 sm:h-28 rounded-lg overflow-hidden bg-black/5 flex-shrink-0 relative">
      <img
        class="w-full h-full object-cover hover:scale-105 transition-transform"
        src="${esc(img)}"
        alt="${name}"
        loading="lazy"
      />
      ${isBackorder ? `<span class="absolute top-1 left-1 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">${badgeLabel}</span>` : ""}
    </a>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex justify-between items-start gap-2">
        <div>
          <a href="/pages/product.html?slug=${esc(slug)}" class="font-bold text-sm leading-tight line-clamp-2 hover:underline">${name}</a>
          ${variantLabel ? `<p class="text-xs text-black/50 mt-0.5">${esc(variantLabel)}</p>` : ""}
          ${isBackorder ? `<p class="text-xs font-bold text-amber-600 mt-1">${shipNote}</p>` : ""}
          ${qtyExceeds ? `<p class="text-xs font-bold text-red-600 mt-1">Only ${stock} available — reduce quantity to continue.</p>` : ""}
          ${lowStock && !qtyExceeds ? `<p class="text-xs font-bold text-red-500 mt-1">Only ${stock} left!</p>` : ""}
        </div>

        <!-- Remove -->
        <button
          type="button"
          class="flex items-center gap-1 text-black/40 hover:text-red-500 transition-colors rounded-full hover:bg-red-50 px-2 py-1"
          data-checkout-remove
          data-id="${esc(id)}"
          data-variant="${esc(variant)}"
          data-variant-id="${esc(variantId)}"
          aria-label="Remove item"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
          <span class="text-xs font-medium hidden sm:inline">Remove</span>
        </button>
      </div>

      <div class="flex items-center justify-between mt-3">
        <!-- Qty controls -->
        <div class="inline-flex items-center bg-black/[0.08] rounded-full">
          <button
            type="button"
            class="w-12 h-12 flex items-center justify-center text-black/70 hover:text-black hover:bg-black/[0.12] rounded-full transition-colors"
            data-checkout-qty-minus
            data-id="${esc(id)}"
            data-variant="${esc(variant)}"
            data-variant-id="${esc(variantId)}"
            aria-label="Decrease quantity"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4"/>
            </svg>
          </button>
          <span class="w-10 text-center text-sm font-bold select-none">${qty}</span>
          <button
            type="button"
            class="w-12 h-12 flex items-center justify-center text-black/70 hover:text-black hover:bg-black/[0.12] rounded-full transition-colors disabled:opacity-30 disabled:pointer-events-none"
            data-checkout-qty-plus
            data-id="${esc(id)}"
            data-variant="${esc(variant)}"
            data-variant-id="${esc(variantId)}"
            data-max-qty="${typeof stock === "number" && stock > 0 ? stock : ""}"
            aria-label="Increase quantity"
            ${typeof stock === "number" && stock > 0 && qty >= stock ? "disabled" : ""}
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
          </button>
        </div>

        <!-- Price -->
        <div class="text-right">
          <span class="font-bold text-base">${money(lineTotal)}</span>
          ${qty > 1 ? `<span class="text-xs text-black/40 block">${money(unit)} each</span>` : ""}
        </div>
      </div>
    </div>
  </div>
</article>
`;
}

/* ── Empty state ── */
function renderEmpty() {
  return `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-20 h-20 rounded-full bg-black/5 flex items-center justify-center mb-5">
        <svg class="w-10 h-10 text-black/30" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
        </svg>
      </div>
      <p class="font-bold text-black/70">Your cart is empty</p>
      <p class="text-sm text-black/40 mt-1 mb-6">Looks like you haven't added anything yet</p>
      <a href="/pages/catalog.html" class="px-6 py-2.5 bg-black text-white text-sm font-bold rounded-xl hover:bg-black/85 transition-colors">
        Continue Shopping
      </a>
    </div>
  `;
}

/* ── Main render function ── */
export async function renderCheckoutItems(items, container) {
  if (!container) return {};

  if (!items || !items.length) {
    container.innerHTML = renderEmpty();
    return { stockMap: {}, mtoSet: new Set(), stockErrors: [] };
  }

  const stocks = await fetchStockLevels(items);

  container.innerHTML = items
    .map((item) => {
      const key = `${item.id}::${normVariantKey(item.variant)}`;
      const stock = stocks[key] ?? lookupAvailable(item) ?? null;
      return renderItemCard(item, stock, isMto(item.id));
    })
    .join("");

  const stockErrors = availabilityMaps ? validateCartAvailability(items, availabilityMaps) : [];

  return { stockMap: stocks, mtoSet: mtoSet || new Set(), stockErrors };
}

/* ── Wire delegated click handlers ── */
export function wireItemControls(container, onCartChange) {
  if (!container) return;

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-checkout-qty-minus], [data-checkout-qty-plus], [data-checkout-remove]");
    if (!btn) return;

    const id = btn.dataset.id;
    const variant = btn.dataset.variant || "";
    const variantId = btn.dataset.variantId || null;

    if (btn.hasAttribute("data-checkout-remove")) {
      removeItem(id, variant, variantId);
      onCartChange();
      return;
    }

    if (btn.hasAttribute("data-checkout-qty-minus")) {
      const current = parseInt(btn.closest("article")?.querySelector(".text-center")?.textContent || "1", 10);
      if (current > 1) {
        setQty(id, variant, current - 1, variantId);
      } else {
        removeItem(id, variant, variantId);
      }
      onCartChange();
      return;
    }

    if (btn.hasAttribute("data-checkout-qty-plus")) {
      const current = parseInt(btn.closest("article")?.querySelector(".text-center")?.textContent || "1", 10);
      const maxRaw = btn.dataset.maxQty;
      const maxQty = maxRaw ? parseInt(maxRaw, 10) : null;
      if (maxQty != null && Number.isFinite(maxQty) && current >= maxQty) return;
      setQty(id, variant, current + 1, variantId);
      onCartChange();
    }
  });
}

/* ── Reset stock cache on re-render ── */
export function resetStockCache() {
  stockMap = null;
  mtoSet = null;
  availabilityMaps = null;
}

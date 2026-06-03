import { qs } from "./dom.js";
import { escapeHtml } from "./renderListings.js";
import { resolveVariantSellerSku } from "./variantPanel.js";

/** @type {string | null} */
let selectedMappingVariantId = null;

/** @type {Array<Record<string, unknown>>} */
let mappingVariants = [];
const STATUS_BADGES = {
  active: { label: "Active", className: "bg-green-100 text-green-800" },
  low_stock: { label: "Low Stock", className: "bg-amber-100 text-amber-800" },
  out_of_stock: { label: "Out of Stock", className: "bg-gray-200 text-gray-700" },
  draft: { label: "Draft", className: "bg-blue-100 text-blue-800" },
  issue: { label: "Issue", className: "bg-red-100 text-red-800" },
  suppressed: { label: "Suppressed", className: "bg-red-100 text-red-800" },
  inactive: { label: "Inactive", className: "bg-gray-200 text-gray-700" },
  unknown: { label: "Unknown", className: "bg-gray-100 text-gray-700" },
};

const MARKETPLACE_LABELS = {
  ATVPDKIKX0DER: "US · Amazon.com",
};

function statusBadge(status) {
  return STATUS_BADGES[status] || STATUS_BADGES.unknown;
}

function formatPrice(row) {
  const price = row.price;
  if (price === null || price === undefined || price === "") return "—";
  const currency = String(row.currency || "USD");
  const num = Number(price);
  if (!Number.isFinite(num)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

function formatSyncedDate(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} [sizeClass]
 */
function listingThumbMarkup(row, sizeClass = "w-14 h-14") {
  const imageUrl = row.main_image_url ? String(row.main_image_url) : "";
  if (imageUrl) {
    return `<img src="${escapeHtml(imageUrl)}" alt="" class="${sizeClass} rounded-lg object-cover border border-gray-200 flex-shrink-0" loading="lazy" />`;
  }
  return `<div class="${sizeClass} rounded-lg bg-kkpeach/60 border border-gray-200 flex-shrink-0" aria-hidden="true"></div>`;
}

/**
 * @param {Record<string, unknown>} row
 */
export function buildUnmappedCard(row) {
  const id = String(row.amazon_listing_id || "");
  const status = String(row.listing_status || "unknown");
  const badge = statusBadge(status);
  const title = escapeHtml(row.amazon_title || "Untitled Amazon Listing");
  const asin = escapeHtml(row.asin || "—");
  const sku = escapeHtml(row.seller_sku || "—");
  const price = escapeHtml(formatPrice(row));
  const synced = escapeHtml(formatSyncedDate(row.last_synced_at));
  const marketplace = escapeHtml(
    MARKETPLACE_LABELS[String(row.marketplace_id || "")] || row.marketplace_id || "—",
  );

  const showFixInactive = status === "inactive" || status === "unknown";
  const imageUrl = row.main_image_url ? String(row.main_image_url) : "";
  const priceRaw = row.price === null || row.price === undefined ? "" : String(row.price);
  const inventoryRaw = row.fbm_quantity === null || row.fbm_quantity === undefined
    ? ""
    : String(row.fbm_quantity);
  const marketplaceId = String(row.marketplace_id || "");
  const buyable = row.listing_status_buyable === true ? "true" : "false";

  return `
    <article
      class="amazon-unmapped-card bg-white rounded-xl border border-gray-200 p-4 shadow-sm"
      data-amazon-listing-id="${escapeHtml(id)}"
      data-asin="${asin}"
      data-seller-sku="${sku}"
      data-title="${title}"
      data-status="${escapeHtml(status)}"
      data-marketplace="${marketplace}"
      data-marketplace-id="${escapeHtml(marketplaceId)}"
      data-price="${price}"
      data-price-raw="${escapeHtml(priceRaw)}"
      data-inventory="${escapeHtml(row.fbm_quantity ?? "—")}"
      data-inventory-raw="${escapeHtml(inventoryRaw)}"
      data-image-url="${escapeHtml(imageUrl)}"
      data-buyable="${buyable}"
      data-last-synced="${synced}"
    >
      <div class="flex flex-col lg:flex-row lg:items-center gap-4">
        ${listingThumbMarkup(row)}
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-sm">${title}</h3>
          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs">
            <div><dt class="text-gray-400">ASIN</dt><dd class="font-mono font-medium">${asin}</dd></div>
            <div><dt class="text-gray-400">Seller SKU</dt><dd class="font-mono font-medium">${sku}</dd></div>
            <div><dt class="text-gray-400">Status</dt><dd><span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${badge.className}">${escapeHtml(badge.label)}</span></dd></div>
            <div><dt class="text-gray-400">Last synced</dt><dd class="text-gray-600">${synced}</dd></div>
            <div><dt class="text-gray-400">Price</dt><dd class="font-bold">${price}</dd></div>
            <div><dt class="text-gray-400">Inventory</dt><dd class="font-bold">${escapeHtml(row.fbm_quantity ?? "—")}</dd></div>
          </dl>
        </div>
        <div class="flex flex-wrap gap-2 shrink-0 w-full lg:w-auto">
          ${showFixInactive ? `
          <button
            type="button"
            data-action="fix-inactive-listing"
            data-amazon-listing-id="${escapeHtml(id)}"
            title="Diagnose and restore price/qty"
            class="flex-1 sm:flex-none border-4 border-amber-500 bg-amber-100 text-amber-950 px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:bg-amber-200"
          >Fix Inactive</button>
          ` : ""}
          <button
            type="button"
            data-action="map-existing-listing"
            data-amazon-listing-id="${escapeHtml(id)}"
            title="Open mapping workflow"
            class="flex-1 sm:flex-none border-4 border-black bg-black text-white px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:opacity-90"
          >Map Listing</button>
          <button
            type="button"
            data-action="ignore-amazon-listing"
            data-amazon-listing-id="${escapeHtml(id)}"
            title="Ignore this listing"
            class="flex-1 sm:flex-none border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-gray-700 min-h-[44px] hover:bg-gray-50"
          >Ignore</button>
        </div>
      </div>
    </article>
  `;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ total?: number }} [meta]
 */
export function renderUnmappedListings(rows, meta = {}) {
  const container = qs("#amazonNeedsMappingList");
  const countLabel = qs("#amazonNeedsMappingCountLabel");
  if (!container) return;

  const total = Number(meta.total ?? rows.length);

  if (!rows.length && total === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p class="text-sm font-bold">No unmapped listings</p>
        <p class="text-xs text-gray-400 mt-2">Sync Amazon listings or map/import from Seller Central.</p>
      </div>
    `;
  } else {
    container.innerHTML = rows.map((row) => buildUnmappedCard(row)).join("");
  }

  if (countLabel) {
    countLabel.textContent = total === 0
      ? "0 unmapped · live"
      : `${total} unmapped · live`;
  }

  const tabCount = qs("#amazonTabNeedsMapping [data-count]");
  if (tabCount) tabCount.textContent = String(total);
}

/**
 * @param {Record<string, unknown>} product
 */
export function buildProductResultCard(product) {
  const id = String(product.id || "");
  const name = escapeHtml(product.name || "Untitled product");
  const code = escapeHtml(product.code || "—");
  const price = Number(product.price);
  const priceText = Number.isFinite(price) ? `$${price.toFixed(2)}` : "—";
  const stock = Number(product.stock);
  const stockText = Number.isFinite(stock) ? String(stock) : "—";

  return `
    <button
      type="button"
      class="amazon-mapping-product-result w-full text-left border-2 border-gray-200 rounded-xl p-3 hover:border-black hover:bg-gray-50 transition-colors"
      data-product-id="${escapeHtml(id)}"
      data-product-code="${code}"
      data-product-name="${name}"
      data-product-price="${escapeHtml(priceText)}"
      data-product-stock="${escapeHtml(stockText)}"
    >
      <span class="block text-sm font-bold">${name}</span>
      <span class="block text-xs font-mono text-gray-500 mt-0.5">SKU: ${code}</span>
      <span class="block text-xs text-gray-600 mt-1">${escapeHtml(priceText)} · Stock: ${escapeHtml(stockText)}</span>
    </button>
  `;
}

/**
 * @param {Array<Record<string, unknown>>} products
 */
export function renderProductSearchResults(products) {
  const container = qs("#amazonMappingProductResults");
  if (!container) return;

  if (!products.length) {
    container.innerHTML = `<p class="text-xs text-gray-400 py-2">No products found.</p>`;
    return;
  }

  container.innerHTML = products.map((product) => buildProductResultCard(product)).join("");
}

export function clearSelectedProduct() {
  const selected = qs("#amazonMappingSelectedProduct");
  if (selected) {
    selected.classList.add("hidden");
    selected.innerHTML = "";
    delete selected.dataset.productId;
    delete selected.dataset.productCode;
  }
  clearMappingVariantPanel();
}

export function clearMappingVariantPanel() {
  mappingVariants = [];
  selectedMappingVariantId = null;
  const section = qs("#amazonMappingVariantSection");
  const list = qs("#amazonMappingVariantList");
  if (section) section.classList.add("hidden");
  if (list) list.innerHTML = "";
}

/** @returns {string | null} */
export function readSelectedMappingVariantId() {
  const checked = document.querySelector('input[name="amazonMappingVariant"]:checked');
  if (checked instanceof HTMLInputElement && checked.value) {
    selectedMappingVariantId = checked.value;
  }
  return selectedMappingVariantId;
}

/** @returns {boolean} */
export function mappingRequiresVariantSelection() {
  return mappingVariants.length > 1;
}

/**
 * @param {Array<Record<string, unknown>>} variants
 * @param {string} productCode
 * @param {string | null} [preferredVariantId]
 */
export function renderMappingVariantPanel(variants, productCode, preferredVariantId = null) {
  mappingVariants = (variants || []).filter((v) => v?.is_active !== false);
  selectedMappingVariantId = null;

  const section = qs("#amazonMappingVariantSection");
  const list = qs("#amazonMappingVariantList");
  if (!section || !list) return;

  if (mappingVariants.length <= 1) {
    section.classList.add("hidden");
    list.innerHTML = "";
    selectedMappingVariantId = mappingVariants[0]?.id ? String(mappingVariants[0].id) : null;
    return;
  }

  section.classList.remove("hidden");
  const preferred = preferredVariantId && mappingVariants.some((v) => String(v.id) === preferredVariantId)
    ? preferredVariantId
    : String(mappingVariants[0]?.id || "");

  list.innerHTML = mappingVariants.map((variant, index) => {
    const id = String(variant.id || "");
    const label = String(variant.option_value || variant.title || `Variant ${index + 1}`);
    const sku = resolveVariantSellerSku(variant, productCode);
    const qty = Number(variant.stock ?? 0);
    const checked = id === preferred ? "checked" : "";
    const oos = qty <= 0 ? '<span class="text-[9px] text-orange-600 font-bold ml-1">OOS</span>' : "";
    return `
      <label class="flex items-start gap-2 p-2 rounded-lg border border-gray-200 bg-gray-50 cursor-pointer hover:border-black">
        <input type="radio" name="amazonMappingVariant" class="mt-1 accent-pink-500" value="${escapeHtml(id)}" ${checked} />
        <span class="min-w-0 flex-1">
          <span class="block text-xs font-bold">${escapeHtml(label)}${oos}</span>
          <span class="block text-[10px] font-mono text-gray-500">${escapeHtml(sku)} · ${qty} in stock</span>
        </span>
      </label>`;
  }).join("");

  selectedMappingVariantId = preferred || null;
}
/**
 * @param {{ id: string, code: string, name: string, price?: string, stock?: string }} product
 */
export function renderSelectedProduct(product) {
  const selected = qs("#amazonMappingSelectedProduct");
  if (!selected) return;

  selected.classList.remove("hidden");
  selected.innerHTML = `
    <div class="border-4 border-black rounded-xl p-3 bg-kkpeach/20">
      <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500 mb-1">Selected KK Product</p>
      <p class="text-sm font-bold">${escapeHtml(product.name)}</p>
      <p class="text-xs font-mono text-gray-500 mt-0.5">SKU: ${escapeHtml(product.code)}</p>
      <p class="text-xs text-gray-600 mt-1">${escapeHtml(product.price || "—")} · Stock: ${escapeHtml(product.stock || "—")}</p>
    </div>
  `;
  selected.dataset.productId = product.id;
  selected.dataset.productCode = product.code;
}

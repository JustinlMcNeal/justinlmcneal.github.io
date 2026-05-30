import { qs } from "./dom.js";
import { escapeHtml } from "./renderListings.js";

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

  return `
    <article
      class="amazon-unmapped-card bg-white rounded-xl border border-gray-200 p-4 shadow-sm"
      data-amazon-listing-id="${escapeHtml(id)}"
      data-asin="${asin}"
      data-seller-sku="${sku}"
      data-title="${title}"
      data-status="${escapeHtml(status)}"
      data-marketplace="${marketplace}"
      data-price="${price}"
      data-inventory="${escapeHtml(row.fbm_quantity ?? "—")}"
      data-last-synced="${synced}"
    >
      <div class="flex flex-col lg:flex-row lg:items-center gap-4">
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
 */
export function renderUnmappedListings(rows) {
  const container = qs("#amazonNeedsMappingList");
  const countLabel = qs("#amazonNeedsMappingCountLabel");
  if (!container) return;

  if (!rows.length) {
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
    countLabel.textContent = rows.length === 0
      ? "0 unmapped · live"
      : `${rows.length} unmapped · live`;
  }

  const tabCount = qs("#amazonTabNeedsMapping [data-count]");
  if (tabCount) tabCount.textContent = String(rows.length);
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

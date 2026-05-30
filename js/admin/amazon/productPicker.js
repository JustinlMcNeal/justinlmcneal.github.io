import { qs, show, hide } from "./dom.js";
import { fetchAmazonReadyToPushProducts, searchKkProducts } from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import { escapeHtml } from "./renderListings.js";

/** @type {number | null} */
let searchTimer = null;

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

function normalizeWarnings(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return [];
}

function pickerWarnings(product, readyRow) {
  if (readyRow) return normalizeWarnings(readyRow.eligibility_warnings);

  const warnings = [];
  const stock = Number(product?.stock);
  const price = Number(product?.price);
  if (!Number.isFinite(stock) || stock <= 0) warnings.push("Missing stock");
  if (!Number.isFinite(price) || price <= 0) warnings.push("Missing price");
  return warnings;
}

function renderHeaderProductResults(products, readyByProductId) {
  const container = qs("#amazonHeaderProductResults");
  if (!container) return;

  if (!products.length) {
    container.innerHTML = `<p class="text-xs text-gray-500 py-4 text-center">Search by product name or SKU (min 2 characters).</p>`;
    return;
  }

  container.innerHTML = products.map((product) => {
    const readyRow = readyByProductId.get(String(product.id));
    const warnings = pickerWarnings(product, readyRow);
    const warningHtml = warnings.length
      ? `<p class="text-[10px] text-amber-700 mt-1">${escapeHtml(warnings.join(" · "))}</p>`
      : "";
    const stock = Number.isFinite(Number(product.stock)) ? String(product.stock) : "—";

    return `
      <button
        type="button"
        data-action="select-header-product"
        data-kk-product-id="${escapeHtml(String(product.id || ""))}"
        data-sku="${escapeHtml(String(product.code || ""))}"
        data-eligibility-status="${escapeHtml(String(readyRow?.eligibility_status || ""))}"
        data-eligibility-warnings="${escapeHtml(warnings.join("|"))}"
        class="w-full text-left border-2 border-black rounded-xl px-3 py-3 bg-white hover:bg-kkpeach/40 min-h-[44px]"
      >
        <span class="block text-sm font-bold">${escapeHtml(product.name || product.code || "Untitled")}</span>
        <span class="block text-[11px] font-mono text-gray-500 mt-0.5">${escapeHtml(product.code || "—")}</span>
        <span class="block text-xs text-gray-600 mt-1">${escapeHtml(formatPrice(product.price))} · Stock ${escapeHtml(stock)}</span>
        ${warningHtml}
      </button>
    `;
  }).join("");
}

/**
 * @param {{
 *   openPush: (trigger: HTMLElement) => Promise<void>,
 *   beforeOpen?: () => void,
 * }} deps
 */
export function initAmazonProductPicker(deps) {
  const modal = qs("#amazonProductPickerModal");
  /** @type {Map<string, Record<string, unknown>>} */
  let readyByProductId = new Map();

  function closePicker() {
    if (!modal) return;
    hide(modal);
    modal.setAttribute("aria-hidden", "true");
    if (!document.querySelector("#amazonPushModal:not(.hidden)")) {
      document.body.style.overflow = "";
    }
  }

  async function openPicker(trigger) {
    if (!modal) return;

    deps.beforeOpen?.();

    const searchInput = qs("#amazonHeaderProductSearch");
    if (searchInput instanceof HTMLInputElement) searchInput.value = "";
    renderHeaderProductResults([], readyByProductId);

    try {
      const rows = await fetchAmazonReadyToPushProducts({ limit: 50 });
      readyByProductId = new Map(rows.map((row) => [String(row.kk_product_id), row]));
    } catch {
      readyByProductId = new Map();
    }

    show(modal);
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    searchInput?.focus();
  }

  async function runSearch(query) {
    const trimmed = String(query || "").trim();
    if (trimmed.length < 2) {
      renderHeaderProductResults([], readyByProductId);
      return;
    }

    try {
      const products = await searchKkProducts(trimmed);
      renderHeaderProductResults(products, readyByProductId);
    } catch {
      showAmazonNotification("Could not search KK products.", { tone: "error" });
    }
  }

  const searchInput = qs("#amazonHeaderProductSearch");
  searchInput?.addEventListener("input", (event) => {
    const value = event.target instanceof HTMLInputElement ? event.target.value : "";
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      runSearch(value).catch(() => {});
    }, 250);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest("[data-action]");
    if (!actionEl) return;

    switch (actionEl.dataset.action) {
      case "select-header-product":
        event.preventDefault();
        closePicker();
        deps.openPush(/** @type {HTMLElement} */ (actionEl)).catch(() => {});
        break;
      case "close-product-picker-modal":
        event.preventDefault();
        closePicker();
        break;
      default:
        break;
    }
  });

  modal?.querySelector("[data-modal-backdrop]")?.addEventListener("click", closePicker);

  return { open: openPicker, close: closePicker };
}

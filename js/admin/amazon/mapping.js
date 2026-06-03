import { qs, setHydrateText } from "./dom.js";
import {
  fetchAmazonUnmappedListings,
  fetchKkProductForPush,
  saveAmazonMapping,
  searchKkProducts,
} from "./api.js";
import { closeAmazonModals } from "./modals.js";
import { showAmazonNotification } from "./notifications.js";
import {
  clearSelectedProduct,
  renderMappingVariantPanel,
  renderProductSearchResults,
  renderSelectedProduct,
  renderUnmappedListings,
  clearMappingVariantPanel,
  readSelectedMappingVariantId,
  mappingRequiresVariantSelection,
} from "./renderMapping.js";
import { initWorkAreaPagination } from "./workAreaPagination.js";

/** @type {Array<Record<string, unknown>>} */
let lastUnmappedRows = [];

const needsMappingPagination = initWorkAreaPagination({
  summaryId: "amazonNeedsMappingPaginationSummary",
  pageLabelId: "amazonNeedsMappingPaginationPageLabel",
  prevId: "amazonNeedsMappingPrevPage",
  nextId: "amazonNeedsMappingNextPage",
  rowsSelectId: "amazonNeedsMappingRowsPerPage",
});

const STATUS_BADGES = {
  active: "bg-green-100 text-green-800",
  low_stock: "bg-amber-100 text-amber-800",
  out_of_stock: "bg-gray-200 text-gray-700",
  issue: "bg-red-100 text-red-800",
  suppressed: "bg-red-100 text-red-800",
  inactive: "bg-gray-200 text-gray-700",
  unknown: "bg-gray-100 text-gray-700",
};

/** @type {Record<string, unknown> | null} */
let activeListing = null;

/** @type {{ id: string, code: string, name: string, price?: string, stock?: string } | null} */
let selectedProduct = null;

/** @type {number | null} */
let searchTimer = null;

/** @type {boolean} */
let saving = false;

/**
 * @param {Record<string, unknown>} listing
 */
function applyListingToModal(listing) {
  const modal = qs("#amazonMappingModal");
  if (!modal || !listing?.amazon_listing_id) return;

  const status = String(listing.listing_status || "unknown");
  const statusClass = STATUS_BADGES[status] || STATUS_BADGES.unknown;

  setHydrateText(modal, "mapping-listing-title", listing.amazon_title || "Untitled");
  setHydrateText(modal, "mapping-asin", listing.asin || "—");
  setHydrateText(modal, "mapping-amazon-sku", listing.seller_sku || "—");
  setHydrateText(modal, "mapping-marketplace", listing.marketplace_id || "—");
  setHydrateText(modal, "mapping-price", listing.price ?? "—");
  setHydrateText(modal, "mapping-inventory", listing.fbm_quantity ?? "—");

  const statusEl = modal.querySelector('[data-hydrate="mapping-status"]');
  if (statusEl) {
    statusEl.textContent = status.replace(/_/g, " ");
    statusEl.className =
      `inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusClass}`;
  }
}

function resetMappingForm() {
  activeListing = null;
  selectedProduct = null;
  clearSelectedProduct();

  const searchInput = qs("#amazonMappingProductSearch");
  if (searchInput instanceof HTMLInputElement) searchInput.value = "";
  renderProductSearchResults([]);
}

/**
 * @param {string} productId
 * @param {string | null} [preferredVariantId]
 */
async function loadProductVariants(productId, preferredVariantId = null) {
  clearMappingVariantPanel();
  if (!productId) return;

  try {
    const product = await fetchKkProductForPush(productId);
    if (!product) return;
    renderMappingVariantPanel(
      product.product_variants || [],
      String(product.code || selectedProduct?.code || ""),
      preferredVariantId,
    );
  } catch {
    clearMappingVariantPanel();
  }
}

/**
 * @param {{ onMappingSaved?: () => Promise<void> | void }} [deps]
 */
export function initAmazonMapping(deps = {}) {
  function renderUnmappedPage() {
    needsMappingPagination.apply(lastUnmappedRows, (pageRows, meta) => {
      renderUnmappedListings(pageRows, { total: meta.total });
    });
  }

  async function refreshUnmapped() {
    try {
      const rows = await fetchAmazonUnmappedListings({ limit: 500 });
      lastUnmappedRows = rows;
      needsMappingPagination.resetPage();
      renderUnmappedPage();
      return rows;
    } catch {
      showAmazonNotification("Could not load unmapped Amazon listings.", { tone: "error" });
      lastUnmappedRows = [];
      renderUnmappedListings([], { total: 0 });
      return [];
    }
  }

  needsMappingPagination.bindNavigation(renderUnmappedPage);

  function readListingFromTrigger(trigger) {
    const card = trigger?.closest?.(".amazon-unmapped-card, article[data-amazon-listing-id]");
    if (!card) return null;

    return {
      amazon_listing_id: card.dataset.amazonListingId || "",
      asin: card.dataset.asin || "",
      seller_sku: card.dataset.sellerSku || "",
      amazon_title: card.dataset.title || card.querySelector("h3")?.textContent?.trim() || "",
      listing_status: card.dataset.status || "unknown",
      marketplace_id: card.dataset.marketplace || card.dataset.marketplaceId || "",
      price: card.dataset.priceRaw || card.dataset.price || "",
      fbm_quantity: card.dataset.inventoryRaw || card.dataset.inventory || "",
      last_synced_at: card.dataset.lastSynced || "",
    };
  }

  /**
   * @param {Record<string, unknown>} row
   */
  function listingFromWorkspaceRow(row) {
    return {
      amazon_listing_id: String(row.amazon_listing_id || ""),
      asin: String(row.asin || ""),
      seller_sku: String(row.seller_sku || row.kk_sku || ""),
      amazon_title: String(row.amazon_title || row.kk_product_title || ""),
      listing_status: String(row.listing_status || "unknown"),
      marketplace_id: String(row.marketplace_id || ""),
      price: row.price ?? "",
      fbm_quantity: row.fbm_quantity ?? "",
      kk_product_id: row.kk_product_id ? String(row.kk_product_id) : "",
      kk_sku: row.kk_sku ? String(row.kk_sku) : "",
      kk_product_title: row.kk_product_title ? String(row.kk_product_title) : "",
      kk_variant_id: row.kk_variant_id ? String(row.kk_variant_id) : "",
    };
  }

  function hydrateMappingModal(trigger) {
    const modal = qs("#amazonMappingModal");
    if (!modal) return;

    resetMappingForm();
    activeListing = readListingFromTrigger(trigger);

    if (!activeListing?.amazon_listing_id) {
      setHydrateText(modal, "mapping-listing-title", "Select a listing from Needs Mapping");
      setHydrateText(modal, "mapping-asin", "—");
      setHydrateText(modal, "mapping-amazon-sku", "—");
      setHydrateText(modal, "mapping-status", "—");
      setHydrateText(modal, "mapping-marketplace", "—");
      setHydrateText(modal, "mapping-price", "—");
      setHydrateText(modal, "mapping-inventory", "—");
      return;
    }

    applyListingToModal(activeListing);
  }

  /**
   * @param {Record<string, unknown>} row
   */
  async function hydrateMappingFromListingRow(row) {
    const modal = qs("#amazonMappingModal");
    if (!modal) return;

    resetMappingForm();
    activeListing = listingFromWorkspaceRow(row);
    applyListingToModal(activeListing);

    const productId = activeListing.kk_product_id;
    if (!productId) return;

    selectedProduct = {
      id: productId,
      code: activeListing.kk_sku || "",
      name: activeListing.kk_product_title || activeListing.kk_sku || "Mapped product",
    };
    renderSelectedProduct(selectedProduct);
    await loadProductVariants(productId, activeListing.kk_variant_id || null);

    const needsVariant = mappingRequiresVariantSelection();
    showAmazonNotification(
      needsVariant
        ? "Pick the KK variant this Amazon SKU represents, then save mapping."
        : "Confirm the KK product (and stock variant if shown), then save mapping.",
      { tone: "info" },
    );
  }

  async function runProductSearch(query) {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      renderProductSearchResults([]);
      return;
    }

    try {
      const products = await searchKkProducts(trimmed);
      renderProductSearchResults(products);
    } catch {
      showAmazonNotification("Could not search KK products.", { tone: "error" });
    }
  }

  async function persistMapping(mappingStatus) {
    if (saving) return;
    if (!activeListing?.amazon_listing_id) {
      showAmazonNotification("Select an Amazon listing from Needs Mapping first.", {
        tone: "warning",
      });
      return;
    }

    if (mappingStatus === "mapped" && !selectedProduct?.id) {
      showAmazonNotification("Select a KK product before saving.", { tone: "warning" });
      return;
    }

    const kkVariantId = readSelectedMappingVariantId() || undefined;
    if (mappingStatus === "mapped" && mappingRequiresVariantSelection() && !kkVariantId) {
      showAmazonNotification("Select which KK variant this Amazon listing represents.", {
        tone: "warning",
      });
      return;
    }

    saving = true;
    try {
      await saveAmazonMapping({
        amazonListingId: String(activeListing.amazon_listing_id),
        kkProductId: selectedProduct?.id || null,
        kkVariantId,
        kkSku: selectedProduct?.code || null,
        mappingStatus,
      });

      const messages = {
        mapped: kkVariantId
          ? "Amazon listing mapped to KK product variant."
          : "Amazon listing mapped to KK product.",
        ignored: "Listing marked as ignored.",
        legacy: "Listing marked as legacy.",
        needs_review: "Listing marked for review.",
      };
      showAmazonNotification(messages[mappingStatus] || "Mapping saved.", {
        tone: "success",
      });

      closeAmazonModals();
      resetMappingForm();
      await refreshUnmapped();
      await deps.onMappingSaved?.();
    } catch (err) {
      const code = err?.code || "request_failed";
      const messages = {
        listing_not_found: "Amazon listing not found.",
        product_not_found: "KK product not found.",
        invalid_request: "Invalid mapping request.",
        unauthorized: "Please sign in as an admin.",
        database_error: "Could not save mapping.",
      };
      showAmazonNotification(messages[code] || "Could not save mapping.", { tone: "error" });
    } finally {
      saving = false;
    }
  }

  document.addEventListener("amazon:view-change", (event) => {
    const view = event.detail?.view;
    if (view === "needs-mapping") refreshUnmapped().catch(() => {});
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id !== "amazonMappingProductSearch") return;

    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      runProductSearch(target.value).catch(() => {});
    }, 250);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const productBtn = target.closest(".amazon-mapping-product-result");
    if (productBtn instanceof HTMLButtonElement) {
      selectedProduct = {
        id: productBtn.dataset.productId || "",
        code: productBtn.dataset.productCode || "",
        name: productBtn.dataset.productName || "",
        price: productBtn.dataset.productPrice || "",
        stock: productBtn.dataset.productStock || "",
      };
      renderSelectedProduct(selectedProduct);
      loadProductVariants(selectedProduct.id).catch(() => {});
      return;
    }

    const ignoreBtn = target.closest('[data-action="ignore-amazon-listing"]');
    if (ignoreBtn instanceof HTMLButtonElement && !ignoreBtn.closest("#amazonMappingModal")) {
      event.preventDefault();
      activeListing = readListingFromTrigger(ignoreBtn);
      if (!activeListing?.amazon_listing_id) return;
      persistMapping("ignored").catch(() => {});
      return;
    }

    const actionEl = target.closest("[data-action]");
    if (!actionEl) return;

    switch (actionEl.dataset.action) {
      case "save-amazon-mapping":
        event.preventDefault();
        persistMapping("mapped").catch(() => {});
        break;
      case "mark-amazon-legacy":
        event.preventDefault();
        persistMapping("legacy").catch(() => {});
        break;
      case "ignore-amazon-listing":
        if (actionEl.closest("#amazonMappingModal")) {
          event.preventDefault();
          persistMapping("ignored").catch(() => {});
        }
        break;
      default:
        break;
    }
  });

  return {
    refreshUnmapped,
    hydrateMappingModal,
    hydrateMappingFromListingRow,
  };
}

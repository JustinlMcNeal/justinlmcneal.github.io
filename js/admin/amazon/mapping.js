import { qs, setHydrateText } from "./dom.js";
import {
  fetchAmazonUnmappedListings,
  saveAmazonMapping,
  searchKkProducts,
} from "./api.js";
import { closeAmazonModals } from "./modals.js";
import { showAmazonNotification } from "./notifications.js";
import {
  clearSelectedProduct,
  renderProductSearchResults,
  renderSelectedProduct,
  renderUnmappedListings,
} from "./renderMapping.js";

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
 * @param {{ onMappingSaved?: () => Promise<void> | void }} [deps]
 */
export function initAmazonMapping(deps = {}) {
  async function refreshUnmapped() {
    try {
      const rows = await fetchAmazonUnmappedListings({ limit: 50 });
      renderUnmappedListings(rows);
      return rows;
    } catch {
      showAmazonNotification("Could not load unmapped Amazon listings.", { tone: "error" });
      return [];
    }
  }

  function readListingFromTrigger(trigger) {
    const card = trigger?.closest?.(".amazon-unmapped-card, article[data-amazon-listing-id]");
    if (!card) return null;

    return {
      amazon_listing_id: card.dataset.amazonListingId || "",
      asin: card.dataset.asin || "",
      seller_sku: card.dataset.sellerSku || "",
      amazon_title: card.dataset.title || card.querySelector("h3")?.textContent?.trim() || "",
      listing_status: card.dataset.status || "unknown",
      marketplace_id: card.dataset.marketplace || "",
      price: card.dataset.price || "",
      fbm_quantity: card.dataset.inventory || "",
      last_synced_at: card.dataset.lastSynced || "",
    };
  }

  function hydrateMappingModal(trigger) {
    const modal = qs("#amazonMappingModal");
    if (!modal) return;

    activeListing = readListingFromTrigger(trigger);
    selectedProduct = null;
    clearSelectedProduct();

    const searchInput = qs("#amazonMappingProductSearch");
    if (searchInput instanceof HTMLInputElement) searchInput.value = "";
    renderProductSearchResults([]);

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

    const status = String(activeListing.listing_status || "unknown");
    const statusClass = STATUS_BADGES[status] || STATUS_BADGES.unknown;

    setHydrateText(modal, "mapping-listing-title", activeListing.amazon_title || "Untitled");
    setHydrateText(modal, "mapping-asin", activeListing.asin || "—");
    setHydrateText(modal, "mapping-amazon-sku", activeListing.seller_sku || "—");
    setHydrateText(modal, "mapping-marketplace", activeListing.marketplace_id || "—");
    setHydrateText(modal, "mapping-price", activeListing.price || "—");
    setHydrateText(modal, "mapping-inventory", activeListing.fbm_quantity || "—");

    const statusEl = modal.querySelector('[data-hydrate="mapping-status"]');
    if (statusEl) {
      statusEl.textContent = status.replace(/_/g, " ");
      statusEl.className =
        `inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusClass}`;
    }
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

    saving = true;
    try {
      await saveAmazonMapping({
        amazonListingId: String(activeListing.amazon_listing_id),
        kkProductId: selectedProduct?.id || null,
        kkSku: selectedProduct?.code || null,
        mappingStatus,
      });

      const messages = {
        mapped: "Amazon listing mapped to KK product.",
        ignored: "Listing marked as ignored.",
        legacy: "Listing marked as legacy.",
        needs_review: "Listing marked for review.",
      };
      showAmazonNotification(messages[mappingStatus] || "Mapping saved.", {
        tone: "success",
      });

      closeAmazonModals();
      activeListing = null;
      selectedProduct = null;
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
  };
}

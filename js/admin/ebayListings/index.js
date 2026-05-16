/**
 * index.js — eBay Listings admin page main module.
 *
 * Orchestrates the product list, push modal (create listing), edit modal,
 * bulk operations, setup/migrate panel, and init.
 */

import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter   } from "/js/shared/footer.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAdmin } from "/js/shared/guard.js";

import {
  esc,
  sanitizeForEbay,
  wrapDescription,
  isComplexHtml,
  buildImageUrls,
  buildPackageWeightAndSize,
  getSelectedPolicies,
  getBestOfferTerms,
  variantSkuFromOption,
  publishQuantityForProduct,
  activeVariantCount,
  isEffectiveGroupListing,
  enableBtn,
  imageOptionLabel,
  addAiBadge,
} from "./utils.js";

import { quillToolbar, descState, resetQuillEditorMount, toggleDescMode, getDescriptionHtml } from "./editor.js";

import { addVolTier, getVolTiers } from "./volPricing.js";
import { buildEstimate, renderPreview } from "./profitPreview.js";
import { computeHealth } from "./listingHealth.js";
import { openSalesHistory, closeSalesHistory } from "./salesHistory.js";
import { buildPriceRef, renderPriceRef, fetchSalesMetrics } from "./priceReference.js";
import { renderImageStrip, showGalleryPicker } from "./images.js";
import { createEditModalContext } from "./editModal.js";

import { callEdge, mergeWorkspaceMetrics } from "./api.js";
import { formatRelativeDate, wsChips, epCls, rowEstProfitHtml } from "./renderHelpers.js";
import {
  isLinkedOnEbay, isStaleLinkCheck, isOutOfStockLinkCheck, isLinkWarningCheck,
  staleActionState, staleActionBadge, staleLinkLabel, staleLinkMessage,
  currentActiveListingId, ebayCodeLinkHtml,
} from "./linkCheck.js";
import { createReconcileActions } from "./reconcileActions.js";
import { renderProductActions } from "./productActions.js";
import { createTableActions } from "./tableActions.js";
import { createProductActionDispatcher } from "./actionDispatcher.js";
import { renderTable } from "./table.js";
import { renderCards } from "./cards.js";
import { initSetupPanel } from "./setupPanel.js";
import { initImportPanel } from "./importPanel.js";
import { initBulkActions, updateBulkBar } from "./bulkActions.js";
import { buildAspectField, buildEditAspectField, collectAspects, validateRequiredAspects } from "./aspectHelpers.js";
import {
  renderVariantAssignedImages, getAssignedVariantImages, setAssignedVariantImages,
  renderVariantCandidatePicker, refreshVariantCandidateButtons, wireVariantImageSetControls,
  renderVariantPanel, getCheckedVariants, renderEditVariantImageControls,
} from "./variantPanel.js";
import {
  refreshPushPreview, refreshEditPreview, refreshPushRef, refreshEditRef, loadAndRenderPriceRef,
} from "./modalPreviews.js";
import {
  shortDelay, ebayErrorIds, isTransientGetItemFailure, getItemForEdit,
  offerUpdateErrorMessage,
} from "./editFetch.js";
import { loadPoliciesCache } from "./policyCache.js";

// ── Init Supabase ─────────────────────────────────────────────
const supabase    = getSupabaseClient();
const SUPABASE_URL = "https://yxdzvzscufkvewecvagq.supabase.co";

// ── Shared State ──────────────────────────────────────────────
let allProducts            = [];
let filteredProducts       = [];
let currentView            = window.innerWidth < 640 ? "cards" : "table";
let currentProduct         = null;
let currentAspects         = [];
let pushQuill              = null;
let editQuill              = null;
let pushImageUrls          = [];
let editImageUrls          = [];
let editVariantImageOverrides = {};
let editVariantQtyOverrides   = {};
let pushVariants           = [];
let isVariantListing       = false;
let editProduct            = null;
let editAspects            = [];
let searchTimeout;
let pushSalesMetrics = null;   // Phase 5: cached per push-modal session
let editSalesMetrics = null;   // Phase 5: cached per edit-modal session
let pageAdRatePct    = 0;      // Phase 6: assumed promoted listing ad rate for main-page estimates
let editOfferLookupCache = new Map();
let linkAuditRunId = 0;

// ── Factory contexts (wired to page-level state and callbacks) ────────────
const reconcileCtx = createReconcileActions({ getProducts: () => allProducts, renderAll, loadProducts, showStatus });
const tableCtx     = createTableActions({ getProducts: () => allProducts, loadProducts, showStatus });
const dispatchProductAction = createProductActionDispatcher({
  openPush:           (...args) => window.openPush?.(...args),
  openEdit:           (...args) => window.openEdit?.(...args),
  openSalesHistory,
  relinkEbayListing:  reconcileCtx.relinkEbayListing,
  clearStaleEbayLink: reconcileCtx.clearStaleEbayLink,
  doWithdraw:         tableCtx.doWithdraw,
  doPublish:          tableCtx.doPublish,
  discardDraft:       tableCtx.discardDraft,
  getProducts:        () => allProducts,
});

// ── Status Bar ────────────────────────────────────────────────
function showStatus(msg, isError = false) {
  const bar = document.getElementById("statusBar");
  bar.textContent = msg;
  bar.className   = `mt-3 text-xs ${isError ? "text-red-500" : "text-gray-500"}`;
  bar.classList.remove("hidden");
}

// ── Stats ──────────────────────────────────────────────────────
function updateStats() {
  document.getElementById("statTotal").textContent     = allProducts.length;
  document.getElementById("statActive").textContent    = allProducts.filter(p => p.ebay_status === "active").length;
  document.getElementById("statDraft").textContent     = allProducts.filter(p => p.ebay_status === "draft").length;
  document.getElementById("statNotListed").textContent = allProducts.filter(p => !p.ebay_status || p.ebay_status === "not_listed").length;
}

// ── Load Products ─────────────────────────────────────────────
async function loadProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, slug, price, weight_g, unit_cost, catalog_image_url, catalog_hover_url, primary_image_url, is_active, ebay_sku, ebay_offer_id, ebay_listing_id, ebay_status, ebay_category_id, ebay_price_cents, ebay_item_group_key, ebay_volume_promo_id, ebay_store_category, product_gallery_images(url, position, is_active), product_variants(id, option_name, option_value, stock, preview_image_url, sort_order, is_active)")
    .order("code");

  if (error) {
    showStatus("Failed to load products: " + error.message, true);
    return;
  }

  allProducts = await mergeWorkspaceMetrics(data || []);
  applyFilters();
  updateStats();
  reconcileCtx.auditListingLinks(allProducts);
}

// ── Search / Filter / View ────────────────────────────────────
function applyFilters() {
  const query     = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
  const statusVal = document.getElementById("statusFilter")?.value || "";
  const quickVal  = document.getElementById("quickFilter")?.value || "";

  filteredProducts = allProducts.filter(p => {
    if (query) {
      const haystack = `${p.name} ${p.code} ${p.ebay_sku || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (statusVal) {
      const pStatus = p.ebay_status || "not_listed";
      if (pStatus !== statusVal) return false;
    }
    if (quickVal === "needs_work") {
      if (!p._ws || (p._ws.issue_count ?? 0) === 0) return false;
    } else if (quickVal === "no_sales_30d") {
      const st = p.ebay_status || "not_listed";
      if (st !== "active") return false;
      if (p._ws && (p._ws.sold_qty_30d ?? 0) > 0) return false;
    } else if (quickVal === "has_promo") {
      if (!p.ebay_volume_promo_id) return false;
    } else if (quickVal === "low_score") {
      const h = computeHealth(p);
      if (h.score === null || h.score >= 60) return false;
    } else if (quickVal === "draft_stalled") {
      if (p.ebay_status !== "draft" || p.ebay_offer_id) return false;
    } else if (quickVal === "missing_basics") {
      const basicFlags = ["missing_category", "missing_ebay_price", "missing_listing_id"];
      const wsFlags    = p._ws?.issue_flags || {};
      const hasMissing = basicFlags.some(f => !!wsFlags[f]);
      if (!hasMissing) return false;
    }
    return true;
  });

  document.getElementById("countLabel").textContent =
    `${filteredProducts.length} item${filteredProducts.length !== 1 ? "s" : ""}`;
  renderAll();
}

function renderAll() {
  if (currentView === "cards") {
    document.getElementById("tableSection").classList.add("hidden");
    document.getElementById("cardSection").classList.remove("hidden");
    renderCards(filteredProducts, pageAdRatePct);
  } else {
    document.getElementById("tableSection").classList.remove("hidden");
    document.getElementById("cardSection").classList.add("hidden");
    renderTable(filteredProducts, pageAdRatePct);
  }
}

function setView(view) {
  currentView = view;
  document.querySelectorAll(".view-toggle-btn").forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.className = `view-toggle-btn px-2 py-1 text-xs font-bold ${isActive ? "bg-black text-white" : "bg-white text-black"}`;
  });
  renderAll();
}

// ── Category / Aspects (Push Modal) ──────────────────────────





// ── Category / Aspects (Push Modal) ──────────────────────────
async function fetchAspects(categoryId) {
  const section      = document.getElementById("aspectsSection");
  const reqContainer = document.getElementById("aspectsRequired");
  const optContainer = document.getElementById("aspectsOptional");
  const loading      = document.getElementById("aspectsLoading");

  section.classList.remove("hidden");
  loading.classList.remove("hidden");
  reqContainer.innerHTML = "";
  optContainer.innerHTML = "";
  currentAspects = [];

  try {
    const result = await callEdge("ebay-taxonomy", { action: "get_aspects", categoryId });
    if (!result.success || !result.aspects?.length) {
      loading.textContent = "No item specifics found for this category";
      return;
    }

    currentAspects = result.aspects;
    const defaults  = { Brand: "Unbranded", Condition: "New", Type: "Accessory", Department: "Unisex Adults" };
    const required  = result.aspects.filter(a => a.required);
    const optional  = result.aspects.filter(a => !a.required).slice(0, 15);

    required.forEach(a => reqContainer.appendChild(buildAspectField(a, defaults, true)));
    optional.forEach(a => optContainer.appendChild(buildAspectField(a, defaults, false)));
    loading.classList.add("hidden");
  } catch (e) {
    loading.textContent = "Failed to load item specifics: " + e.message;
  }
}


// ── Push Modal ────────────────────────────────────────────────
window.openPush = async function openPush(code) {
  currentProduct = allProducts.find(p => p.code === code);
  if (!currentProduct) return;

  document.getElementById("modalProductName").textContent = currentProduct.name;
  document.getElementById("modalProductCode").textContent = currentProduct.code;
  document.getElementById("modalSku").value      = currentProduct.ebay_sku || currentProduct.code;
  document.getElementById("modalTitle").value    = currentProduct.name;
  document.getElementById("modalPrice").value    = currentProduct.price ? Number(currentProduct.price).toFixed(2) : "";
  document.getElementById("modalQuantity").value = "1";
  document.getElementById("modalCondition").value = "NEW";
  document.getElementById("modalLotEnabled").checked = false;
  document.getElementById("modalLotFields").classList.add("hidden");
  document.getElementById("modalLotSize").value = "2";
  document.getElementById("modalVolEnabled").checked = false;
  document.getElementById("modalVolFields").classList.add("hidden");
  document.getElementById("modalVolTiers").innerHTML = "";
  document.getElementById("modalCatSearch").value = currentProduct.name;
  document.getElementById("modalCatSelect").classList.add("hidden");
  document.getElementById("modalCatSelected").classList.add("hidden");
  document.getElementById("modalStatus").textContent = "";

  // Init Quill (destroy previous if exists)
  resetQuillEditorMount("modalDescriptionEditor");
  const editorEl = document.getElementById("modalDescriptionEditor");
  pushQuill = new Quill(editorEl, { theme: "snow", modules: { toolbar: quillToolbar } });

  // Reset description mode
  descState.pushMode = "visual";
  document.getElementById("modalDescriptionHtml").value = "";
  document.getElementById("modalDescriptionHtml").classList.add("hidden");
  document.getElementById("modalDescriptionPreview").classList.add("hidden");
  document.getElementById("btnPushVisual").classList.add("active");
  document.getElementById("btnPushHtml").classList.remove("active");
  document.getElementById("btnPushPreview").classList.remove("active");

  // Build image strip
  pushImageUrls = buildImageUrls(currentProduct);
  renderImageStrip("modalImageStrip", pushImageUrls, pushImageUrls);
  document.getElementById("modalImagePicker").classList.add("hidden");

  // Reset aspects
  currentAspects = [];
  document.getElementById("aspectsSection").classList.add("hidden");
  document.getElementById("aspectsRequired").innerHTML = "";
  document.getElementById("aspectsOptional").innerHTML = "";

  // Auto-fill weight (grams → ounces)
  document.getElementById("modalWeightOz").value =
    currentProduct.weight_g ? (currentProduct.weight_g / 28.3495).toFixed(1) : "4";

  // Detect variants
  const activeVariants = (currentProduct.product_variants || []).filter(v => v.is_active);
  pushVariants     = activeVariants;
  isVariantListing = activeVariants.length > 1;

  if (isVariantListing) {
    document.getElementById("variantPanel").classList.remove("hidden");
    renderVariantPanel(activeVariants, currentProduct.code, currentProduct);
    document.getElementById("btnCreateItem").textContent  = "1. Create Items";
    document.getElementById("btnCreateOffer").textContent = "2. Create Group + Offer";
    // eBay does not allow Best Offer on group (variant) listings
    document.getElementById("modalBestOffer").checked = false;
    document.getElementById("modalBestOfferFields").classList.add("hidden");
    document.getElementById("modalBestOffer").closest("div").classList.add("hidden");
  } else {
    document.getElementById("variantPanel").classList.add("hidden");
    document.getElementById("variantProgress").classList.add("hidden");
    pushVariants     = [];
    isVariantListing = false;
    document.getElementById("btnCreateItem").textContent  = "1. Create Item";
    document.getElementById("btnCreateOffer").textContent = "2. Create Offer";
    document.getElementById("modalBestOffer").closest("div").classList.remove("hidden");
  }

  enableBtn("btnCreateItem",  true);
  enableBtn("btnCreateOffer", false);
  enableBtn("btnPublish",     false);

  document.getElementById("pushModal").classList.remove("hidden");

  // ── Resume draft: pre-load existing eBay item data ──────────
  const isResumableDraft = currentProduct.ebay_status === "draft"
    && currentProduct.ebay_sku
    && !currentProduct.ebay_offer_id;

  if (isResumableDraft) {
    showStatus("Loading your previous draft from eBay…");
    try {
      const itemResult = await callEdge("ebay-manage-listing", { action: "get_item", sku: currentProduct.ebay_sku });
      if (itemResult.success && itemResult.item) {
        const ebayItem = itemResult.item;
        const prod     = ebayItem.product || {};

        if (prod.title) document.getElementById("modalTitle").value = prod.title;

        if (prod.description) {
          if (isComplexHtml(prod.description)) {
            document.getElementById("modalDescriptionHtml").value = prod.description;
            descState.pushMode = "html";
            toggleDescMode("html", "modal", pushQuill);
          } else {
            pushQuill.root.innerHTML = prod.description;
          }
        }

        if (ebayItem.condition) document.getElementById("modalCondition").value = ebayItem.condition;
        const qty = ebayItem.availability?.shipToLocationAvailability?.quantity;
        if (qty !== undefined) document.getElementById("modalQuantity").value = qty;

        const pkg = ebayItem.packageWeightAndSize || {};
        if (pkg.weight?.value) document.getElementById("modalWeightOz").value = pkg.weight.value;

        if (prod.imageUrls?.length) {
          pushImageUrls = [...prod.imageUrls];
          renderImageStrip("modalImageStrip", pushImageUrls, pushImageUrls);
        }

        const btn1 = document.getElementById("btnCreateItem");
        btn1.textContent = "✓ Item Created";
        btn1.disabled    = true;
        btn1.classList.add("border-gray-300", "bg-gray-100", "text-gray-400");
        btn1.classList.remove("border-black", "bg-black", "text-white", "hover:bg-kkpink", "hover:border-kkpink", "hover:text-black");
        enableBtn("btnCreateOffer", true);

        showStatus("📋 Draft resumed — your previous data has been loaded. Continue from Step 2.");
      } else {
        showStatus("Could not load previous draft — starting from Step 1.", true);
      }
    } catch (e) {
      console.warn("Resume draft pre-load failed:", e.message);
      showStatus("Could not load previous draft — starting from Step 1.", true);
    }
  }

  document.getElementById("modalAdRate").value = String(pageAdRatePct);
  refreshPushPreview(currentProduct);
  pushSalesMetrics = null;
  loadAndRenderPriceRef("modalPriceRef", currentProduct, "modalPrice", (m) => { pushSalesMetrics = m; }, (p) => currentProduct?.code === p.code);
}






// ── Edit Modal Context ────────────────────────────────────────
const editCtx = createEditModalContext({
  getProducts:           () => allProducts,
  loadProducts,
  showStatus,
  getAdRatePct:          () => pageAdRatePct,
  supabase,
  reconcileEbayLink:     reconcileCtx.reconcileEbayLink,
  renderEditLinkWarning: reconcileCtx.renderEditLinkWarning,
  relinkEbayListing:     reconcileCtx.relinkEbayListing,
  syncBack(state) {
    editProduct               = state.currentProduct;
    editQuill                 = state.editQuill;
    editImageUrls             = state.editImageUrls;
    editVariantImageOverrides = state.editVariantImageOverrides;
    editVariantQtyOverrides   = state.editVariantQtyOverrides;
    editAspects               = state.currentAspects;
    editSalesMetrics          = state.editSalesMetrics;
  },
});
window.openEdit = editCtx.openEdit;

// ── Event Listeners ────────────────────────────────────────────

// Search
document.getElementById("searchInput").addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(applyFilters, 250);
  document.getElementById("searchClear").classList.toggle("hidden", !document.getElementById("searchInput").value);
});
document.getElementById("searchClear").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  document.getElementById("searchClear").classList.add("hidden");
  applyFilters();
});
document.getElementById("statusFilter").addEventListener("change", applyFilters);
document.getElementById("quickFilter").addEventListener("change", applyFilters);
document.getElementById("adRateFilter").addEventListener("change", e => {
  pageAdRatePct = parseInt(e.target.value, 10) || 0;
  renderAll();
});

// View toggle
document.querySelectorAll(".view-toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

// Push Modal — close
document.getElementById("btnCloseModal").addEventListener("click", () => {
  document.getElementById("pushModal").classList.add("hidden");
  document.getElementById("modalImagePicker").classList.add("hidden");
  currentProduct = null;
});

// Push Modal — profit preview + price reference live update
document.getElementById("modalPrice").addEventListener("input", () => refreshPushPreview(currentProduct));
document.getElementById("modalPrice").addEventListener("input", () => refreshPushRef(currentProduct, pushSalesMetrics));
document.getElementById("modalWeightOz").addEventListener("input", () => refreshPushPreview(currentProduct));

// Push Modal — Add image
document.getElementById("btnAddImgPush").addEventListener("click", () => {
  if (!currentProduct) return;
  showGalleryPicker("modalImagePicker", "modalImageStrip", pushImageUrls, currentProduct);
});

// Push Modal — Description mode
document.getElementById("btnPushVisual").addEventListener("click", () => {
  descState.pushMode = "visual";
  toggleDescMode("visual", "modal", pushQuill);
});
document.getElementById("btnPushHtml").addEventListener("click", () => {
  descState.pushMode = "html";
  toggleDescMode("html", "modal", pushQuill);
});
document.getElementById("btnPushPreview").addEventListener("click", () => {
  toggleDescMode("preview", "modal", pushQuill);
});

// Push Modal — Category Search
document.getElementById("btnSearchCat").addEventListener("click", async () => {
  const query = document.getElementById("modalCatSearch").value.trim();
  if (!query) return;
  const btn = document.getElementById("btnSearchCat");
  btn.disabled = true; btn.textContent = "...";
  try {
    const result = await callEdge("ebay-taxonomy", { action: "suggest_category", query });
    const sel    = document.getElementById("modalCatSelect");
    if (result.suggestions?.length) {
      sel.innerHTML = result.suggestions.map(s =>
        `<option value="${s.categoryId}">${esc(s.categoryName)} (${s.categoryId})</option>`
      ).join("");
      sel.classList.remove("hidden");
      sel.onchange = () => {
        const opt = sel.options[sel.selectedIndex];
        document.getElementById("modalCatSelected").textContent = `✓ ${opt.text}`;
        document.getElementById("modalCatSelected").classList.remove("hidden");
        fetchAspects(opt.value);
      };
      sel.selectedIndex = 0;
      sel.dispatchEvent(new Event("change"));
    } else {
      sel.innerHTML = '<option>No categories found</option>';
      sel.classList.remove("hidden");
    }
  } catch (e) {
    document.getElementById("modalStatus").textContent = "Category search failed: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Search";
  }
});

// Push Modal — AI Auto-Fill
document.getElementById("btnAiFill").addEventListener("click", async () => {
  if (!currentProduct) return;
  const btn      = document.getElementById("btnAiFill");
  const statusEl = document.getElementById("aiFillStatus");
  btn.disabled   = true;
  btn.innerHTML  = '<span class="animate-pulse">✨ Generating...</span>';
  statusEl.textContent = "Analyzing product images and generating listing...";
  statusEl.classList.remove("hidden");

  try {
    const existingAspects = currentAspects.map(a => a.name);
    let categoryName = document.getElementById("modalStoreCategory")?.value || "";
    if (!categoryName) {
      const catMap = { headwear: "Headwear", jewelry: "Jewelry", bags: "Bags", accessories: "Accessories", plushies: "Plushies", lego: "Lego" };
      for (const [key, val] of Object.entries(catMap)) {
        if (currentProduct.name?.toLowerCase().includes(key) || currentProduct.code?.toLowerCase().startsWith(key.substring(0, 2).toUpperCase())) {
          categoryName = val; break;
        }
      }
    }

    const result = await callEdge("ebay-ai-autofill", {
      productName: currentProduct.name,
      productCode: currentProduct.code,
      category:    categoryName,
      price:       currentProduct.price ? Number(currentProduct.price) : undefined,
      imageUrls:   pushImageUrls.slice(0, 4),
      existingAspects,
    });

    if (!result.success) {
      statusEl.textContent = "AI fill failed: " + (result.error || "Unknown error");
      statusEl.className   = "text-[10px] text-red-500 text-center";
      return;
    }

    const ai = result.data;
    if (ai.title?.value) {
      document.getElementById("modalTitle").value = ai.title.value;
      addAiBadge("modalTitle", ai.title.source || "generated");
    }
    if (ai.description_html?.value) {
      descState.pushMode = "html";
      document.getElementById("modalDescriptionHtml").value = ai.description_html.value;
      toggleDescMode("html", "modal", pushQuill);
      addAiBadge("modalDescriptionHtml", ai.description_html.source || "generated");
    }
    if (ai.item_specifics?.length && currentAspects.length) {
      for (const spec of ai.item_specifics) {
        const input = document.querySelector(`[data-aspect="${spec.name}"]`);
        if (input && spec.value) {
          input.value = spec.value;
          const badge = document.createElement("span");
          badge.className = `ai-badge ai-badge-${spec.source || "inferred"}`;
          badge.textContent = spec.source === "default" ? "Default" : spec.source === "from_data" ? "From data" : "AI";
          const existing = input.parentElement.querySelector(".ai-badge");
          if (existing) existing.remove();
          input.parentElement.appendChild(badge);
        }
      }
    }

    const notes = ai.notes || [];
    if (notes.length) {
      statusEl.innerHTML  = "✅ AI filled fields. Notes:<br>" + notes.map(n => `• ${esc(n)}`).join("<br>");
      statusEl.className  = "text-[10px] text-amber-600 text-center";
    } else {
      statusEl.textContent = "✅ AI auto-fill complete — review fields before proceeding.";
      statusEl.className   = "text-[10px] text-green-600 text-center";
    }
  } catch (e) {
    statusEl.textContent = "AI fill error: " + e.message;
    statusEl.className   = "text-[10px] text-red-500 text-center";
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<span>✨</span> AI Auto-Fill';
  }
});

// Push Modal — Step 1: Create Item(s)
document.getElementById("btnCreateItem").addEventListener("click", async () => {
  const btn        = document.getElementById("btnCreateItem");
  const status     = document.getElementById("modalStatus");
  const progressEl = document.getElementById("variantProgress");
  btn.disabled = true; btn.textContent = "Creating...";

  const sku       = document.getElementById("modalSku").value.trim();
  const title     = document.getElementById("modalTitle").value.trim();
  const rawHtml   = getDescriptionHtml("modal", pushQuill);
  const description = descState.pushMode === "html" ? sanitizeForEbay(rawHtml) : wrapDescription(title, rawHtml);
  const condition = document.getElementById("modalCondition").value;
  const quantity  = parseInt(document.getElementById("modalQuantity").value) || 1;
  const lotSize   = document.getElementById("modalLotEnabled").checked ? (parseInt(document.getElementById("modalLotSize").value) || 0) : 0;

  if (!sku || !title) {
    status.textContent = "❌ SKU and title required";
    btn.disabled = false; btn.textContent = isVariantListing ? "1. Create Items" : "1. Create Item";
    return;
  }

  const missingAspects = validateRequiredAspects();
  if (missingAspects.length) {
    status.textContent = `❌ Required item specifics missing: ${missingAspects.join(", ")}`;
    btn.disabled = false; btn.textContent = isVariantListing ? "1. Create Items" : "1. Create Item";
    return;
  }

  const aspects   = collectAspects();
  const imageUrls = [...pushImageUrls];

  try {
    if (isVariantListing) {
      const checked = getCheckedVariants(pushVariants, currentProduct.code);
      if (!checked.length) {
        status.textContent = "❌ Select at least one variant";
        btn.disabled = false; btn.textContent = "1. Create Items";
        return;
      }

      const generatedSkus = checked.map(v => v.sku);
      const uniqueSkus    = new Set(generatedSkus);
      if (uniqueSkus.size !== generatedSkus.length) {
        const dupes = [...new Set(generatedSkus.filter((s, i) => generatedSkus.indexOf(s) !== i))];
        status.textContent = `❌ SKU collision: ${dupes.join(", ")} — rename variant options so the first 6 letters/digits are unique`;
        btn.disabled = false; btn.textContent = "1. Create Items";
        return;
      }

      progressEl.classList.remove("hidden");
      let created       = 0;
      const errors      = [];
      const createdSkus = [];
      // Include all checked variants — even qty=0 (out of stock).
      // They'll be created on eBay with qty 0 and can be restocked via Edit later.
      const validVariants = checked;
      const hasAnyStock   = checked.some(v => v.quantity > 0);

      if (!validVariants.length) {
        status.textContent = "❌ Select at least one variant";
        btn.disabled = false; btn.textContent = "1. Create Items";
        return;
      }
      if (!hasAnyStock) {
        status.textContent = "❌ At least one variant must have quantity > 0 to publish";
        btn.disabled = false; btn.textContent = "1. Create Items";
        return;
      }

      for (const v of validVariants) {
        progressEl.textContent = `Creating ${v.option_value} (${v.sku})... (${created + 1}/${validVariants.length})`;
        const variantAspects = { ...aspects, Color: [v.option_value] };
        const variantImages = [...new Set((v.variant_image_urls || []).filter(Boolean))];

        const variantProduct = { title, description, condition, quantity: v.quantity, imageUrls: variantImages.slice(0, 24), aspects: variantAspects };
        if (lotSize > 1) variantProduct.lotSize = lotSize;

        const result = await callEdge("ebay-manage-listing", {
          action:               "create_item",
          sku:                  v.sku,
          product:              variantProduct,
          packageWeightAndSize: buildPackageWeightAndSize("modal"),
        });

        if (result.success) { created++; createdSkus.push(v.sku); }
        else errors.push(`${v.option_value}: ${result.error || "Failed"}`);
      }

      currentProduct._createdVariantSKUs = createdSkus;

      if (created === validVariants.length && !errors.length) {
        status.textContent   = `✅ ${created} variant items created — now create group + offer`;
        progressEl.textContent = `All ${created} items created ✓`;
        enableBtn("btnCreateItem",  false);
        enableBtn("btnCreateOffer", true);
      } else if (created > 0) {
        status.textContent = `⚠️ ${created}/${validVariants.length} created. Errors: ${errors.join("; ")}. You can still proceed.`;
        enableBtn("btnCreateItem",  false);
        enableBtn("btnCreateOffer", true);
      } else {
        status.textContent = `❌ No items created. Errors: ${errors.join("; ")}`;
      }
    } else {
      const productPayload = { title, description, condition, quantity, imageUrls, aspects };
      if (lotSize > 1) productPayload.lotSize = lotSize;

      const result = await callEdge("ebay-manage-listing", {
        action:               "create_item",
        sku,
        product:              productPayload,
        packageWeightAndSize: buildPackageWeightAndSize("modal"),
      });

      if (result.success) {
        status.textContent = "✅ Inventory item created — now create an offer";
        enableBtn("btnCreateItem",  false);
        enableBtn("btnCreateOffer", true);
      } else {
        status.textContent = "❌ " + (result.error || "Create failed");
      }
    }
  } catch (e) {
    status.textContent = "❌ Error: " + e.message;
  } finally {
    btn.disabled    = false;
    btn.textContent = isVariantListing ? "1. Create Items" : "1. Create Item";
  }
});

// Push Modal — Step 2: Create Offer (or Group + Offer)
document.getElementById("btnCreateOffer").addEventListener("click", async () => {
  const btn        = document.getElementById("btnCreateOffer");
  const status     = document.getElementById("modalStatus");
  const progressEl = document.getElementById("variantProgress");
  btn.disabled = true; btn.textContent = "Creating...";

  const sku        = document.getElementById("modalSku").value.trim();
  const categoryId = document.getElementById("modalCatSelect")?.value;
  const price      = parseFloat(document.getElementById("modalPrice").value) || 0;
  const quantity   = parseInt(document.getElementById("modalQuantity").value) || 1;

  if (!categoryId || categoryId === "No categories found") {
    status.textContent = "❌ Select a category first";
    btn.disabled = false; btn.textContent = isVariantListing ? "2. Create Group + Offer" : "2. Create Offer";
    return;
  }

  try {
    const checked       = getCheckedVariants(pushVariants, currentProduct.code);
    // Always use all active checked SKUs — some may already exist on eBay from a prior run,
    // and create_group_offer handles 25002 (already exists) gracefully.
    const publishableVariants = checked.filter(v => v.quantity > 0);
    const allActiveSkus = publishableVariants.map(v => v.sku);
    const effectiveSkus = allActiveSkus;

    if (isVariantListing && allActiveSkus.length < 2) {
      if (allActiveSkus.length === 0) {
        status.textContent = "❌ No valid items to create an offer for — check quantities";
        btn.disabled = false; btn.textContent = "2. Create Offer";
        return;
      }
      const variantItem = publishableVariants.find(v => v.sku === allActiveSkus[0]) || publishableVariants[0];
      const vSku        = variantItem.sku;
      const vQty        = variantItem.quantity;
      const storeCat    = document.getElementById("modalStoreCategory").value;
      const result      = await callEdge("ebay-manage-listing", {
        action:           "create_offer",
        sku:              vSku,
        categoryId,
        priceCents:       Math.round(price * 100),
        quantity:         vQty,
        policies:         getSelectedPolicies("modal"),
        bestOfferTerms:   getBestOfferTerms("modal"),
        storeCategoryNames: storeCat ? [storeCat] : [],
      });
      if (result.success) {
        status.textContent = `✅ Offer created (${result.offerId}) — ready to publish`;
        currentProduct._offerId = result.offerId;
        enableBtn("btnCreateOffer", false);
        enableBtn("btnPublish",     true);
      } else {
        status.textContent = "❌ " + (result.error || "Offer creation failed");
      }
      btn.disabled = false; btn.textContent = "2. Create Offer";
      return;
    }

    if (isVariantListing) {
      const groupKey    = `${currentProduct.code}-GROUP`;
      const title       = document.getElementById("modalTitle").value.trim();
      const rawHtml     = getDescriptionHtml("modal", pushQuill);
      const description = descState.pushMode === "html" ? sanitizeForEbay(rawHtml) : wrapDescription(title, rawHtml);
      const aspects     = collectAspects();
      delete aspects.Color;

      // Always use all active checked SKUs — some may already exist on eBay from a prior run,
      // and create_group_offer handles 25002 (already exists) gracefully.
      const variantSKUs = allActiveSkus;
      if (!variantSKUs.length) {
        status.textContent = "❌ No active variants found — complete step 1 first";
        btn.disabled = false; btn.textContent = "2. Create Group + Offer";
        return;
      }
      const colorValues = publishableVariants.filter(v => variantSKUs.includes(v.sku)).map(v => v.option_value);
      const variesBy        = { aspectsImageVariesBy: ["Color"], specifications: [{ name: "Color", values: colorValues }] };

      progressEl.textContent = "Creating inventory item group...";
      const groupResult = await callEdge("ebay-manage-listing", {
        action:               "create_item_group",
        inventoryItemGroupKey: groupKey,
        title, description,
        imageUrls:            [...pushImageUrls].slice(0, 24),
        aspects, variantSKUs, variesBy,
        baseProductCode:      currentProduct.code,
      });

      if (!groupResult.success) {
        status.textContent = "❌ Group creation failed: " + (groupResult.error || "Unknown");
        btn.disabled = false; btn.textContent = "2. Create Group + Offer";
        return;
      }

      progressEl.textContent = "Group created ✓ — Creating offer...";
      const storeCat    = document.getElementById("modalStoreCategory").value;
      const variantQuantities = Object.fromEntries(publishableVariants.map(v => [v.sku, v.quantity]));
      const offerResult = await callEdge("ebay-manage-listing", {
        action:               "create_group_offer",
        inventoryItemGroupKey: groupKey,
        variantSKUs, categoryId,
        variantQuantities,
        priceCents:           Math.round(price * 100),
        policies:             getSelectedPolicies("modal"),
        bestOfferTerms:       getBestOfferTerms("modal"),
        storeCategoryNames:   storeCat ? [storeCat] : [],
        baseProductCode:      currentProduct.code,
      });

      if (offerResult.success) {
        status.textContent     = `✅ Group + Offers created (${offerResult.count || 0} variants) — ready to publish`;
        progressEl.textContent = `Group "${groupKey}" + ${offerResult.count || 0} offers created ✓`;
        currentProduct._groupKey      = groupKey;
        currentProduct._groupOfferIds = offerResult.offerIds || [];
        enableBtn("btnCreateOffer", false);
        enableBtn("btnPublish",     true);
      } else {
        status.textContent = "❌ Offer creation failed: " + (offerResult.error || "Unknown");
      }
    } else {
      const storeCat = document.getElementById("modalStoreCategory").value;
      const result   = await callEdge("ebay-manage-listing", {
        action:           "create_offer",
        sku, categoryId,
        priceCents:       Math.round(price * 100),
        quantity,
        policies:         getSelectedPolicies("modal"),
        bestOfferTerms:   getBestOfferTerms("modal"),
        storeCategoryNames: storeCat ? [storeCat] : [],
      });
      if (result.success) {
        status.textContent = `✅ Offer created (${result.offerId}) — ready to publish`;
        currentProduct._offerId = result.offerId;
        enableBtn("btnCreateOffer", false);
        enableBtn("btnPublish",     true);
      } else {
        status.textContent = "❌ " + (result.error || "Offer creation failed");
      }
    }
  } catch (e) {
    status.textContent = "❌ Error: " + e.message;
  } finally {
    btn.disabled    = false;
    btn.textContent = isVariantListing ? "2. Create Group + Offer" : "2. Create Offer";
  }
});

// Push Modal — Step 3: Publish
document.getElementById("btnPublish").addEventListener("click", async () => {
  const btn    = document.getElementById("btnPublish");
  const status = document.getElementById("modalStatus");
  btn.disabled = true; btn.textContent = "Publishing...";

  const sku      = document.getElementById("modalSku").value.trim();
  const offerId  = currentProduct._offerId || currentProduct.ebay_offer_id;
  const groupKey = currentProduct._groupKey || currentProduct.ebay_item_group_key || `${currentProduct.code}-GROUP`;
  const checked = getCheckedVariants(pushVariants, currentProduct.code).filter(v => v.quantity > 0);
  const variantQuantities = Object.fromEntries(checked.map(v => [v.sku, v.quantity]));
  variantQuantities[currentProduct.code] = checked.reduce((sum, v) => sum + v.quantity, 0) || (parseInt(document.getElementById("modalQuantity").value, 10) || 1);

  if (!isVariantListing && !offerId) {
    status.textContent = "❌ No offer ID";
    btn.disabled = false; btn.textContent = "3. Publish";
    return;
  }

  try {
    const categoryId = document.getElementById("modalCatSelect")?.value || "";
  const price       = parseFloat(document.getElementById("modalPrice").value) || 0;
  const priceCents  = Math.round(price * 100);

  const result = isVariantListing
      ? await callEdge("ebay-manage-listing", { action: "publish_group", inventoryItemGroupKey: groupKey, sku: currentProduct.code, categoryId, priceCents, variantQuantities })
      : await callEdge("ebay-manage-listing", { action: "publish", offerId, sku, categoryId, priceCents, quantity: parseInt(document.getElementById("modalQuantity").value, 10) || 1 });

    if (result.success) {
      status.textContent = `✅ Published! Listing ID: ${result.listingId}`;
      enableBtn("btnPublish", false);

      if (document.getElementById("modalVolEnabled").checked) {
        const volTiers = getVolTiers("modal");
        if (volTiers.length && result.listingId) {
          try {
            status.textContent += " — Creating volume discount...";
            const volResult = await callEdge("ebay-manage-listing", {
              action: "create_volume_discount",
              listingId:   result.listingId,
              tiers:       volTiers,
              productCode: currentProduct.code,
            });
            if (volResult.success) {
              status.textContent = `✅ Published + Volume pricing set! Listing ID: ${result.listingId}`;
              setTimeout(() => { document.getElementById("pushModal").classList.add("hidden"); loadProducts(); }, 1500);
            } else {
              status.textContent = `✅ Published (Listing ${result.listingId}) — ⚠️ Volume pricing failed: ${volResult.error || JSON.stringify(volResult)} (close manually when done)`;
            }
          } catch (ve) {
            status.textContent = `✅ Published (Listing ${result.listingId}) — ⚠️ Volume pricing error: ${ve.message} (close manually when done)`;
          }
          return;
        }
      }

      setTimeout(() => { document.getElementById("pushModal").classList.add("hidden"); loadProducts(); }, 1500);
    } else {
      status.textContent = "❌ " + (result.error || "Publish failed");
    }
  } catch (e) {
    status.textContent = "❌ Error: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "3. Publish";
  }
});

// Edit Modal — base listeners (close, relink, previews, add image, desc tabs) — delegated to editCtx:
editCtx.bindEditBaseListeners();

// Product action dispatcher — handles all data-action buttons in table and cards.
document.getElementById("tableSection").addEventListener("click", dispatchProductAction);
document.getElementById("cardSection").addEventListener("click", dispatchProductAction);
document.getElementById("btnCloseSales").addEventListener("click", closeSalesHistory);


// Edit Modal — AI Auto-Fill
document.getElementById("btnEditAiFill").addEventListener("click", async () => {
  if (!editProduct) return;
  const btn      = document.getElementById("btnEditAiFill");
  const statusEl = document.getElementById("editAiFillStatus");
  btn.disabled   = true;
  btn.innerHTML  = '<span class="animate-pulse">✨ Generating...</span>';
  statusEl.textContent = "Analyzing product images and generating listing...";
  statusEl.classList.remove("hidden");

  try {
    const existingAspects = editAspects.map(a => a.name);
    let categoryName = document.getElementById("editStoreCategory")?.value || "";
    if (!categoryName) {
      const catMap = { headwear: "Headwear", jewelry: "Jewelry", bags: "Bags", accessories: "Accessories", plushies: "Plushies", lego: "Lego" };
      for (const [key, val] of Object.entries(catMap)) {
        if (editProduct.name?.toLowerCase().includes(key) || editProduct.code?.toLowerCase().startsWith(key.substring(0, 2).toUpperCase())) {
          categoryName = val; break;
        }
      }
    }

    const result = await callEdge("ebay-ai-autofill", {
      productName: editProduct.name,
      productCode: editProduct.code,
      category:    categoryName,
      price:       editProduct.price ? Number(editProduct.price) : undefined,
      imageUrls:   editImageUrls.slice(0, 4),
      existingAspects,
    });

    if (!result.success) {
      statusEl.textContent = "AI fill failed: " + (result.error || "Unknown error");
      statusEl.className   = "text-[10px] text-red-500 text-center";
      return;
    }

    const ai = result.data;
    if (ai.title?.value) {
      document.getElementById("editTitle").value = ai.title.value;
      addAiBadge("editTitle", ai.title.source || "generated");
    }
    if (ai.description_html?.value) {
      descState.editMode = "html";
      document.getElementById("editDescriptionHtml").value = ai.description_html.value;
      toggleDescMode("html", "edit", editQuill);
      addAiBadge("editDescriptionHtml", ai.description_html.source || "generated");
    }
    if (ai.item_specifics?.length && editAspects.length) {
      for (const spec of ai.item_specifics) {
        const input = document.querySelector(`[data-edit-aspect="${spec.name}"]`);
        if (input && spec.value && (!input.value || input.value === "Unbranded")) {
          input.value = spec.value;
          const badge = document.createElement("span");
          badge.className   = `ai-badge ai-badge-${spec.source || "inferred"}`;
          badge.textContent = spec.source === "default" ? "Default" : spec.source === "from_data" ? "From data" : "AI";
          const existing = input.parentElement.querySelector(".ai-badge");
          if (existing) existing.remove();
          input.parentElement.appendChild(badge);
        }
      }
    }

    const notes = ai.notes || [];
    if (notes.length) {
      statusEl.innerHTML = "✅ AI filled fields. Notes:<br>" + notes.map(n => `• ${esc(n)}`).join("<br>");
      statusEl.className = "text-[10px] text-amber-600 text-center";
    } else {
      statusEl.textContent = "✅ AI auto-fill complete — review fields before saving.";
      statusEl.className   = "text-[10px] text-green-600 text-center";
    }
  } catch (e) {
    statusEl.textContent = "AI fill error: " + e.message;
    statusEl.className   = "text-[10px] text-red-500 text-center";
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<span>✨</span> AI Auto-Fill';
  }
});

// Edit Modal — Save Changes
document.getElementById("btnSaveEdit").addEventListener("click", async () => {
  if (!editProduct) return;
  const btn    = document.getElementById("btnSaveEdit");
  const status = document.getElementById("editStatus");
  btn.disabled = true; btn.textContent = "Saving...";

  const sku         = editProduct.ebay_sku || editProduct.code;
  const title       = document.getElementById("editTitle").value.trim();
  const rawHtml     = getDescriptionHtml("edit", editQuill);
  const description = descState.editMode === "html" ? sanitizeForEbay(rawHtml) : wrapDescription(title, rawHtml);
  const condition   = document.getElementById("editCondition").value;
  const quantity    = parseInt(document.getElementById("editQuantity").value) || 1;
  const price       = parseFloat(document.getElementById("editPrice").value) || 0;
  const editLotSize = document.getElementById("editLotEnabled").checked ? (parseInt(document.getElementById("editLotSize").value) || 0) : 0;

  if (!title) { status.textContent = "❌ Title required"; btn.disabled = false; btn.textContent = "Save Changes"; return; }

  // Validate required aspects
  const missing = [];
  document.querySelectorAll("[data-edit-aspect][data-required='true']").forEach(input => {
    if (!input.value.trim()) missing.push(input.dataset.editAspect);
  });
  if (missing.length) {
    status.textContent = `❌ Required: ${missing.join(", ")}`;
    btn.disabled = false; btn.textContent = "Save Changes";
    return;
  }

  // Collect aspects
  const aspects = {};
  document.querySelectorAll("[data-edit-aspect]").forEach(input => {
    const val = input.value.trim();
    if (val) aspects[input.dataset.editAspect] = [val];
  });

  const imageUrls = [...editImageUrls];

  try {
    if (editProduct.ebay_status === "active") {
      status.textContent = "Checking eBay linkage before save...";
      const linkCheck = await reconcileCtx.reconcileEbayLink(editProduct, false);
      reconcileCtx.renderEditLinkWarning(linkCheck);
      if (isStaleLinkCheck(linkCheck)) {
        throw new Error(`${staleLinkMessage(linkCheck)} Use Relink/Import refresh before saving so you do not edit an old ended listing.`);
      }
    }

    if (editProduct._isGroup) {
      const groupKey   = editProduct.ebay_item_group_key;
      const groupData  = editProduct._groupData || {};
      const variantSKUs = groupData.variantSKUs || [];
      const unresolvedVariantOffers = variantSKUs.filter(vSku => {
        const cached = editOfferLookupCache.get(vSku);
        return !cached?.success || !(cached.offers || [])[0]?.offerId;
      });
      if (editProduct._offerMappingsUnresolved || unresolvedVariantOffers.length) {
        const detail = editProduct._offerMappingFailureMessage
          || `This variant listing could not be matched to active eBay offers${unresolvedVariantOffers.length ? ` for ${unresolvedVariantOffers.join(", ")}` : ""}. Refresh/relink this listing before saving eBay edits.`;
        throw new Error(detail);
      }
      const sharedAspects = { ...aspects };
      delete sharedAspects.Color;

      status.textContent = "Updating item group...";
      const groupResult = await callEdge("ebay-manage-listing", {
        action:               "update_item_group",
        inventoryItemGroupKey: groupKey,
        title, description, imageUrls,
        aspects:              sharedAspects,
        variantSKUs,
        variesBy:             groupData.variesBy || { aspectsImageVariesBy: ["Color"], specifications: [] },
        baseProductCode:      editProduct.code,
      });
      if (!groupResult.success) throw new Error(groupResult.error || "Group update failed");

      status.textContent = `Updating ${variantSKUs.length} variant items...`;
      for (const vSku of variantSKUs) {
        const varResult = await callEdge("ebay-manage-listing", { action: "get_item", sku: vSku });
        if (!varResult.success) continue;

        const varItem   = varResult.item;
        const varAspects = varItem.product?.aspects || {};
        const mergedAspects = { ...sharedAspects };
        if (varAspects.Color) mergedAspects.Color = varAspects.Color;

        const variantImageUrls = [...new Set((editVariantImageOverrides[vSku] || varItem.product?.imageUrls || []).filter(Boolean))].slice(0, 24);

        const resolvedQty          = editVariantQtyOverrides[vSku] ?? varItem.availability?.shipToLocationAvailability?.quantity ?? quantity;
        const variantUpdateProduct = { title, description, condition, imageUrls: variantImageUrls, aspects: mergedAspects,
          quantity: resolvedQty };
        if (editLotSize > 1) variantUpdateProduct.lotSize = editLotSize;

        await callEdge("ebay-manage-listing", {
          action:               "update_item",
          sku:                  vSku,
          product:              variantUpdateProduct,
          packageWeightAndSize: buildPackageWeightAndSize("edit"),
        });
      }

      status.textContent = "Updating variant offers...";
      const priceCents   = Math.round(price * 100);
      const editStoreCat = document.getElementById("editStoreCategory").value;
      const editCategoryId = document.getElementById("editCategoryId").value.trim();
      const offerLookupFailures = [];
      const variantOfferRows = [];
      for (const vSku of variantSKUs) {
        const offersResp = editOfferLookupCache.get(vSku) || { success: false, offers: [], cached: true };
        if (!offersResp.success) {
          offerLookupFailures.push(vSku);
          continue;
        }
        const offerRow   = (offersResp.offers || [])[0];
        variantOfferRows.push({ vSku, offerRow });
      }
      if (offerLookupFailures.length) {
        throw new Error(`Could not load eBay offers for ${offerLookupFailures.join(", ")}. This was cached to avoid repeated failing requests; refresh/relink the listing if it persists.`);
      }
      for (const { vSku, offerRow } of variantOfferRows) {
        if (!offerRow?.offerId) continue;
        const offerResult = await callEdge("ebay-manage-listing", {
          action:           "update_offer",
          offerId:          offerRow.offerId,
          sku:              editProduct.code,
          expectedSku:      vSku,
          listingId:        editProduct.ebay_listing_id,
          priceCents,
          quantity:         editVariantQtyOverrides[vSku] ?? offerRow.availableQuantity ?? quantity,
          categoryId:       editCategoryId || undefined,
          policies:         getSelectedPolicies("edit"),
          // Best Offer not permitted on group (variant) listings (eBay error 25737)
          storeCategoryNames: editStoreCat ? [editStoreCat] : [],
        });
        if (!offerResult.success) throw new Error(offerUpdateErrorMessage(offerResult, `Offer update failed for ${vSku}`));
      }
    } else {
      status.textContent = "Updating item...";
      const editProductPayload = { title, description, condition, quantity, imageUrls, aspects };
      if (editLotSize > 1) editProductPayload.lotSize = editLotSize;

      const itemResult = await callEdge("ebay-manage-listing", {
        action:               "update_item",
        sku,
        product:              editProductPayload,
        packageWeightAndSize: buildPackageWeightAndSize("edit"),
      });
      if (!itemResult.success) throw new Error(itemResult.error || "Item update failed");

      if (editProduct.ebay_offer_id) {
        status.textContent = "Updating offer...";
        const priceCents   = Math.round(price * 100);
        const editStoreCat = document.getElementById("editStoreCategory").value;
        const editCategoryId = document.getElementById("editCategoryId").value.trim();
        const offerResult  = await callEdge("ebay-manage-listing", {
          action:           "update_offer",
          offerId:          editProduct.ebay_offer_id,
          sku, expectedSku: sku, listingId: editProduct.ebay_listing_id, priceCents, quantity,
          categoryId:       editCategoryId || undefined,
          policies:         getSelectedPolicies("edit"),
          bestOfferTerms:   getBestOfferTerms("edit"),
          storeCategoryNames: editStoreCat ? [editStoreCat] : [],
        });
        if (!offerResult.success) throw new Error(offerUpdateErrorMessage(offerResult, "Offer update failed"));
      }
    }

    // Persist store category to local DB
    const savedStoreCat = document.getElementById("editStoreCategory").value;
    await supabase.from("products").update({ ebay_store_category: savedStoreCat || null }).eq("id", editProduct.id);

    // Volume Pricing
    const volEnabled     = document.getElementById("editVolEnabled").checked;
    const volTiers       = volEnabled ? getVolTiers("edit") : [];
    const existingPromoId = editProduct._volPromoId || editProduct.ebay_volume_promo_id;
    const listingId       = editProduct.ebay_listing_id;

    if (volEnabled && volTiers.length && listingId) {
      status.textContent = "Updating volume pricing...";
      if (existingPromoId) {
        const volResult = await callEdge("ebay-manage-listing", { action: "update_volume_discount", promotionId: existingPromoId, listingId, tiers: volTiers });
        if (!volResult.success) console.warn("Volume pricing update failed:", volResult.error);
      } else {
        const volResult = await callEdge("ebay-manage-listing", { action: "create_volume_discount", listingId, tiers: volTiers, productCode: editProduct.code });
        if (!volResult.success) console.warn("Volume pricing create failed:", volResult.error);
      }
    } else if (!volEnabled && existingPromoId) {
      status.textContent = "Removing volume pricing...";
      const volResult = await callEdge("ebay-manage-listing", { action: "delete_volume_discount", promotionId: existingPromoId, productCode: editProduct.code });
      if (!volResult.success) console.warn("Volume pricing delete failed:", volResult.error);
    }

    status.textContent = "✅ Listing updated successfully";
    setTimeout(() => {
      document.getElementById("editModal").classList.add("hidden");
      editProduct = null;
      loadProducts();
    }, 1200);
  } catch (e) {
    status.textContent = "❌ " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Save Changes";
  }
});


// Checkbox toggles — Best Offer
document.getElementById("modalBestOffer").addEventListener("change", (e) => {
  document.getElementById("modalBestOfferFields").classList.toggle("hidden", !e.target.checked);
});
document.getElementById("editBestOffer").addEventListener("change", (e) => {
  document.getElementById("editBestOfferFields").classList.toggle("hidden", !e.target.checked);
});

// Checkbox toggles — Lot
document.getElementById("modalLotEnabled").addEventListener("change", (e) => {
  document.getElementById("modalLotFields").classList.toggle("hidden", !e.target.checked);
});
document.getElementById("editLotEnabled").addEventListener("change", (e) => {
  document.getElementById("editLotFields").classList.toggle("hidden", !e.target.checked);
});

// Checkbox toggles — Volume Pricing
document.getElementById("modalVolEnabled").addEventListener("change", (e) => {
  document.getElementById("modalVolFields").classList.toggle("hidden", !e.target.checked);
  if (e.target.checked && !document.getElementById("modalVolTiers").children.length) addVolTier("modal");
});
document.getElementById("editVolEnabled").addEventListener("change", (e) => {
  document.getElementById("editVolFields").classList.toggle("hidden", !e.target.checked);
  if (e.target.checked && !document.getElementById("editVolTiers").children.length) addVolTier("edit");
});
document.getElementById("modalAddTier").addEventListener("click", () => addVolTier("modal"));
document.getElementById("editAddTier").addEventListener("click",  () => addVolTier("edit"));



// Refresh
document.getElementById("btnRefresh").addEventListener("click", () => loadProducts());

// ── Init ────────────────────────────────────────────────────────
async function init() {
  await initAdminNav("eBay Listings");
  initFooter();
  await requireAdmin();
  setView(currentView); // sync view toggle buttons on load
  await loadProducts();
  loadPoliciesCache();
  initBulkActions({ callEdge, supabase, loadProducts });
  initSetupPanel({ callEdge });
  initImportPanel({ callEdge, loadProducts });
}

init();

import {
  isEffectiveGroupListing,
  buildImageUrls,
  isComplexHtml,
} from "./utils.js";
import {
  quillToolbar,
  descState,
  resetQuillEditorMount,
  toggleDescMode,
} from "./editor.js";
import { renderImageStrip, showGalleryPicker } from "./images.js";
import { setVolTiers } from "./volPricing.js";
import { buildEditAspectField } from "./aspectHelpers.js";
import { renderEditVariantImageControls } from "./variantPanel.js";
import { refreshEditPreview, refreshEditRef, loadAndRenderPriceRef } from "./modalPreviews.js";
import { fetchAspectsForCategory } from "./taxonomyApi.js";
import { getItemForEdit, getOffersForEdit, getOffersByGroupForEdit } from "./editFetch.js";
import { loadPoliciesCache } from "./policyCache.js";
import {
  isStaleLinkCheck,
  isOutOfStockLinkCheck,
  currentActiveListingId,
} from "./linkCheck.js";
import { callEdge } from "./api.js";

/**
 * editModal.js — Edit modal context factory.
 *
 * Owns all Edit-modal state and handlers: openEdit, Save Changes,
 * AI Auto-Fill, description mode, image picker, aspects, volume
 * pricing, best offer, lot, variant image/qty overrides, and
 * all toggle controls.
 *
 * Shared dependencies injected via factory:
 *   getProducts()         — () => Product[]   page-level product list
 *   loadProducts()        — () => Promise<void>  page-level reload
 *   showStatus()          — (msg, isError?) => void  page-level status bar
 *   getAdRatePct()        — () => number  shared ad rate
 *   supabase              — Supabase client  (store-category DB write in save handler)
 *   reconcileEbayLink     — from createReconcileActions
 *   renderEditLinkWarning — from createReconcileActions
 *   relinkEbayListing     — from createReconcileActions
 *
 * Exports:
 *   createEditModalContext(deps) — factory; returns state accessors + handlers
 *
 * Migration status: E-2 — openEdit() is here; remaining handlers in index.js.
 *   handleEditAiFill(), handleEditSave(), and bindEditListeners()
 *   will be added in phases E-3 and E-4.
 *   syncBack dependency is temporary; removed when all handlers migrate.
 */

/**
 * Creates the Edit modal context — state container, accessor bridge, and (eventually)
 * all Edit handlers.
 *
 * @param {object}   deps
 * @param {Function} deps.getProducts             — () => Product[]
 * @param {Function} deps.loadProducts            — () => Promise<void>
 * @param {Function} deps.showStatus              — (msg, isError?) => void
 * @param {Function} deps.getAdRatePct            — () => number
 * @param {object}   deps.supabase                — Supabase client instance
 * @param {Function} deps.reconcileEbayLink       — (product, full) => Promise<object>
 * @param {Function} deps.renderEditLinkWarning   — (linkCheck) => void
 * @param {Function} deps.relinkEbayListing       — (code) => Promise<void>
 * @param {Function} deps.syncBack                — (state) => void  temp sync-back for E-2/E-3/E-4; removed in E-5
 */
export function createEditModalContext({
  getProducts            = () => [],
  loadProducts           = async () => {},
  showStatus             = () => {},
  getAdRatePct           = () => 0,
  supabase               = null,
  reconcileEbayLink      = async () => ({}),
  renderEditLinkWarning  = () => {},
  relinkEbayListing      = async () => {},
  syncBack               = () => {},
} = {}) {

  // ── Edit-private state ────────────────────────────────────────────────────
  const state = {
    currentProduct:             null,    // the product being edited (was editProduct)
    editQuill:                  null,    // live Quill instance; set by openEdit()
    editImageUrls:              [],      // ordered eBay image URLs for the item
    editVariantImageOverrides:  {},      // { [sku]: string[] } — mutated by variantPanel
    editVariantQtyOverrides:    {},      // { [sku]: number }  — mutated by variantPanel
    editAspects:                [],      // aspect metadata array from fetchAspectsForCategory
    editSalesMetrics:           null,    // sales metrics object from loadAndRenderPriceRef
    editOfferLookupCache:       new Map(), // eBay offer lookup cache; reset each openEdit
  };

  // ── Stored injected dependencies ──────────────────────────────────────────
  const deps = {
    getProducts,
    loadProducts,
    showStatus,
    getAdRatePct,
    supabase,
    reconcileEbayLink,
    renderEditLinkWarning,
    relinkEbayListing,
    syncBack,
  };

  // ── Accessors ─────────────────────────────────────────────────────────────
  function getCurrentProduct()                     { return state.currentProduct; }
  function setCurrentProduct(p)                    { state.currentProduct = p; }

  function getEditQuill()                          { return state.editQuill; }
  function setEditQuill(q)                         { state.editQuill = q; }

  function getEditImageUrls()                      { return state.editImageUrls; }
  function setEditImageUrls(urls)                  { state.editImageUrls = urls; }

  function getEditVariantImageOverrides()          { return state.editVariantImageOverrides; }
  function setEditVariantImageOverrides(map)       { state.editVariantImageOverrides = map; }

  function getEditVariantQtyOverrides()            { return state.editVariantQtyOverrides; }
  function setEditVariantQtyOverrides(map)         { state.editVariantQtyOverrides = map; }

  function getEditAspects()                        { return state.editAspects; }
  function setEditAspects(a)                       { state.editAspects = a; }

  function getEditSalesMetrics()                   { return state.editSalesMetrics; }
  function setEditSalesMetrics(m)                  { state.editSalesMetrics = m; }

  function getEditOfferLookupCache()               { return state.editOfferLookupCache; }
  function setEditOfferLookupCache(c)              { state.editOfferLookupCache = c; }

  /**
   * Resets all Edit-private state to initial values.
   * Called by the Edit modal close handler.
   */
  function resetEditState() {
    state.currentProduct            = null;
    state.editQuill                 = null;
    state.editImageUrls             = [];
    state.editVariantImageOverrides = {};
    state.editVariantQtyOverrides   = {};
    state.editAspects               = [];
    state.editSalesMetrics          = null;
    state.editOfferLookupCache      = new Map();
  }

  // ── openEdit ──────────────────────────────────────────────────────────────
  /**
   * Opens the Edit modal for a product and hydrates all fields.
   *
   * @param {string} code — product code to open
   */
  async function openEdit(code) {
    state.currentProduct = deps.getProducts().find(pr => pr.code === code);
    if (!state.currentProduct) return;

    const p              = state.currentProduct;   // local alias; object mutations visible via state.currentProduct
    const isGroupListing = isEffectiveGroupListing(p);

    document.getElementById("editModal").classList.remove("hidden");
    document.getElementById("editLoading").classList.remove("hidden");
    document.getElementById("editForm").classList.add("hidden");
    document.getElementById("editStatus").textContent = "";
    deps.renderEditLinkWarning(null);
    document.getElementById("editPriceQtyGrid").classList.toggle("grid-cols-1", isGroupListing);
    document.getElementById("editPriceQtyGrid").classList.toggle("grid-cols-2", !isGroupListing);
    document.getElementById("editQuantityField").classList.toggle("hidden", isGroupListing);
    document.getElementById("editQuantity").disabled = isGroupListing;
    document.getElementById("editVariantQtyNote").classList.toggle("hidden", !isGroupListing);
    state.editOfferLookupCache      = new Map();
    state.editVariantImageOverrides = {};
    state.editVariantQtyOverrides   = {};
    p._offerMappingsUnresolved      = false;
    p._offerMappingFailureMessage    = "";
    document.getElementById("editVariantImagesSection").classList.add("hidden");
    document.getElementById("editVariantImagesList").innerHTML = "";

    document.getElementById("editProductName").textContent = p.name;
    document.getElementById("editProductCode").textContent = p.code + (isGroupListing ? " (Multi-Variant)" : "");

    let variantFetchSummary = null;

    const ebayLink = document.getElementById("editEbayLink");
    if (p.ebay_listing_id) {
      ebayLink.href        = `https://www.ebay.com/itm/${p.ebay_listing_id}`;
      ebayLink.textContent = "View on eBay \u2197";
      ebayLink.classList.remove("hidden");
    } else {
      ebayLink.classList.add("hidden");
    }

    try {
      try {
        const linkCheck = await deps.reconcileEbayLink(p, false);
        deps.renderEditLinkWarning(linkCheck);
        if (isOutOfStockLinkCheck(linkCheck)) {
          ebayLink.textContent = "View sold-out listing \u2197";
          document.getElementById("editStatus").textContent = "\u26a0\ufe0f Sold out on eBay \u2014 set quantity above 0 and save to restock this listing.";
        } else if (isStaleLinkCheck(linkCheck)) {
          const activeId = currentActiveListingId(linkCheck);
          if (activeId) {
            ebayLink.href        = `https://www.ebay.com/itm/${activeId}`;
            ebayLink.textContent = "View active match \u2197";
            ebayLink.classList.remove("hidden");
          } else {
            ebayLink.classList.add("hidden");
          }
          document.getElementById("editStatus").textContent = "\u26a0\ufe0f Local eBay link may be stale. Refresh/relink before editing.";
        }
      } catch (linkErr) {
        console.warn("Edit link reconciliation failed:", linkErr);
        document.getElementById("editStatus").textContent = "\u26a0\ufe0f Could not verify eBay link freshness. Save will re-check before writing.";
      }

      let product = {};
      let item    = {};
      let offer   = {};

      if (isGroupListing) {
        const groupResult = await callEdge("ebay-manage-listing", {
          action:                "get_item_group",
          inventoryItemGroupKey: p.ebay_item_group_key,
        });
        if (!groupResult.success) throw new Error(groupResult.error || "Failed to fetch item group");

        const group = groupResult.itemGroup;
        product = {
          title:       group.title       || "",
          description: group.description || "",
          imageUrls:   group.imageUrls   || [],
          aspects:     group.aspects     || {},
        };
        p._groupData = group;
        p._isGroup   = true;

        const firstVariantSku = group.variantSKUs?.[0];
        const groupOffersResult = p.ebay_item_group_key
          ? await getOffersByGroupForEdit(state.editOfferLookupCache, p.ebay_item_group_key, group.variantSKUs || [], "open")
          : { success: false, offers: [], error: "Missing local inventory item group key" };
        if (!groupOffersResult.success) {
          p._offerMappingsUnresolved = true;
          p._offerMappingFailureMessage = "This variant listing could not be matched to active eBay offers. Refresh/relink this listing before saving eBay edits.";
        } else {
          const offerSkus = new Set((groupOffersResult.offers || []).map(o => o?.sku).filter(Boolean));
          const missingOfferSkus = (group.variantSKUs || []).filter(sku => !offerSkus.has(sku));
          if (missingOfferSkus.length) {
            p._offerMappingsUnresolved = true;
            p._offerMappingFailureMessage = `This variant listing is missing active eBay offers for ${missingOfferSkus.join(", ")}. Refresh/relink this listing before saving eBay edits.`;
          }
        }
        if (firstVariantSku) {
          const variantItemResult = await getItemForEdit(firstVariantSku);
          offer = (state.editOfferLookupCache.get(firstVariantSku)?.offers || [])[0] || (groupOffersResult.offers || [])[0] || {};
          if (variantItemResult.success) item = variantItemResult.item;
        }
        if (!offer.pricingSummary?.price?.value && p.ebay_price_cents) {
          offer.pricingSummary = { price: { value: (p.ebay_price_cents / 100).toFixed(2) } };
        }
      } else {
        const sku = p.ebay_sku || p.code;
        const [itemResult, offerResult] = await Promise.all([
          callEdge("ebay-manage-listing", { action: "get_item", sku }),
          p.ebay_offer_id
            ? getOffersForEdit(state.editOfferLookupCache, sku, "open")
            : Promise.resolve({ success: true, offers: [] }),
        ]);
        if (!itemResult.success) throw new Error(itemResult.error || "Failed to fetch item");
        item    = itemResult.item;
        product = item.product || {};
        p._isGroup = false;
        offer   = (offerResult.offers || []).find(o => o.offerId === p.ebay_offer_id) || {};
      }

      // Pre-fill fields
      document.getElementById("editTitle").value     = product.title || p.name;
      document.getElementById("editCondition").value = item.condition || "NEW";
      document.getElementById("editQuantity").value  = item.availability?.shipToLocationAvailability?.quantity ?? 1;

      const existingLotSize = item.lotSize || 0;
      document.getElementById("editLotEnabled").checked = existingLotSize > 1;
      document.getElementById("editLotFields").classList.toggle("hidden", existingLotSize <= 1);
      document.getElementById("editLotSize").value = existingLotSize > 1 ? existingLotSize : 2;

      // Init Quill for edit (destroy previous)
      resetQuillEditorMount("editDescriptionEditor");
      const editEditorEl  = document.getElementById("editDescriptionEditor");
      state.editQuill     = new Quill(editEditorEl, { theme: "snow", modules: { toolbar: quillToolbar } });

      const existingDesc = product.description || "";
      document.getElementById("editDescriptionPreview").classList.add("hidden");
      document.getElementById("btnEditPreview").classList.remove("active");
      if (existingDesc && isComplexHtml(existingDesc)) {
        descState.editMode = "html";
        document.getElementById("editDescriptionHtml").value = existingDesc;
        document.getElementById("editDescriptionHtml").classList.remove("hidden");
        editEditorEl.style.display = "none";
        const tb = editEditorEl.previousElementSibling;
        if (tb?.classList?.contains("ql-toolbar")) tb.style.display = "none";
        document.getElementById("btnEditVisual").classList.remove("active");
        document.getElementById("btnEditHtml").classList.add("active");
      } else {
        if (existingDesc) state.editQuill.root.innerHTML = existingDesc;
        descState.editMode = "visual";
        document.getElementById("editDescriptionHtml").value = "";
        document.getElementById("editDescriptionHtml").classList.add("hidden");
        document.getElementById("btnEditVisual").classList.add("active");
        document.getElementById("btnEditHtml").classList.remove("active");
      }

      // Build edit image strip
      const ebayImages    = product.imageUrls || [];
      state.editImageUrls = ebayImages.length ? [...ebayImages] : buildImageUrls(p);
      renderImageStrip("editImageStrip", state.editImageUrls, state.editImageUrls);

      if (isGroupListing) {
        variantFetchSummary = await renderEditVariantImageControls(p, p._groupData, {
          editImageUrls:             state.editImageUrls,
          editVariantImageOverrides: state.editVariantImageOverrides,
          editVariantQtyOverrides:   state.editVariantQtyOverrides,
        });
      }

      const offerPrice = offer.pricingSummary?.price?.value;
      document.getElementById("editPrice").value = offerPrice
        ? parseFloat(offerPrice).toFixed(2)
        : p.ebay_price_cents
          ? (p.ebay_price_cents / 100).toFixed(2)
          : Number(p.price).toFixed(2);

      const pkg = item.packageWeightAndSize || {};
      if (pkg.weight) {
        document.getElementById("editWeightOz").value = pkg.weight.value || "";
      } else if (p.weight_g) {
        document.getElementById("editWeightOz").value = (p.weight_g / 28.3495).toFixed(1);
      }
      if (pkg.dimensions) {
        document.getElementById("editDimL").value = pkg.dimensions.length || "";
        document.getElementById("editDimW").value = pkg.dimensions.width  || "";
        document.getElementById("editDimH").value = pkg.dimensions.height || "";
      }

      // Policy dropdowns
      await loadPoliciesCache();
      const lp = offer.listingPolicies || {};
      if (lp.fulfillmentPolicyId) document.getElementById("editFulfillmentPolicy").value = lp.fulfillmentPolicyId;
      if (lp.returnPolicyId)      document.getElementById("editReturnPolicy").value      = lp.returnPolicyId;
      if (lp.paymentPolicyId)     document.getElementById("editPaymentPolicy").value     = lp.paymentPolicyId;

      // Best Offer — not permitted on group (variant) listings
      const bot = lp.bestOfferTerms || {};
      if (isGroupListing) {
        document.getElementById("editBestOffer").checked = false;
        document.getElementById("editBestOfferFields").classList.add("hidden");
        document.getElementById("editBestOffer").closest("div").classList.add("hidden");
      } else {
        document.getElementById("editBestOffer").closest("div").classList.remove("hidden");
        document.getElementById("editBestOffer").checked = !!bot.bestOfferEnabled;
        document.getElementById("editBestOfferFields").classList.toggle("hidden", !bot.bestOfferEnabled);
        document.getElementById("editAutoAccept").value  = bot.autoAcceptPrice?.value  || "";
        document.getElementById("editAutoDecline").value = bot.autoDeclinePrice?.value || "";
      }

      // Store Category — local DB first, eBay GET as fallback
      const storeCats = offer.storeCategoryNames || [];
      document.getElementById("editStoreCategory").value = p.ebay_store_category || storeCats[0] || "";

      // Volume Pricing
      const volPromoId = p.ebay_volume_promo_id;
      if (volPromoId) {
        try {
          const promoResult = await callEdge("ebay-manage-listing", { action: "get_volume_discount", promotionId: volPromoId });
          if (promoResult.success && promoResult.promotion?.discountRules?.length) {
            document.getElementById("editVolEnabled").checked = true;
            document.getElementById("editVolFields").classList.remove("hidden");
            setVolTiers("edit", promoResult.promotion.discountRules);
            p._volPromoId = volPromoId;
          } else {
            document.getElementById("editVolEnabled").checked = false;
            document.getElementById("editVolFields").classList.add("hidden");
            document.getElementById("editVolTiers").innerHTML = "";
          }
        } catch (ve) {
          console.warn("Volume pricing fetch failed:", ve);
          document.getElementById("editVolEnabled").checked = false;
          document.getElementById("editVolFields").classList.add("hidden");
          document.getElementById("editVolTiers").innerHTML = "";
        }
      } else {
        document.getElementById("editVolEnabled").checked = false;
        document.getElementById("editVolFields").classList.add("hidden");
        document.getElementById("editVolTiers").innerHTML = "";
      }

      // Aspects
      const categoryId      = p.ebay_category_id || offer.categoryId || item.categoryId || "";
      document.getElementById("editCategoryId").value = categoryId || "";
      const existingAspects = product.aspects || {};
      const reqContainer    = document.getElementById("editAspectsRequired");
      const optContainer    = document.getElementById("editAspectsOptional");
      reqContainer.innerHTML = "";
      optContainer.innerHTML = "";
      state.editAspects = [];

      if (categoryId) {
        const aspectResult = await fetchAspectsForCategory(categoryId);
        if (aspectResult.success && aspectResult.aspects?.length) {
          state.editAspects    = aspectResult.aspects;
          const required = aspectResult.aspects.filter(a => a.required);
          const optional = aspectResult.aspects.filter(a => !a.required).slice(0, 15);

          const defaults = {};
          for (const [key, val] of Object.entries(existingAspects)) {
            defaults[key] = Array.isArray(val) ? val[0] : val;
          }
          if (!defaults.Brand)      defaults.Brand      = "Unbranded";
          if (!defaults.Type)       defaults.Type       = "Accessory";
          if (!defaults.Department) defaults.Department = "Unisex Adults";
          if (isGroupListing && !defaults.Color) {
            const colorSpec = p._groupData?.variesBy?.specifications?.find(s => s?.name === "Color");
            if (colorSpec?.values?.length) defaults.Color = colorSpec.values.join(", ");
          }

          required.forEach(a => reqContainer.appendChild(buildEditAspectField(a, defaults, true)));
          optional.forEach(a => optContainer.appendChild(buildEditAspectField(a, defaults, false)));
        }
      } else if (!p.ebay_offer_id) {
        document.getElementById("editStatus").textContent = "\u26a0\ufe0f This draft has no category/offer yet. Use Resume Push from the list to choose a category and create the offer.";
      }

      document.getElementById("editLoading").classList.add("hidden");
      document.getElementById("editForm").classList.remove("hidden");
      const offerLookupFailures = [...state.editOfferLookupCache.values()].filter(r => !r.success);
      if (isOutOfStockLinkCheck(p._linkCheck)) {
        document.getElementById("editStatus").textContent = "\u26a0\ufe0f Sold out on eBay \u2014 set quantity above 0 and save to restock this listing.";
      } else if (isStaleLinkCheck(p._linkCheck)) {
        document.getElementById("editStatus").textContent = `\u26a0\ufe0f ${p._linkCheck?.message || "Local eBay link may be stale. Refresh/relink before editing."}`;
      } else if (p._offerMappingsUnresolved) {
        document.getElementById("editStatus").textContent = `\u26a0\ufe0f ${p._offerMappingFailureMessage || "This variant listing could not be matched to active eBay offers. Refresh/relink this listing before saving eBay edits."}`;
      } else if (offerLookupFailures.length) {
        document.getElementById("editStatus").textContent = "\u26a0\ufe0f eBay offer details could not be loaded for part of this listing. Refresh/relink this listing before saving eBay edits.";
      } else if (variantFetchSummary?.failures?.length) {
        document.getElementById("editStatus").textContent = `\u26a0\ufe0f ${variantFetchSummary.failures.length} variant eBay detail lookup(s) failed. Fallback image/qty controls are shown where available; you can still edit and save.`;
      }

      document.getElementById("editAdRate").value = String(deps.getAdRatePct());
      refreshEditPreview(p);
      state.editSalesMetrics = null;
      loadAndRenderPriceRef("editPriceRef", p, "editPrice",
        m => { state.editSalesMetrics = m; deps.syncBack(state); },
        pr => state.currentProduct?.code === pr.code);

      deps.syncBack(state);
    } catch (e) {
      document.getElementById("editLoading").textContent = "\u274c " + e.message;
      deps.syncBack(state);
    }
  }

  // ── Remaining handlers ────────────────────────────────────────────────────
  // ── Base Edit listeners ─────────────────────────────────────────────────────────────
  // Close, relink, preview/reference refresh, add-image, description-mode tabs.
  // E-3 extraction: wired in index.js before; now own by the factory.
  // handleEditAiFill() and handleEditSave() remain in index.js for now (E-4).
  function bindEditBaseListeners() {
    // Close modal
    document.getElementById("btnCloseEdit").addEventListener("click", () => {
      document.getElementById("editModal").classList.add("hidden");
      document.getElementById("editImagePicker").classList.add("hidden");
      state.currentProduct = null;
      deps.syncBack(state);
    });

    // Relink button
    document.getElementById("btnEditRelink").addEventListener("click", async () => {
      if (!state.currentProduct) return;
      await deps.relinkEbayListing(state.currentProduct.code);
    });

    // Profit preview + price reference live update
    document.getElementById("editPrice").addEventListener("input", () => refreshEditPreview(state.currentProduct));
    document.getElementById("editPrice").addEventListener("input", () => refreshEditRef(state.currentProduct, state.editSalesMetrics));
    document.getElementById("editWeightOz").addEventListener("input", () => refreshEditPreview(state.currentProduct));
    document.getElementById("editAdRate").addEventListener("change", () => {
      refreshEditPreview(state.currentProduct);
      refreshEditRef(state.currentProduct, state.editSalesMetrics);
    });

    // Add image
    document.getElementById("btnAddImgEdit").addEventListener("click", () => {
      if (!state.currentProduct) return;
      showGalleryPicker("editImagePicker", "editImageStrip", state.editImageUrls, state.currentProduct);
    });

    // Description mode tabs
    document.getElementById("btnEditVisual").addEventListener("click", () => {
      descState.editMode = "visual";
      toggleDescMode("visual", "edit", state.editQuill);
    });
    document.getElementById("btnEditHtml").addEventListener("click", () => {
      descState.editMode = "html";
      toggleDescMode("html", "edit", state.editQuill);
    });
    document.getElementById("btnEditPreview").addEventListener("click", () => {
      toggleDescMode("preview", "edit", state.editQuill);
    });
  }

  // handleEditAiFill() and handleEditSave() will be added in phase E-4.
  // They remain in index.js for now.

  return {
    openEdit,
    bindEditBaseListeners,
    getCurrentProduct,        setCurrentProduct,
    getEditQuill,             setEditQuill,
    getEditImageUrls,         setEditImageUrls,
    getEditVariantImageOverrides, setEditVariantImageOverrides,
    getEditVariantQtyOverrides,   setEditVariantQtyOverrides,
    getEditAspects,           setEditAspects,
    getEditSalesMetrics,      setEditSalesMetrics,
    getEditOfferLookupCache,  setEditOfferLookupCache,
    resetEditState,
  };
}

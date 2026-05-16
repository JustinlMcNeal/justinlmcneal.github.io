/**
 * pushModal.js â€” Push modal context factory.
 *
 * Owns all Push-modal state and handlers: openPush, Create Item,
 * Create Offer, Publish, AI fill, category search, description mode,
 * close, live-update previews, and toggle controls.
 *
 * Shared dependencies injected via factory:
 *   getProducts()   â€” page-level product list
 *   loadProducts()  â€” page-level reload
 *   showStatus()    â€” page-level status bar
 *   getAdRatePct()  â€” shared ad rate (also used by Edit modal)
 *
 * Exports:
 *   createPushModalContext(deps) â€” factory; returns state + accessors + handlers
 */

import {
  buildImageUrls,
  enableBtn,
  isComplexHtml,
  sanitizeForEbay,
  wrapDescription,
  buildPackageWeightAndSize,
  getSelectedPolicies,
  getBestOfferTerms,
  addAiBadge,
  esc,
} from "./utils.js";
import {
  quillToolbar,
  descState,
  resetQuillEditorMount,
  toggleDescMode,
  getDescriptionHtml,
} from "./editor.js";
import { renderImageStrip, showGalleryPicker } from "./images.js";
import { renderVariantPanel, getCheckedVariants } from "./variantPanel.js";
import { collectAspects, validateRequiredAspects, buildAspectField } from "./aspectHelpers.js";
import { refreshPushPreview, refreshPushRef, loadAndRenderPriceRef } from "./modalPreviews.js";
import { callEdge } from "./api.js";
import { addVolTier, getVolTiers } from "./volPricing.js";
import { fetchCategorySuggestions } from "./taxonomyApi.js";
import { fetchAndRenderAspects } from "./aspectFlow.js";

/**
 * Creates the Push modal context â€” state container, accessor bridge, and all Push handlers.
 *
 * @param {object}   deps
 * @param {Function} deps.getProducts             â€” () => Product[]
 * @param {Function} deps.loadProducts            â€” () => Promise<void>
 * @param {Function} deps.showStatus              â€” (msg, isError?) => void
 * @param {Function} deps.getAdRatePct            â€” () => number
 */
export function createPushModalContext({
  getProducts  = () => [],
  loadProducts = async () => {},
  showStatus   = () => {},
  getAdRatePct = () => 0,
} = {}) {
  // â”€â”€ Push-private state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const state = {
    currentProduct:    null,
    currentAspects:    [],
    pushImageUrls:     [],
    pushVariants:      [],
    isVariantListing:  false,
    pushSalesMetrics:  null,
    pushQuill:         null,   // live Quill instance; set by openPush()
  };

  // â”€â”€ Stored injected dependencies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const deps = { getProducts, loadProducts, showStatus, getAdRatePct };

  // â”€â”€ Accessors â”€â”€â”€â”€â”€â”€
  function getCurrentProduct()   { return state.currentProduct; }
  function setCurrentProduct(p)      { state.currentProduct = p; }

  function getCurrentAspects()   { return state.currentAspects; }
  function setCurrentAspects(a)      { state.currentAspects = a; }

  function getPushImageUrls()        { return state.pushImageUrls; }
  function setPushImageUrls(urls)    { state.pushImageUrls = urls; }

  function getPushVariants()         { return state.pushVariants; }
  function setPushVariants(variants) { state.pushVariants = variants; }

  function getIsVariantListing()    { return state.isVariantListing; }
  function setIsVariantListing(v)    { state.isVariantListing = v; }

  function getPushSalesMetrics()    { return state.pushSalesMetrics; }
  function setPushSalesMetrics(m)    { state.pushSalesMetrics = m; }

  function getPushQuill()           { return state.pushQuill; }
  function setPushQuill(q)           { state.pushQuill = q; }

  /**
   * Resets all Push-private state to initial values.
   * Called by the Push modal close handler.
   */
  function resetPushState() {
    setCurrentProduct(null);
    setCurrentAspects([]);
    setPushImageUrls([]);
    setPushVariants([]);
    setIsVariantListing(false);
    setPushSalesMetrics(null);
    // pushQuill is a DOM instance â€” not reset here; openPush re-creates it
  }

  // â”€â”€ openPush â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Opens the Push modal for a product and hydrates all fields.

   *
   * @param {string} code â€” product code to open
   */
  async function openPush(code) {
    const product = deps.getProducts().find(p => p.code === code);
    if (!product) return;
    setCurrentProduct(product);

    document.getElementById("modalProductName").textContent = product.name;
    document.getElementById("modalProductCode").textContent = product.code;
    document.getElementById("modalSku").value       = product.ebay_sku || product.code;
    document.getElementById("modalTitle").value     = product.name;
    document.getElementById("modalPrice").value     = product.price ? Number(product.price).toFixed(2) : "";
    document.getElementById("modalQuantity").value  = "1";
    document.getElementById("modalCondition").value = "NEW";
    document.getElementById("modalLotEnabled").checked = false;
    document.getElementById("modalLotFields").classList.add("hidden");
    document.getElementById("modalLotSize").value   = "2";
    document.getElementById("modalVolEnabled").checked = false;
    document.getElementById("modalVolFields").classList.add("hidden");
    document.getElementById("modalVolTiers").innerHTML = "";
    document.getElementById("modalCatSearch").value = product.name;
    document.getElementById("modalCatSelect").classList.add("hidden");
    document.getElementById("modalCatSelected").classList.add("hidden");
    document.getElementById("modalStatus").textContent = "";

    // Init Quill (destroy previous if exists)
    resetQuillEditorMount("modalDescriptionEditor");
    const editorEl  = document.getElementById("modalDescriptionEditor");
    // eslint-disable-next-line no-undef
    const quill     = new Quill(editorEl, { theme: "snow", modules: { toolbar: quillToolbar } });
    setPushQuill(quill);

    // Reset description mode
    descState.pushMode = "visual";
    document.getElementById("modalDescriptionHtml").value = "";
    document.getElementById("modalDescriptionHtml").classList.add("hidden");
    document.getElementById("modalDescriptionPreview").classList.add("hidden");
    document.getElementById("btnPushVisual").classList.add("active");
    document.getElementById("btnPushHtml").classList.remove("active");
    document.getElementById("btnPushPreview").classList.remove("active");

    // Build image strip
    const imageUrls = buildImageUrls(product);
    setPushImageUrls(imageUrls);
    renderImageStrip("modalImageStrip", state.pushImageUrls, state.pushImageUrls);
    document.getElementById("modalImagePicker").classList.add("hidden");

    // Reset aspects
    setCurrentAspects([]);
    document.getElementById("aspectsSection").classList.add("hidden");
    document.getElementById("aspectsRequired").innerHTML = "";
    document.getElementById("aspectsOptional").innerHTML = "";

    // Auto-fill weight (grams â†’ ounces)
    document.getElementById("modalWeightOz").value =
      product.weight_g ? (product.weight_g / 28.3495).toFixed(1) : "4";

    // Detect variants
    const activeVariants = (product.product_variants || []).filter(v => v.is_active);
    const isVariant      = activeVariants.length > 1;
    setPushVariants(isVariant ? activeVariants : []);
    setIsVariantListing(isVariant);

    if (isVariant) {
      document.getElementById("variantPanel").classList.remove("hidden");
      renderVariantPanel(activeVariants, product.code, product);
      document.getElementById("btnCreateItem").textContent  = "1. Create Items";
      document.getElementById("btnCreateOffer").textContent = "2. Create Group + Offer";
      // eBay does not allow Best Offer on group (variant) listings
      document.getElementById("modalBestOffer").checked = false;
      document.getElementById("modalBestOfferFields").classList.add("hidden");
      document.getElementById("modalBestOffer").closest("div").classList.add("hidden");
    } else {
      document.getElementById("variantPanel").classList.add("hidden");
      document.getElementById("variantProgress").classList.add("hidden");
      document.getElementById("btnCreateItem").textContent  = "1. Create Item";
      document.getElementById("btnCreateOffer").textContent = "2. Create Offer";
      document.getElementById("modalBestOffer").closest("div").classList.remove("hidden");
    }

    enableBtn("btnCreateItem",  true);
    enableBtn("btnCreateOffer", false);
    enableBtn("btnPublish",     false);

    document.getElementById("pushModal").classList.remove("hidden");

    // â”€â”€ Resume draft: pre-load existing eBay item data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const isResumableDraft = product.ebay_status === "draft"
      && product.ebay_sku
      && !product.ebay_offer_id;

    if (isResumableDraft) {
      deps.showStatus("Loading your previous draft from eBayâ€¦");
      try {
        const itemResult = await callEdge("ebay-manage-listing", { action: "get_item", sku: product.ebay_sku });
        if (itemResult.success && itemResult.item) {
          const ebayItem = itemResult.item;
          const prod     = ebayItem.product || {};

          if (prod.title) document.getElementById("modalTitle").value = prod.title;

          if (prod.description) {
            if (isComplexHtml(prod.description)) {
              document.getElementById("modalDescriptionHtml").value = prod.description;
              descState.pushMode = "html";
              toggleDescMode("html", "modal", state.pushQuill);
            } else {
              state.pushQuill.root.innerHTML = prod.description;
            }
          }

          if (ebayItem.condition) document.getElementById("modalCondition").value = ebayItem.condition;
          const qty = ebayItem.availability?.shipToLocationAvailability?.quantity;
          if (qty !== undefined) document.getElementById("modalQuantity").value = qty;

          const pkg = ebayItem.packageWeightAndSize || {};
          if (pkg.weight?.value) document.getElementById("modalWeightOz").value = pkg.weight.value;

          if (prod.imageUrls?.length) {
            setPushImageUrls([...prod.imageUrls]);
            renderImageStrip("modalImageStrip", state.pushImageUrls, state.pushImageUrls);
          }

          const btn1 = document.getElementById("btnCreateItem");
          btn1.textContent = "âœ“ Item Created";
          btn1.disabled    = true;
          btn1.classList.add("border-gray-300", "bg-gray-100", "text-gray-400");
          btn1.classList.remove("border-black", "bg-black", "text-white", "hover:bg-kkpink", "hover:border-kkpink", "hover:text-black");
          enableBtn("btnCreateOffer", true);

          deps.showStatus("ðŸ“‹ Draft resumed â€” your previous data has been loaded. Continue from Step 2.");
        } else {
          deps.showStatus("Could not load previous draft â€” starting from Step 1.", true);
        }
      } catch (e) {
        console.warn("Resume draft pre-load failed:", e.message);
        deps.showStatus("Could not load previous draft â€” starting from Step 1.", true);
      }
    }

    document.getElementById("modalAdRate").value = String(deps.getAdRatePct());
    refreshPushPreview(state.currentProduct);
    setPushSalesMetrics(null);
    loadAndRenderPriceRef("modalPriceRef", state.currentProduct, "modalPrice",
      m => { setPushSalesMetrics(m); },
      p => state.currentProduct?.code === p.code);
  }

  // â”€â”€ Create Item handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Handles the "1. Create Item" / "1. Create Items" button click.
   */
  async function handleCreateItem() {
    const btn        = document.getElementById("btnCreateItem");
    const status     = document.getElementById("modalStatus");
    const progressEl = document.getElementById("variantProgress");
    btn.disabled = true; btn.textContent = "Creating...";

    const sku         = document.getElementById("modalSku").value.trim();
    const title       = document.getElementById("modalTitle").value.trim();
    const rawHtml     = getDescriptionHtml("modal", state.pushQuill);
    const description = descState.pushMode === "html" ? sanitizeForEbay(rawHtml) : wrapDescription(title, rawHtml);
    const condition   = document.getElementById("modalCondition").value;
    const quantity    = parseInt(document.getElementById("modalQuantity").value) || 1;
    const lotSize     = document.getElementById("modalLotEnabled").checked ? (parseInt(document.getElementById("modalLotSize").value) || 0) : 0;

    if (!sku || !title) {
      status.textContent = "\u274C SKU and title required";
      btn.disabled = false; btn.textContent = state.isVariantListing ? "1. Create Items" : "1. Create Item";
      return;
    }

    const missingAspects = validateRequiredAspects();
    if (missingAspects.length) {
      status.textContent = `\u274C Required item specifics missing: ${missingAspects.join(", ")}`;
      btn.disabled = false; btn.textContent = state.isVariantListing ? "1. Create Items" : "1. Create Item";
      return;
    }

    const aspects   = collectAspects();
    const imageUrls = [...state.pushImageUrls];

    try {
      if (state.isVariantListing) {
        const checked = getCheckedVariants(state.pushVariants, state.currentProduct.code);
        if (!checked.length) {
          status.textContent = "\u274C Select at least one variant";
          btn.disabled = false; btn.textContent = "1. Create Items";
          return;
        }

        const generatedSkus = checked.map(v => v.sku);
        const uniqueSkus    = new Set(generatedSkus);
        if (uniqueSkus.size !== generatedSkus.length) {
          const dupes = [...new Set(generatedSkus.filter((s, i) => generatedSkus.indexOf(s) !== i))];
          status.textContent = `\u274C SKU collision: ${dupes.join(", ")} \u2014 rename variant options so the first 6 letters/digits are unique`;
          btn.disabled = false; btn.textContent = "1. Create Items";
          return;
        }

        progressEl.classList.remove("hidden");
        let created       = 0;
        const errors      = [];
        const createdSkus = [];
        // Include all checked variants â€” even qty=0 (out of stock).
        // They'll be created on eBay with qty 0 and can be restocked via Edit later.
        const validVariants = checked;
        const hasAnyStock   = checked.some(v => v.quantity > 0);

        if (!validVariants.length) {
          status.textContent = "\u274C Select at least one variant";
          btn.disabled = false; btn.textContent = "1. Create Items";
          return;
        }
        if (!hasAnyStock) {
          status.textContent = "\u274C At least one variant must have quantity > 0 to publish";
          btn.disabled = false; btn.textContent = "1. Create Items";
          return;
        }

        for (const v of validVariants) {
          progressEl.textContent = `Creating ${v.option_value} (${v.sku})... (${created + 1}/${validVariants.length})`;
          const variantAspects = { ...aspects, Color: [v.option_value] };
          const variantImages  = [...new Set((v.variant_image_urls || []).filter(Boolean))];

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

        state.currentProduct._createdVariantSKUs = createdSkus;

        if (created === validVariants.length && !errors.length) {
          status.textContent     = `\u2705 ${created} variant items created \u2014 now create group + offer`;
          progressEl.textContent = `All ${created} items created \u2713`;
          enableBtn("btnCreateItem",  false);
          enableBtn("btnCreateOffer", true);
        } else if (created > 0) {
          status.textContent = `\u26A0\uFE0F ${created}/${validVariants.length} created. Errors: ${errors.join("; ")}. You can still proceed.`;
          enableBtn("btnCreateItem",  false);
          enableBtn("btnCreateOffer", true);
        } else {
          status.textContent = `\u274C No items created. Errors: ${errors.join("; ")}`;
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
          status.textContent = "\u2705 Inventory item created \u2014 now create an offer";
          enableBtn("btnCreateItem",  false);
          enableBtn("btnCreateOffer", true);
        } else {
          status.textContent = "\u274C " + (result.error || "Create failed");
        }
      }
    } catch (e) {
      status.textContent = "\u274C Error: " + e.message;
    } finally {
      btn.disabled    = false;
      btn.textContent = state.isVariantListing ? "1. Create Items" : "1. Create Item";
    }
  }

  /**
   * Wire the Create Item button listener. Call once during page init.
   */
  function bindCreateItemListener() {
    document.getElementById("btnCreateItem").addEventListener("click", handleCreateItem);
  }

  // ── Named Push handlers ──────────────────────────────────────────────────
  // Extracted from bindRemainingPushListeners for readability; behavior unchanged.

  async function handleAiFill() {
    if (!state.currentProduct) return;
    const btn      = document.getElementById("btnAiFill");
    const statusEl = document.getElementById("aiFillStatus");
    btn.disabled   = true;
    btn.innerHTML  = '<span class="animate-pulse">\u2728 Generating...</span>';
    statusEl.textContent = "Analyzing product images and generating listing...";
    statusEl.classList.remove("hidden");

    try {
      const existingAspects = state.currentAspects.map(a => a.name);
      let categoryName = document.getElementById("modalStoreCategory")?.value || "";
      if (!categoryName) {
        const catMap = { headwear: "Headwear", jewelry: "Jewelry", bags: "Bags", accessories: "Accessories", plushies: "Plushies", lego: "Lego" };
        for (const [key, val] of Object.entries(catMap)) {
          if (state.currentProduct.name?.toLowerCase().includes(key) || state.currentProduct.code?.toLowerCase().startsWith(key.substring(0, 2).toUpperCase())) {
            categoryName = val; break;
          }
        }
      }

      const result = await callEdge("ebay-ai-autofill", {
        productName: state.currentProduct.name,
        productCode: state.currentProduct.code,
        category:    categoryName,
        price:       state.currentProduct.price ? Number(state.currentProduct.price) : undefined,
        imageUrls:   state.pushImageUrls.slice(0, 4),
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
        toggleDescMode("html", "modal", state.pushQuill);
        addAiBadge("modalDescriptionHtml", ai.description_html.source || "generated");
      }
      if (ai.item_specifics?.length && state.currentAspects.length) {
        for (const spec of ai.item_specifics) {
          const input = document.querySelector(`[data-aspect="${spec.name}"]`);
          if (input && spec.value) {
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
        statusEl.innerHTML = "\u2705 AI filled fields. Notes:<br>" + notes.map(n => `\u2022 ${esc(n)}`).join("<br>");
        statusEl.className = "text-[10px] text-amber-600 text-center";
      } else {
        statusEl.textContent = "\u2705 AI auto-fill complete \u2014 review fields before proceeding.";
        statusEl.className   = "text-[10px] text-green-600 text-center";
      }
    } catch (e) {
      statusEl.textContent = "AI fill error: " + e.message;
      statusEl.className   = "text-[10px] text-red-500 text-center";
    } finally {
      btn.disabled  = false;
      btn.innerHTML = "<span>\u2728</span> AI Auto-Fill";
    }
  
  }

  async function handleCreateOffer() {
    const btn        = document.getElementById("btnCreateOffer");
    const status     = document.getElementById("modalStatus");
    const progressEl = document.getElementById("variantProgress");
    btn.disabled = true; btn.textContent = "Creating...";

    const sku        = document.getElementById("modalSku").value.trim();
    const categoryId = document.getElementById("modalCatSelect")?.value;
    const price      = parseFloat(document.getElementById("modalPrice").value) || 0;
    const quantity   = parseInt(document.getElementById("modalQuantity").value) || 1;

    if (!categoryId || categoryId === "No categories found") {
      status.textContent = "\u274C Select a category first";
      btn.disabled = false; btn.textContent = state.isVariantListing ? "2. Create Group + Offer" : "2. Create Offer";
      return;
    }

    try {
      const checked             = getCheckedVariants(state.pushVariants, state.currentProduct.code);
      // Always use all active checked SKUs — some may already exist on eBay from a prior run,
      // and create_group_offer handles 25002 (already exists) gracefully.
      const publishableVariants = checked.filter(v => v.quantity > 0);
      const allActiveSkus       = publishableVariants.map(v => v.sku);

      if (state.isVariantListing && allActiveSkus.length < 2) {
        if (allActiveSkus.length === 0) {
          status.textContent = "\u274C No valid items to create an offer for \u2014 check quantities";
          btn.disabled = false; btn.textContent = "2. Create Offer";
          return;
        }
        const variantItem = publishableVariants.find(v => v.sku === allActiveSkus[0]) || publishableVariants[0];
        const vSku        = variantItem.sku;
        const vQty        = variantItem.quantity;
        const storeCat    = document.getElementById("modalStoreCategory").value;
        const result      = await callEdge("ebay-manage-listing", {
          action:             "create_offer",
          sku:                vSku,
          categoryId,
          priceCents:         Math.round(price * 100),
          quantity:           vQty,
          policies:           getSelectedPolicies("modal"),
          bestOfferTerms:     getBestOfferTerms("modal"),
          storeCategoryNames: storeCat ? [storeCat] : [],
        });
        if (result.success) {
          status.textContent = `\u2705 Offer created (${result.offerId}) \u2014 ready to publish`;
          state.currentProduct._offerId = result.offerId;
          enableBtn("btnCreateOffer", false);
          enableBtn("btnPublish",     true);
        } else {
          status.textContent = "\u274C " + (result.error || "Offer creation failed");
        }
        btn.disabled = false; btn.textContent = "2. Create Offer";
        return;
      }

      if (state.isVariantListing) {
        const groupKey    = `${state.currentProduct.code}-GROUP`;
        const title       = document.getElementById("modalTitle").value.trim();
        const rawHtml     = getDescriptionHtml("modal", state.pushQuill);
        const description = descState.pushMode === "html" ? sanitizeForEbay(rawHtml) : wrapDescription(title, rawHtml);
        const aspects     = collectAspects();
        delete aspects.Color;

        // Always use all active checked SKUs — some may already exist on eBay from a prior run,
        // and create_group_offer handles 25002 (already exists) gracefully.
        const variantSKUs = allActiveSkus;
        if (!variantSKUs.length) {
          status.textContent = "\u274C No active variants found \u2014 complete step 1 first";
          btn.disabled = false; btn.textContent = "2. Create Group + Offer";
          return;
        }
        const colorValues = publishableVariants.filter(v => variantSKUs.includes(v.sku)).map(v => v.option_value);
        const variesBy    = { aspectsImageVariesBy: ["Color"], specifications: [{ name: "Color", values: colorValues }] };

        progressEl.textContent = "Creating inventory item group...";
        const groupResult = await callEdge("ebay-manage-listing", {
          action:                "create_item_group",
          inventoryItemGroupKey: groupKey,
          title, description,
          imageUrls:             [...state.pushImageUrls].slice(0, 24),
          aspects, variantSKUs, variesBy,
          baseProductCode:       state.currentProduct.code,
        });

        if (!groupResult.success) {
          status.textContent = "\u274C Group creation failed: " + (groupResult.error || "Unknown");
          btn.disabled = false; btn.textContent = "2. Create Group + Offer";
          return;
        }

        progressEl.textContent = "Group created \u2713 \u2014 Creating offer...";
        const storeCat          = document.getElementById("modalStoreCategory").value;
        const variantQuantities = Object.fromEntries(publishableVariants.map(v => [v.sku, v.quantity]));
        const offerResult       = await callEdge("ebay-manage-listing", {
          action:                "create_group_offer",
          inventoryItemGroupKey: groupKey,
          variantSKUs, categoryId,
          variantQuantities,
          priceCents:            Math.round(price * 100),
          policies:              getSelectedPolicies("modal"),
          bestOfferTerms:        getBestOfferTerms("modal"),
          storeCategoryNames:    storeCat ? [storeCat] : [],
          baseProductCode:       state.currentProduct.code,
        });

        if (offerResult.success) {
          status.textContent     = `\u2705 Group + Offers created (${offerResult.count || 0} variants) \u2014 ready to publish`;
          progressEl.textContent = `Group "${groupKey}" + ${offerResult.count || 0} offers created \u2713`;
          state.currentProduct._groupKey      = groupKey;
          state.currentProduct._groupOfferIds = offerResult.offerIds || [];
          enableBtn("btnCreateOffer", false);
          enableBtn("btnPublish",     true);
        } else {
          status.textContent = "\u274C Offer creation failed: " + (offerResult.error || "Unknown");
        }
      } else {
        const storeCat = document.getElementById("modalStoreCategory").value;
        const result   = await callEdge("ebay-manage-listing", {
          action:             "create_offer",
          sku, categoryId,
          priceCents:         Math.round(price * 100),
          quantity,
          policies:           getSelectedPolicies("modal"),
          bestOfferTerms:     getBestOfferTerms("modal"),
          storeCategoryNames: storeCat ? [storeCat] : [],
        });
        if (result.success) {
          status.textContent = `\u2705 Offer created (${result.offerId}) \u2014 ready to publish`;
          state.currentProduct._offerId = result.offerId;
          enableBtn("btnCreateOffer", false);
          enableBtn("btnPublish",     true);
        } else {
          status.textContent = "\u274C " + (result.error || "Offer creation failed");
        }
      }
    } catch (e) {
      status.textContent = "\u274C Error: " + e.message;
    } finally {
      btn.disabled    = false;
      btn.textContent = state.isVariantListing ? "2. Create Group + Offer" : "2. Create Offer";
    }
  
  }

  async function handlePublish() {
    const btn    = document.getElementById("btnPublish");
    const status = document.getElementById("modalStatus");
    btn.disabled = true; btn.textContent = "Publishing...";

    const sku      = document.getElementById("modalSku").value.trim();
    const offerId  = state.currentProduct._offerId || state.currentProduct.ebay_offer_id;
    const groupKey = state.currentProduct._groupKey || state.currentProduct.ebay_item_group_key || `${state.currentProduct.code}-GROUP`;
    const checked  = getCheckedVariants(state.pushVariants, state.currentProduct.code).filter(v => v.quantity > 0);
    const variantQuantities = Object.fromEntries(checked.map(v => [v.sku, v.quantity]));
    variantQuantities[state.currentProduct.code] = checked.reduce((sum, v) => sum + v.quantity, 0) || (parseInt(document.getElementById("modalQuantity").value, 10) || 1);

    if (!state.isVariantListing && !offerId) {
      status.textContent = "\u274C No offer ID";
      btn.disabled = false; btn.textContent = "3. Publish";
      return;
    }

    try {
      const categoryId = document.getElementById("modalCatSelect")?.value || "";
      const price      = parseFloat(document.getElementById("modalPrice").value) || 0;
      const priceCents = Math.round(price * 100);

      const result = state.isVariantListing
        ? await callEdge("ebay-manage-listing", { action: "publish_group", inventoryItemGroupKey: groupKey, sku: state.currentProduct.code, categoryId, priceCents, variantQuantities })
        : await callEdge("ebay-manage-listing", { action: "publish", offerId, sku, categoryId, priceCents, quantity: parseInt(document.getElementById("modalQuantity").value, 10) || 1 });

      if (result.success) {
        status.textContent = `\u2705 Published! Listing ID: ${result.listingId}`;
        enableBtn("btnPublish", false);

        if (document.getElementById("modalVolEnabled").checked) {
          const volTiers = getVolTiers("modal");
          if (volTiers.length && result.listingId) {
            try {
              status.textContent += " \u2014 Creating volume discount...";
              const volResult = await callEdge("ebay-manage-listing", {
                action:      "create_volume_discount",
                listingId:   result.listingId,
                tiers:       volTiers,
                productCode: state.currentProduct.code,
              });
              if (volResult.success) {
                status.textContent = `\u2705 Published + Volume pricing set! Listing ID: ${result.listingId}`;
                setTimeout(() => { document.getElementById("pushModal").classList.add("hidden"); deps.loadProducts(); }, 1500);
              } else {
                status.textContent = `\u2705 Published (Listing ${result.listingId}) \u2014 \u26A0\uFE0F Volume pricing failed: ${volResult.error || JSON.stringify(volResult)} (close manually when done)`;
              }
            } catch (ve) {
              status.textContent = `\u2705 Published (Listing ${result.listingId}) \u2014 \u26A0\uFE0F Volume pricing error: ${ve.message} (close manually when done)`;
            }
            return;
          }
        }

        setTimeout(() => { document.getElementById("pushModal").classList.add("hidden"); deps.loadProducts(); }, 1500);
      } else {
        status.textContent = "\u274C " + (result.error || "Publish failed");
      }
    } catch (e) {
      status.textContent = "\u274C Error: " + e.message;
    } finally {
      btn.disabled = false; btn.textContent = "3. Publish";
    }
  
  }

  // ── Remaining Push listeners ───────────────────────────────────────────────
  /**
   * Wire all remaining Push-modal event listeners.
   * Handles: close, price/weight live update, adRate, add image,
   * description mode, category search, AI fill, Step 2 Create Offer,
   * Step 3 Publish, and Push-only checkbox/toggle controls.
   * Call once during page init.
   */
  function bindRemainingPushListeners() {
    // Close
    document.getElementById("btnCloseModal").addEventListener("click", () => {
      document.getElementById("pushModal").classList.add("hidden");
      document.getElementById("modalImagePicker").classList.add("hidden");
      setCurrentProduct(null);
    });

    // Live profit preview + price reference
    document.getElementById("modalPrice").addEventListener("input", () => refreshPushPreview(state.currentProduct));
    document.getElementById("modalPrice").addEventListener("input", () => refreshPushRef(state.currentProduct, state.pushSalesMetrics));
    document.getElementById("modalWeightOz").addEventListener("input", () => refreshPushPreview(state.currentProduct));
    document.getElementById("modalAdRate").addEventListener("change", () => {
      refreshPushPreview(state.currentProduct);
      refreshPushRef(state.currentProduct, state.pushSalesMetrics);
    });

    // Add image
    document.getElementById("btnAddImgPush").addEventListener("click", () => {
      if (!state.currentProduct) return;
      showGalleryPicker("modalImagePicker", "modalImageStrip", state.pushImageUrls, state.currentProduct);
    });

    // Description mode
    document.getElementById("btnPushVisual").addEventListener("click", () => {
      descState.pushMode = "visual";
      toggleDescMode("visual", "modal", state.pushQuill);
    });
    document.getElementById("btnPushHtml").addEventListener("click", () => {
      descState.pushMode = "html";
      toggleDescMode("html", "modal", state.pushQuill);
    });
    document.getElementById("btnPushPreview").addEventListener("click", () => {
      toggleDescMode("preview", "modal", state.pushQuill);
    });

    // Category Search
    document.getElementById("btnSearchCat").addEventListener("click", async () => {
      const query = document.getElementById("modalCatSearch").value.trim();
      if (!query) return;
      const btn = document.getElementById("btnSearchCat");
      btn.disabled = true; btn.textContent = "...";
      try {
        const result = await fetchCategorySuggestions(query);
        const sel    = document.getElementById("modalCatSelect");
        if (result.suggestions?.length) {
          sel.innerHTML = result.suggestions.map(s =>
            `<option value="${s.categoryId}">${esc(s.categoryName)} (${s.categoryId})</option>`
          ).join("");
          sel.classList.remove("hidden");
          sel.onchange = () => {
            const opt = sel.options[sel.selectedIndex];
            document.getElementById("modalCatSelected").textContent = `\u2713 ${opt.text}`;
            document.getElementById("modalCatSelected").classList.remove("hidden");
            fetchAndRenderAspects({
              categoryId:   opt.value,
              sectionEl:    document.getElementById("aspectsSection"),
              loadingEl:    document.getElementById("aspectsLoading"),
              reqContainer: document.getElementById("aspectsRequired"),
              optContainer: document.getElementById("aspectsOptional"),
              buildField:   buildAspectField,
              defaults:     { Brand: "Unbranded", Condition: "New", Type: "Accessory", Department: "Unisex Adults" },
              onAspects:    (aspects) => { setCurrentAspects(aspects); },
            });
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

    // AI Auto-Fill
    document.getElementById("btnAiFill").addEventListener("click", handleAiFill);

    // Step 2: Create Offer (or Group + Offer)
    document.getElementById("btnCreateOffer").addEventListener("click", handleCreateOffer);

    // Step 3: Publish
    document.getElementById("btnPublish").addEventListener("click", handlePublish);

    // Push-only checkbox / toggle controls
    document.getElementById("modalBestOffer").addEventListener("change", (e) => {
      document.getElementById("modalBestOfferFields").classList.toggle("hidden", !e.target.checked);
    });
    document.getElementById("modalLotEnabled").addEventListener("change", (e) => {
      document.getElementById("modalLotFields").classList.toggle("hidden", !e.target.checked);
    });
    document.getElementById("modalVolEnabled").addEventListener("change", (e) => {
      document.getElementById("modalVolFields").classList.toggle("hidden", !e.target.checked);
      if (e.target.checked && !document.getElementById("modalVolTiers").children.length) addVolTier("modal");
    });
    document.getElementById("modalAddTier").addEventListener("click", () => addVolTier("modal"));
  }

  return {
    openPush,
    getCurrentProduct,
    setCurrentProduct,
    getCurrentAspects,
    setCurrentAspects,
    getPushImageUrls,
    setPushImageUrls,
    getPushVariants,
    setPushVariants,
    getIsVariantListing,
    setIsVariantListing,
    getPushSalesMetrics,
    setPushSalesMetrics,
    getPushQuill,
    setPushQuill,
    resetPushState,
    bindCreateItemListener,
    bindRemainingPushListeners,
  };
}

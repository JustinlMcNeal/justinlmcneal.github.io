# 035 — Push Modal Dependency Map & Extraction Plan

**Date:** 2026-05-16  
**Type:** Documentation / planning pass  
**Code changed:** None  
**`index.js` current:** 1,398 lines

---

## 1. Current Push-Owned State

All state variables are declared in `index.js` at the top of the module scope.

| Variable | Declared | Written (Push) | Read (Push) | Shared with Edit? | Can move to `pushModal.js`? |
|---|---|---|---|---|---|
| `currentProduct` | `index.js` let | `openPush` sets it; close handler nulls it; Create Item, Create Offer, Publish all read it | All Push handlers read `currentProduct.*` | ⚠️ **Yes** — Edit *also* declares `editProduct`, but `currentProduct` dispatches from `handleProductAction` → `openPush`, so both state vars could theoretically be local if dispatchers are injected | **Yes** — can be local state inside `pushModal.js` factory |
| `currentAspects` | `index.js` let | `fetchAspects` writes it; `openPush` resets it | AI autofill handler reads `currentAspects.map(a => a.name)` | ❌ Push-only | **Yes** — pure Push state |
| `pushQuill` | `index.js` let | `openPush` initializes it | Create Item, Create Offer (group path), AI autofill all call `getDescriptionHtml("modal", pushQuill)` or `toggleDescMode(...)` | ❌ Push-only | **Yes** — pure Push state |
| `pushImageUrls` | `index.js` let | `openPush` sets it via `buildImageUrls`; draft-resume path reassigns it; Add Image picker writes it via `renderImageStrip` | Create Item (single: `imageUrls = [...pushImageUrls]`; group: `[...pushImageUrls].slice(0,24)`), AI autofill (`pushImageUrls.slice(0,4)`) | ❌ Push-only | **Yes** — pure Push state |
| `pushVariants` | `index.js` let | `openPush` sets from `activeVariants` or resets to `[]` | Create Item, Create Offer, Publish all call `getCheckedVariants(pushVariants, currentProduct.code)` | ❌ Push-only | **Yes** — pure Push state |
| `isVariantListing` | `index.js` let | `openPush` sets from `activeVariants.length > 1` | All three step handlers branch on it; button labels reference it in `finally` blocks | ⚠️ Not shared with Edit but declared page-scope | **Yes** — pure Push state |
| `pushSalesMetrics` | `index.js` let | `openPush` resets to `null`, then `loadAndRenderPriceRef` callback sets it | `modalPrice` input → `refreshPushRef(currentProduct, pushSalesMetrics)` | ❌ Push-only | **Yes** — pure Push state |
| `pageAdRatePct` | `index.js` let | `adRateFilter` change handler (page-level) | `openPush` reads it to initialize `modalAdRate` input; `modalAdRate` change refreshes push preview | ✅ **Yes** — also read by `openEdit` and `editAdRate` handler | ❌ **Must stay in `index.js`** — shared with Edit |
| `descState.pushMode` | `editor.js` (module object) | `openPush` resets to `"visual"`; desc mode buttons write it; draft-resume path writes it | Create Item/Offer read it to decide `sanitizeForEbay` vs `wrapDescription`; AI autofill writes + reads it | ⚠️ `descState` is a shared object with `editMode` field | **Yes on `pushMode` field** — `descState` is owned by `editor.js`, passed via import; both Push and Edit access their respective `.pushMode` / `.editMode` fields |

**Summary:** 7 of 8 Push state variables are Push-exclusive and can move into a `pushModal.js` factory as local closed-over state. Only `pageAdRatePct` must remain in `index.js`.

---

## 2. Push Functions and Handlers in `index.js`

### 2a. `fetchAspects(categoryId)` — ~26 lines (lines ~208–236)

| Property | Detail |
|---|---|
| Role | Fetches item specifics for a category; renders aspect fields into the Push modal |
| Dependencies | `fetchAspectsForCategory` (taxonomyApi.js), `buildAspectField` (aspectHelpers.js), `currentAspects` (write), DOM IDs: `aspectsSection`, `aspectsRequired`, `aspectsOptional`, `aspectsLoading` |
| Calls eBay? | Yes — via `fetchAspectsForCategory` |
| Mutates page state | `currentAspects = result.aspects` |
| Touches DOM | Yes — directly renders aspect field elements |
| Risk to move | **Low** — only called from Push category search handler; clean seam |
| Notes | Can be inlined into `pushModal.js` as a private (non-exported) function. Or extracted as part of the broader Push bundle. |

---

### 2b. `openPush(code)` — ~159 lines (lines ~240–395)

| Property | Detail |
|---|---|
| Role | Opens Push modal, hydrates all fields from product data, initializes Quill, loads variants, resumes draft if applicable, loads price reference |
| Dependencies (writes) | `currentProduct`, `currentAspects`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushSalesMetrics`, `descState.pushMode` |
| Dependencies (reads) | `allProducts` (to find product by code), `pageAdRatePct` |
| Imported helpers | `resetQuillEditorMount`, `quillToolbar`, `descState`, `toggleDescMode`, `isComplexHtml` (editor.js); `buildImageUrls`, `enableBtn`, `sanitizeForEbay`, `wrapDescription` (utils.js); `renderImageStrip` (images.js); `buildAspectField`, `collectAspects`, `validateRequiredAspects` (aspectHelpers.js); `renderVariantPanel` (variantPanel.js); `refreshPushPreview`, `loadAndRenderPriceRef` (modalPreviews.js); `callEdge` (api.js — draft resume path); `showStatus` (page helper) |
| Calls eBay? | Yes — draft-resume path calls `callEdge("ebay-manage-listing", { action: "get_item" })` |
| DOM element IDs touched (33+) | `pushModal`, `modalProductName`, `modalProductCode`, `modalSku`, `modalTitle`, `modalPrice`, `modalQuantity`, `modalCondition`, `modalLotEnabled`, `modalLotFields`, `modalLotSize`, `modalVolEnabled`, `modalVolFields`, `modalVolTiers`, `modalCatSearch`, `modalCatSelect`, `modalCatSelected`, `modalStatus`, `modalDescriptionEditor`, `modalDescriptionHtml`, `modalDescriptionPreview`, `btnPushVisual`, `btnPushHtml`, `btnPushPreview`, `modalImageStrip`, `modalImagePicker`, `aspectsSection`, `aspectsRequired`, `aspectsOptional`, `variantPanel`, `variantProgress`, `btnCreateItem`, `btnCreateOffer`, `btnPublish`, `modalBestOffer`, `modalBestOfferFields`, `modalWeightOz`, `modalAdRate`, `aiFillStatus` |
| Risk to move | **High** — largest number of state mutations and DOM reads of any individual function |

---

### 2c. Push Modal Close handler

| Property | Detail |
|---|---|
| Selector | `#btnCloseModal` click |
| Role | Hides pushModal and imagePicker, nulls `currentProduct` |
| Dependencies | Writes `currentProduct = null` |
| Risk | Low (3 lines) |

---

### 2d. Push price/weight live-update listeners

| Property | Detail |
|---|---|
| Selectors | `#modalPrice` input × 2, `#modalWeightOz` input |
| Role | Calls `refreshPushPreview(currentProduct)` and `refreshPushRef(currentProduct, pushSalesMetrics)` |
| Dependencies | Reads `currentProduct`, `pushSalesMetrics` (Push state); calls `refreshPushPreview`, `refreshPushRef` (modalPreviews.js) |
| Risk | Low (3 listeners, 3 lines each) |

---

### 2e. Push Add Image handler

| Property | Detail |
|---|---|
| Selector | `#btnAddImgPush` click |
| Role | Calls `showGalleryPicker(...)` which opens the image picker and wires it to write into `pushImageUrls` |
| Dependencies | Reads `currentProduct`, `pushImageUrls`; calls `showGalleryPicker` (images.js) |
| Risk | Low (3 lines) |
| Notes | `showGalleryPicker` internally mutates `pushImageUrls` by reference — this is the only shared-by-ref mutation on `pushImageUrls` outside `openPush` |

---

### 2f. Push description mode buttons

| Property | Detail |
|---|---|
| Selectors | `#btnPushVisual`, `#btnPushHtml`, `#btnPushPreview` click |
| Role | Set `descState.pushMode` and call `toggleDescMode(mode, "modal", pushQuill)` |
| Dependencies | Reads/writes `descState.pushMode`, `pushQuill`; calls `toggleDescMode` (editor.js) |
| Risk | Low (3 × 2-line listeners) |

---

### 2g. Push Category Search handler

| Property | Detail |
|---|---|
| Selector | `#btnSearchCat` click |
| Role | Calls `fetchCategorySuggestions(query)`, renders category dropdown, wires `onchange` to call `fetchAspects` |
| Dependencies | Reads DOM (`#modalCatSearch`, `#modalCatSelect`, `#modalCatSelected`, `#modalStatus`); calls `fetchCategorySuggestions` (taxonomyApi.js); calls `fetchAspects` (local Push function) |
| Calls eBay? | Yes — `fetchCategorySuggestions` calls `callEdge("ebay-category", {action:"suggest_categories"})` |
| Risk | Medium — inline `sel.onchange` wires calls to `fetchAspects` |

---

### 2h. Push AI Auto-Fill handler

| Property | Detail |
|---|---|
| Selector | `#btnAiFill` click |
| Role | Calls `callEdge("ebay-ai-autofill", {...})` with product data; populates title, description, aspect fields |
| Dependencies | Reads `currentProduct`, `currentAspects`, `pushImageUrls`, `descState`; calls `callEdge`, `addAiBadge`, `toggleDescMode`, `esc` |
| Calls eBay? | Yes — `callEdge("ebay-ai-autofill", { productName, productCode, category, price, imageUrls, existingAspects })` |
| Mutates page state | Writes `descState.pushMode = "html"` when AI generates HTML desc |
| Risk | Medium — reads Push state only; but aspect DOM writes use `document.querySelector("[data-aspect]")` global selector |

---

### 2i. Push Step 1: Create Item handler

| Property | Detail |
|---|---|
| Selector | `#btnCreateItem` click |
| Role | Builds product payload from DOM, calls `create_item` for single or all checked variants in sequence |
| Dependencies | Reads `isVariantListing`, `pushVariants`, `currentProduct`, `pushImageUrls`, `pushQuill`, `descState`; calls `collectAspects`, `validateRequiredAspects`, `getCheckedVariants`, `buildPackageWeightAndSize`, `getDescriptionHtml`, `sanitizeForEbay`, `wrapDescription`, `enableBtn`, `esc`, `callEdge` |
| Calls eBay? | Yes — `callEdge("ebay-manage-listing", { action: "create_item", sku, product, packageWeightAndSize })` |
| Mutates page state | Writes `currentProduct._createdVariantSKUs` (temp field on currentProduct object) |
| Risk | **High** — largest handler, 128 lines, 2 code paths (single/variant), sequential eBay loop |

---

### 2j. Push Step 2: Create Offer handler

| Property | Detail |
|---|---|
| Selector | `#btnCreateOffer` click |
| Role | Creates eBay offer (single) or inventory group + group offers (variant); uses policy/bestoffer/storecat selections |
| Dependencies | Reads `isVariantListing`, `pushVariants`, `currentProduct`, `pushImageUrls`, `pushQuill`, `descState`; calls `getCheckedVariants`, `getSelectedPolicies`, `getBestOfferTerms`, `collectAspects`, `getDescriptionHtml`, `sanitizeForEbay`, `wrapDescription`, `enableBtn`, `callEdge` |
| Calls eBay? | Yes — `callEdge("ebay-manage-listing", { action: "create_offer" })` and/or `{ action: "create_item_group" }` + `{ action: "create_group_offer" }` |
| Mutates page state | Writes `currentProduct._offerId`, `currentProduct._groupKey`, `currentProduct._groupOfferIds` |
| Risk | **High** — 118 lines, 3 code paths |

---

### 2k. Push Step 3: Publish handler

| Property | Detail |
|---|---|
| Selector | `#btnPublish` click |
| Role | Publishes offer or group; optionally creates volume discount |
| Dependencies | Reads `isVariantListing`, `pushVariants`, `currentProduct`; calls `getCheckedVariants`, `getVolTiers`, `enableBtn`, `callEdge`, `loadProducts` |
| Calls eBay? | Yes — `callEdge("ebay-manage-listing", { action: "publish" })` or `{ action: "publish_group" }` + optional `{ action: "create_volume_discount" }` |
| Mutates page state | Closes modal; calls `loadProducts()` to refresh page |
| Risk | **High** — 62 lines; calls `loadProducts()` which is a page-level dep |

---

### 2l. Push `modalAdRate` change handler

| Property | Detail |
|---|---|
| Selector | `#modalAdRate` change |
| Role | Refreshes profit preview and price reference using updated ad rate |
| Dependencies | Reads `currentProduct`, `pushSalesMetrics`; calls `refreshPushPreview`, `refreshPushRef` |
| Risk | Low (1 line) |
| Notes | This listener is grouped with the Edit `editAdRate` handler on the same line |

---

### 2m. Push Checkbox Toggles (Best Offer, Lot, Vol Pricing)

| Selector | Push fields | Notes |
|---|---|---|
| `#modalBestOffer` change | Toggles `#modalBestOfferFields` | 2 lines; pure DOM |
| `#modalLotEnabled` change | Toggles `#modalLotFields` | 2 lines; pure DOM |
| `#modalVolEnabled` change | Toggles `#modalVolFields`; calls `addVolTier("modal")` if first tier | 3 lines |
| `#modalAddTier` click | Calls `addVolTier("modal")` | 1 line |

---

## 3. Push Backend Calls (All Payloads)

### 3a. `get_item` (draft resume in `openPush`)
```js
callEdge("ebay-manage-listing", {
  action: "get_item",
  sku: currentProduct.ebay_sku,
})
// Response: { success, item: { product: { title, description, imageUrls }, condition,
//             availability: { shipToLocationAvailability: { quantity } },
//             packageWeightAndSize: { weight: { value }, dimensions: { length, width, height } } } }
```

### 3b. `create_item` — single listing
```js
callEdge("ebay-manage-listing", {
  action: "create_item",
  sku,                   // string
  product: {
    title,               // string
    description,         // sanitized HTML
    condition,           // "NEW" etc.
    quantity,            // integer
    imageUrls,           // string[] (from pushImageUrls)
    aspects,             // { [name]: [value] }
    // optional:
    lotSize,             // integer > 1
  },
  packageWeightAndSize: buildPackageWeightAndSize("modal"),
  // { weight: { value, unit: "OUNCE" }, dimensions: { length, width, height, unit: "INCH" } }
})
```

### 3c. `create_item` — variant (per variant in loop)
```js
callEdge("ebay-manage-listing", {
  action: "create_item",
  sku: v.sku,            // variant SKU
  product: {
    title,
    description,
    condition,
    quantity: v.quantity,
    imageUrls: variantImages.slice(0, 24),  // variant-specific image list
    aspects: { ...aspects, Color: [v.option_value] },
    // optional: lotSize
  },
  packageWeightAndSize: buildPackageWeightAndSize("modal"),
})
```

### 3d. `create_item_group` — variant group
```js
callEdge("ebay-manage-listing", {
  action: "create_item_group",
  inventoryItemGroupKey: groupKey,  // `${currentProduct.code}-GROUP`
  title,
  description,
  imageUrls: [...pushImageUrls].slice(0, 24),
  aspects,              // shared aspects (Color deleted)
  variantSKUs,          // string[]
  variesBy: {
    aspectsImageVariesBy: ["Color"],
    specifications: [{ name: "Color", values: colorValues }],
  },
  baseProductCode: currentProduct.code,
})
```

### 3e. `create_offer` — single
```js
callEdge("ebay-manage-listing", {
  action: "create_offer",
  sku, categoryId,
  priceCents: Math.round(price * 100),
  quantity,
  policies: getSelectedPolicies("modal"),
  // { fulfillmentPolicyId, returnPolicyId, paymentPolicyId }
  bestOfferTerms: getBestOfferTerms("modal"),
  // { bestOfferEnabled, autoAcceptPrice, autoDeclinePrice } or {}
  storeCategoryNames: storeCat ? [storeCat] : [],
})
```

### 3f. `create_offer` — fallback single-variant (< 2 active variants)
Same payload as 3e but uses `vSku` and `vQty` from publishable variant.

### 3g. `create_group_offer`
```js
callEdge("ebay-manage-listing", {
  action: "create_group_offer",
  inventoryItemGroupKey: groupKey,
  variantSKUs,
  categoryId,
  variantQuantities,   // { [sku]: qty }
  priceCents: Math.round(price * 100),
  policies: getSelectedPolicies("modal"),
  bestOfferTerms: getBestOfferTerms("modal"),
  storeCategoryNames: storeCat ? [storeCat] : [],
  baseProductCode: currentProduct.code,
})
```

### 3h. `publish` — single
```js
callEdge("ebay-manage-listing", {
  action: "publish",
  offerId,
  sku,
  categoryId,
  priceCents,
  quantity: parseInt(document.getElementById("modalQuantity").value, 10) || 1,
})
```

### 3i. `publish_group` — variant
```js
callEdge("ebay-manage-listing", {
  action: "publish_group",
  inventoryItemGroupKey: groupKey,
  sku: currentProduct.code,
  categoryId,
  priceCents,
  variantQuantities,   // { [sku]: qty, [baseCode]: totalQty }
})
```

### 3j. `create_volume_discount` — post-publish
```js
callEdge("ebay-manage-listing", {
  action: "create_volume_discount",
  listingId: result.listingId,
  tiers: getVolTiers("modal"),
  // [{ minQuantity, percentOff }]
  productCode: currentProduct.code,
})
```

### 3k. `ebay-ai-autofill`
```js
callEdge("ebay-ai-autofill", {
  productName: currentProduct.name,
  productCode: currentProduct.code,
  category: categoryName,
  price: Number(currentProduct.price) || undefined,
  imageUrls: pushImageUrls.slice(0, 4),
  existingAspects: currentAspects.map(a => a.name),
})
// Response: { success, data: { title, description_html, item_specifics, notes } }
```

---

## 4. Push Helper / Module Dependencies

| Module | What Push uses | Notes |
|---|---|---|
| `api.js` | `callEdge` | All eBay calls go through this |
| `aspectHelpers.js` | `buildAspectField` (in `fetchAspects`), `collectAspects` (Create Item, Create Offer), `validateRequiredAspects` (Create Item) | Aspect DOM build + payload read |
| `taxonomyApi.js` | `fetchCategorySuggestions` (category search), `fetchAspectsForCategory` (in `fetchAspects`) | Both calls come from Push only |
| `policyCache.js` | `loadPoliciesCache()` (called in `init()` — NOT directly from openPush) | `populatePolicyDropdowns()` is internal to policyCache; Push reads policy dropdowns via `getSelectedPolicies` (utils.js) |
| `modalPreviews.js` | `refreshPushPreview`, `refreshPushRef`, `loadAndRenderPriceRef` | All called after `openPush` and in live-update handlers |
| `variantPanel.js` | `renderVariantPanel` (in `openPush`), `getCheckedVariants` (Step 1, 2, 3) | Push builds/reads variant DOM |
| `images.js` | `buildImageUrls` (via utils.js — actually `buildImageUrls` is in utils.js), `renderImageStrip` (open + draft), `showGalleryPicker` (add image) | Gallery picker writes to `pushImageUrls` |
| `editor.js` | `resetQuillEditorMount`, `quillToolbar`, `descState`, `toggleDescMode`, `getDescriptionHtml` | Creates Quill instance; reads description in step handlers |
| `volPricing.js` | `addVolTier` (vol checkbox + add-tier btn), `getVolTiers` (publish handler) | `setVolTiers` is Edit-only |
| `utils.js` | `buildImageUrls`, `buildPackageWeightAndSize`, `getSelectedPolicies`, `getBestOfferTerms`, `enableBtn`, `sanitizeForEbay`, `wrapDescription`, `isComplexHtml`, `esc`, `addAiBadge` | Most of these are shared with Edit |

---

## 5. Proposed `pushModal.js` API

```js
/**
 * pushModal.js — Push modal factory.
 *
 * Owns:
 *   openPush / fetchAspects
 *   All Push modal event listeners (close, price, weight, add-image,
 *   desc-mode, category search, AI autofill, create item, create offer, publish)
 *   Push-specific checkbox toggles (best offer, lot, vol pricing)
 *   Push-local state: currentProduct, currentAspects, pushQuill,
 *                     pushImageUrls, pushVariants, isVariantListing, pushSalesMetrics
 *
 * Does NOT own:
 *   openEdit, editProduct, or any edit-modal state
 *   allProducts — accessed via getProducts() injection
 *   loadProducts — injected for post-publish refresh
 *   showStatus   — injected from index.js
 *   pageAdRatePct — injected via getter
 *   callEdge — imported from api.js
 *   supabase — NOT used by Push (no DB writes in Push flow)
 */
export function initPushModal({
  getProducts,     // () => Product[]            — reads allProducts
  loadProducts,    // () => Promise<void>         — called after publish
  showStatus,      // (msg, isError?) => void     — page-level status
  getAdRatePct,    // () => number                — reads pageAdRatePct
}) {
  // ── Private Push state ──────────────────────────────────────
  let currentProduct    = null;
  let currentAspects    = [];
  let pushQuill         = null;
  let pushImageUrls     = [];
  let pushVariants      = [];
  let isVariantListing  = false;
  let pushSalesMetrics  = null;

  // ── Private helpers ─────────────────────────────────────────
  async function fetchAspects(categoryId) { … }

  // ── Public: open modal ──────────────────────────────────────
  async function openPush(code) { … }

  // ── Wire event listeners (called once from index.js init) ───
  function bindListeners() {
    document.getElementById("btnCloseModal").addEventListener(…);
    document.getElementById("modalPrice").addEventListener(…);
    document.getElementById("modalWeightOz").addEventListener(…);
    document.getElementById("btnAddImgPush").addEventListener(…);
    document.getElementById("btnPushVisual").addEventListener(…);
    document.getElementById("btnPushHtml").addEventListener(…);
    document.getElementById("btnPushPreview").addEventListener(…);
    document.getElementById("btnSearchCat").addEventListener(…);
    document.getElementById("btnAiFill").addEventListener(…);
    document.getElementById("btnCreateItem").addEventListener(…);
    document.getElementById("btnCreateOffer").addEventListener(…);
    document.getElementById("btnPublish").addEventListener(…);
    document.getElementById("modalAdRate").addEventListener(…);
    document.getElementById("modalBestOffer").addEventListener(…);
    document.getElementById("modalLotEnabled").addEventListener(…);
    document.getElementById("modalVolEnabled").addEventListener(…);
    document.getElementById("modalAddTier").addEventListener(…);
  }

  return { openPush, bindListeners };
}
```

### Dependencies injected vs imported

| Dependency | Inject via param | Import directly |
|---|---|---|
| `allProducts` | `getProducts()` | — |
| `loadProducts` | `loadProducts` param | — |
| `showStatus` | `showStatus` param | — |
| `pageAdRatePct` | `getAdRatePct()` | — |
| `callEdge` | — | `import { callEdge } from "./api.js"` |
| `buildImageUrls`, `buildPackageWeightAndSize`, etc. | — | `import … from "./utils.js"` |
| `fetchCategorySuggestions`, `fetchAspectsForCategory` | — | `import … from "./taxonomyApi.js"` |
| `loadPoliciesCache` (not called from Push; policies auto-populate from init) | — | not needed |
| `refreshPushPreview`, `refreshPushRef`, `loadAndRenderPriceRef` | — | `import … from "./modalPreviews.js"` |
| `renderVariantPanel`, `getCheckedVariants` | — | `import … from "./variantPanel.js"` |
| `renderImageStrip`, `showGalleryPicker` | — | `import … from "./images.js"` |
| `resetQuillEditorMount`, `quillToolbar`, `descState`, `toggleDescMode`, `getDescriptionHtml` | — | `import … from "./editor.js"` |
| `collectAspects`, `validateRequiredAspects`, `buildAspectField` | — | `import … from "./aspectHelpers.js"` |
| `addVolTier`, `getVolTiers` | — | `import … from "./volPricing.js"` |

---

## 6. Safe Phased Extraction Plan

### Phase N-1: `fetchAspects` isolation (~26 lines)

**Scope:** Extract `fetchAspects` out of inline `index.js` scope and into `aspectHelpers.js` as a standalone exported function.

**Approach:** 
```js
// In aspectHelpers.js:
export async function fetchAndRenderAspects(categoryId, { setCurrentAspects }) { … }
```

**Deps:** `fetchAspectsForCategory` (already imported there), `buildAspectField` (already there), DOM IDs: `aspectsSection`, `aspectsRequired`, `aspectsOptional`, `aspectsLoading`

**Risk:** Low  
**Lines removed from index.js:** ~26  
**Verification:** `node --check`, page loads, category search works in Push modal  
**Rollback:** Revert 2 files; no DB/edge changes

---

### Phase N-2: Create `pushModal.js` with `initPushModal` + `openPush` only

**Scope:** Move `openPush` + `fetchAspects` (already simplified in N-1) into `pushModal.js` as the factory module. No handlers yet. `bindListeners` returns `{}` (empty) initially — listeners stay in `index.js`.

**Approach:**
- Create `pushModal.js` with `initPushModal(deps)` factory
- Move Push-private state inside factory
- Move `openPush` function body unchanged
- In `index.js`: `const { openPush } = initPushModal({ getProducts: () => allProducts, loadProducts, showStatus, getAdRatePct: () => pageAdRatePct })`
- All existing listeners in `index.js` still reference `currentProduct`, `pushQuill`, etc. — these **cannot** move yet since they're still in `index.js` scope

> ⚠️ **Critical constraint:** The Push event listeners in `index.js` directly close over `currentProduct`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushSalesMetrics`. These closures cannot be moved to `pushModal.js` until ALL the handlers that reference them move together in the same phase. Moving `openPush` alone would break listener closure references.

**This means Phase N-2 alone is NOT safe without also moving listeners or converting them to accessor functions.**

**Alternative to N-2:** Use accessor pattern:
```js
// pushModal.js exports:
return {
  openPush,
  bindListeners,      // wires all Push listeners in one shot
  // also expose accessors for index.js if any other code reads Push state:
  getCurrentProduct: () => currentProduct,
  getPushImageUrls:  () => pushImageUrls,
};
```

Then in `index.js`, replace all listener registrations with a single `bindListeners()` call.

**Risk:** **Medium-High** — requires moving all Push listeners in one phase to avoid broken closures  
**Lines removed from index.js:** ~380 (all Push code)  
**Verification:** All Push actions tested: open modal, category search, create item, create offer, publish  
**Rollback:** Revert 2 files

---

### Phase N-3 (alternative): Incremental Push handler extraction using refs

**Approach:** Before moving any listeners, convert all Push state from closed-over page vars to an explicit context object exposed by `pushModal.js`:

```js
// pushModal.js returns:
const ctx = {
  getCurrentProduct:   () => currentProduct,
  getPushImageUrls:    () => pushImageUrls,
  getPushQuill:        () => pushQuill,
  getPushVariants:     () => pushVariants,
  isVariantListing:    () => isVariantListing,
  getPushSalesMetrics: () => pushSalesMetrics,
  setPushSalesMetrics: (m) => { pushSalesMetrics = m; },
};
```

This allows handlers in `index.js` to switch from direct variable access to `ctx.getCurrentProduct()` gradually, one handler at a time, before the final full move.

**Risk:** Medium — incremental, testable, each step isolated  
**Recommended:** Yes, if doing phased extraction

---

### Recommended Phase Sequence

| Phase | Scope | Lines removed | Risk | Pre-condition |
|---|---|---|---|---|
| **N-1** | `fetchAspects` → `aspectHelpers.js` | ~26 | Low | None |
| **N-2** | Create `pushModal.js` skeleton; push `openPush` into factory; expose Push state via accessor refs; convert `index.js` listeners to use ctx accessors | ~10 | Medium | N-1 done |
| **N-3** | Move Push close + live-update + desc-mode + checkbox listeners into `bindListeners()` | ~50 | Low-Medium | N-2 done |
| **N-4** | Move category search + AI autofill into `bindListeners()` | ~90 | Medium | N-3 done |
| **N-5** | Move Create Item into `bindListeners()` | ~128 | High | N-4 done |
| **N-6** | Move Create Offer into `bindListeners()` | ~118 | High | N-5 done |
| **N-7** | Move Publish + volume discount into `bindListeners()` | ~62 | High | N-6 done |
| **N-final** | Remove ctx accessors; consolidate Push state as fully private | ~0 net change | Low | N-7 done |

**Total Push lines to remove from index.js:** ~484 (openPush ~159 + fetchAspects ~26 + all Push handlers ~299)

---

## 7. Readiness Call

### Is `pushModal.js` ready to create now?

**No — not yet.** The blocking constraint is the closures:

The Push handlers in `index.js` close directly over `currentProduct`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing`, and `pushSalesMetrics`. Moving `openPush` alone without moving the handlers would leave orphaned references. Moving all handlers in one big-bang phase is the highest-risk possible extraction.

### What is the first safest Push code to move?

**Phase N-1: `fetchAspects` into `aspectHelpers.js`** (~26 lines, zero closure risk, 1 call site).

This does not touch any Push closures and is independently valuable.

### What should move next after N-1?

**Create `pushModal.js` with accessor-ref pattern (Phase N-2):** Push state moves into the factory, but accessible via exported getters so existing `index.js` listeners can be migrated one by one (N-3 → N-7).

### What must stay in `index.js` until later?

- `openEdit`, Edit modal handlers, Edit save handler (Edit Phase O — separate extraction)
- `allProducts`, `loadProducts`, `showStatus`, `pageAdRatePct` (shared page state)
- `modalAdRate` change handler (currently one line shared with `editAdRate` on same line — needs splitting before moving)
- `initBulkActions`, `initSetupPanel`, `initImportPanel`, `init()` function

### What must NOT change in any Push extraction?

- All eBay API payload shapes (3a – 3k above) must be byte-for-byte identical
- `buildPackageWeightAndSize("modal")` call signature unchanged
- `getSelectedPolicies("modal")` / `getBestOfferTerms("modal")` call signatures unchanged
- `getCheckedVariants(pushVariants, currentProduct.code)` call — `pushVariants` array must reflect current DOM state
- `collectAspects()` — reads `[data-aspect]` DOM attributes; no change to attribute names
- `validateRequiredAspects()` — reads `[data-aspect][data-required='true']` DOM attributes
- Variant image URL slicing: `.slice(0, 24)` limits
- `descState.pushMode` check before `sanitizeForEbay` vs `wrapDescription` — logic unchanged

# 020 — Push Modal Extraction Audit

## 1. Current Push Workflow Map

### Step 0 — Trigger
User clicks a `Push` or `Re-list` button (rendered by `renderProductActions`).
`handleProductAction` delegates to `openPush(code)`.

### Step 1 — `openPush(code)`
1. Locate product in `allProducts` → set `currentProduct`
2. Reset all modal form fields (SKU, title, price, quantity, condition, lot, vol)
3. Destroy/remount Quill editor (`resetQuillEditorMount`)
4. Reset description mode state (`descState.pushMode = "visual"`)
5. Build image URLs (`buildImageUrls`) → set `pushImageUrls` → call `renderImageStrip`
6. Reset aspects section (hide, clear containers, clear `currentAspects`)
7. Auto-fill weight from product data (grams → oz)
8. Detect active variants → set `pushVariants`, `isVariantListing`
9. If variant: show `variantPanel`, call `renderVariantPanel(activeVariants, code)`, hide Best Offer
10. If non-variant: hide `variantPanel`, show Best Offer
11. Enable Create Item, disable Create Offer and Publish
12. Show pushModal
13. **Draft resume path** (if `ebay_status === "draft"` and sku exists but no offer_id):
    - `callEdge("ebay-manage-listing", { action: "get_item", sku })` 
    - Pre-fill title, description, condition, qty, weight, images from eBay response
    - Enable Create Offer, disable Create Item
14. Set ad rate input
15. `refreshPushPreview()` — render profit estimate
16. Set `pushSalesMetrics = null`
17. `loadAndRenderPriceRef("modalPriceRef", product, "push")` — async price reference

### Step 2 — Category Search
User types keyword → clicks Search → `btnSearchCat` listener → 
`callEdge("ebay-taxonomy", { action: "suggest_category", query })` → 
populates `modalCatSelect` → on change calls `fetchAspects(categoryId)`.

### Step 3 — `fetchAspects(categoryId)`
`callEdge("ebay-taxonomy", { action: "get_aspects", categoryId })` →
sets `currentAspects` → calls `buildAspectField(...)` for required/optional aspects →
appends to `#aspectsRequired` / `#aspectsOptional`.

### Step 4 (optional) — AI Auto-Fill
`btnAiFill` listener → `callEdge("ebay-ai-autofill", { ... })` →
fills title, description, aspects in DOM → calls `addAiBadge(inputId, source)`.

### Step 5 — Create Item (`btnCreateItem`)
1. Collect SKU, title, description (`getDescriptionHtml`), condition, qty, lot size
2. `validateRequiredAspects()` — DOM check
3. `collectAspects()` — DOM collect
4. Collect `pushImageUrls`
5. **Non-variant**: `callEdge("ebay-manage-listing", { action: "create_item", sku, product, packageWeightAndSize })`
6. **Variant**: loop over `getCheckedVariants()` → per-variant `create_item` calls with `variantAspects`, `variant_image_urls`
7. Enable Create Offer on success; store `_createdVariantSKUs` on `currentProduct`

### Step 6 — Create Offer (`btnCreateOffer`)
1. Read `modalCatSelect.value` (categoryId), price, qty
2. **Non-variant**: `callEdge("ebay-manage-listing", { action: "create_offer", sku, categoryId, priceCents, qty, policies, bestOfferTerms, storeCategoryNames })`
3. **Variant (≥2 active)**: 
   - `callEdge("ebay-manage-listing", { action: "create_item_group", ... title, description, imageUrls, aspects, variantSKUs, variesBy })`
   - `callEdge("ebay-manage-listing", { action: "create_group_offer", ... variantSKUs, categoryId, variantQuantities, priceCents, policies, storeCategoryNames })`
4. Enable Publish on success; store `_offerId` / `_groupKey` on `currentProduct`

### Step 7 — Publish (`btnPublish`)
1. Read offerId/groupKey from `currentProduct` (or DOM sku + computed groupKey)
2. **Non-variant**: `callEdge("ebay-manage-listing", { action: "publish", offerId, sku, categoryId, priceCents, quantity })`
3. **Variant**: `callEdge("ebay-manage-listing", { action: "publish_group", inventoryItemGroupKey, sku, categoryId, priceCents, variantQuantities })`
4. **Post-publish** (if vol pricing enabled): `callEdge("ebay-manage-listing", { action: "create_volume_discount", listingId, tiers, productCode })`
5. On success: 1.5s delay → close modal → `loadProducts()`

---

## 2. Functions Currently in `index.js` Involved in Push

| Function | Role | DOM? | eBay? | Supabase? | State | Risk to move |
|---|---|---|---|---|---|---|
| `openPush(code)` | Hydrate + open modal | ✅ heavy | 📞 (draft resume) | ❌ | reads/writes: `currentProduct`, `pushVariants`, `isVariantListing`, `pushImageUrls`, `pushSalesMetrics`, `currentAspects` | 🔴 HIGH — orchestrates everything |
| `fetchAspects(categoryId)` | Load aspects for category | ✅ | 📞 `ebay-taxonomy` | ❌ | writes `currentAspects` | 🟡 MEDIUM — uses module state + DOM |
| `buildAspectField(aspect, defaults, isRequired)` | Build aspect DOM field | ✅ creates element | ❌ | ❌ | none | 🟢 LOW — pure DOM builder, depends only on `esc` |
| `collectAspects()` | Read aspect values from DOM | ✅ queries `[data-aspect]` | ❌ | ❌ | none | 🟢 LOW — pure DOM reader, no state |
| `validateRequiredAspects()` | Check required aspects in DOM | ✅ queries `[data-aspect]` | ❌ | ❌ | none | 🟢 LOW — pure DOM reader, no state |
| `renderVariantPanel(variants, baseCode)` | Render variant list UI | ✅ heavy | ❌ | ❌ | reads `currentProduct` (for image candidates) | 🟡 MEDIUM |
| `renderVariantAssignedImages(container, urls)` | Render assigned image thumbnails | ✅ | ❌ | ❌ | none | 🟢 LOW |
| `renderVariantCandidatePicker(urls)` | Render image picker grid | ✅ | ❌ | ❌ | none (returns HTML string) | 🟢 LOW |
| `getAssignedVariantImages(row)` | Read assigned images from DOM | ✅ | ❌ | ❌ | none | 🟢 LOW |
| `setAssignedVariantImages(row, urls)` | Write assigned images to DOM | ✅ | ❌ | ❌ | none | 🟢 LOW |
| `refreshVariantCandidateButtons(row)` | Sync candidate picker visibility | ✅ | ❌ | ❌ | none | 🟢 LOW |
| `wireVariantImageSetControls(row, onChange)` | Wire click events on variant image row | ✅ event listener | ❌ | ❌ | none | 🟢 LOW |
| `getCheckedVariants()` | Read checked variant rows from DOM | ✅ | ❌ | ❌ | none | 🟢 LOW |
| `publishQuantityForProduct(product)` | Compute publish qty from variants | ❌ | ❌ | ❌ | none | 🟢 **VERY LOW — pure function** |
| `activeVariantCount(product)` | Count active variants | ❌ | ❌ | ❌ | none | 🟢 **VERY LOW — pure function** |
| `isEffectiveGroupListing(product)` | Check if product is a group listing | ❌ | ❌ | ❌ | none | 🟢 **VERY LOW — pure function** |
| `addAiBadge(inputId, source)` | Add AI badge to form label | ✅ | ❌ | ❌ | none | 🟢 **VERY LOW — pure DOM helper** |
| `refreshPushPreview()` | Re-render profit estimate for Push | ✅ | ❌ | ❌ | reads `currentProduct` | 🟡 MEDIUM — reads module state |
| `refreshPushRef()` | Re-render price reference for Push | ✅ | ❌ | ❌ | reads `currentProduct`, `pushSalesMetrics` | 🟡 MEDIUM — reads module state |
| `loadAndRenderPriceRef(containerId, product, type)` | Async load + render price ref | ✅ | ❌ | 📞 (reads view) | writes `pushSalesMetrics` or `editSalesMetrics` | 🟡 MEDIUM — shared by push+edit |
| `enableBtn(id, enabled)` | Toggle step button state | ✅ | ❌ | ❌ | none | 🟢 LOW |
| `imageOptionLabel(url, idx)` | Format image filename for display | ❌ | ❌ | ❌ | none | 🟢 **VERY LOW — pure string function** |
| `btnCreateItem` handler | Step 1 mutation | ✅ | 📞 `ebay-manage-listing` | ❌ | reads `currentProduct`, `pushVariants`, `isVariantListing`, `pushImageUrls`, `currentAspects` | 🔴 HIGH |
| `btnCreateOffer` handler | Step 2 mutation | ✅ | 📞 `ebay-manage-listing` | ❌ | reads `currentProduct`, `isVariantListing` | 🔴 HIGH |
| `btnPublish` handler | Step 3 mutation + post-publish | ✅ | 📞 `ebay-manage-listing` | ❌ | reads `currentProduct`, `isVariantListing` | 🔴 HIGH |
| `btnAiFill` handler | AI fill form fields | ✅ | 📞 `ebay-ai-autofill` | ❌ | reads `currentProduct`, `currentAspects`, `pushImageUrls` | 🔴 HIGH |
| `btnSearchCat` handler | Category search | ✅ | 📞 `ebay-taxonomy` | ❌ | none | 🟡 MEDIUM |

---

## 3. Push State Variables

| Variable | Role | Can move to `pushModal.js`? |
|---|---|---|
| `currentProduct` | Product being pushed / edited | ✅ could be push-local if push module owns openPush |
| `currentAspects` | Loaded aspect definitions for category | ✅ push-local; only read by `fetchAspects`, `btnAiFill`, `btnCreateItem` |
| `pushQuill` | Quill editor instance for push modal | ✅ push-local |
| `pushImageUrls` | Selected image URLs for push modal | ✅ push-local |
| `pushVariants` | Active variants for push modal | ✅ push-local |
| `isVariantListing` | Whether current push is variant flow | ✅ push-local |
| `pushSalesMetrics` | Cached sales data for price reference | ✅ push-local |

**Note:** `currentProduct` is shared with `renderEditLinkWarning`, `reconcileEbayLink`, `doWithdraw`, `doPublish`, and various listeners. Until the edit modal is also extracted, this state must remain in `index.js` or be passed between modules. `isVariantListing` is similarly referenced by Create Item, Create Offer, and Publish handlers — it must stay in scope with those handlers.

---

## 4. Existing Helper Modules That Push Already Uses

| Module | Imports used by Push | Notes |
|---|---|---|
| `utils.js` | `esc`, `sanitizeForEbay`, `wrapDescription`, `isComplexHtml`, `buildImageUrls`, `buildPackageWeightAndSize`, `getSelectedPolicies`, `getBestOfferTerms`, `variantSkuFromOption` | Already fully imported |
| `editor.js` | `quillToolbar`, `descState`, `resetQuillEditorMount`, `toggleDescMode`, `getDescriptionHtml` | Already fully imported |
| `images.js` | `renderImageStrip`, `showGalleryPicker` | Already fully imported |
| `volPricing.js` | `addVolTier`, `getVolTiers`, `setVolTiers` | Already fully imported |
| `profitPreview.js` | `buildEstimate`, `renderPreview` | Already fully imported |
| `priceReference.js` | `buildPriceRef`, `renderPriceRef`, `fetchSalesMetrics` | Already fully imported |
| `api.js` | `callEdge` | Already fully imported |
| `listingHealth.js` | `computeHealth` | Not Push-specific but in imports |

---

## 5. Recommended Extraction Phases

### Push Phase A — Pure product helpers → `utils.js` ✅ (IMPLEMENTED in doc 021)
**Move:** `publishQuantityForProduct`, `activeVariantCount`, `isEffectiveGroupListing`  
**Why safe:** Zero deps, zero DOM, zero state. Pure functions of product data.  
**Risk:** Near zero.

### Push Phase B — Pure DOM helpers → `utils.js` or new home
**Move:** `addAiBadge(inputId, source)`, `imageOptionLabel(url, idx)`, `enableBtn(id, enabled)`  
**Why safe:** Zero module state, zero eBay. All are generic DOM helpers.  
**Caveat:** `addAiBadge` is called by both push AND edit modal AI fill, so it belongs in a shared helper, not in `pushModal.js`.  
**Risk:** Very low.

### Push Phase C — Aspect helpers → `aspectHelpers.js`
**Move:** `buildAspectField`, `collectAspects`, `validateRequiredAspects`  
**Note:** `buildEditAspectField` and its edit counterpart DOM queries (`[data-edit-aspect]`) are structurally similar but differ in attribute names and datalist prefix. They could optionally be unified into one parameterized function here, but only if existing markup is not changed.  
**Deps:** `esc` from `utils.js`.  
**Risk:** Low. Verify aspects still render after move.

### Push Phase D — Variant image panel helpers → `variantPanel.js`
**Move:** `renderVariantAssignedImages`, `getAssignedVariantImages`, `setAssignedVariantImages`, `renderVariantCandidatePicker`, `refreshVariantCandidateButtons`, `wireVariantImageSetControls`, `renderVariantPanel`, `getCheckedVariants`  
**Blocker:** `renderVariantPanel` reads `currentProduct` for image candidates — must be passed as parameter.  
**Deps:** `esc`, `buildImageUrls` from `utils.js`; `variantSkuFromOption` from `utils.js`.  
**Risk:** Medium — variant image wiring is complex. Test variant push flow end-to-end.

### Push Phase E — `openPush` hydration → `pushModal.js`
**Move:** `openPush(code)`, push modal event listeners  
**Deps (to inject):** `allProducts`, `callEdge`, `loadProducts` (callback), `pageAdRatePct`  
**State to make push-local:** `currentProduct`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushSalesMetrics`, `currentAspects`  
**Blocker:** Cannot move until Phase D is done (variant panel), Phase A-C helpers are imported, and `doPublish`/`doWithdraw` still need access to `currentProduct`+`isVariantListing`. May require cross-module state sharing via a thin exported getter, or passing state into `doPublish` as parameters.  
**Risk:** High. Full integration test required.

### Push Phase F — Create item / create offer / publish handlers
**Move:** `btnCreateItem`, `btnCreateOffer`, `btnPublish` listeners  
**Note:** These are best moved together with `openPush` (Phase E) since they share push-local state tightly.  
**Risk:** High. eBay mutation path. Test all three steps (non-variant and variant) in staging or against live eBay with a known test SKU.

---

## 6. Suggested `pushModal.js` API (Future)

```js
// Injected once at init time
export function initPushModal({
  getProducts,         // () => allProducts — avoids import of index state
  callEdge,            // from api.js
  onPushComplete,      // () => loadProducts() — callback after success
  getPageAdRatePct,    // () => pageAdRatePct — getter for current ad rate
}) { ... }

// Called from handleProductAction dispatcher
export async function openPush(code) { ... }
```

**Dependencies `pushModal.js` would import directly:**
- `esc`, `sanitizeForEbay`, `wrapDescription`, `isComplexHtml`, `buildImageUrls`, `buildPackageWeightAndSize`, `getSelectedPolicies`, `getBestOfferTerms`, `variantSkuFromOption` from `./utils.js`
- `quillToolbar`, `descState`, `resetQuillEditorMount`, `toggleDescMode`, `getDescriptionHtml` from `./editor.js`
- `renderImageStrip`, `showGalleryPicker` from `./images.js`
- `addVolTier`, `getVolTiers`, `setVolTiers` from `./volPricing.js`
- `buildEstimate`, `renderPreview` from `./profitPreview.js`
- `buildPriceRef`, `renderPriceRef`, `fetchSalesMetrics` from `./priceReference.js`
- `computeHealth` — not needed by push directly
- `addAiBadge`, `enableBtn`, `imageOptionLabel` — from `./utils.js` (after Phase B)
- `buildAspectField`, `collectAspects`, `validateRequiredAspects` — from `./aspectHelpers.js` (after Phase C)
- `renderVariantPanel`, `getCheckedVariants` — from `./variantPanel.js` (after Phase D)

**Dependencies passed via `initPushModal(deps)` to avoid circular imports:**
- `getProducts` — returns `allProducts`
- `callEdge` — already imported in `pushModal.js` directly; no need to pass
- `onPushComplete` — `() => loadProducts()` callback
- `getPageAdRatePct` — getter function

---

## 7. What Must NOT Move Until Later

| Item | Reason |
|---|---|
| `doPublish`, `doWithdraw`, `discardDraft` | Shared by both the explicit push flow and by action handlers in `handleProductAction` |
| `isEffectiveGroupListing` | Used by `doWithdraw`, `doPublish`, `openEdit` — move to `utils.js` first (Phase A) |
| `refreshPushPreview` + `refreshPushRef` | Read `currentProduct` + `pushSalesMetrics` which are module-level; move last |
| `loadAndRenderPriceRef` | Shared by push and edit; move to a common helper or pass as injected dep |
| Push event listeners | Can't detach until `openPush` owns its own init |

---

## 8. Dependency Check: No Circular Risk

All phase extract targets import only from modules that do not import from `index.js`. The planned `pushModal.js` module would import from leaf modules only (`utils.js`, `editor.js`, `images.js`, etc.) and receive `index.js` callbacks via injection.

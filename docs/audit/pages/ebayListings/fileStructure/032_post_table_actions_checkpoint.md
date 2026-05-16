# 032 — Post–Phase J Checkpoint: Architecture Audit & Extraction Roadmap

**Date:** 2025-07  
**Status:** Documentation-only pass. No code changed.  
**Scope:** Full audit of `js/admin/ebayListings/` after Phase J (`tableActions.js` extraction).

---

## 1. Current File Inventory (27 modules + index.js)

| File | Lines | Responsibility |
|---|---|---|
| `api.js` | 68 | `callEdge`, `fetchProductsWithWorkspaceMetrics`, `mergeWorkspaceMetrics` |
| `aspectHelpers.js` | 79 | `buildAspectField`, `buildEditAspectField`, `collectAspects`, `validateRequiredAspects` |
| `bulkActions.js` | 101 | `initBulkActions`, `updateBulkBar` |
| `cards.js` | 52 | `renderCards` |
| `editFetch.js` | 122 | `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure`, `getItemForEdit`, `getOffersForEdit`, `offerUpdateErrorMessage` |
| `editor.js` | 106 | `quillToolbar`, `descState`, `resetQuillEditorMount`, `toggleDescMode`, `getDescriptionHtml` |
| `filters.js` | 55 | `filterProducts` |
| `images.js` | 74 | `renderImageStrip`, `showGalleryPicker` |
| `importPanel.js` | 63 | `initImportPanel` |
| **`index.js`** | **~1,475** | **Page orchestrator — see §3** |
| `linkCheck.js` | 63 | 10 stale-link display helpers (`isOutOfStockLinkCheck`, `isStaleLinkCheck`, `currentActiveListingId`, `staleLinkMessage`, …) |
| `listingHealth.js` | 193 | `computeHealth` |
| `modalPreviews.js` | 126 | `refreshPushPreview`, `refreshEditPreview`, `refreshPushRef`, `refreshEditRef`, `addAiBadge` |
| `policyCache.js` | 52 | `loadPoliciesCache`, `populatePolicyDropdowns`, `cachedPolicies` state — **Phase H** |
| `priceReference.js` | 247 | `buildPriceRef`, `renderPriceRef`, `fetchSalesMetrics`, `loadAndRenderPriceRef` |
| `productActions.js` | 41 | `renderProductActions` |
| `profitPreview.js` | 347 | `buildEstimate`, `renderPreview` |
| `reconcileActions.js` | 139 | `createReconcileActions` factory: `reconcileEbayLink`, `auditListingLinks`, `relinkEbayListing`, `clearStaleEbayLink`, `renderEditLinkWarning` — **Phase I** |
| `renderHelpers.js` | 119 | `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` |
| `salesHistory.js` | 185 | `openSalesHistory`, `closeSalesHistory` |
| `setupPanel.js` | 65 | `initSetupPanel` |
| `table.js` | 58 | `renderTable` |
| `tableActions.js` | 97 | `createTableActions` factory: `discardDraft`, `doWithdraw`, `doPublish` — **Phase J** |
| `taxonomyApi.js` | 36 | `fetchAspectsForCategory`, `fetchCategorySuggestions` |
| `utils.js` | 159 | 15 pure helpers: `buildImageUrls`, `buildPackageWeightAndSize`, `esc`, `enableBtn`, `sanitizeForEbay`, `wrapDescription`, `isComplexHtml`, `variantSkuFromOption`, `getSelectedPolicies`, `getBestOfferTerms`, `isEffectiveGroupListing`, `publishQuantityForProduct`, `getCheckedVariants`, `getVolTiers`, `setVolTiers`, `addVolTier` |
| `variantPanel.js` | 159 | `renderVariantPanel`, `getCheckedVariants`, `setAssignedVariantImages`, `wireVariantImageSetControls`, `renderVariantCandidatePicker` |
| `volPricing.js` | 67 | `addVolTier`, `getVolTiers`, `setVolTiers` |

**Total satellite modules:** 27  
**Combined satellite lines:** ~3,445  
**`index.js` lines:** ~1,475

---

## 2. Line Count Trajectory

| After phase | Completion doc | `index.js` lines | Key extraction |
|---|---|---|---|
| Phase A–F | 026 | ~1,937 | Multiple early extractions |
| Phase G | 027 | ~1,854 | `editFetch.js` |
| Phase H | 029 | ~1,806 | `policyCache.js` |
| Phase I | 030 | ~1,695 | `reconcileActions.js` |
| Phase J | 031 | ~1,613 | `tableActions.js` (actual: **~1,475**) |
| **Current** | **032** | **~1,475** | — |

> The Phase J actual reduction was greater than estimated (~138 lines removed vs ~80 expected) because the doc 031 estimate was conservative.

---

## 3. `index.js` — Full Responsibility Map (Post–Phase J)

### Group 1: Imports (~lines 1–99)
27 ES module imports — one per satellite file.

### Group 2: Supabase client + Shared state (~lines 100–123)
```js
let allProducts, filteredProducts, currentView, currentProduct, currentAspects
let pushQuill, editQuill, pushImageUrls, editImageUrls
let editVariantImageOverrides, editVariantQtyOverrides
let pushVariants, isVariantListing, editProduct, editAspects
let searchTimeout, pushSalesMetrics, editSalesMetrics, pageAdRatePct
let editOfferLookupCache = new Map()
```
These `let` bindings are owned by `index.js` because they are shared across `openPush`, `openEdit`, event handlers, and the factory closures.

### Group 3: Factory instantiation (~lines 124–135)
```js
const { reconcileEbayLink, auditListingLinks, … } = createReconcileActions({…})
const { discardDraft, doWithdraw, doPublish } = createTableActions({…})
```

### Group 4: `showStatus` (~lines 137–145)
8-line pure DOM helper. Low extraction value due to size; leave in place.

### Group 5: `loadProducts` (~lines 146–162)
Page data-fetch orchestrator. Calls `fetchProductsWithWorkspaceMetrics`, `applyFilters`, `updateStats`, `auditListingLinks`. Must stay — uses most page state.

### Group 6: `applyFilters`, `renderAll`, `setView` (~lines 163–196)
Page orchestration triad. `renderAll` calls `renderTable`, `renderCards`, `updateBulkBar`. Hard to move without coupling.

### Group 7: `updateStats` (~lines 197–209)
Writes 4 stat counters to DOM. ~12 lines. Not worth extracting standalone.

### Group 8: `fetchAspects(categoryId)` (~lines 210–236)
Calls `fetchAspectsForCategory`, mutates `currentAspects`, renders aspect fields into Push modal DOM. Only called from the Push modal category-search event listener. **Extraction candidate** — see §5.

### Group 9: `openPush(code)` (~lines 237–395)
~159 lines. Sets up entire Push modal state:
- Reads from `allProducts`, writes `currentProduct`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushSalesMetrics`
- Calls 15+ DOM element IDs for initial population
- Calls `buildImageUrls`, `renderImageStrip`, `renderVariantPanel`, `resetQuillEditorMount`, `loadAndRenderPriceRef`, `refreshPushPreview`, `callEdge` (draft resume)
- Complex async logic (draft resume with item fetch + form pre-fill)
- **Hard to extract** — owns or mutates 6 shared state vars; see §4 risk notes.

### Group 10: `openEdit(code)` (~lines 396–662)
~267 lines. Sets up entire Edit modal state:
- Reads `allProducts`, writes `editProduct`, `editQuill`, `editImageUrls`, `editVariantImageOverrides`, `editVariantQtyOverrides`, `editAspects`, `editSalesMetrics`, `editOfferLookupCache`
- Calls `reconcileEbayLink`, `getItemForEdit`, `getOffersForEdit`, `buildImageUrls`, `renderImageStrip`, `renderEditVariantImageControls`, `resetQuillEditorMount`, `loadPoliciesCache`, `fetchAspectsForCategory`, `loadAndRenderPriceRef`, `refreshEditPreview`
- 3 async paths: group listing, single listing, draft-with-no-offer
- **Highest complexity** — 267 lines with 9 state mutations and 3 eBay API call paths.

### Group 11: `renderEditVariantImageControls(product, group)` (~lines 663–750)
~88 lines. Renders per-variant image+qty controls in the Edit modal. Calls `getItemForEdit` for each variant SKU via `Promise.all`, writes `editVariantImageOverrides` and `editVariantQtyOverrides`. Returns `{ rows, failures }`.
- **Extraction candidate** — see §5.

### Group 12: Event Listeners (~lines 752–1,475)
~723 lines. Covers:

| Sub-group | Est. lines | Description |
|---|---|---|
| Search + view toggles | ~45 | `searchInput`, `searchClear`, `statusFilter`, `quickFilter`, `adRateFilter`, `view-toggle-btn` |
| Push modal — close + live updates | ~20 | Close, `modalPrice`, `modalWeightOz` |
| Push modal — add image + desc mode | ~20 | `btnAddImgPush`, `btnPushVisual/Html/Preview` |
| Push modal — category search | ~37 | `btnSearchCat` → `fetchCategorySuggestions` → `fetchAspects` |
| Push modal — AI auto-fill | ~50 | `btnAiFill` → `callEdge("ebay-ai-autofill")` |
| Push modal — Step 1: Create Item(s) | ~128 | Single + variant paths, `callEdge("create_item")` |
| Push modal — Step 2: Create Offer | ~118 | Single + variant group paths, `callEdge("create_offer"/"create_group_offer")` |
| Push modal — Step 3: Publish | ~62 | `callEdge("publish"/"publish_group")` + vol pricing |
| Edit modal — close + relink + live updates | ~25 | Close, `btnEditRelink`, price/weight listeners, adRate |
| `handleProductAction` dispatcher | ~30 | Delegated click handler for table/card action buttons |
| Edit modal — add image + desc mode | ~20 | `btnAddImgEdit`, `btnEditVisual/Html/Preview` |
| Edit modal — AI auto-fill | ~70 | `btnEditAiFill` → `callEdge("ebay-ai-autofill")` |
| Edit modal — Save Changes | ~210 | Group + single paths, item/offer update, vol pricing, store cat persist |
| `initBulkActions` call | ~2 | Pass deps |
| Checkbox toggles (Best Offer, Lot, Vol) | ~20 | 6 toggles |
| `initSetupPanel`, `initImportPanel` | ~5 | Pass deps |
| Refresh button + `init()` | ~10 | `loadProducts()` wiring, `init()` function + call |

**Event listeners total estimate: ~872 lines** — largest remaining block.

---

## 4. Extraction Risk Assessment

| Candidate | Est. Lines | Risk | Risk Reason |
|---|---|---|---|
| `fetchAspects` | ~26 | **Low** | Called once (from category search handler), mutates `currentAspects`, accesses no modal state directly beyond that one write |
| `renderEditVariantImageControls` | ~88 | **Medium-Low** | Reads/writes `editVariantImageOverrides`, `editVariantQtyOverrides`, `editImageUrls`; needs all three as deps; return value is used in `openEdit` |
| `openPush` | ~159 | **High** | Mutates 6 state vars; calls `callEdge` directly; mixed with DOM IDs; tight coupling to Push modal event handlers that reference `currentProduct`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushQuill` by name |
| `openEdit` | ~267 | **Very High** | Most complex function in file; mutates 9 state vars; 3 async code paths; `renderEditVariantImageControls` is a synchronous sub-call inside it |
| Push modal handlers (Create Item / Create Offer / Publish) | ~308 | **Very High** | Each handler reads many shared state vars (`currentProduct`, `isVariantListing`, `pushVariants`, `pushImageUrls`, `pushQuill`, `descState`); tightly coupled to each other (Step 1 → Step 2 → Step 3 flow) |
| Edit modal save handler | ~210 | **High** | Reads `editProduct`, `editQuill`, `editImageUrls`, `editVariantImageOverrides`, `editVariantQtyOverrides`, `editAspects`; calls `reconcileEbayLink`, `getOffersForEdit`, `callEdge` |
| `handleProductAction` dispatcher | ~30 | **Low** | Pure dispatcher; calls already-extracted functions; safe standalone extraction |

---

## 5. Recommended Extraction Order — Phase K Onward

### Phase K: `handleProductAction` dispatcher (~30 lines → `actionDispatcher.js`)
**Justification:** Cleanest extraction available. The function is a pure event dispatcher — it reads `e.target.closest("[data-action]")` and calls only already-extracted named functions (`openPush`, `openEdit`, `openSalesHistory`, `relinkEbayListing`, `clearStaleEbayLink`, `doWithdraw`, `doPublish`, `discardDraft`). No shared state mutations. Easy factory pattern.

```js
// actionDispatcher.js — proposed signature
export function createActionDispatcher({ openPush, openEdit, openSalesHistory,
  relinkEbayListing, clearStaleEbayLink, doWithdraw, doPublish, discardDraft, getProducts }) { … }
```

**Concern:** `openPush` and `openEdit` will remain in `index.js` for now (they are not yet extractable), so the dispatcher still depends on them — but via injected function refs, so no circular import.

---

### Phase L: `fetchAspects` (~26 lines → inline in `aspectHelpers.js` or thin wrapper)
**Justification:** The function is 26 lines, calls `fetchAspectsForCategory`, and mutates `currentAspects` plus writes to 3 DOM elements. It is only called from the Push modal category search handler.

**Options:**
- **Option L-A**: Absorb into `aspectHelpers.js` as an exported helper that takes a `setCurrentAspects` callback. Keeps aspect-DOM work co-located with the aspect-field builders.
- **Option L-B**: Leave in `index.js` — at 26 lines it may not be worth the plumbing.

> **Recommendation:** Option L-B (leave) unless `openPush` extraction is imminent and `fetchAspects` would be logically moved with it.

---

### Phase M: `renderEditVariantImageControls` (~88 lines → `variantPanel.js` or standalone)
**Justification:** Logically belongs with variant panel work. Calls `getItemForEdit` (from `editFetch.js`), reads `editImageUrls`, writes `editVariantImageOverrides` / `editVariantQtyOverrides`. Can be extracted with a dependency bag.

**Proposed signature:**
```js
// added export in variantPanel.js
export async function renderEditVariantImageControls(product, group, {
  getEditImageUrls, setVariantImageOverride, setVariantQtyOverride
}) { … }
```

**Risk:** Medium-low. The function's `rows` / `failures` return value is used inline in `openEdit`; a callback-based return still works cleanly.

---

### Phase N (Future): `openPush` and Push modal handlers
**Pre-condition:** `fetchAspects`, `renderEditVariantImageControls` and `handleProductAction` must be extracted first to reduce coupling scope.

**Strategy when ready:** Bundle `openPush` + all 3 Push modal step handlers (Create Item, Create Offer, Publish) + AI auto-fill (push) + category search handler into a single `pushModal.js` factory. They all share the same state set (`currentProduct`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushQuill`, `descState`).

**Proposed signature:**
```js
export function createPushModal({ getProducts, loadProducts, showStatus,
  callEdge, supabase }) {
  // owns: currentProduct, pushImageUrls, pushVariants, isVariantListing, pushQuill, pushSalesMetrics
  return { openPush, bindEventListeners };
}
```

This phase is the largest single reduction opportunity (~380+ lines) but has the highest coupling risk. **Do not attempt without a full line-by-line dependency map.**

---

### Phase O (Future): `openEdit` + Edit modal handlers
**Pre-condition:** Phase N complete, all shared state refactored.

**Strategy:** Same factory pattern as Push modal. `openEdit` + Edit AI auto-fill + Edit save handler share `editProduct`, `editQuill`, `editImageUrls`, `editVariantImageOverrides`, `editVariantQtyOverrides`, `editAspects`, `editSalesMetrics`, `editOfferLookupCache`.

---

## 6. Hard Rules (Unchanged)

1. **No behavior changes** — all eBay API payloads must be byte-for-byte identical.
2. **No bundler / build tools** — ES module `import` only, browser-native.
3. **No circular imports** — satellite modules import only from other satellites (never from `index.js`).
4. **Factory pattern** for any module needing page state — inject via parameter bag, lazy-close over state via `() => stateVar`.
5. **Do not move `openPush` or `openEdit`** until a full dependency map for their respective event handler blocks exists.

---

## 7. Estimated Lines to Remove by Phase

| Phase | Target | Est. Removal | Post-phase `index.js` |
|---|---|---|---|
| K | `handleProductAction` | ~30 | ~1,445 |
| L | `fetchAspects` (if extracted) | ~26 | ~1,419 |
| M | `renderEditVariantImageControls` | ~88 | ~1,331 |
| N | `openPush` + Push modal handlers | ~380 | ~951 |
| O | `openEdit` + Edit modal handlers | ~430 | ~521 |
| Final | Remaining orchestration | ~120 | ~400 |

The 400-line residual would be: imports, state declarations, factory calls, `showStatus`, `loadProducts`, `applyFilters`, `renderAll`, `setView`, `updateStats`, wiring + init.

---

## 8. Phase K Pre-Flight Checklist

Before starting Phase K (`handleProductAction` extraction), verify:

- [ ] `tableActions.js` (`discardDraft`, `doWithdraw`, `doPublish`) works in production — all three destructured correctly from factory
- [ ] `reconcileActions.js` (`relinkEbayListing`, `clearStaleEbayLink`) still wired correctly
- [ ] `openSalesHistory` / `closeSalesHistory` import from `salesHistory.js` unchanged
- [ ] `handleProductAction` current code dispatches to exact function names with `code` + `offerId` + `groupKey` args as currently defined

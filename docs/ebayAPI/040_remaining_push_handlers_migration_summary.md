# 040 — Remaining Push Handlers Migration Summary

**Phase N-6** (following N-5 which migrated `btnCreateItem`)

---

## Files Changed

| File | Before | After | Delta |
|---|---|---|---|
| `js/admin/ebayListings/pushModal.js` | 476 lines | 876 lines | +400 |
| `js/admin/ebayListings/index.js` | 1,291 lines | 920 lines | −371 |

---

## Handlers Moved into `pushModal.js`

All listeners now wired via `bindRemainingPushListeners()`, exported from the `createPushModalContext` factory:

| Handler / control | `index.js` element | Migrated |
|---|---|---|
| Push modal close | `btnCloseModal` | ✅ |
| Profit preview (price input) | `modalPrice` input | ✅ |
| Price reference (price input) | `modalPrice` input | ✅ |
| Weight preview | `modalWeightOz` input | ✅ |
| Ad-rate change | `modalAdRate` change | ✅ |
| Add push image | `btnAddImgPush` | ✅ |
| Description → Visual mode | `btnPushVisual` | ✅ |
| Description → HTML mode | `btnPushHtml` | ✅ |
| Description → Preview mode | `btnPushPreview` | ✅ |
| Category search | `btnSearchCat` | ✅ |
| AI Auto-Fill | `btnAiFill` | ✅ |
| **Step 2: Create Offer / Group+Offer** | `btnCreateOffer` | ✅ |
| **Step 3: Publish** | `btnPublish` | ✅ |
| Best Offer toggle | `modalBestOffer` | ✅ |
| Lot-size toggle | `modalLotEnabled` | ✅ |
| Volume-pricing toggle | `modalVolEnabled` | ✅ |
| Add volume tier | `modalAddTier` | ✅ |

Previously migrated (Phase N-5):

| Handler | Migrated in |
|---|---|
| `btnCreateItem` — Create Item / Create Items | N-5 (`bindCreateItemListener`) |

---

## What Stayed in `index.js`

- All **Edit modal** handlers (close, save, relink, price/weight preview, AI fill, description mode, add image)
- `editAdRate` change listener
- `editBestOffer`, `editLotEnabled`, `editVolEnabled`, `editAddTier` checkbox handlers
- `createPushModalContext` instantiation (`pushCtx`) — the factory call with all sync-back callbacks
- All table/card/bulk/setup/import wiring
- `openEdit`, `openSalesHistory`, `relinkEbayListing`, etc.
- `init()`, `loadProducts()`, `showStatus()`

---

## New Imports Added to `pushModal.js`

| Symbol(s) | Module |
|---|---|
| `getSelectedPolicies`, `getBestOfferTerms`, `addAiBadge`, `esc` | `./utils.js` |
| `showGalleryPicker` | `./images.js` |
| `refreshPushRef` | `./modalPreviews.js` |
| `buildAspectField` | `./aspectHelpers.js` |
| `addVolTier`, `getVolTiers` | `./volPricing.js` (new) |
| `fetchCategorySuggestions` | `./taxonomyApi.js` (new) |
| `fetchAndRenderAspects` | `./aspectFlow.js` (new) |

---

## State Sync Details

All migrated handlers read Push state via `state.*` directly (no let-var indirection). Writes use setters:

| State field | Migrated access pattern |
|---|---|
| `currentProduct` | `state.currentProduct` (read); `setCurrentProduct(null)` on close |
| `pushQuill` | `state.pushQuill` (read) |
| `pushImageUrls` | `state.pushImageUrls` (read) |
| `pushVariants` | `state.pushVariants` (read) |
| `isVariantListing` | `state.isVariantListing` (read) |
| `currentAspects` | `state.currentAspects` (read); `setCurrentAspects(aspects)` in cat-search `onAspects` callback |
| `pushSalesMetrics` | `state.pushSalesMetrics` (read for preview/ref) |
| `loadProducts` | `deps.loadProducts()` in Publish step |
| `currentProduct._offerId` | Mutated directly (same object ref — visible through sync-back) |
| `currentProduct._groupKey` | Mutated directly (same object ref) |
| `currentProduct._groupOfferIds` | Mutated directly (same object ref) |

**Sync-back callbacks** in the `createPushModalContext` instantiation in `index.js` are still present and still fire correctly (they are now no-ops for most paths since no index.js code reads Push let-vars after handlers migrated, but they are harmless and can be cleaned up in a future pass).

---

## How `index.js` Wires Push Behavior

```js
// Push Modal — Step 1: Create Item(s)
// Push Modal — all remaining listeners wired via pushCtx:
pushCtx.bindCreateItemListener();
pushCtx.bindRemainingPushListeners();
```

Both functions are called once at module scope during page init. They register all Push-modal DOM listeners.

`pushCtx.openPush` is passed to the product action dispatcher:
```js
const handleProductAction = createProductActionDispatcher({
  openPush: pushCtx.openPush,
  ...
});
```

---

## Behavior Guarantees

- **No eBay payload changes**: all `callEdge` calls pass identical arguments
- **Step sequencing preserved**: Create Item → Create Offer → Publish button enable/disable flow unchanged
- **Variant path**: `getCheckedVariants`, SKU dedup, group creation, group offer preserved exactly
- **Resume-draft path**: inside `openPush` (Phase N-3), unchanged
- **Volume pricing on Publish**: `getVolTiers("modal")` now imported from `./volPricing.js` in pushModal.js
- **Category search + aspects**: `fetchAndRenderAspects` callback uses `setCurrentAspects` (still fires sync-back to index.js `currentAspects` let-var)
- **AI fill**: Uses `state.currentAspects`, `state.pushImageUrls`, `state.pushQuill`, `state.currentProduct`
- **Close**: Calls `setCurrentProduct(null)` which fires sync-back to `currentProduct = null` in index.js

---

## Verification

```
node --check js/admin/ebayListings/pushModal.js  → PASS
node --check js/admin/ebayListings/index.js      → PASS
```

No remaining Push listener registrations found in `index.js` (confirmed by `Select-String`).

---

## Recommended Next Phase

**N-8 (optional cleanup)**: Remove sync-back callbacks from the `createPushModalContext` instantiation in `index.js` that are no longer needed (since no remaining index.js code reads the Push state let-vars). Specifically, remove:
- `onCurrentProductChange`, `onPushQuillChange`, `onPushImageUrlsChange`
- `onPushVariantsChange`, `onIsVariantListingChange`
- `onCurrentAspectsChange`, `onPushSalesMetricsChange`

And remove the now-unused Push let-vars from index.js:
- `currentProduct`, `currentAspects`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushSalesMetrics`

**Prerequisite for N-8**: Confirm no other index.js code (e.g. openEdit, renderAll) reads any of those let-vars. openEdit uses `editProduct` not `currentProduct`, so this should be safe.

> After N-8, `pushModal.js` will be the sole owner of all Push-modal state, and the sync-back bridge can be removed entirely.

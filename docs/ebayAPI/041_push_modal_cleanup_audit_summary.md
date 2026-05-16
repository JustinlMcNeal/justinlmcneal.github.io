# 041 — Phase N-8: Push Modal Cleanup Audit

## Objective

Following the N-6 migration of all Push-only handlers into `pushModal.js`, phase N-8 audited `index.js` for residual Push coupling and removed everything that was only there to support the now-migrated Push flow.

---

## Changes Applied

### 1. Stale Import Removal

Five import sources were trimmed; symbols referenced only by Push handlers were dropped while Edit-modal symbols in the same lines were preserved.

| Source file | Removed | Kept |
|---|---|---|
| `utils.js` | `variantSkuFromOption`, `publishQuantityForProduct`, `activeVariantCount`, `enableBtn`, `imageOptionLabel` | `esc`, `sanitizeForEbay`, `wrapDescription`, `isComplexHtml`, `buildImageUrls`, `buildPackageWeightAndSize`, `getSelectedPolicies`, `getBestOfferTerms`, `isEffectiveGroupListing`, `addAiBadge` |
| `aspectHelpers.js` | `buildAspectField`, `collectAspects`, `validateRequiredAspects` | `buildEditAspectField` |
| `variantPanel.js` | `renderVariantPanel`, `getCheckedVariants`, `renderVariantAssignedImages`, `getAssignedVariantImages`, `setAssignedVariantImages`, `renderVariantCandidatePicker`, `refreshVariantCandidateButtons`, `wireVariantImageSetControls` | `renderEditVariantImageControls` |
| `modalPreviews.js` | `refreshPushPreview`, `refreshPushRef` | `refreshEditPreview`, `refreshEditRef`, `loadAndRenderPriceRef` |
| `taxonomyApi.js` / `aspectFlow.js` | `fetchCategorySuggestions` (from taxonomyApi); entire `import { fetchAndRenderAspects } from "./aspectFlow.js"` line | `fetchAspectsForCategory` |

### 2. Push-Only State Variables Removed

All 7 Push-scoped `let` declarations were deleted from the Shared State block in `index.js`. These variables were never read in `index.js`; they existed only to receive values through sync-back callbacks.

| Removed variable | Former declaration |
|---|---|
| `currentProduct` | `let currentProduct = null;` |
| `currentAspects` | `let currentAspects = [];` |
| `pushQuill` | `let pushQuill = null;` |
| `pushImageUrls` | `let pushImageUrls = [];` |
| `pushVariants` | `let pushVariants = [];` |
| `isVariantListing` | `let isVariantListing = false;` |
| `pushSalesMetrics` | `let pushSalesMetrics = null;` |

### 3. Sync-Back Callbacks Removed from `pushCtx` Factory Call

The `createPushModalContext(...)` call previously passed 7 `on*Change` callbacks whose sole purpose was writing back into the now-removed let-vars. Those callbacks and the accompanying stale comment were removed:

```js
// Before (N-6 scaffolding)
const pushCtx = createPushModalContext({
  getProducts:  () => allProducts,
  loadProducts,
  showStatus,
  getAdRatePct: () => pageAdRatePct,
  onCurrentProductChange:    (p)  => { currentProduct   = p; },
  onPushQuillChange:         (q)  => { pushQuill        = q; },
  onPushImageUrlsChange:     (u)  => { pushImageUrls    = u; },
  onPushVariantsChange:      (v)  => { pushVariants     = v; },
  onIsVariantListingChange:  (iv) => { isVariantListing = iv; },
  onCurrentAspectsChange:    (a)  => { currentAspects   = a; },
  onPushSalesMetricsChange:  (m)  => { pushSalesMetrics = m; },
});

// After (N-8)
const pushCtx = createPushModalContext({
  getProducts:  () => allProducts,
  loadProducts,
  showStatus,
  getAdRatePct: () => pageAdRatePct,
});
```

---

## Intentionally Preserved

All Edit-modal imports, state variables (`editQuill`, `editImageUrls`, `editVariantImageOverrides`, `editVariantQtyOverrides`, `editProduct`, `editAspects`, `editSalesMetrics`), and handlers were left untouched. No behavior was changed.

`pageAdRatePct` was also kept — it is still read by `getAdRatePct`, `renderCards`, `renderTable`, and the ad-rate filter event listener.

---

## Verification

Both files pass syntax check with no errors:

```
node --check js/admin/ebayListings/index.js    → OK
node --check js/admin/ebayListings/pushModal.js → OK
```

Word-boundary grep for all 7 removed Push vars in `index.js` returns zero matches.

---

## File State After N-8

| File | Status |
|---|---|
| `index.js` | ~890 lines. Owns Edit modal state and handlers only. Push wired entirely through `pushCtx`. |
| `pushModal.js` | 876 lines. Fully self-contained: owns all Push state, `openPush`, `bindCreateItemListener`, `bindRemainingPushListeners`. |

---

## Recommended Next Phase — N-9

**Audit `pushModal.js` internal organization.**

Now that `pushModal.js` owns the entire Push flow, review whether its single large factory function benefits from internal helper decomposition. Candidates:

- Extract the `bindRemainingPushListeners` body into named sub-functions within the factory (e.g. `bindCategoryHandlers`, `bindDescModeHandlers`, `bindVolumePricingHandlers`) for readability.
- Extract the AI-fill block into a dedicated `handleAiFill()` inner function.
- Extract the Create Offer / Publish sequence into `handleCreateOffer()` / `handlePublish()` inner functions.

**Constraint:** all behavior must remain byte-for-byte identical to the current implementation — no logic changes, no eBay payload changes, no new external dependencies.

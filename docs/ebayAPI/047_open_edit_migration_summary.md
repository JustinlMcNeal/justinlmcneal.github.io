# 047 — openEdit Migration Summary (E-2)

**Date:** 2025-07  
**Phase:** E-2 — `openEdit()` moved to `editModal.js`  
**Files changed:** `js/admin/ebayListings/editModal.js` (updated), `js/admin/ebayListings/index.js` (updated)

---

## Files Changed

| File | Change |
|---|---|
| `editModal.js` | Imports added (14 lines); factory JSDoc + params updated; `openEdit()` added (~175 lines); `openEdit` added to return object |
| `index.js` | `syncBack` added to `editCtx` instantiation; `openEdit` wrapper added; dispatcher updated; close handler updated (1 line) |

---

## What Moved — `openEdit()` into `editModal.js`

The full `openEdit(code)` implementation now lives in `editModal.js` as `async function openEdit(code)` inside the factory body.

**Translations applied:**

| index.js (before) | editModal.js (after) |
|---|---|
| `editProduct = ...` | `state.currentProduct = ...` |
| `editQuill = new Quill(...)` | `state.editQuill = new Quill(...)` |
| `editImageUrls = ...` | `state.editImageUrls = ...` |
| `editVariantImageOverrides = {}` | `state.editVariantImageOverrides = {}` |
| `editVariantQtyOverrides = {}` | `state.editVariantQtyOverrides = {}` |
| `editAspects = [...]` | `state.editAspects = [...]` |
| `editSalesMetrics = null` | `state.editSalesMetrics = null` |
| `editOfferLookupCache = new Map()` | `state.editOfferLookupCache = new Map()` |
| `allProducts.find(...)` | `deps.getProducts().find(...)` |
| `reconcileEbayLink(...)` | `deps.reconcileEbayLink(...)` |
| `renderEditLinkWarning(...)` | `deps.renderEditLinkWarning(...)` |
| `String(pageAdRatePct)` | `String(deps.getAdRatePct())` |

**Local alias used:** `const p = state.currentProduct;` — a local alias at the top of `openEdit()`. Mutations such as `p._groupData = group` and `p._linkCheck` (set by `reconcileEbayLink`) are reflected in `state.currentProduct` since both point to the same object. ✓

**`editVariantImageOverrides` / `editVariantQtyOverrides` mutation safety:** Both are reset to `{}` at the top of `openEdit()`, then passed by reference to `renderEditVariantImageControls`, which writes keys into them via async DOM-listener callbacks. After `deps.syncBack(state)` the let vars in index.js point to the same objects — all subsequent mutations propagate into both. ✓

### Imports added to `editModal.js`
All 14 symbols needed by `openEdit()` only:
- `isEffectiveGroupListing`, `buildImageUrls`, `isComplexHtml` from `utils.js`
- `quillToolbar`, `descState`, `resetQuillEditorMount` from `editor.js`
- `renderImageStrip` from `images.js`
- `setVolTiers` from `volPricing.js`
- `buildEditAspectField` from `aspectHelpers.js`
- `renderEditVariantImageControls` from `variantPanel.js`
- `refreshEditPreview`, `loadAndRenderPriceRef` from `modalPreviews.js`
- `fetchAspectsForCategory` from `taxonomyApi.js`
- `getItemForEdit`, `getOffersForEdit` from `editFetch.js`
- `loadPoliciesCache` from `policyCache.js`
- `isStaleLinkCheck`, `isOutOfStockLinkCheck`, `currentActiveListingId` from `linkCheck.js`
- `callEdge` from `api.js`

---

## Sync-Back Design

The remaining Edit handlers in index.js still read the old `let` vars (`editProduct`, `editQuill`, etc.). A temporary `syncBack` callback bridges them:

```js
syncBack: (s) => {
  editProduct               = s.currentProduct;
  editQuill                 = s.editQuill;
  editImageUrls             = s.editImageUrls;
  editVariantImageOverrides = s.editVariantImageOverrides;
  editVariantQtyOverrides   = s.editVariantQtyOverrides;
  editAspects               = s.editAspects;
  editSalesMetrics          = s.editSalesMetrics;
  editOfferLookupCache      = s.editOfferLookupCache;
},
```

`deps.syncBack(state)` is called in three places inside `openEdit()`:
1. End of the `try` block — syncs all 8 fields after the synchronous setup finishes
2. Inside the `loadAndRenderPriceRef` metrics callback — syncs `editSalesMetrics` when the async price ref resolves
3. End of the `catch` block — syncs in the error path so the close handler sees the correct `editProduct`

---

## What Stayed in `index.js`

- All 8 `let` Edit vars (`editProduct`, `editQuill`, etc.) — intact, synced via `syncBack`
- All Edit event listeners (close, relink, price/weight/adRate, add image, desc mode, AI fill, save, toggles) — unchanged
- `openEdit` function declaration — kept as a thin delegating wrapper with an early `return editCtx.openEdit(code)`:

```js
async function openEdit(code) {
  // Implementation has moved to editModal.js (createEditModalContext).
  // Dead code below is a migration remnant; removed in E-5 boundary cleanup.
  return editCtx.openEdit(code);
  /* eslint-disable no-unreachable */
  editProduct = allProducts.find(p => p.code === code);
  ...  // (old body — dead code, braces balance, node --check passes)
};
```

The dead-code body keeps the file syntactically valid while making clear the delegation. It is scheduled for removal in E-5.

### Three targeted changes to `index.js`

1. **`editCtx` instantiation** — `syncBack` callback added (8 field assignments)
2. **`createProductActionDispatcher`** — `openEdit` → `openEdit: editCtx.openEdit`
3. **Close handler** — `editCtx.setCurrentProduct(null)` added alongside `editProduct = null`:
   ```js
   editProduct = null;
   editCtx.setCurrentProduct(null);  // keep factory state in sync until close handler migrates in E-4
   ```
   This preserves the `state.currentProduct?.code` guard in the `loadAndRenderPriceRef` callback — if the user closes the modal while the price ref is still loading, both the let var and the factory state are null, and the stale-result guard correctly rejects the response.

---

## Behaviour Guarantees

- All DOM mutations, Quill setup, image strip, variant override pass-by-reference, aspect fetch+render, sales metrics callback, eBay link warning, and policy/cache logic are identical to the original — verbatim body, just variable prefix changed.
- The `syncBack` is called at end of `try`, end of `catch`, and inside the async price-ref callback — ensuring the let vars are current before any user interaction with the modal is possible.
- `editVariantImageOverrides` and `editVariantQtyOverrides` are objects passed by reference; post-`syncBack` they share identity between the `let` var and `state.*`, so DOM-wired mutations from `variantPanel.js` flow through to the save handler.
- `node --check` passes on both files.

---

## Verification

```
node --check js/admin/ebayListings/editModal.js  → no errors
node --check js/admin/ebayListings/index.js      → no errors
```

Grep confirms:
- `editCtx.openEdit` used in dispatcher (line 560, index.js)
- `return editCtx.openEdit(code)` in wrapper (line 215, index.js)
- `editCtx.setCurrentProduct(null)` in close handler (line 541, index.js)
- `async function openEdit(code) {` present in editModal.js (line 151)

---

## Next Recommended Phase — E-3

**Goal:** Extract `handleEditAiFill()` and `handleEditSave()` as named async functions inside the factory in `editModal.js`.

**Steps:**
1. Add the remaining Edit-exclusive imports to `editModal.js` that these handlers need:
   - From `utils.js`: `esc`, `sanitizeForEbay`, `wrapDescription`, `buildPackageWeightAndSize`, `getSelectedPolicies`, `getBestOfferTerms`, `addAiBadge`
   - From `editor.js`: `toggleDescMode`, `getDescriptionHtml`
   - From `volPricing.js`: `getVolTiers`
   - From `modalPreviews.js`: `refreshEditRef`
   - From `editFetch.js`: `offerUpdateErrorMessage`
   - From `linkCheck.js`: `isStaleLinkCheck` (already imported), `staleLinkMessage`
2. Move the `btnEditAiFill` listener body into `async function handleEditAiFill()` inside the factory; wire in `bindEditListeners()` stub.
3. Move the `btnSaveEdit` listener body into `async function handleEditSave()` inside the factory; add `deps.supabase` usage within it.
4. Replace the two inline listener callbacks in index.js with one-liners (`handleEditAiFill` / `handleEditSave`) — or leave them as stubs calling `editCtx` methods until `bindEditListeners` is implemented in E-4.
5. `node --check` both files. Test AI fill and save on a single-SKU and a group-variant listing.

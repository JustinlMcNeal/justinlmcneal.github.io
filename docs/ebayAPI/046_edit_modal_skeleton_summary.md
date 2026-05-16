# 046 — Edit Modal Skeleton Summary (E-1)

**Date:** 2025-07  
**Phase:** E-1 — State boundary skeleton  
**Files changed:** `js/admin/ebayListings/editModal.js` (created), `js/admin/ebayListings/index.js` (import + instantiation added)

---

## Files Changed

| File | Change |
|---|---|
| `js/admin/ebayListings/editModal.js` | **Created** — factory skeleton (~130 lines) |
| `js/admin/ebayListings/index.js` | Import added (1 line); `editCtx` instantiation block added (10 lines) |

No other runtime files were modified. All existing Edit variables, `openEdit()`, and Edit handlers remain in `index.js` unchanged.

---

## What Was Created — `editModal.js`

### Factory signature
```js
export function createEditModalContext({
  getProducts, loadProducts, showStatus, getAdRatePct,
  supabase,
  reconcileEbayLink, renderEditLinkWarning, relinkEbayListing,
} = {})
```
All 8 parameters default-safe (defaults are no-ops / empty returns).

### State fields (8)

| Field | Type | Initial value | Maps from index.js `let` var |
|---|---|---|---|
| `currentProduct` | `object\|null` | `null` | `editProduct` |
| `editQuill` | `Quill\|null` | `null` | `editQuill` |
| `editImageUrls` | `string[]` | `[]` | `editImageUrls` |
| `editVariantImageOverrides` | `{[sku]: string[]}` | `{}` | `editVariantImageOverrides` |
| `editVariantQtyOverrides` | `{[sku]: number}` | `{}` | `editVariantQtyOverrides` |
| `editAspects` | `object[]` | `[]` | `editAspects` |
| `editSalesMetrics` | `object\|null` | `null` | `editSalesMetrics` |
| `editOfferLookupCache` | `Map` | `new Map()` | `editOfferLookupCache` |

### Accessors (8 pairs — 16 functions)
One `get*()`/`set*()` pair per state field. Single-line implementations. All included in the return object.

### `resetEditState()`
Resets all 8 state fields to their initial values. Called by the close handler (in E-4). Included in the return object.

### `deps` object
Stores all 8 injected dependencies for use by future handler functions added in E-2 through E-4.

### Return object
```js
return {
  getCurrentProduct, setCurrentProduct,
  getEditQuill, setEditQuill,
  getEditImageUrls, setEditImageUrls,
  getEditVariantImageOverrides, setEditVariantImageOverrides,
  getEditVariantQtyOverrides, setEditVariantQtyOverrides,
  getEditAspects, setEditAspects,
  getEditSalesMetrics, setEditSalesMetrics,
  getEditOfferLookupCache, setEditOfferLookupCache,
  resetEditState,
};
```
No `deps`/`state` raw objects exported (lesson from N-11 cleanup).

---

## What Changed in `index.js`

### Import added (after pushModal import)
```js
import { createEditModalContext } from "./editModal.js";
```

### Instantiation added (after pushCtx block)
```js
const editCtx = createEditModalContext({
  getProducts:           () => allProducts,
  loadProducts,
  showStatus,
  getAdRatePct:          () => pageAdRatePct,
  supabase,
  reconcileEbayLink,
  renderEditLinkWarning,
  relinkEbayListing,
});
```

### Nothing else changed in index.js
The 8 `let editProduct/editQuill/...` vars remain.  
`openEdit()`, all Edit listeners, all Edit imports remain as-is.  
`editCtx` is instantiated but not yet wired to any handler.

---

## Behaviour Guarantees

- **Zero behaviour change at runtime.** `editCtx` is instantiated and sits idle; it is not called by any handler yet. All existing Edit modal interactions continue to use the unchanged `let` vars and inline handlers in index.js.
- **No import side effects.** `editModal.js` has no top-level statements that execute; the factory is only invoked when `createEditModalContext(...)` is called.
- **`editCtx` is ready.** When E-2 begins moving `openEdit()` into the factory, it can immediately use `state.*` fields via the accessor bridge.

---

## Verification

```
node --check js/admin/ebayListings/editModal.js  → no errors
node --check js/admin/ebayListings/index.js      → no errors
```

---

## Next Recommended Phase — E-2

**Goal:** Move `openEdit(code)` verbatim into the factory body in `editModal.js`.

**Steps:**
1. Add all Edit-exclusive imports to `editModal.js` (utils, editor, images, volPricing, aspectHelpers, variantPanel, modalPreviews, taxonomyApi, editFetch, policyCache, linkCheck symbols).
2. Move the `async function openEdit(code) { ... }` body into the factory. Replace all direct `editProduct =` / `editQuill =` / etc. references with `state.currentProduct` / `state.editQuill` / etc. (or accessor calls). Replace all reads of `reconcileEbayLink`, `renderEditLinkWarning` with `deps.*` equivalents.
3. Add `openEdit` to the `editModal.js` return object.
4. In `index.js`: remove the `openEdit` function; update `createProductActionDispatcher` call to `openEdit: editCtx.openEdit`. Remove Edit-only imports that are now fully owned by editModal.js.
5. `node --check` both files. Test open/close Edit on a single-SKU and a group-variant listing.

# 034 — Phase L: `renderEditVariantImageControls` Extraction Summary

**Date:** 2026-05-16  
**Status:** Complete  
**Phase:** L  
**`index.js` before:** 1,460 lines  
**`index.js` after:** 1,398 lines (−62)  
**`variantPanel.js` before:** 159 lines  
**`variantPanel.js` after:** 245 lines (+86)

---

## What Moved

### `renderEditVariantImageControls(product, group)` → `variantPanel.js`

The function was extracted verbatim into `variantPanel.js` as a new named export.
All rendering logic, DOM interactions, async variant fetching, image/qty override writes,
and return value shape are **byte-for-byte identical** to the original.

**Only change to observable behavior:** none. Page state is passed in; mutations happen in-place
on the same shared objects.

---

## What Stayed in `index.js`

Everything except the function body. Specifically retained:

- `openEdit(code)` — unchanged, still owns the call site
- Call site itself (line ~535): now passes a deps object (see §Signature Change)
- Edit save handler — unchanged
- `editVariantImageOverrides`, `editVariantQtyOverrides`, `editImageUrls` state — all remain declared in `index.js`
- All edit modal event handlers
- All push modal logic

---

## New Export: `variantPanel.js`

```js
export async function renderEditVariantImageControls(product, group, {
  editImageUrls,
  editVariantImageOverrides,
  editVariantQtyOverrides,
})
```

### Signature change from original

| | Original (index.js) | Extracted (variantPanel.js) |
|---|---|---|
| `product` | positional param | positional param (unchanged) |
| `group` | positional param | positional param (unchanged) |
| `editImageUrls` | closed-over page state | third param `{ editImageUrls }` |
| `editVariantImageOverrides` | closed-over page state | third param `{ editVariantImageOverrides }` |
| `editVariantQtyOverrides` | closed-over page state | third param `{ editVariantQtyOverrides }` |

`editVariantImageOverrides` and `editVariantQtyOverrides` are plain objects — property writes
inside the function mutate the original objects in-place, so `openEdit` and the save handler
see the same values they always did. Behavior is identical.

---

## New Imports in `variantPanel.js`

```js
// Added to utils.js import (was: esc, imageOptionLabel, buildImageUrls):
import { esc, imageOptionLabel, buildImageUrls, variantSkuFromOption } from "./utils.js";

// New import (no circular risk: variantPanel → editFetch → api.js):
import { getItemForEdit } from "./editFetch.js";
```

### Circular import check

```
variantPanel.js → utils.js          (existing, no issue)
variantPanel.js → editFetch.js      (new)
  editFetch.js  → api.js            (existing)
  api.js        → (nothing local)
```

No circular imports. `variantPanel.js` is not imported by `editFetch.js` or `api.js`.

---

## Updated `index.js`

### Import (variantPanel.js line added):
```js
import {
  renderVariantPanel,
  getCheckedVariants,
  renderVariantAssignedImages,
  getAssignedVariantImages,
  setAssignedVariantImages,
  renderVariantCandidatePicker,
  refreshVariantCandidateButtons,
  wireVariantImageSetControls,
  renderEditVariantImageControls,   // ← new
} from "./variantPanel.js";
```

### Call site in `openEdit` (unchanged outer logic, deps added):
```js
if (isGroupListing) {
  variantFetchSummary = await renderEditVariantImageControls(editProduct, editProduct._groupData, {
    editImageUrls,
    editVariantImageOverrides,
    editVariantQtyOverrides,
  });
}
```

Return value `{ rows, failures }` consumed by `openEdit` to set status text — unchanged.

---

## Dependencies Injected into `variantPanel.js`

| Dep | Source | How passed |
|---|---|---|
| `editImageUrls` | `index.js` page state | `deps.editImageUrls` (read-only) |
| `editVariantImageOverrides` | `index.js` page state | `deps.editVariantImageOverrides` (mutated in-place) |
| `editVariantQtyOverrides` | `index.js` page state | `deps.editVariantQtyOverrides` (mutated in-place) |
| `getItemForEdit` | `editFetch.js` | direct import (no circular risk) |
| `variantSkuFromOption` | `utils.js` | direct import (already a dep of variantPanel) |
| `esc` | `utils.js` | direct import (existing) |
| `renderVariantCandidatePicker` | local | already in same file |
| `setAssignedVariantImages` | local | already in same file |
| `wireVariantImageSetControls` | local | already in same file |

---

## Behavior Preservation Checklist

| Behavior | Status |
|---|---|
| Variant rows rendered per `group.variantSKUs` | ✅ Unchanged |
| Assigned image strips rendered | ✅ Unchanged |
| Candidate thumbnail picker built from `editImageUrls ∪ assignedImages` | ✅ Unchanged |
| Already-assigned images deduplicated | ✅ Unchanged — `new Set(...)` logic preserved |
| Remove image / set-main behavior | ✅ Unchanged — `wireVariantImageSetControls` call unchanged |
| Variant quantity inputs | ✅ Unchanged — `data-var-qty-sku` attr + `change` handler preserved |
| `editVariantImageOverrides[sku]` writes | ✅ In-place mutation on passed object — same effect |
| `editVariantQtyOverrides[sku]` writes | ✅ In-place mutation on passed object — same effect |
| Failed variant fetch fallback | ✅ Unchanged — `r.failed` check and warning div preserved |
| Transient `get_item` retry | ✅ Unchanged — `getItemForEdit` handles internally (unchanged) |
| Fallback warning copy | ✅ Byte-for-byte identical |
| `section.classList.remove("hidden")` gating | ✅ Unchanged |
| Return value `{ rows, failures }` shape | ✅ Unchanged |
| DOM IDs accessed | ✅ `editVariantImagesSection`, `editVariantImagesList` — unchanged |
| All data attributes | ✅ `data-var-qty-sku`, `data-variant-assigned-images`, `data-toggle-variant-picker`, `data-variant-picker` — unchanged |
| First-image-as-main behavior | ✅ Unchanged — `setAssignedVariantImages` call order unchanged |
| eBay payloads | ✅ Not touched — function is render-only |

---

## Verification Checklist

| # | Check | Result |
|---|---|---|
| 1 | `node --check variantPanel.js` | ✅ Pass (no output) |
| 2 | `node --check index.js` | ✅ Pass (no output) |
| 3 | No circular imports | ✅ Confirmed — variantPanel → editFetch → api (no cycle) |
| 4 | Page loads | ✅ Confirmed — screenshot at localhost:5500 |
| 5 | 59 products load | ✅ Confirmed |
| 6 | Table view renders | ✅ Confirmed |
| 7 | Card view | ✅ (view toggle present) |
| 8 | Edit modal — single listing | ✅ Code inspection — `openEdit` call site unchanged, deps object passed correctly |
| 9 | Edit modal — variant/group listing | ⚠️ Not tested live (would require triggering group listing opens with active eBay credentials). Verified by code inspection — logic path unchanged |
| 10 | Edit variant image controls | ⚠️ Not triggered live (requires group listing + eBay auth). Verified by code inspection — body byte-for-byte identical, state mutation semantics preserved |
| 11 | Quantity inputs render | ✅ Code inspection — `data-var-qty-sku` + `change` handler preserved |
| 12 | Failed fetch fallback | ✅ Code inspection — `r.failed` check, warning div, fallback copy unchanged |
| 13 | `editVariantImageOverrides` / `editVariantQtyOverrides` mutations | ✅ Pass-by-reference — behaviorally identical |
| 14 | No eBay payloads changed | ✅ Function is render-only, no `callEdge` in body |
| 15 | Console errors | ✅ None — only pre-existing "Not authenticated" warnings |

---

## Line Count After Phase L

| File | Before | After | Δ |
|---|---|---|---|
| `index.js` | 1,460 | 1,398 | −62 |
| `variantPanel.js` | 159 | 245 | +86 |

---

## Next Recommended Phase

The two-phase doc 032 roadmap is now at Phase L complete. Remaining candidates in order:

### Phase M: `fetchAspects(categoryId)` — optional (~26 lines)
**Justification:** Very small, low-risk. Called only from the Push modal category search handler.
Mutates `currentAspects` (Push modal state) and writes to Push modal DOM.
**Options:**
- Absorb into `aspectHelpers.js` with a `setCurrentAspects` callback
- Leave in `index.js` — at 26 lines with 1 call site, benefit is minimal

**Recommendation:** Skip unless `openPush` extraction is imminent (Phase N).

### Phase N: Pre-audit `openPush` + Push modal handlers (~380-line block)
**Pre-condition:** A full line-by-line dependency map of `openPush` and all 3 step handlers
(Create Item, Create Offer, Publish) must be written before attempting extraction.
These functions share `currentProduct`, `pushImageUrls`, `pushVariants`, `isVariantListing`,
`pushQuill`, `descState`, `pushSalesMetrics` — all tightly coupled.

**Recommended next doc:** A pre-extraction dependency map for `openPush` modal bundle
(similar approach to what was done before Phase I/J extractions).

### Do NOT attempt yet:
- `openEdit` extraction — 267 lines, 9 state vars, 3 async paths
- Full edit modal bundle extraction — requires `openEdit` pre-audit first

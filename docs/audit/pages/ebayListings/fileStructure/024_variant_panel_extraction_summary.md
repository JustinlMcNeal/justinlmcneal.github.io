# 024 — Variant Panel Extraction Summary (Push Phase D)

**Date:** 2026-05-15
**Phase:** Push Phase D
**Scope:** Extract variant panel and image assignment helpers from `index.js` → `variantPanel.js`

---

## What Moved

### New file: `js/admin/ebayListings/variantPanel.js`

Eight functions extracted from `index.js`:

| Function | Signature | Notes |
|---|---|---|
| `renderVariantAssignedImages` | `(container, urls)` | Unchanged |
| `getAssignedVariantImages` | `(row)` | Unchanged |
| `setAssignedVariantImages` | `(row, urls)` | Unchanged |
| `renderVariantCandidatePicker` | `(urls)` | Unchanged |
| `refreshVariantCandidateButtons` | `(row)` | Unchanged |
| `wireVariantImageSetControls` | `(row, onChange)` | Unchanged |
| `renderVariantPanel` | `(variants, baseCode, product)` | **Signature changed** — added `product` param |
| `getCheckedVariants` | `(variants, productCode)` | **Signature changed** — added `variants, productCode` params |

### Signature changes

**`renderVariantPanel`**: was `(variants, baseCode)`, now `(variants, baseCode, product)`
- Previous body used `currentProduct` directly: `buildImageUrls(currentProduct)`
- Now accepts `product` as a parameter; no page state needed inside the function
- Call site updated: `renderVariantPanel(activeVariants, currentProduct.code, currentProduct)`

**`getCheckedVariants`**: was `()`, now `(variants, productCode)`
- Previous body used `pushVariants[i]` and `currentProduct.code`
- Now accepts both as parameters; no page state needed inside the function
- 3 call sites updated: `getCheckedVariants(pushVariants, currentProduct.code)`

### `variantPanel.js` imports
```js
import { esc, imageOptionLabel, buildImageUrls } from "./utils.js";
```

---

## What Stayed in `index.js`

| Stayed | Reason |
|---|---|
| `openPush(code)` | Per hard rules |
| `openEdit(code)` | Per hard rules |
| `renderEditVariantImageControls(product, group)` | Edit modal variant image controls — separate from Push variant panel; would require `editVariantImageOverrides` state coupling |
| `pushVariants` variable | Module-level Push state — stays in index.js, passed as parameter to `getCheckedVariants` |
| `currentProduct` variable | Module-level state — stays in index.js, passed as parameter to `renderVariantPanel` and `getCheckedVariants` |
| Create item/offer/publish handlers | Per hard rules |

---

## Imports added to `index.js`
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
} from "./variantPanel.js";
```

---

## Files Changed

| File | Change |
|---|---|
| `js/admin/ebayListings/variantPanel.js` | **Created** — 8 exported functions |
| `js/admin/ebayListings/index.js` | Import added; 4 call sites updated; `// ── Variant Panel ──` section + 8 function definitions removed |

---

## Verification Results

| Check | Result |
|---|---|
| `node --check variantPanel.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| Page loads | ✅ 60 products rendered, no JS errors |
| Single-product Push modal opens | ✅ Confirmed (KK_0066 — no variant panel shown, hidden correctly) |
| Multi-variant Push modal opens (KK-0005 "Moto Jacket Crossbody") | ✅ variantPanel visible |
| Variant rows rendered | ✅ 6 rows, 6 checkboxes, 6 qty inputs |
| Assigned image containers | ✅ 6 containers render |
| Candidate pick toggle (+ Add image) | ✅ Opens picker with 42 candidate thumbnails |
| Assign image from picker | ✅ Image assigns, picker closes, candidate hidden |
| Remove image | ✅ Image removed from assigned strip |
| Set-Main | ✅ Clicked image promoted to first position with "Main" badge |
| `data-assigned-url` data attribute | ✅ Present on assigned thumbnails |
| `data-remove-assigned-url` | ✅ Wired and working |
| `data-set-main-url` | ✅ Wired and working |
| Edit modal opens | ✅ Confirmed |
| No JS module import errors | ✅ No 404s on variantPanel.js |
| No eBay payload changes | ✅ No payload code touched |
| No backend/edge function changes | ✅ Not touched |

---

## Dependency graph (post Phase D)

```
index.js
  ├── utils.js         (esc, buildImageUrls, imageOptionLabel, ...)
  ├── variantPanel.js  → utils.js
  ├── aspectHelpers.js → utils.js
  ├── renderHelpers.js
  ├── table.js         → renderHelpers.js, linkCheck.js, productActions.js, bulkActions.js, utils.js
  ├── cards.js         → renderHelpers.js, linkCheck.js, productActions.js, utils.js
  ├── linkCheck.js
  ├── productActions.js
  ├── bulkActions.js
  ├── filters.js
  ├── api.js
  ├── setupPanel.js
  └── importPanel.js
```

---

## Next Recommended Phase

### Push Phase E — `pushModal.js`

**Target:** Extract `openPush(code)` and the 3 step-button event handlers (`btnCreateItem`, `btnCreateOffer`, `btnPublish`) into `pushModal.js`.

**Risk level:** High — these are the most state-coupled functions in the file:
- `openPush` reads/writes: `currentProduct`, `pushVariants`, `isVariantListing`, `pushQuill`, `pushImageUrls`, `descState`, `currentAspects`, `pageAdRatePct`, `pushSalesMetrics`
- Create item handler reads: `currentProduct`, `pushVariants`, `isVariantListing`, `pushImageUrls`
- Create offer handler reads: `currentProduct`, `isVariantListing`
- Publish handler reads: `currentProduct`, `pushVariants`

**Dependency injection pattern:** Each function will need these state values passed as parameters, or the module will need to export setters/getters for a shared state object. The least invasive approach:
1. Define a `PushState` object in `index.js`
2. Pass it to each handler during `init()`
3. `pushModal.js` receives the state reference and calls back to `index.js` to mutate it

**Alternative (safer but more partial):** Only extract the 3 step buttons (create item, create offer, publish) into `pushModal.js` while leaving `openPush` in `index.js`. This would be a smaller blast radius.

**Recommendation:** Do a thorough audit of `openPush` and each handler's complete state surface before attempting extraction. Push Phase E is the highest-risk remaining phase.

# Push Phase E — Modal Preview Helpers Extraction (Doc 025)

## Summary

Extracted 5 profit-preview + price-reference helpers from `index.js` into `modalPreviews.js`.  
Behavior-preserving: no feature changes, no payload changes.

---

## New File

`js/admin/ebayListings/modalPreviews.js`

### Imports
```js
import { buildEstimate, renderPreview } from "./profitPreview.js";
import { buildPriceRef, renderPriceRef, fetchSalesMetrics } from "./priceReference.js";
```

### Exports (5)

| Export | Signature change from original |
|---|---|
| `refreshPushPreview(product)` | `product` param replaces closure over `currentProduct` |
| `refreshEditPreview(product)` | `product` param replaces closure over `editProduct` |
| `refreshPushRef(product, salesMetrics)` | params replace `currentProduct` + `pushSalesMetrics` |
| `refreshEditRef(product, salesMetrics)` | params replace `editProduct` + `editSalesMetrics` |
| `loadAndRenderPriceRef(containerId, product, priceInputId, onMetricsReady, isStillActive)` | `type` string replaced with `priceInputId` + two callbacks |

---

## Changes to `index.js`

### Imports
- **Removed**: `buildEstimate`, `renderPreview` from `./profitPreview.js`
- **Removed**: `buildPriceRef`, `renderPriceRef`, `fetchSalesMetrics` from `./priceReference.js`
- **Added**: `refreshPushPreview`, `refreshEditPreview`, `refreshPushRef`, `refreshEditRef`, `loadAndRenderPriceRef` from `./modalPreviews.js`

### Call sites updated (2)
- `openPush`: `refreshPushPreview()` → `refreshPushPreview(currentProduct)`
- `openPush`: `loadAndRenderPriceRef("modalPriceRef", currentProduct, "push")` → `loadAndRenderPriceRef("modalPriceRef", currentProduct, "modalPrice", m => { pushSalesMetrics = m; }, p => currentProduct?.code === p.code)`
- `openEdit`: `refreshEditPreview()` → `refreshEditPreview(editProduct)`
- `openEdit`: `loadAndRenderPriceRef("editPriceRef", editProduct, "edit")` → `loadAndRenderPriceRef("editPriceRef", editProduct, "editPrice", m => { editSalesMetrics = m; }, p => editProduct?.code === p.code)`

### Event listeners updated (8)
Functions used as direct references became lambdas to pass current state:

```js
// Push modal inputs
document.getElementById("modalPrice").addEventListener("input", () => refreshPushPreview(currentProduct));
document.getElementById("modalPrice").addEventListener("input", () => refreshPushRef(currentProduct, pushSalesMetrics));
document.getElementById("modalWeightOz").addEventListener("input", () => refreshPushPreview(currentProduct));
// Edit modal inputs
document.getElementById("editPrice").addEventListener("input", () => refreshEditPreview(editProduct));
document.getElementById("editPrice").addEventListener("input", () => refreshEditRef(editProduct, editSalesMetrics));
document.getElementById("editWeightOz").addEventListener("input", () => refreshEditPreview(editProduct));
// Ad rate selects
document.getElementById("modalAdRate").addEventListener("change", () => { refreshPushPreview(currentProduct); refreshPushRef(currentProduct, pushSalesMetrics); });
document.getElementById("editAdRate").addEventListener("change",  () => { refreshEditPreview(editProduct); refreshEditRef(editProduct, editSalesMetrics); });
```

### Function bodies removed (5)
`// ── Profit Preview Helpers (Phase 2)` and `// ── Price Reference Helpers (Phase 5)` sections fully removed.

---

## Verification

- `node --check modalPreviews.js` — clean
- `node --check index.js` — clean
- Browser: Push modal profit preview + price reference render correctly
- Browser: Price/weight/ad-rate input changes trigger live preview updates
- Browser: Edit modal same behavior confirmed

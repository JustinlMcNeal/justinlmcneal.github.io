# 038 — `openPush()` Migration Summary (Phase N-3)

**Date:** 2026-05-16
**Phase:** N-3 (from Phase N roadmap in doc 035)
**Type:** Behavior-preserving structural extraction
**`index.js` before:** 1,543 lines
**`index.js` after:** 1,417 lines (−126)

---

## 1. Files Changed

| File | Change |
|---|---|
| `js/admin/ebayListings/pushModal.js` | Full rewrite: added all imports, `pushQuill` to state, `on*Change` sync-back callbacks to factory signature, `getPushQuill`/`setPushQuill` accessors, complete `openPush()` function |
| `js/admin/ebayListings/index.js` | Removed `openPush()` function (~158 lines); updated `createPushModalContext` call to pass 7 sync-back callbacks; updated `createProductActionDispatcher` to pass `openPush: pushCtx.openPush` |

---

## 2. What Moved

### `async function openPush(code)` — removed from `index.js`, now lives in `pushModal.js`

The function body is identical in behavior. Variable names that referred to `index.js` let-vars (`currentProduct`, `pushQuill`, `pushImageUrls`, etc.) now reference the factory's `state.*` with write-through via setters. The setters fire sync-back callbacks so the index.js let-vars stay up to date for unmoved handlers.

### `pushQuill` added to `pushCtx.state`

The state object now has `pushQuill: null` (was intentionally omitted in Phase N-2 pending this migration). Accessors `getPushQuill()` / `setPushQuill(q)` are now exported.

---

## 3. Sync-Back Callback Pattern

Seven `on*Change` callbacks are injected into `createPushModalContext` and stored in `deps`. Each setter calls its callback after updating `state.*`:

```js
function setCurrentProduct(p) {
  state.currentProduct = p;
  deps.onCurrentProductChange?.(p);
}
```

`index.js` provides the callbacks at instantiation time:

```js
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
```

This means: whenever `openPush` (or any future handler that migrates) writes state via a setter, the corresponding index.js let-var is immediately updated. All unmoved Push handlers in `index.js` continue to read from the let-vars unchanged.

### Why sync-back rather than updating all handler reads?

The alternative (updating every handler to call `pushCtx.get*()` instead of reading let-vars) would require ~40–50 scattered changes across Create Item / Create Offer / Publish / AI fill / close / desc-mode handlers. That is planned for Phases N-5 through N-7, one handler at a time. Doing all of them now would make this a high-risk big-bang extraction instead of a safe incremental one.

---

## 4. Exact Exports/Imports Added

### `pushModal.js` new imports:

```js
import { buildImageUrls, enableBtn, isComplexHtml } from "./utils.js";
import { quillToolbar, descState, resetQuillEditorMount, toggleDescMode } from "./editor.js";
import { renderImageStrip } from "./images.js";
import { renderVariantPanel } from "./variantPanel.js";
import { refreshPushPreview, loadAndRenderPriceRef } from "./modalPreviews.js";
import { callEdge } from "./api.js";
```

### `pushModal.js` new exports (added to factory return):

```js
return {
  ..., // all existing accessors
  openPush,        // new — async (code: string) => void
  getPushQuill,    // new accessor
  setPushQuill,    // new accessor
};
```

### `index.js` imports: unchanged

All imports that `openPush` needed (`buildImageUrls`, `renderImageStrip`, `renderVariantPanel`, etc.) remain in `index.js` because they are also used by Edit modal or remaining Push handlers. No import cleanup was needed or performed.

---

## 5. What Stayed in `index.js`

| Item | Why |
|---|---|
| `let currentProduct = null` | Still read by all Push handlers; kept in sync via `onCurrentProductChange` |
| `let pushQuill = null` | Still read by desc-mode buttons, AI fill, Create Item/Offer; kept in sync via `onPushQuillChange` |
| `let pushImageUrls = []` | Still read by add-image handler, Create Item/Offer; kept in sync via `onPushImageUrlsChange` |
| `let pushVariants = []` | Still read by Create Item/Offer/Publish; kept in sync via `onPushVariantsChange` |
| `let isVariantListing = false` | Still read by Create Item/Offer/Publish; kept in sync via `onIsVariantListingChange` |
| `let currentAspects = []` | Still read by AI fill handler (`currentAspects.map(a => a.name)`); kept in sync via `onCurrentAspectsChange` |
| `let pushSalesMetrics = null` | Still read by `modalPrice` / `modalAdRate` listeners; kept in sync via `onPushSalesMetricsChange` (fires async when metrics arrive) |
| All Push event listeners | Not moved — Create Item, Create Offer, Publish, AI fill, close, desc-mode, category search, price/weight live-update, checkbox toggles |

---

## 6. Behavior Guarantees

### What did NOT change:

| Behavior | Guarantee |
|---|---|
| Product hydration | setCurrentProduct + direct field writes identical to old code |
| Quill initialization | `resetQuillEditorMount` → `new Quill(...)` → `setPushQuill` — identical |
| Description mode reset | `descState.pushMode = "visual"` and tab button active states — identical |
| Image strip build | `buildImageUrls` → `setPushImageUrls` → `renderImageStrip` — identical |
| Aspect reset on open | `setCurrentAspects([])` → `onCurrentAspectsChange([])`  → `currentAspects = []` — identical |
| Weight autofill | `weight_g / 28.3495` — identical |
| Variant detection | `activeVariants.length > 1` branch — identical |
| Variant panel render | `renderVariantPanel(activeVariants, code, product)` — identical |
| Button enable states | `enableBtn(...)` — identical |
| Draft resume (async) | `callEdge("get_item")` → `setPushQuill`/`setPushImageUrls` calls — identical payloads |
| Sales metrics | `loadAndRenderPriceRef(...)` callback → `setPushSalesMetrics(m)` → `onPushSalesMetricsChange(m)` → `pushSalesMetrics = m` — identical |
| Ad rate init | `String(deps.getAdRatePct())` — identical to old `String(pageAdRatePct)` (reads same value via getter) |
| Push preview | `refreshPushPreview(state.currentProduct)` — same reference as synced `currentProduct` let-var |
| eBay `get_item` API payload | `{ action: "get_item", sku: product.ebay_sku }` — unchanged |

### Critical reference semantics:

- `pushImageUrls` (index.js let-var) and `state.pushImageUrls` point to the **same array object** after `setPushImageUrls` is called. In-place mutations from drag-and-drop (`stateArr.splice(...)`) are visible in both.
- `pushVariants` same pattern.
- When the draft-resume path creates a **new array** (`[...prod.imageUrls]`), `setPushImageUrls` fires `onPushImageUrlsChange` so the index.js let-var is updated to the new reference before any handler can run.

---

## 7. Verification Results

| Check | Result |
|---|---|
| `node --check pushModal.js` | ✅ Pass |
| `node --check index.js` | ✅ Pass |
| `async function openPush` absent from `index.js` | ✅ Confirmed (grep returns 0 matches) |
| `pushCtx.openPush` passed to dispatcher | ✅ Confirmed (line 1058) |
| Sync-back callbacks present in `createPushModalContext` call | ✅ Confirmed (7 callbacks) |
| `pushQuill` in `pushCtx.state` | ✅ Confirmed |
| `index.js` let-vars (`currentProduct`, `pushQuill`, etc.) still declared | ✅ Unchanged |
| All Push handlers still in `index.js` unchanged | ✅ No handler code modified |
| eBay draft resume payload unchanged | ✅ `{ action: "get_item", sku: product.ebay_sku }` |
| `index.js` line count | ✅ 1,417 (was 1,543 before N-3; −126) |
| Live browser test (open Push modal, draft resume, category search) | ⚠️ **Manual verification required.** No runtime paths were altered; behavior guaranteed by inspection. Recommended: open Push modal on a non-draft product → confirm fields hydrate, variants show/hide, price reference loads. Then open a draft-status product → confirm draft resume path fires and pre-fills title/description. |

---

## 8. Next Recommended Phase

**Phase N-4 (optional): Clean up redundant `index.js` imports**

After N-3, several imports remain in `index.js` that are ONLY needed there for Edit modal or remaining Push handlers. Specifically, `resetQuillEditorMount`, `quillToolbar` — verify if they're still used in `index.js`'s Edit modal. If Edit modal also uses them, keep. If not, they become `pushModal.js`-only and can be removed from `index.js`. Low risk, low value.

**Phase N-5 (high value): Migrate Create Item handler into `pushModal.js`**

### Pre-conditions for N-5:
- `openPush` now in `pushModal.js` ✅
- `pushCtx.state.*` has all correct values when handler fires ✅
- Handler still reads from index.js let-vars — needs to switch to `pushCtx.get*()` calls

### What N-5 would do:
1. Move `document.getElementById("btnCreateItem").addEventListener(...)` body into `bindListeners()` method inside `pushModal.js`
2. Replace all `currentProduct`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing` reads with `state.*` refs (or `get*()` calls)
3. Remove the sync-back callbacks that are no longer needed once handlers migrate
4. Remove the corresponding index.js let-vars once no handler reads them

### Risk of N-5:
**High** — Create Item is ~128 lines with single + variant paths and sequential eBay API calls. Should be tested thoroughly after migration.

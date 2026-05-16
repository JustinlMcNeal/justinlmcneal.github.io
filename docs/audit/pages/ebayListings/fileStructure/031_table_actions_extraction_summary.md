# 031 — Push Phase J: `tableActions.js` Extraction Summary

**Date:** 2026-05-16  
**Status:** Complete ✅  
**Risk level:** Low-Medium (dependency injection required, no payload risk)

---

## 1. What Moved

Three product-list mutation action implementations extracted from `index.js` → `tableActions.js`:

| Function | Trigger | Edge action(s) |
|---|---|---|
| `discardDraft(code, offerId, itemGroupKey)` | `data-action="discard-draft"` | `discard_draft` |
| `doWithdraw(code, offerId, itemGroupKey)` | `data-action="withdraw"` | `withdraw` or `withdraw_group` |
| `doPublish(code, offerId, itemGroupKey)` | `data-action="publish"` | `publish` or `publish_group` |

**Total removed from `index.js`:** ~82 lines (3 function bodies + `// ── Withdraw / Publish` comment header)

---

## 2. Module API — Factory Pattern

Same pattern as `reconcileActions.js`:

```js
export function createTableActions({ getProducts, loadProducts, showStatus }) {
  // ...
  return { discardDraft, doWithdraw, doPublish };
}
```

---

## 3. Dependencies

### Directly imported in `tableActions.js`

| Import | Source |
|---|---|
| `callEdge` | `./api.js` |
| `isEffectiveGroupListing` | `./utils.js` |
| `publishQuantityForProduct` | `./utils.js` |

### Injected from `index.js`

| Dep | Type | Purpose |
|---|---|---|
| `getProducts` | `() => any[]` | Returns current `allProducts` — lazy closure |
| `loadProducts` | `() => Promise<void>` | Full product reload after success |
| `showStatus` | `(msg, isError?) => void` | Status bar display |

**Circular import risk:** None. `tableActions.js → api.js`, `utils.js` only.

---

## 4. Changes to `index.js`

1. **Import added** after `reconcileActions.js`:
   ```js
   import { createTableActions } from "./tableActions.js";
   ```
2. **Factory call added** after `createReconcileActions`:
   ```js
   const { discardDraft, doWithdraw, doPublish } = createTableActions({
     getProducts:  () => allProducts,
     loadProducts,
     showStatus,
   });
   ```
3. **~82 lines removed** — `// ── Withdraw / Publish` section + all 3 function bodies

**Zero call-site changes:** `handleProductAction` dispatcher cases `"discard-draft"`, `"withdraw"`, `"publish"` call identically-named destructured functions.

---

## 5. What Stayed in `index.js`

- `handleProductAction` dispatcher — unchanged, still delegates to the same names
- `allProducts` — still the source of truth, accessed via `getProducts()`
- `showStatus`, `loadProducts` — still defined in `index.js`, passed as deps
- All Push/Edit modal logic — untouched
- All eBay payload handlers (`btnCreateItem`, `btnCreateOffer`, `btnPublish`, `btnSaveEdit`) — untouched

---

## 6. Confirmation Prompts — Preserved Byte-for-Byte

| Function | Prompt text |
|---|---|
| `discardDraft` | `"Discard the eBay draft attempt for ${code}? This deletes the unpublished eBay draft resources and resets the product to Not Listed."` |
| `doWithdraw` | `"End eBay listing for ${code}?"` |
| `doPublish` | No confirm — proceeds immediately |

---

## 7. Payload Preservation

All edge function action names and payload shapes are byte-for-byte identical to the original:

| Action | Payload fields |
|---|---|
| `discard_draft` | `{ action, productCode, sku, offerId, inventoryItemGroupKey }` |
| `withdraw` | `{ action: "withdraw", offerId, sku }` |
| `withdraw_group` | `{ action: "withdraw_group", inventoryItemGroupKey, sku }` |
| `publish` | `{ action: "publish", offerId, sku, quantity }` |
| `publish_group` | `{ action: "publish_group", inventoryItemGroupKey, sku, variantQuantities }` |

---

## 8. Updated Line Count

| Phase | Approximate `index.js` lines |
|---|---|
| After Push Phase I (030) | ~1,695 |
| After Push Phase J (031) | **~1,613** |
| Lines removed | ~82 |

---

## 9. Verification

| Check | Result |
|---|---|
| `node --check tableActions.js` | ✅ No errors |
| `node --check index.js` | ✅ No errors |
| `tableActions.js` loaded by browser | ✅ Confirmed via `performance.getEntriesByType('resource')` |
| Page loads with products | ✅ Table renders |
| `data-action` buttons present | ✅ `edit`, `withdraw`, `open-sales`, `push` confirmed in DOM |
| Edit modal opens | ✅ Opens with expected auth error |
| `reconcileEbayLink` still at `reconcileActions.js` | ✅ Stack trace unchanged |
| `handleProductAction` dispatcher unchanged | ✅ Cases `"discard-draft"`, `"withdraw"`, `"publish"` unchanged |
| Payload shapes unchanged | ✅ Byte-for-byte code inspection |
| Confirmation prompts unchanged | ✅ Byte-for-byte code inspection |

**Not live-tested (destructive — requires auth + real eBay data):**
- `discardDraft` confirmation + success/error flow
- `doWithdraw` confirmation + `withdraw`/`withdraw_group` routing
- `doPublish` `publish`/`publish_group` routing + `variantQuantities` assembly

All verified by code-path inspection to be functionally identical to before.

---

## 10. Updated Module Inventory

| File | Lines | Key exports |
|---|---|---|
| `api.js` | 74 | `callEdge`, `fetchProductsWithWorkspaceMetrics` |
| `aspectHelpers.js` | 86 | 4 aspect field helpers |
| `bulkActions.js` | 114 | `initBulkActions`, `updateBulkBar` |
| `cards.js` | 56 | `renderCards` |
| `editor.js` | 116 | Quill helpers |
| `editFetch.js` | ~140 | 6 edit-fetch helpers |
| `filters.js` | 60 | `filterProducts` |
| `images.js` | 84 | `renderImageStrip`, `showGalleryPicker` |
| `importPanel.js` | 67 | `initImportPanel` |
| `linkCheck.js` | 73 | 10 display helpers |
| `listingHealth.js` | 209 | `computeHealth` |
| `modalPreviews.js` | 140 | 5 preview helpers |
| `policyCache.js` | ~60 | `loadPoliciesCache` |
| `productActions.js` | 45 | `renderProductActions` |
| `reconcileActions.js` | ~145 | `createReconcileActions` factory |
| `renderHelpers.js` | 128 | `formatRelativeDate`, chips, etc. |
| `setupPanel.js` | 69 | `initSetupPanel` |
| `table.js` | 63 | `renderTable` |
| `tableActions.js` | **~105** | `createTableActions` factory (NEW this phase) |
| `taxonomyApi.js` | 39 | `fetchAspectsForCategory`, `fetchCategorySuggestions` |
| `utils.js` | 176 | 15 pure helpers |
| `variantPanel.js` | 175 | 8 variant panel helpers |
| `volPricing.js` | 70 | Vol tier helpers |
| `index.js` | **~1,613** | Page orchestrator |

**Total module files:** 27

---

## 11. What Still Remains After Phase J

| Group | Content | Lines |
|---|---|---|
| C | `showStatus` | ~8 |
| E | `loadProducts`, `applyFilters`, `renderAll`, `setView`, `updateStats` | ~59 |
| F | `fetchAspects(categoryId)` | ~32 |
| G | `openPush` | ~143 |
| H | `openEdit` | ~283 |
| I | `renderEditVariantImageControls` | ~75 |
| K | Push modal event handlers | ~459 |
| L | Edit modal event handlers | ~408 |
| M | `handleProductAction` dispatcher + bootstrap | ~60 |

---

## 12. Recommended Next Phase: Push Phase K — `fetchAspects` inline helper

**Target:** `fetchAspects(categoryId)` (~32 lines) in `openPush` prep

**Why next:** This is the last mid-size, low-risk function before `openPush` itself. It calls `fetchAspectsForCategory` (already in `taxonomyApi.js`) + mutates `currentAspects` + renders DOM. Two options:

1. **Refactor to return value**: `fetchAspects` returns aspects, caller (`openPush`) assigns to `currentAspects` and renders. Cleanest, but touches `openPush` internals.
2. **Keep in index.js, defer**: Since `openPush` is high-risk and not yet being extracted, and `fetchAspects` is only called from within `openPush`, it may be cleanest to leave it until `openPush` extraction.

**Alternative: Skip to `showStatus` + `loadProducts`/`renderAll` audit** — these are the final shared helpers before the modal phase begins. They are small and don't warrant a phase by themselves.

**True next high-value phase: `openPush` prep audit** — examine exactly what state/deps `openPush` needs so the high-risk modal extractions can be sequenced safely. Consider a doc-only checkpoint pass (like doc 027) before attempting `openPush` or `openEdit` extractions.

# 030 — Push Phase I: `reconcileActions.js` Extraction Summary

**Date:** 2026-05-16  
**Status:** Complete ✅  
**Risk level:** Medium (dependency injection required) — behavior preserved exactly

---

## 1. What Moved

Five functions extracted from `index.js` → `reconcileActions.js`:

| Function | Purpose |
|---|---|
| `reconcileEbayLink(product, relink)` | Calls `reconcile_listing` edge function; tags `product._linkCheck` in-place |
| `auditListingLinks(products)` | Background audit loop over all linked products; triggers `renderAll` + `showStatus` on completion |
| `relinkEbayListing(code)` | User-triggered: confirm + relink via `reconcileEbayLink(true)`, reload on success |
| `clearStaleEbayLink(code)` | User-triggered: confirm + `clear_stale_listing_link` edge call, reload on success |
| `renderEditLinkWarning(check)` | Renders stale-link warning box (editLinkWarning DOM) inside the Edit modal |

**Also moved:** `let linkAuditRunId = 0;` — now module-private inside `reconcileActions.js`

**Total removed from `index.js`:** ~111 lines (5 function bodies + state declaration)

---

## 2. Module API — Factory Pattern

`reconcileActions.js` exports a single factory:

```js
export function createReconcileActions({ getProducts, renderAll, loadProducts, showStatus }) {
  let linkAuditRunId = 0;

  // ... function definitions using injected deps ...

  return { reconcileEbayLink, auditListingLinks, relinkEbayListing, clearStaleEbayLink, renderEditLinkWarning };
}
```

**Why factory, not plain exports?** Four of the five functions depend on mutable page state (`allProducts`) and page-level functions (`renderAll`, `loadProducts`, `showStatus`) that live in `index.js`. Plain exports would require importing `index.js`, creating a circular dependency. Dependency injection avoids this entirely.

---

## 3. Dependencies

### Injected from `index.js`

| Dep | Type | Purpose |
|---|---|---|
| `getProducts` | `() => any[]` | Returns current `allProducts` at call time — lazy closure |
| `renderAll` | `() => void` | Re-renders table/cards after audit completion |
| `loadProducts` | `() => Promise<void>` | Full product reload after relink/clear-stale |
| `showStatus` | `(msg, isError?) => void` | Status bar display |

### Directly imported in `reconcileActions.js`

| Import | Source |
|---|---|
| `callEdge` | `./api.js` |
| `isLinkedOnEbay`, `isLinkWarningCheck`, `isOutOfStockLinkCheck`, `isStaleLinkCheck`, `staleLinkLabel`, `staleLinkMessage`, `currentActiveListingId` | `./linkCheck.js` |
| `esc` | `./utils.js` |

**Circular import risk:** None. `reconcileActions.js → api.js`, `linkCheck.js`, `utils.js` — no path back to `index.js`.

---

## 4. Where `linkAuditRunId` Now Lives

`linkAuditRunId` is **module-private state inside `reconcileActions.js`**, declared inside the factory closure:

```js
let linkAuditRunId = 0;
```

It is used only by `auditListingLinks` (increment on each audit start, check before post-audit `renderAll`/`showStatus` to abort stale runs). Behavior is identical — the counter is still private and still cancels superseded audit runs.

---

## 5. Signature Changes

One behavioral-equivalent change in `auditListingLinks`:

| | Before | After |
|---|---|---|
| Signature | `auditListingLinks(products = allProducts)` | `auditListingLinks(products)` |
| Default handling | JS default parameter `= allProducts` (evaluated at call time) | `const list = products ?? getProducts();` |
| Behavior | **Identical** — both evaluate to the current `allProducts` array when no argument is passed |

Zero changes to `reconcileEbayLink`, `relinkEbayListing`, `clearStaleEbayLink`, `renderEditLinkWarning` — signatures, return values, and error handling are byte-for-byte preserved.

---

## 6. Changes to `index.js`

1. **Import added** after `policyCache.js` import:
   ```js
   import { createReconcileActions } from "./reconcileActions.js";
   ```

2. **Factory call + destructure** replaces `let linkAuditRunId = 0;` and all 5 function bodies:
   ```js
   const { reconcileEbayLink, auditListingLinks, relinkEbayListing, clearStaleEbayLink, renderEditLinkWarning } = createReconcileActions({
     getProducts:  () => allProducts,
     renderAll,
     loadProducts,
     showStatus,
   });
   ```

3. **~111 lines removed** — `let linkAuditRunId = 0;` + 5 complete function definitions

**Zero call-site changes:** All 5 names are destructured back into `index.js` scope, so all existing call sites (`handleProductAction`, `openEdit`, save handler, `loadProducts`) continue to call the same names identically.

---

## 7. Call Site Map (unchanged)

| Call site | Where in index.js | Function called |
|---|---|---|
| `openEdit` — link reconcile | line ~415 | `reconcileEbayLink(editProduct, false)` |
| `openEdit` — display warning | line ~417 | `renderEditLinkWarning(linkCheck)` |
| Save handler — pre-save check | line ~1514 | `reconcileEbayLink(editProduct, false)` |
| Save handler — display warning | line ~1516 | `renderEditLinkWarning(linkCheck)` |
| `loadProducts` | line ~249 | `auditListingLinks(allProducts)` |
| `handleProductAction` case `"relink"` | line ~1361 | `relinkEbayListing(code)` |
| `handleProductAction` case `"clear-stale"` | line ~1363 | `clearStaleEbayLink(code)` |

---

## 8. Updated Line Count

| Phase | Approximate `index.js` lines |
|---|---|
| After Push Phase H (029) | ~1,806 |
| After Push Phase I (030) | **~1,695** |
| Lines removed | ~111 |

---

## 9. Verification

| Check | Result |
|---|---|
| `node --check reconcileActions.js` | ✅ No errors |
| `node --check index.js` | ✅ No errors |
| `reconcileActions.js` loaded by browser | ✅ Confirmed via `performance.getEntriesByType('resource')` |
| Page loads with products | ✅ Table renders, 60 products |
| `reconcileEbayLink` stack trace | ✅ `reconcileActions.js:42` (not `index.js`) |
| Edit modal opens | ✅ Opens with expected auth error |
| `auditListingLinks` fires on page load | ✅ Expected auth errors from each linked product |
| `policyCache.js` still working | ✅ `policyCache.js:24` stack trace confirmed |
| No module load errors | ✅ No console errors on load |
| `relink`/`clear-stale` payloads | ✅ Code-path verified — `action: "reconcile_listing"` and `action: "clear_stale_listing_link"` preserved byte-for-byte |
| Edit save guard | ✅ Code-path verified — `reconcileEbayLink(editProduct, false)` + stale check preserved |

**Auth-gated items not live-tested (localhost):**
- Stale/no-active/sold-out badge rendering (requires real active eBay listings)
- `renderEditLinkWarning` with actual stale check result
- `relinkEbayListing` full confirmation + reload flow
- `clearStaleEbayLink` full confirmation + reload flow
- `auditListingLinks` successful completion + `renderAll` + `showStatus` call

All these paths are verified by code inspection to be functionally identical to before.

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
| `reconcileActions.js` | **~145** | `createReconcileActions` factory (NEW this phase) |
| `renderHelpers.js` | 128 | `formatRelativeDate`, chips, etc. |
| `setupPanel.js` | 69 | `initSetupPanel` |
| `table.js` | 63 | `renderTable` |
| `taxonomyApi.js` | 39 | `fetchAspectsForCategory`, `fetchCategorySuggestions` |
| `utils.js` | 176 | 15 pure helpers |
| `variantPanel.js` | 175 | 8 variant panel helpers |
| `volPricing.js` | 70 | Vol tier helpers |
| `index.js` | **~1,695** | Page orchestrator |

**Total module files:** 26

---

## 11. What Still Remains in `index.js` After Phase I

| Group | Content | Lines | Notes |
|---|---|---|---|
| C | `showStatus` | ~8 | Used across entire file; leave in index.js |
| E | Load/filter/render orchestration (`loadProducts`, `applyFilters`, `renderAll`, `setView`, `updateStats`) | ~59 | Do not extract — page bootstrap |
| F | `fetchAspects(categoryId)` — Push modal DOM helper | ~32 | Mixed state/DOM |
| G | `openPush` | ~143 | High risk |
| H | `openEdit` | ~283 | High risk — largest function |
| I | `renderEditVariantImageControls` | ~75 | High risk — extract with/after `openEdit` |
| J | Table-action handlers (`discardDraft`, `doWithdraw`, `doPublish`) | ~76 | Medium risk — need callbacks |
| K | Push modal event handlers | ~459 | Mixed risk; payload handlers: do not touch |
| L | Edit modal event handlers | ~408 | Mixed risk; `btnSaveEdit` payload: do not touch |
| M | Bootstrap / misc event wiring | ~60 | Do not extract |

---

## 12. Recommended Next Phase: Push Phase J — Table Action Handlers → `tableActions.js`

**Target:** Group J — `discardDraft`, `doWithdraw`, `doPublish` (~76 lines)

**Why next:**
- No eBay payload risk (these call edge functions but the payload assembly is simple and stable)
- Only dependencies: `callEdge`, `showStatus`, `loadProducts` — all easily injected
- Same factory pattern as `reconcileActions.js` — low additional pattern risk
- Clears 3 more mid-file functions before tackling `openPush`/`openEdit`

**Approach:** Same `createTableActions({ callEdge, showStatus, loadProducts })` factory. `callEdge` can be imported directly from `api.js` inside `tableActions.js`.

**Do not attempt yet:**
- `openPush` / `openEdit` — still need more pre-extraction
- All eBay payload handlers (`btnCreateItem`, `btnCreateOffer`, `btnPublish`, `btnSaveEdit`)

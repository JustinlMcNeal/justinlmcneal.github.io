# 028 — Push Phase G: `editFetch.js` Extraction Summary

**Date:** 2026-05-16  
**Status:** Complete ✅  
**Risk level:** Low

---

## 1. What Moved

Six edit-session eBay fetch helpers extracted from `index.js` → `editFetch.js`:

| Function | Lines | Purpose |
|---|---|---|
| `shortDelay(ms)` | 3 | Promise wrapper for `setTimeout` |
| `ebayErrorIds(payload)` | 3 | Extract numeric error IDs from eBay response payloads |
| `isTransientGetItemFailure(result)` | 5 | Detect transient `getItem` failures (500 status, errorId 25001, system error string) |
| `getItemForEdit(sku)` | ~31 | Fetch item data from eBay via Edge Function; retries once on transient failure |
| `getOffersForEdit(cache, sku, context)` | ~24 | Fetch offer data; reads/writes Map cache passed as parameter |
| `offerUpdateErrorMessage(result, fallback)` | ~8 | Build human-readable error message for offer update failures (STALE/LOCATION relink, generic) |

**Total removed from `index.js`:** ~83 lines (former lines 116–196)

---

## 2. Key Design Decision — Cache Ownership

`getOffersForEdit` previously closed over `editOfferLookupCache` (a `Map` declared in `index.js`). Since `editFetch.js` must not import from `index.js`, the cache is passed as the first parameter:

```js
// Before (in index.js)
async function getOffersForEdit(sku, context = "edit") {
  if (editOfferLookupCache.has(sku)) { ... }
  // ...
  editOfferLookupCache.set(sku, result);
}

// After (in editFetch.js)
export async function getOffersForEdit(cache, sku, context = "edit") {
  if (cache.has(sku)) { ... }
  // ...
  cache.set(sku, result);
}
```

`editOfferLookupCache` **stays in `index.js`** and is passed at every call site:

```js
// Call sites updated (3 total)
getOffersForEdit(editOfferLookupCache, firstVariantSku, "open")
getOffersForEdit(editOfferLookupCache, sku, "open")
getOffersForEdit(editOfferLookupCache, vSku, "save")
```

Because `Map` is a reference type, writes inside `getOffersForEdit` are visible back in `index.js` — no behavior change.

`editOfferLookupCache` remaining uses in `index.js`:
- **Line 113**: `let editOfferLookupCache = new Map();` — declaration
- **`openEdit`**: `editOfferLookupCache = new Map();` — reset on each open
- **`openEdit`**: `[...editOfferLookupCache.values()].filter(r => !r.success)` — error summary read

---

## 3. New File: `editFetch.js`

**Path:** `js/admin/ebayListings/editFetch.js`  
**Import:** `import { callEdge } from "./api.js";`  
**Exports:** all 6 functions above  
**Circular import risk:** None — `editFetch.js` → `api.js` only

---

## 4. Changes to `index.js`

1. **Import added** after `taxonomyApi.js` import block:
   ```js
   import { shortDelay, ebayErrorIds, isTransientGetItemFailure, getItemForEdit, getOffersForEdit, offerUpdateErrorMessage } from "./editFetch.js";
   ```
2. **~83 lines removed** — all 6 function bodies (former lines 116–196)
3. **3 call sites updated** — `getOffersForEdit` now receives `editOfferLookupCache` as first argument

---

## 5. Updated Line Count

| Phase | Approximate `index.js` lines |
|---|---|
| After Push Phase F (027) | 1,937 |
| After Push Phase G (028) | **~1,854** |
| Lines removed | ~83 |

---

## 6. Verification

| Check | Result |
|---|---|
| `node --check editFetch.js` | ✅ No errors |
| `node --check index.js` | ✅ No errors |
| Page load (localhost:5500) | ✅ 60 products loaded, table rendered |
| Edit modal open | ✅ Modal opened, expected auth error on localhost |

---

## 7. Updated Module Inventory

| File | Lines | Key exports |
|---|---|---|
| `api.js` | 74 | `callEdge`, `fetchProductsWithWorkspaceMetrics` |
| `aspectHelpers.js` | 86 | 4 aspect field helpers |
| `bulkActions.js` | 114 | `initBulkActions`, `updateBulkBar` |
| `cards.js` | 56 | `renderCards` |
| `editor.js` | 116 | Quill helpers |
| `editFetch.js` | **~140** | `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure`, `getItemForEdit`, `getOffersForEdit`, `offerUpdateErrorMessage` |
| `filters.js` | 60 | `filterProducts` |
| `images.js` | 84 | `renderImageStrip`, `showGalleryPicker` |
| `importPanel.js` | 67 | `initImportPanel` |
| `linkCheck.js` | 73 | 10 display helpers |
| `listingHealth.js` | 209 | `computeHealth` |
| `modalPreviews.js` | 140 | 5 preview helpers |
| `productActions.js` | 45 | `renderProductActions` |
| `renderHelpers.js` | 128 | `formatRelativeDate`, chips, etc. |
| `setupPanel.js` | 69 | `initSetupPanel` |
| `table.js` | 63 | `renderTable` |
| `taxonomyApi.js` | 39 | `fetchAspectsForCategory`, `fetchCategorySuggestions` |
| `utils.js` | 176 | 15 pure helpers |
| `variantPanel.js` | 175 | 8 variant panel helpers |
| `volPricing.js` | 70 | Vol tier helpers |
| `index.js` | **~1,854** | Page orchestrator |

**Total module files:** 24  

---

## 8. What Still Remains in `index.js` After Phase G

Group labels from doc 027, updated for current line numbering (approximate):

| Group | Content | Lines | Notes |
|---|---|---|---|
| A | ~~Edit-fetch helpers~~ | ~~81~~ | **Extracted this phase** |
| B | Reconciliation cluster (`reconcileEbayLink`, `auditListingLinks`, `relinkEbayListing`, `clearStaleEbayLink`) | ~79 | Medium risk — needs callbacks |
| C | `renderEditLinkWarning`, `showStatus` | ~34 | Small; `showStatus` used across entire file |
| D | Policy cache (`loadPoliciesCache`, `populatePolicyDropdowns`) | ~40 | Medium risk — shares `cachedPolicies` state |
| E | Load/filter/render orchestration (`loadProducts`, `applyFilters`, `renderAll`, `setView`, `updateStats`) | ~59 | Do not extract — page bootstrap |
| F | `fetchAspects(categoryId)` — Push modal DOM helper | ~32 | Mixed state/DOM — extract after `openPush` prep |
| G | `openPush` | ~143 | High risk — extract last after helpers pre-cleaned |
| H | `openEdit` | ~283 | High risk — largest function, most complex |
| I | `renderEditVariantImageControls` | ~75 | High risk — extract with/after `openEdit` |
| J | Table-action handlers (`discardDraft`, `doWithdraw`, `doPublish`) | ~76 | Medium risk — need callbacks |
| K | Push modal event handlers | ~459 | Mixed risk; payload handlers: do not touch |
| L | Edit modal event handlers | ~408 | Mixed risk; `btnSaveEdit` payload: do not touch |
| M | Bootstrap / misc event wiring | ~60 | Do not extract |

---

## 9. Recommended Next Phase: Push Phase H — `policyCache.js`

**Target:** Group D — `loadPoliciesCache` + `populatePolicyDropdowns`

**Why next:**
- Self-contained: only dependency is `callEdge` + `cachedPolicies` state
- No eBay payload risk
- Extracting this unblocks `openEdit` extraction later (called inside `openEdit`)
- `cachedPolicies` (a plain object) can be passed as parameter or initialized inside the module

**Approach options:**
1. **Module-owned state**: `policyCache.js` owns `cachedPolicies` internally; `loadPoliciesCache()` caches on first call; `getCachedPolicies()` returns it. Index.js calls `loadPoliciesCache()` at boot and `getCachedPolicies()` where needed.
2. **Callback injection**: Pass `cachedPolicies` ref + `populatePolicyDropdowns` callback into `loadPoliciesCache`. More verbose, less clean.

**Option 1 preferred** — policy cache has no state that `index.js` reads back except via `populatePolicyDropdowns`, which can also live in the new module.

**Affected files:**
- `js/admin/ebayListings/policyCache.js` (new, ~50 lines)
- `js/admin/ebayListings/index.js` (remove 2 function bodies, add import)

**Do not attempt this phase:**
- All eBay payload handlers (`btnCreateItem`, `btnCreateOffer`, `btnPublish`, `btnSaveEdit`)
- `openPush` / `openEdit` — still need more pre-extraction

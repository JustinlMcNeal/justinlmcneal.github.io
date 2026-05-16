# 049 — Post-openEdit Cleanup Checkpoint

**Phase:** Checkpoint / documentation pass (no handler migrations)
**Date:** 2026-05
**Files changed this pass:** `js/admin/ebayListings/index.js` — 9 dead import symbols removed (optional tiny cleanup)

---

## 1. Current File List and Line Counts

| File | Lines | Responsibility | Status |
|---|---|---|---|
| `index.js` | **512** | Page orchestrator: state, load/filter/render, event listeners, Edit handlers (save, AI fill, close, previews, toggles), init | Transitional — Edit handlers still here |
| `editModal.js` | **413** | Edit modal factory: `openEdit()` (full), 8 state fields, 16 accessors, `resetEditState()`, `syncBack` bridge | Transitional — remaining handlers in E-3/E-4 |
| `pushModal.js` | **740** | Push modal factory: `openPush`, `handleCreateItem`, `handleAiFill`, `handleCreateOffer`, `handlePublish`, `bindCreateItemListener`, `bindRemainingPushListeners`, all Push state/accessors | **Stable** — fully migrated |
| `actionDispatcher.js` | **59** | `createProductActionDispatcher` — routes data-action button clicks to handlers | **Stable** |
| `reconcileActions.js` | **139** | `createReconcileActions` — eBay link reconcile, audit, relink, clear-stale, renderEditLinkWarning | **Stable** |
| `tableActions.js` | **97** | `createTableActions` — discardDraft, doWithdraw, doPublish | **Stable** |
| `api.js` | **68** | `callEdge`, `fetchProductsWithWorkspaceMetrics` | **Stable** |
| `filters.js` | **55** | `filterProducts` | **Stable** |
| `renderHelpers.js` | **119** | `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` | **Stable** |
| `linkCheck.js` | **63** | `isLinkedOnEbay`, `isStaleLinkCheck`, `isOutOfStockLinkCheck`, `isLinkWarningCheck`, `staleActionState`, `staleActionBadge`, `staleLinkLabel`, `staleLinkMessage`, `currentActiveListingId`, `ebayCodeLinkHtml` | **Stable** |
| `productActions.js` | **41** | `renderProductActions` — per-row action button HTML | **Stable** |
| `table.js` | **58** | `renderTable` | **Stable** |
| `cards.js` | **52** | `renderCards` | **Stable** |
| `setupPanel.js` | **65** | `initSetupPanel` | **Stable** |
| `importPanel.js` | **63** | `initImportPanel` | **Stable** |
| `bulkActions.js` | **101** | `initBulkActions`, `updateBulkBar` | **Stable** |
| `aspectHelpers.js` | **79** | `buildEditAspectField`, `buildAspectField`, `collectAspects`, `validateRequiredAspects` | **Stable** |
| `aspectFlow.js` | **70** | `fetchAndRenderAspects` — category taxonomy fetch + aspect field render pipeline for Push | **Stable** |
| `variantPanel.js` | **245** | `renderVariantPanel`, `getCheckedVariants`, `renderEditVariantImageControls` | **Stable** |
| `modalPreviews.js` | **126** | `refreshPushPreview`, `refreshPushRef`, `refreshEditPreview`, `refreshEditRef`, `loadAndRenderPriceRef` | **Stable** |
| `taxonomyApi.js` | **36** | `fetchCategorySuggestions`, `fetchAspectsForCategory` | **Stable** |
| `policyCache.js` | **52** | `loadPoliciesCache` | **Stable** |
| `editFetch.js` | **122** | `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure`, `getItemForEdit`, `getOffersForEdit`, `offerUpdateErrorMessage` | **Stable** |
| `utils.js` | **159** | `esc`, `sanitizeForEbay`, `wrapDescription`, `buildImageUrls`, `buildPackageWeightAndSize`, `isComplexHtml`, `isEffectiveGroupListing`, `getSelectedPolicies`, `getBestOfferTerms`, `addAiBadge`, `enableBtn` | **Stable** |
| `editor.js` | **106** | `quillToolbar`, `descState`, `resetQuillEditorMount`, `toggleDescMode`, `getDescriptionHtml` | **Stable** |
| `images.js` | **74** | `renderImageStrip`, `showGalleryPicker` | **Stable** |
| `volPricing.js` | **67** | `addVolTier`, `getVolTiers`, `setVolTiers` | **Stable** |
| `listingHealth.js` | **193** | `computeHealth` | **Stable** |
| `salesHistory.js` | **185** | `openSalesHistory`, `closeSalesHistory` | **Stable** |
| `priceReference.js` | **247** | `fetchSalesMetrics`, `buildPriceRef`, `renderPriceRef` | **Stable** |
| `profitPreview.js` | **347** | `buildEstimate`, `renderPreview` | **Stable** |

**Total files:** 31  
**Total lines (all files):** ~5,207

---

## 2. Current `index.js` Line Count

| Point in time | Line count |
|---|---|
| Original pre-refactor estimate | ~2,600+ |
| Checkpoint 027 (post all module extractions) | 1,937 |
| After Push migration (038) | ~1,100 (est.) |
| After E-1 (editModal skeleton) | ~1,070 (est.) |
| After E-2 (openEdit moved to editModal.js) | ~820 (est.) |
| **After E-2b (dead openEdit body removed)** | **527** |
| **After this pass (9 dead imports removed)** | **512** |

**Reduction from last checkpoint (027):** ~1,425 lines (~74%)
**Reduction from pre-refactor baseline:** ~2,088 lines (~80%)

### What remains in `index.js` (512 lines)

| Group | Approx. lines | Description |
|---|---|---|
| Imports | ~52 | 18 import statements covering ~15 modules |
| Supabase init | 2 | `const supabase = getSupabaseClient()` |
| Shared state | ~14 | `allProducts`, `filteredProducts`, `currentView`, `editProduct`, `editQuill`, `editImageUrls`, `editVariantImageOverrides`, `editVariantQtyOverrides`, `editAspects`, `editSalesMetrics`, `pageAdRatePct`, `editOfferLookupCache`, `searchTimeout` |
| Module context creation | ~30 | `createReconcileActions`, `createTableActions`, `pushCtx`, `editCtx` (incl. syncBack) |
| `showStatus` | 6 | Page status bar helper |
| `loadProducts` | 10 | `fetchProductsWithWorkspaceMetrics` → `allProducts` → `applyFilters` + `updateStats` + `auditListingLinks` |
| `applyFilters` + `renderAll` + `setView` | ~20 | Filter/render/view orchestration |
| `updateStats` | 7 | Stat counter DOM update |
| Search/filter event listeners | ~20 | searchInput, searchClear, statusFilter, quickFilter, adRateFilter, view toggle |
| Push delegation | 4 | `pushCtx.bindCreateItemListener()`, `pushCtx.bindRemainingPushListeners()` |
| Edit close handler | 7 | `btnCloseEdit` — hides modal, nulls `editProduct`, calls `editCtx.setCurrentProduct(null)` |
| Edit relink handler | 4 | `btnEditRelink` → `relinkEbayListing` |
| Edit preview listeners | 5 | editPrice (×2), editWeightOz, editAdRate → `refreshEditPreview` / `refreshEditRef` |
| Product action dispatcher | 12 | `createProductActionDispatcher`, tableSection/cardSection click, btnCloseSales |
| Edit add image | 4 | `btnAddImgEdit` → `showGalleryPicker` |
| Edit description mode | 9 | btnEditVisual, btnEditHtml, btnEditPreview → `toggleDescMode` |
| **Edit AI Auto-Fill handler** | **~60** | `btnEditAiFill` — calls `ebay-ai-autofill` edge function, fills title/description/aspects |
| **Edit Save handler** | **~130** | `btnSaveEdit` — validate, link-check, group/single update-item, update-offer, store-cat DB write, volume pricing, vol delete |
| Bulk Actions | 2 | `initBulkActions` |
| Checkbox toggles | 12 | Best Offer, Lot, Vol Pricing, add tier |
| Setup / Import / Refresh | 5 | `initSetupPanel`, `initImportPanel`, btnRefresh |
| `init()` + call | 8 | nav, footer, requireAdmin, setView, loadProducts, loadPoliciesCache |

---

## 3. Edit Migration State

### What lives in `editModal.js`

| Item | Status |
|---|---|
| 8 private state fields (`currentProduct`, `editQuill`, `editImageUrls`, etc.) | ✅ In editModal.js |
| 16 state accessors (get/set pairs) | ✅ In editModal.js |
| `resetEditState()` | ✅ In editModal.js |
| `openEdit(code)` — full implementation (~250 lines) | ✅ In editModal.js |
| All `openEdit` dependencies (14 imports) | ✅ In editModal.js |

### What Edit-related code still lives in `index.js`

| Item | Location | Phase to move |
|---|---|---|
| 8 `let` state vars (`editProduct`, `editQuill`, etc.) | index.js ~line 70–84 | E-5 (after handlers migrate) |
| `editCtx` instantiation + `syncBack` callback | index.js ~line 105–121 | E-5 (remove syncBack when vars gone) |
| Edit close handler (`btnCloseEdit`) | index.js ~line 222–228 | E-3 or E-4 |
| Edit relink handler (`btnEditRelink`) | index.js ~line 230–233 | E-3 |
| Edit preview listeners (price, weight, adRate) | index.js ~line 235–239 | E-3 |
| Edit add image handler (`btnAddImgEdit`) | index.js ~line 256–259 | E-3 |
| Edit description mode handlers (3 buttons) | index.js ~line 261–269 | E-3 |
| **Edit AI Auto-Fill handler** (`btnEditAiFill`) | index.js ~line 271–330 | **E-3** |
| **Edit Save handler** (`btnSaveEdit`) | index.js ~line 332–556 | **E-4** |
| Edit checkbox toggles (Best Offer, Lot, Vol Pricing) | index.js ~line 558–574 | E-4 |

### `syncBack` current payload

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
}
```

`syncBack` keeps all 8 index.js `let` vars in sync from `editModal.js` state after `openEdit()` completes. Required until all handlers that read these vars migrate into `editModal.js`.

### Dead `openEdit` code status

No dead `openEdit` code remains in `index.js`. Removed in E-2b.

### Stale imports status

As of this pass: **none detected**.

- 9 additional dead imports confirmed and removed in this pass:
  - `isLinkedOnEbay`, `isLinkWarningCheck`, `staleActionState`, `staleActionBadge`, `staleLinkLabel`, `ebayCodeLinkHtml` (from linkCheck.js — used by child modules directly, not index.js)
  - `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure` (from editFetch.js — used internally by editFetch.js only)

All remaining index.js imports are confirmed used in the live code body.

---

## 4. Push Migration State

### `pushModal.js` exists: ✅ YES — 740 lines

Push migration is **complete**. All Push logic resides in `pushModal.js`:
- `openPush()` — opens modal, hydrates fields
- `handleCreateItem()` — Step 1 create inventory item + aspect rendering
- `handleAiFill()` — Push AI auto-fill
- `handleCreateOffer()` — Step 2 create offer, category, policies
- `handlePublish()` — Step 3 publish listing
- `bindCreateItemListener()` + `bindRemainingPushListeners()` — all event wiring

### Push entries in `index.js`

Only 4 lines remain:
```js
const pushCtx = createPushModalContext({ getProducts, loadProducts, showStatus, getAdRatePct });
// ...
pushCtx.bindCreateItemListener();
pushCtx.bindRemainingPushListeners();
// dispatcher: openPush: pushCtx.openPush
```

No Push state variables, no Push event handlers, and no Push logic in index.js.

### Push readiness for further extraction

None needed. Push is stable and complete. Do not touch.

---

## 5. Remaining High-Risk Workflows

### Risk rankings

| Handler / workflow | Risk | Notes |
|---|---|---|
| Edit close handler | **Low** | 6 lines; uses `editCtx.setCurrentProduct(null)` already; safe to move |
| Edit relink handler | **Low** | 3 lines; just calls `relinkEbayListing`; safe to move |
| Edit preview listeners (price/weight/adRate) | **Low** | 5 lines; call `refreshEditPreview` / `refreshEditRef`; state already in editModal |
| Edit add image handler | **Low** | 3 lines; calls `showGalleryPicker` |
| Edit description mode buttons (3) | **Low** | 9 lines; calls `toggleDescMode`; `descState` already in editModal |
| Edit checkbox toggles (Best Offer, Lot, Vol) | **Medium** | 12 lines; DOM-only toggles; medium because they interact with save handler fields |
| **Edit AI Auto-Fill handler** | **Medium** | ~60 lines; reads `editProduct`, `editAspects`, `editImageUrls` from syncBack vars; safe after state confirmed in editModal |
| **Edit Save handler** | **High** | ~130 lines; reads all 8 state vars; calls many utils; 3 distinct paths (group/single/vol); eBay payloads; highest impact if broken |
| Push create-item handler | **Do not touch** | Stable in pushModal.js; no reason to change |
| Push create-offer handler | **Do not touch** | Stable in pushModal.js; no reason to change |
| Push publish handler | **Do not touch** | Stable in pushModal.js; no reason to change |
| Push AI fill handler | **Do not touch** | Stable in pushModal.js; no reason to change |
| Category search wiring for Push | **Do not touch** | Stable in pushModal.js |
| `init()` bootstrap | **Do not touch yet** | Depends on all other migrations being complete; extract last |

---

## 6. Recommended Next Extraction — E-3a: Small Edit Listeners

### Recommendation: Move the 5 small Edit event listeners into `editModal.js`

**Why it is safest:**

1. All 5 are 3–6 line wrappers that call functions already available inside `editModal.js`
2. None read shared state that isn't already in `editCtx` or accessible via `deps`
3. The Edit close handler already partially communicates with `editCtx.setCurrentProduct(null)` — it belongs inside the factory
4. These move ~45 lines in total; too small to meaningfully break anything
5. Does not touch the save handler (the only truly high-risk block)

**Exact files affected:**

- `js/admin/ebayListings/index.js` — remove 5 listener blocks
- `js/admin/ebayListings/editModal.js` — add `bindEditBaseListeners()` function to factory return

**Handlers to move (candidate set for E-3a):**

| Handler | Lines | DOM element |
|---|---|---|
| Edit close | 7 | `btnCloseEdit` |
| Edit relink | 4 | `btnEditRelink` |
| Edit preview — price (×2) | 2 | `editPrice` |
| Edit preview — weight | 1 | `editWeightOz` |
| Edit preview — adRate | 2 | `editAdRate` |
| Edit add image | 4 | `btnAddImgEdit` |
| Edit description modes (3 buttons) | 9 | `btnEditVisual`, `btnEditHtml`, `btnEditPreview` |

**Dependencies already in `editModal.js`:**
- `refreshEditPreview`, `refreshEditRef` — already imported
- `showGalleryPicker` — already available (imported by editModal or passed via dep)
- `toggleDescMode`, `descState` — already imported

**Dependencies that need to be resolved:**
- `relinkEbayListing` — injected as `deps.relinkEbayListing` ✅ already a dep
- `pageAdRatePct` — currently a page-level var; readable via `deps.getAdRatePct()` ✅ already a dep
- Close handler: `editProduct = null` → becomes `state.currentProduct = null` inside factory (no syncBack needed for close)
- `showGalleryPicker` — needs to be added to editModal.js imports if not already there

**Risk level:** Low

**Verification checklist:**
1. `node --check index.js` exits 0
2. `node --check editModal.js` exits 0
3. Browser: open Edit modal on a simple product → hydrates correctly
4. Browser: edit price field → profit preview updates in real time
5. Browser: click close → modal hides, state resets
6. Browser: click Add Image → gallery picker opens
7. Browser: description mode buttons → switch modes without error

**Rollback notes:**
Move is purely additive to `editModal.js` and subtractive from `index.js`. If issues arise restore by: (a) reverting the 5 listener additions in editModal.js, (b) restoring the removed blocks in index.js. Both files are independently valid.

---

## 7. Documentation Folder Consistency

### Expected folder

`docs/audit/pages/ebayListings/fileStructure/` — canonical home for all numbered file-structure docs

### Current state

| Doc # | File | Actual location | Expected location |
|---|---|---|---|
| 001–038 | `001_…038_…` | `docs/audit/pages/ebayListings/fileStructure/` | ✅ Correct |
| 039 | *(does not exist)* | — | — |
| 040–048 | `040_…048_…` | `docs/ebayAPI/` | ⚠️ Wrong folder |
| **049** | This doc | `docs/audit/pages/ebayListings/fileStructure/` | ✅ Correct |

### Impact

Docs 040–048 were written to `docs/ebayAPI/` (presumably after a chat session reset where the correct folder was not re-established). They are all valid content; only their path is wrong.

**Recommendation:** In a future cleanup pass, move `docs/ebayAPI/040_*.md` through `docs/ebayAPI/048_*.md` into `docs/audit/pages/ebayListings/fileStructure/`. This is a rename-only operation — no content changes needed. Do not do it in a mixed code+doc pass.

---

## 8. Code Changes in This Pass

### Change: 9 dead import symbols removed from `index.js`

**Confirmed dead by grep:** each symbol appeared only on its import line; never called in the index.js body. The modules that actually use them (reconcileActions.js, productActions.js, table.js, cards.js, editFetch.js internal) import them directly from the source modules.

**Removed from `linkCheck.js` import:**
`isLinkedOnEbay`, `isLinkWarningCheck`, `staleActionState`, `staleActionBadge`, `staleLinkLabel`, `ebayCodeLinkHtml`
(were imported by index.js from a pre-module-extraction era)

**Removed from `editFetch.js` import:**
`shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure`
(used internally by editFetch.js only; never called directly by index.js)

**Verification:**
```
node --check js/admin/ebayListings/index.js   → exit 0
node --check js/admin/ebayListings/editModal.js → exit 0
```

**`index.js` line count after this pass:** 512 (was 527 post-E-2b, 1,937 at checkpoint 027)

---

## Summary

| Metric | Value |
|---|---|
| `index.js` line count now | **512** |
| `editModal.js` line count | **413** |
| `pushModal.js` line count | **740** (stable, no changes) |
| Total files in ebayListings/ | 31 |
| Dead code in index.js | None |
| Stale imports in index.js | None (all cleared) |
| Push migration | **Complete** |
| Edit migration | **E-2 complete** (openEdit migrated); E-3/E-4 remain |
| syncBack bridge | Still active — removed in E-5 after all handlers migrate |
| Recommended next step | **E-3a** — move 5 small Edit listeners into `editModal.js` |

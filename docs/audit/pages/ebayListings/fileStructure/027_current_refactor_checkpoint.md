# 027 — Current Refactor Checkpoint

**Date:** 2026-05-16  
**Status:** Documentation / checkpoint pass. One 3-line stale-comment cleanup applied.

---

## 1. Current File List and Line Counts

All files in `js/admin/ebayListings/`:

| File | Lines | Responsibility |
|---|---|---|
| `api.js` | 74 | `callEdge`, `fetchProducts`, `fetchProductsWithWorkspaceMetrics`, `mergeWorkspaceMetrics` |
| `aspectHelpers.js` | 86 | `buildAspectField`, `buildEditAspectField`, `collectAspects`, `validateRequiredAspects` |
| `bulkActions.js` | 114 | `initBulkActions`, `updateBulkBar` — bulk select, mass end/publish |
| `cards.js` | 56 | `renderCards(products, pageAdRatePct)` — card view renderer |
| `editor.js` | 116 | Quill toolbar config, `descState`, `resetQuillEditorMount`, `toggleDescMode`, `getDescriptionHtml` |
| `filters.js` | 60 | `filterProducts(all, query, status, quick)` — pure filter function |
| `images.js` | 84 | `renderImageStrip`, `showGalleryPicker` — image strip + picker UI |
| `importPanel.js` | 67 | `initImportPanel` — eBay import/migrate panel |
| `index.js` | **1937** | Page orchestrator (see §4 below) |
| `linkCheck.js` | 73 | 10 pure display helpers — `isLinkedOnEbay`, `isStaleLinkCheck`, `staleLinkMessage`, etc. |
| `listingHealth.js` | 209 | `computeHealth` — listing health scoring |
| `modalPreviews.js` | 140 | `refreshPushPreview`, `refreshEditPreview`, `refreshPushRef`, `refreshEditRef`, `loadAndRenderPriceRef` |
| `priceReference.js` | 282 | `buildPriceRef`, `renderPriceRef`, `fetchSalesMetrics` — price reference panel |
| `productActions.js` | 45 | `renderProductActions(product)` — action button markup |
| `profitPreview.js` | 384 | `buildEstimate`, `renderPreview` — profit math + preview render |
| `renderHelpers.js` | 128 | `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` — table/card chip helpers |
| `salesHistory.js` | 212 | `openSalesHistory`, `closeSalesHistory` — sales history modal |
| `setupPanel.js` | 69 | `initSetupPanel` — eBay setup/credential panel |
| `table.js` | 63 | `renderTable(products, pageAdRatePct)` — table view renderer |
| `taxonomyApi.js` | 39 | `fetchAspectsForCategory`, `fetchCategorySuggestions` — taxonomy Edge Function wrappers |
| `utils.js` | 176 | 15 pure helpers: `esc`, `sanitizeForEbay`, `wrapDescription`, `isComplexHtml`, `buildImageUrls`, `buildPackageWeightAndSize`, `getSelectedPolicies`, `getBestOfferTerms`, `variantSkuFromOption`, `publishQuantityForProduct`, `activeVariantCount`, `isEffectiveGroupListing`, `enableBtn`, `imageOptionLabel`, `addAiBadge` |
| `variantPanel.js` | 175 | 8 variant panel helpers: `renderVariantPanel`, `getCheckedVariants`, `renderVariantAssignedImages`, `getAssignedVariantImages`, `setAssignedVariantImages`, `renderVariantCandidatePicker`, `refreshVariantCandidateButtons`, `wireVariantImageSetControls` |
| `volPricing.js` | 70 | `addVolTier`, `getVolTiers`, `setVolTiers` — volume pricing tier UI |

**Total module files:** 23  
**Total module lines (excluding index.js):** ~3,256  

---

## 2. Current `index.js` Line Count

| Point in time | Approximate line count |
|---|---|
| Original (pre-refactor) | ~2,600+ estimated |
| After Phase 4a–4h (rendering modules) | ~2,300 |
| After Push Phases A–B (utils extraction) | ~2,150 |
| After Push Phase C (aspectHelpers) | ~2,100 |
| After Push Phase D (variantPanel) | ~2,030 |
| After Push Phase E (modalPreviews) | ~1,950 |
| After Push Phase F (taxonomyApi) | **1,937** (current) |

> Note: post-refactor additions (Vol Pricing, Price Reference, AI Auto-Fill, Sales History, Variant Image Controls) added features during the refactor period, maintaining high overall line counts.

### Major responsibility groups remaining in `index.js`

1. Imports (lines 1–88) — 88 lines
2. Module state declarations (lines 92–115) — 24 lines
3. Edit-fetch helpers (lines 116–196) — 81 lines  
4. Reconciliation / link audit (lines 198–276) — 79 lines  
5. `renderEditLinkWarning` + `showStatus` (lines 277–310) — 34 lines  
6. Policy cache + dropdown population (lines 311–350) — 40 lines  
7. Product loading, filtering, rendering orchestration (lines 355–413) — 59 lines  
8. Push modal aspect fetch `fetchAspects` (lines 415–446) — 32 lines  
9. `openPush` (lines 448–590) — 143 lines  
10. `openEdit` (lines 592–874) — 283 lines  
11. `renderEditVariantImageControls` (lines 876–950) — 75 lines  
12. Table-action handlers: `discardDraft`, `doWithdraw`, `doPublish` (lines 952–1027) — 76 lines  
13. Event listeners — page-level (lines 1028–1070) — 43 lines  
14. Event listeners — Push modal description/category/AI/create/offer/publish (lines 1071–1529) — 459 lines  
15. Event listeners — Edit modal close/relink/description/AI/save (lines 1530–1937) — 408 lines  

---

## 3. What Has Already Been Extracted

| Phase | Doc | Module | What moved |
|---|---|---|---|
| Phase 1 | 001 | `api.js` | `callEdge`, `fetchProducts`, `mergeWorkspaceMetrics` |
| Phase 2 | built-in | `utils.js` | 15 pure helpers (esc, buildImageUrls, buildPackageWeightAndSize, etc.) |
| Phase 4a | — | `filters.js` | `filterProducts` |
| Phase 4b | — | `renderHelpers.js` | `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` |
| Phase 4c | — | `productActions.js` | `renderProductActions` |
| Phase 4d | — | `table.js` | `renderTable` |
| Phase 4e | — | `cards.js` | `renderCards` |
| Phase 4f | — | `setupPanel.js` | `initSetupPanel` |
| Phase 4g | — | `importPanel.js` | `initImportPanel` |
| Phase 4h | — | `bulkActions.js` | `initBulkActions`, `updateBulkBar` |
| Push Phase A | 021 | `utils.js` additions | pure product helpers |
| Push Phase B | 022 | `utils.js` additions | small UI helpers |
| Push Phase C | 023 | `aspectHelpers.js` | `buildAspectField`, `buildEditAspectField`, `collectAspects`, `validateRequiredAspects` |
| Push Phase D | 024 | `variantPanel.js` | 8 variant panel helpers |
| Push Phase E | 025 | `modalPreviews.js` | 5 profit preview + price reference helpers |
| Push Phase F | 026 | `taxonomyApi.js` | `fetchAspectsForCategory`, `fetchCategorySuggestions` |

Other pre-existing extracted modules (not from this refactor pass):  
`editor.js`, `images.js`, `volPricing.js`, `listingHealth.js`, `salesHistory.js`, `profitPreview.js`, `priceReference.js`, `linkCheck.js`

---

## 4. What Still Remains Inside `index.js`

### Group A — Edit-fetch helpers (lines 116–196, ~81 lines)

Functions that support loading eBay data when opening the Edit modal:

| Function | Lines | Dependencies |
|---|---|---|
| `shortDelay(ms)` | 3 | none |
| `ebayErrorIds(payload)` | 3 | none |
| `isTransientGetItemFailure(result)` | 5 | `ebayErrorIds` |
| `getItemForEdit(sku)` | 31 | `callEdge`, `shortDelay`, `isTransientGetItemFailure` |
| `getOffersForEdit(sku, context)` | 24 | `callEdge`, `editOfferLookupCache` (module state) |
| `offerUpdateErrorMessage(result, fallback)` | 8 | none |

**Used by:** `openEdit` (lines 680, 690, 702, 734), `renderEditVariantImageControls` (line 904), edit save handler (lines 1816, 1845)

### Group B — Reconciliation / link audit (lines 198–276, ~79 lines)

| Function | Lines | Dependencies |
|---|---|---|
| `reconcileEbayLink(product, relink)` | 16 | `callEdge` |
| `auditListingLinks(products)` | 20 | `reconcileEbayLink`, `allProducts`, `isLinkWarningCheck`, `renderAll`, `showStatus` |
| `relinkEbayListing(code)` | 18 | `allProducts`, `reconcileEbayLink`, `showStatus`, `loadProducts` |
| `clearStaleEbayLink(code)` | 18 | `allProducts`, `callEdge`, `showStatus`, `loadProducts` |

### Group C — Page-local UI helpers (lines 277–310)

| Function | Lines | Dependencies |
|---|---|---|
| `renderEditLinkWarning(check)` | 26 | DOM, `linkCheck.js` helpers, `esc` |
| `showStatus(msg, isError)` | 6 | DOM only |

### Group D — Policy cache (lines 311–350)

| Function | Lines | Dependencies |
|---|---|---|
| `loadPoliciesCache()` | 10 | `callEdge`, `cachedPolicies` state, `populatePolicyDropdowns` |
| `populatePolicyDropdowns()` | 30 | `cachedPolicies` state, DOM |

### Group E — Product loading / filtering / rendering orchestration (lines 355–413)

| Function | Purpose |
|---|---|
| `loadProducts()` | Fetch → filter → stats → audit |
| `applyFilters()` | Re-filter + re-render |
| `renderAll()` | Dispatch to table or cards |
| `setView(view)` | Toggle view mode |
| `updateStats()` | Update stat counters |

These are page bootstrap orchestrators — **do not extract**.

### Group F — Push modal aspect DOM helper (lines 415–446)

`fetchAspects(categoryId)` — calls `fetchAspectsForCategory` + mutates `currentAspects` state + renders DOM. Mixed state/DOM function, intentionally not extracted in Phase F.

### Group G — Push modal open flow (lines 448–590, ~143 lines)

`openPush(code)` — full modal initialization including draft resume.

### Group H — Edit modal open flow (lines 592–874, ~283 lines)

`openEdit(code)` — full edit modal initialization including link reconcile, eBay data fetch, aspect pre-fill.

### Group I — Edit variant image controls (lines 876–950, ~75 lines)

`renderEditVariantImageControls(product, group)` — async, renders per-variant image rows in edit modal.

### Group J — Table-triggered action handlers (lines 952–1027, ~76 lines)

| Function | Lines |
|---|---|
| `discardDraft(code, offerId, itemGroupKey)` | ~26 |
| `doWithdraw(code, offerId, itemGroupKey)` | ~18 |
| `doPublish(code, offerId, itemGroupKey)` | ~28 |

### Group K — Push modal event handlers (lines 1071–1529, ~459 lines)

| Handler | Lines | Risk |
|---|---|---|
| Description mode toggle (3 listeners) | ~12 | Low |
| Category search `btnSearchCat` | ~30 | Low |
| AI auto-fill `btnAiFill` | ~90 | Medium |
| Create Item `btnCreateItem` | ~105 | High (payload) |
| Create Offer `btnCreateOffer` | ~147 | High (payload) |
| Publish `btnPublish` | ~70 | High (payload) |

### Group L — Edit modal event handlers (lines 1530–1937, ~408 lines)

| Handler | Lines | Risk |
|---|---|---|
| Modal close | ~5 | Low |
| Relink button | ~3 | Low |
| Description mode toggle (3 listeners) | ~12 | Low |
| AI auto-fill `btnEditAiFill` | ~80 | Medium |
| Save Changes `btnSaveEdit` | ~180 | High (payload) |

### Group M — Miscellaneous event listeners

Checkbox toggles (Best Offer, Lot, Vol Pricing), vol tier add buttons,  
`initBulkActions`, `initSetupPanel`, `initImportPanel` wiring, refresh button,  
`handleProductAction` dispatcher, `init()` bootstrap — ~60 lines

---

## 5. Risk Ranking of Remaining Extraction Candidates

### Low Risk

| Candidate | Why safe |
|---|---|
| Group A — `getItemForEdit` + its 4 pure helpers | Self-contained edit-fetch utilities; only dependency is `callEdge` and a cache state passed by reference. `offerUpdateErrorMessage` is pure. No DOM, no page state except `editOfferLookupCache`. |
| `fetchAspects(categoryId)` (Group F) | Could be refactored to return value + let index.js do DOM, but current DOM entanglement makes this medium-risk; see note. |

### Medium Risk

| Candidate | Why medium |
|---|---|
| Policy cache (`loadPoliciesCache` + `populatePolicyDropdowns`) | Shares `cachedPolicies` state. Extractable to `policyCache.js` with callback injection, but dropdown IDs are hardcoded and both modals share the same dropdowns — requires care. |
| Reconciliation cluster (`reconcileEbayLink` + `auditListingLinks` + `relinkEbayListing` + `clearStaleEbayLink`) | `reconcileEbayLink` alone is low-risk. But the cluster depends on `allProducts`, `showStatus`, `loadProducts`, `renderAll` — needs callbacks to extract cleanly. |
| `renderEditLinkWarning` | Small, DOM-only, but tightly coupled to edit modal element IDs — extract only when edit modal is ready. |
| AI auto-fill handlers (Push + Edit) | ~170 lines combined, no payload risk (`ebay-ai-autofill` only), but deep DOM + state coupling. |
| Table-action handlers (`discardDraft`, `doWithdraw`, `doPublish`) | ~76 lines combined. No shared state, but these call `callEdge`, `showStatus`, `loadProducts`. Need callbacks or imports to move. |

### High Risk — do not extract yet

| Candidate | Why high risk |
|---|---|
| `openPush` | 143 lines. Orchestrates full modal init, draft resume, Quill mount, all Push state. Extract only after all helpers are pre-cleaned. |
| `openEdit` | 283 lines. Calls `getItemForEdit`, `getOffersForEdit`, `reconcileEbayLink`, all Edit state, category/aspect fetch, variant image controls. Largest and most complex function. |
| `renderEditVariantImageControls` | Called only from `openEdit`. Extract when or after `openEdit` is ready. |
| `btnCreateItem` handler | eBay payload — do not change. |
| `btnCreateOffer` handler | eBay payload — do not change. |
| `btnPublish` handler | eBay payload — do not change. |
| `btnSaveEdit` handler | eBay payload for update_item, update_offer, update_item_group — highest risk in the file. |

### Do Not Touch Yet

- `openPush` — next only after edit-fetch helpers and policy cache are pre-extracted
- `openEdit` — next only after full helper cleanup
- All eBay payload assembly (create_item, create_offer, publish_group, update_item, update_offer, update_item_group)
- `init()` bootstrap
- All module-level state declarations

---

## 6. Recommended Next Extraction

### Push Phase G: `editFetch.js` — Edit-session eBay fetch helpers

**Why next:**  
Group A is the cleanest extraction remaining. These 6 functions are tightly clustered, have no DOM dependencies, and form a natural "eBay data fetch for edit session" unit. Extracting them clears space before `openEdit` can be tackled in a future high-risk phase.

**Files affected:**
- `js/admin/ebayListings/editFetch.js` (new, ~90 lines)
- `js/admin/ebayListings/index.js` (remove 6 function bodies, add import)

**Functions to move:**

| Function | Notes |
|---|---|
| `shortDelay(ms)` | Pure timing utility |
| `ebayErrorIds(payload)` | Pure payload inspector |
| `isTransientGetItemFailure(result)` | Pure retry condition checker |
| `getItemForEdit(sku)` | Needs `callEdge` — import from `./api.js` directly |
| `offerUpdateErrorMessage(result, fallback)` | Pure error message formatter |
| `getOffersForEdit(cache, sku, context)` | **Signature change**: add `cache` param (receives `editOfferLookupCache`) — all call sites pass the cache; `openEdit` reset (`editOfferLookupCache = new Map()`) stays in index.js |

**Dependency direction:**  
`editFetch.js` → `api.js` (callEdge) — no cycle

**Risk level:** Low–Medium  
The only complexity is `getOffersForEdit` cache parameter, but Maps are passed by reference in JS so the memoization pattern is preserved exactly. The cache reset in `openEdit` (line 611: `editOfferLookupCache = new Map()`) stays in index.js.

**Verification checklist:**
1. `node --check editFetch.js`
2. `node --check index.js`
3. Page loads
4. Products load
5. Edit modal opens on an ACTIVE product
6. Edit modal populates title, price, weight, images correctly
7. Edit modal loads aspects correctly
8. Variant edit modal opens and shows per-variant rows
9. Edit save succeeds (or fails with correct eBay error, not JS error)
10. No `editOfferLookupCache` mutation errors

---

## 7. Push/Edit Modal Warning

### `pushModal.js` — NOT READY YET

`openPush` can only be extracted after:
- [ ] `editFetch.js` is done (Push Phase G) — clears helpers used by push draft resume
- [ ] Policy cache (`loadPoliciesCache`) is pre-extracted or made callable — used inside `openPush? No — `openPush` itself does NOT call `loadPoliciesCache`. That's only called in `openEdit` and `init`.  
  
Correction: `openPush` is slightly simpler. It does not call `loadPoliciesCache`. Remaining dependencies for `openPush` extraction:  
- `callEdge` (for draft resume get_item) — already importable  
- `fetchAspects` — still in index.js, needs to be a callable  
- All push state: `currentProduct`, `currentAspects`, `pushVariants`, `isVariantListing`, `pushImageUrls`, `pushQuill`, `pushSalesMetrics`  
- `showStatus`, `refreshPushPreview`, `loadAndRenderPriceRef`, `buildImageUrls`, `renderImageStrip`, all imported helpers  

**Assessment:** `openPush` remains high-risk. Do not attempt to extract it until Push modal handler extraction (Groups K minus AI fill) has been evaluated.

### `editModal.js` — NOT READY YET

`openEdit` can only be extracted after:
- [ ] **Push Phase G** (`editFetch.js`) — `getItemForEdit`, `getOffersForEdit` must be pre-extracted
- [ ] **Optional**: Policy cache pre-extracted (`loadPoliciesCache`)
- [ ] **Optional**: `reconcileEbayLink` pre-extracted or made callable
- [ ] `renderEditVariantImageControls` — decision: move with `openEdit` or extract first separately

`openEdit` is the most complex function in the file (283 lines, calls 8+ external helpers, manages 6 state variables, renders 3 sub-sections). It should be the **last** function moved in the edit modal extraction sequence, not the first.

**What should be extracted BEFORE attempting either modal file:**
1. `editFetch.js` (Push Phase G) — `getItemForEdit`, `getOffersForEdit`, `offerUpdateErrorMessage`, helpers
2. Optionally: `policyCache.js` — `loadPoliciesCache` + `populatePolicyDropdowns`
3. Optionally: `linkActions.js` — `reconcileEbayLink` (standalone), `relinkEbayListing`, `clearStaleEbayLink`
4. Only then: evaluate `openPush` or `openEdit` extraction

---

## 8. Optional Tiny Cleanup Applied

Removed 3 stale comments from `index.js` at lines 350–352:

```js
// Relative date formatter for "last sold" badges.
// ── Est Profit Helpers (Phase 6) ──────────────────────────────
// formatRelativeDate, wsChips, epCls, rowEstProfitHtml moved to renderHelpers.js
```

These were migration markers left over when `formatRelativeDate` and the profit helpers were extracted to `renderHelpers.js`. No code was attached — comment-only removal.

**Verification:** `node --check index.js` — clean.

# 052 — Post-Recovery Verification Checkpoint

**Date:** 2026-05-16  
**Scope:** eBay Listings file-structure state after `051_recovery_reconciliation_summary.md`  
**Mode:** docs/checkpoint only — no feature work, no extraction, no payload/backend/database changes.

---

## Executive Summary

The post-recovery codebase is **syntax-clean** and the live page can render products, switch table/card views, open Push, open Edit, open Setup, open Import, and update bulk selection state after browser cache is disabled.

However, the page is **not yet fully structurally clean**:

1. `index.js` still has a large live Push flow and Edit save/AI flow.
2. `pushModal.js` exists and contains a full Push-modal factory with duplicate Push ownership, but it is **not imported or wired** by `index.js`.
3. `filters.js`, `aspectFlow.js`, and parts of `taxonomyApi.js` are extracted but are currently **not wired into `index.js` Push/search flow**.
4. `index.js` has several unused imports and two unused local remnants (`SUPABASE_URL`, `linkAuditRunId`).
5. Browser verification initially hit stale cached modules on port `8080`; after cache/service-worker clearing, current files loaded correctly.

Decision standard: **pause refactor and stabilize before continuing**.

---

## Current Line Counts

### Primary files

| File | Lines |
|---|---:|
| `js/admin/ebayListings/index.js` | 1263 |
| `js/admin/ebayListings/editModal.js` | 508 |
| `js/admin/ebayListings/pushModal.js` | 827 |
| `pages/admin/ebay-listings.html` | 799 |
| `docs/audit/pages/ebayListings/fileStructure/051_recovery_reconciliation_summary.md` | 149 |

### All `js/admin/ebayListings/*.js`

| File | Lines |
|---|---:|
| `actionDispatcher.js` | 60 |
| `api.js` | 74 |
| `aspectFlow.js` | 75 |
| `aspectHelpers.js` | 86 |
| `bulkActions.js` | 114 |
| `cards.js` | 56 |
| `editFetch.js` | 139 |
| `editModal.js` | 508 |
| `editor.js` | 116 |
| `filters.js` | 60 |
| `images.js` | 84 |
| `importPanel.js` | 67 |
| `index.js` | 1263 |
| `linkCheck.js` | 73 |
| `listingHealth.js` | 209 |
| `modalPreviews.js` | 140 |
| `policyCache.js` | 58 |
| `priceReference.js` | 282 |
| `productActions.js` | 45 |
| `profitPreview.js` | 384 |
| `pushModal.js` | 827 |
| `reconcileActions.js` | 147 |
| `renderHelpers.js` | 128 |
| `salesHistory.js` | 212 |
| `setupPanel.js` | 69 |
| `table.js` | 63 |
| `tableActions.js` | 102 |
| `taxonomyApi.js` | 39 |
| `utils.js` | 176 |
| `variantPanel.js` | 271 |
| `volPricing.js` | 70 |

---

## Required Check 1 — Duplicate Ownership Audit

### Result by group

| Group | Current owner(s) | Duplicate still inline in `index.js`? | Notes |
|---|---|---:|---|
| API helpers | `api.js` | No | `callEdge()` and workspace metric merge are externalized. `index.js` still directly performs the main product Supabase query instead of using `fetchProductsWithWorkspaceMetrics()`. |
| Filter helpers | `filters.js` + `index.js` | **Partial duplicate ownership** | `filters.js` exports `filterProducts()`, but `index.js` still owns equivalent filter logic in local `applyFilters()`. Function name differs, but ownership overlaps. |
| Render helpers | `renderHelpers.js` | No | Extracted helpers are no longer defined inline. Several imported render helpers are currently unused by `index.js` because table/cards own them. |
| Table/cards rendering | `table.js`, `cards.js` | No | `index.js` calls `renderTable(filteredProducts, pageAdRatePct)` and `renderCards(filteredProducts, pageAdRatePct)`. |
| Product action rendering | `productActions.js` | No | No inline `renderProductActions()` remains. Runtime after cache clear shows product buttons use `data-action`. |
| Table actions | `tableActions.js` | No | No inline `window.discardDraft`, `window.doWithdraw`, or `window.doPublish` remains. |
| Action dispatcher | `actionDispatcher.js` | No | `tableSection` and `cardSection` use `dispatchProductAction`. |
| Setup handlers | `setupPanel.js` | No | `initSetupPanel({ callEdge })` is called in `init()`. |
| Import handlers | `importPanel.js` | No | `initImportPanel({ callEdge, loadProducts })` is called in `init()`. |
| Bulk handlers | `bulkActions.js` | No | `initBulkActions({ callEdge, supabase, loadProducts })` is called in `init()`. |
| Link check helpers | `linkCheck.js` | No | No inline link-check helper definitions remain. |
| Reconciliation actions | `reconcileActions.js` | No | `reconcileCtx` owns reconciliation, relink, clear-stale, and edit warning render. |
| Aspect helpers | `aspectHelpers.js` | No | `buildAspectField()`, `collectAspects()`, `validateRequiredAspects()`, `buildEditAspectField()` are not duplicated inline. |
| Aspect flow | `aspectFlow.js` + `index.js` | **Partial duplicate ownership** | `aspectFlow.js` exports `fetchAndRenderAspects()`, but `index.js` still owns local `fetchAspects()` and direct taxonomy call in the Push category flow. |
| Variant panel helpers | `variantPanel.js` | No | Inline variant helpers are gone; `renderVariantPanel()` and `getCheckedVariants()` use module signatures. |
| Modal previews | `modalPreviews.js` | No | Inline preview/ref functions are gone; current Push calls use module signatures. |
| Taxonomy API wrappers | `taxonomyApi.js`, `editModal.js`, `index.js` | **Partial duplicate ownership** | `editModal.js` uses `fetchAspectsForCategory()`. Push in `index.js` still calls `callEdge("ebay-taxonomy", ...)` directly for category search and aspects. |
| Edit fetch helpers | `editFetch.js` | No | `getOffersForEdit(editOfferLookupCache, sku, context)` signature is used correctly in Edit save. |
| Policy cache | `policyCache.js` | No | `loadPoliciesCache()` is imported and used; inline cache state is removed. |
| Edit modal open logic | `editModal.js` | No | `index.js` only sets `window.openEdit = editCtx.openEdit`. Edit AI fill/save still live in `index.js` and are intentionally not duplicated in `editModal.js`. |
| Push modal open/create/offer/publish logic | `index.js` + `pushModal.js` | **Yes, duplicate ownership exists** | `pushModal.js` contains `createPushModalContext()` with `openPush`, create item/offer/publish, AI fill, category, and listeners. It is not imported or active; `index.js` remains live owner. |

### Specific duplicate findings

1. **Active duplicate-risk file: `pushModal.js`**
   - Contains a full Push-modal context factory and handlers.
   - `index.js` still owns `window.openPush`, Push close, Push AI fill, category search, create item, create offer, publish, and Push toggle listeners.
   - Because `pushModal.js` is not imported, there is no runtime double-binding now, but the file is a high-risk duplicate source for future work.

2. **Extracted but not wired: `filters.js`**
   - `filterProducts()` exists.
   - `index.js` still owns `applyFilters()` and inline predicate logic.

3. **Extracted but not wired for Push: `aspectFlow.js` + `taxonomyApi.js`**
   - `fetchAndRenderAspects()` and `fetchCategorySuggestions()` exist.
   - `index.js` Push flow still calls `callEdge("ebay-taxonomy", ...)` directly and owns `fetchAspects()`.
   - `editModal.js` already uses `fetchAspectsForCategory()`.

---

## Required Check 2 — Import / Wiring Audit

### Good wiring confirmed

- `reconcileCtx` is wired and used by `loadProducts()`, Edit open context, Edit save stale-link check, relink, and clear-stale actions.
- `tableCtx` is wired into `dispatchProductAction` for `withdraw`, `publish`, and `discard-draft`.
- `dispatchProductAction` is attached to both `tableSection` and `cardSection`.
- Product actions currently render `data-action` attributes, not inline `onclick`, when current files are loaded.
- `renderTable()` and `renderCards()` are called with `filteredProducts` and `pageAdRatePct`.
- `renderVariantPanel()` is called with `(activeVariants, currentProduct.code, currentProduct)`.
- `getCheckedVariants()` is called with `(pushVariants, currentProduct.code)`.
- `loadAndRenderPriceRef()` Push call uses the current 5-argument module signature.
- Edit save uses `getOffersForEdit(editOfferLookupCache, vSku, "save")`.
- `init()` calls `initBulkActions()`, `initSetupPanel()`, and `initImportPanel()`.
- `editCtx.bindEditBaseListeners()` is still called before `init()` (verified in code).

### Unused imports in `index.js`

A rough static usage scan found these imports appear only in import declarations:

| Import | From | Status |
|---|---|---|
| `variantSkuFromOption` | `utils.js` | Unused in `index.js`; used by modules. |
| `publishQuantityForProduct` | `utils.js` | Unused in `index.js`; table actions use it internally. |
| `activeVariantCount` | `utils.js` | Unused in `index.js`; utility module ownership only. |
| `isEffectiveGroupListing` | `utils.js` | Unused in `index.js`; used by `tableActions.js` and `editModal.js`. |
| `imageOptionLabel` | `utils.js` | Unused in `index.js`; used by `variantPanel.js`. |
| `buildEstimate`, `renderPreview` | `profitPreview.js` | Unused in `index.js`; modal preview module owns these calls. |
| `buildPriceRef`, `renderPriceRef`, `fetchSalesMetrics` | `priceReference.js` | Unused in `index.js`; modal preview module owns these calls. |
| `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` | `renderHelpers.js` | Unused in `index.js`; table/cards own presentation calls. |
| `isLinkedOnEbay`, `isOutOfStockLinkCheck`, `isLinkWarningCheck`, `staleActionState`, `staleActionBadge`, `staleLinkLabel`, `currentActiveListingId`, `ebayCodeLinkHtml` | `linkCheck.js` | Mostly unused in `index.js`; link modules/table/cards use them. `isStaleLinkCheck` and `staleLinkMessage` are still used. |
| `renderProductActions` | `productActions.js` | Unused in `index.js`; table/cards own rendering. |
| `updateBulkBar` | `bulkActions.js` | Unused in `index.js`; bulk module owns it. |
| `buildEditAspectField` | `aspectHelpers.js` | Unused in `index.js`; `editModal.js` uses it. |
| `renderVariantAssignedImages`, `getAssignedVariantImages`, `setAssignedVariantImages`, `renderVariantCandidatePicker`, `refreshVariantCandidateButtons`, `wireVariantImageSetControls`, `renderEditVariantImageControls` | `variantPanel.js` | Unused in `index.js`; `variantPanel.js`/`editModal.js` own these. |
| `refreshEditPreview`, `refreshEditRef` | `modalPreviews.js` | Unused in `index.js`; `editModal.js` owns base Edit listener wiring. |
| `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure`, `getItemForEdit` | `editFetch.js` | Unused in `index.js`; edit modules own these. |

These are not parse/runtime blockers if the exported names exist, but they are stale import clutter and increase cache/import-error risk.

### Unused local state/remnants in `index.js`

| Local | Finding |
|---|---|
| `SUPABASE_URL` | Declared in `index.js` but not used after `callEdge()` moved to `api.js`. |
| `linkAuditRunId` | Declared in `index.js` but not used after reconciliation moved into `reconcileActions.js`. |

### Stale function names / old signatures

No active old-signature call sites found for:

- `renderVariantPanel(activeVariants, currentProduct.code)`
- `getCheckedVariants()` with no args
- `loadAndRenderPriceRef(..., "push")` / `loadAndRenderPriceRef(..., "edit")`
- `getOffersForEdit(vSku, "save")`
- standalone `reconcileEbayLink(...)`
- standalone `renderEditLinkWarning(...)`

### Event listener duplication

Current active page wiring has no duplicated Setup/Import/Bulk listeners in `index.js`; those are delegated to module init functions.

Important caveat: if `pushModal.js` were wired without first removing the Push listeners in `index.js`, it would double-bind Push buttons. Treat `pushModal.js` as inactive duplicate code until a dedicated migration phase.

### Product action `onclick` check

- Source grep: no `onclick=` in `pages/admin/ebay-listings.html`.
- Live runtime after cache clear:
  - Table product action inline onclick count: `0`
  - Card product action inline onclick count: `0`
  - Table `data-action` count: `106`
  - Card `data-action` count: `106`

### Unexpected `window.*` globals

Current expected globals:

- `window.openPush = async function openPush(code) { ... }`
- `window.openEdit = editCtx.openEdit`

No remaining `window.discardDraft`, `window.doWithdraw`, `window.doPublish`, `window.relinkEbayListing`, or `window.clearStaleEbayLink` assignments were found.

`window.openPush` remains necessary for current dispatcher wiring, but should eventually become `pushCtx.openPush` once Push migration resumes.

---

## Required Check 3 — Current `index.js` Responsibility Map

### State

`index.js` currently owns:

- Supabase client setup.
- Product list state: `allProducts`, `filteredProducts`.
- View/filter state: `currentView`, `searchTimeout`, `pageAdRatePct`.
- Push modal state: `currentProduct`, `currentAspects`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushSalesMetrics`.
- Edit sync-back state used by Edit AI/save: `editProduct`, `editQuill`, `editImageUrls`, `editVariantImageOverrides`, `editVariantQtyOverrides`, `editAspects`, `editSalesMetrics`, `editOfferLookupCache`.
- Two stale local remnants: `SUPABASE_URL`, `linkAuditRunId`.

### Loading orchestration

- `loadProducts()` performs the product Supabase query, merges workspace metrics, filters/renders, updates stats, and starts link audit via `reconcileCtx.auditListingLinks(allProducts)`.
- `updateStats()` is local and intentionally retained because it directly reads `allProducts`.
- `renderAll()` switches table/card sections and calls module renderers.

### Filtering / view state

- `applyFilters()` remains in `index.js` and duplicates the extracted predicate behavior in `filters.js`.
- `setView()` remains local and updates toggle button state.

### Push flow

`index.js` still owns the live Push flow:

- `window.openPush`
- `fetchAspects()`
- Push close listener
- Push price/ref listeners
- Push image picker
- Push description mode listeners
- Push category search
- Push AI Auto-Fill
- Step 1 create inventory item(s)
- Step 2 create offer/group offer
- Step 3 publish
- Push best-offer/lot/volume toggles

`pushModal.js` duplicates this area but is not active.

### Edit flow

Split ownership:

- `editModal.js` owns `openEdit()` and base Edit listeners: close, relink, edit price/ref refresh, image picker, description tabs.
- `index.js` still owns Edit AI Auto-Fill.
- `index.js` still owns Edit Save.
- `index.js` owns Edit best-offer/lot/volume toggles.

### Event wiring

`index.js` still directly wires:

- Search, clear search, status filter, quick filter, ad-rate filter.
- View toggle.
- Push modal listeners and all Push step buttons.
- Product action delegation to `dispatchProductAction`.
- Sales modal close.
- Edit AI fill.
- Edit save.
- Edit/Push checkbox toggles for best-offer, lot, volume, and tier buttons.
- Refresh button.

Module-owned event wiring now active:

- `editCtx.bindEditBaseListeners()`
- `initBulkActions(...)`
- `initSetupPanel(...)`
- `initImportPanel(...)`

### Bootstrap/init

`init()` currently:

1. Initializes admin nav and footer.
2. Requires admin.
3. Syncs view toggle state.
4. Loads products.
5. Starts policy cache load.
6. Wires bulk/setup/import modules.

---

## Required Check 4 — Live / Static Verification

### Static checks run

| Command | Result |
|---|---|
| `node --check js/admin/ebayListings/index.js` | ✅ exit 0 |
| `node --check` for every `js/admin/ebayListings/*.js` module | ✅ all 31 modules OK |
| `git diff --check -- js/admin/ebayListings/index.js docs/audit/pages/ebayListings/fileStructure/051_recovery_reconciliation_summary.md` | ✅ exit 0 |

### Browser smoke check

Environment notes:

- Existing `localhost:5500` page was affected by service-worker/offline behavior during cache-busted navigation.
- `localhost:8080` was used for current-file verification.
- Initial `8080` reload produced `The requested module './utils.js' does not provide an export named 'imageOptionLabel'` due stale browser/module cache. A direct `fetch('/js/admin/ebayListings/utils.js?verify052=...')` showed the current file did export `imageOptionLabel`.
- After disabling browser cache and clearing service workers/caches, the current module graph loaded and rendered correctly.

| Smoke item | Result | Evidence / note |
|---|---|---|
| Page loads | ✅ | Title `Admin · eBay Listings`. |
| Products load | ✅ | `59` products rendered; stats showed `59 / 23 / 0 / 35`. |
| Table renders | ✅ | `#productsBody tr` count `59`. |
| Card view renders | ✅ | Card view toggled; `#cardsGrid > div` count `59`. |
| Push opens | ✅ | First Push action opened `pushModal`; modal product name `8-Ball Dice Charm Keychain`; Quill editor existed. |
| Edit opens | ⚠️ Partial | Edit modal opened for `Blue Bell Flower Charm Keychain`; eBay hydration stopped with `Not authenticated — please refresh the page`, expected from Edge auth/session during local smoke. Modal open wiring itself worked. |
| Setup opens | ✅ / auth-limited | Setup panel opened; content showed `❌ Not authenticated — please refresh the page`, expected because `get_policies` requires session token. |
| Import opens | ✅ | Import panel opened and showed Scan / Auto-Link buttons. |
| Bulk selection works | ✅ | First bulk checkbox set bulk bar visible; count became `1 selected`. |
| No inline product action onclicks | ✅ after cache clear | Table inline onclick count `0`; Card inline onclick count `0`; `data-action` present. |

### Console findings during smoke

Expected/local-environment warnings/errors:

- Tailwind CDN production warning.
- PWA Push subscription failures in browser/incognito/no active service worker.
- Repeated eBay link audit warnings: `Not authenticated — please refresh the page` from `api.js:16`, because Edge Function calls require a Supabase auth token/session.
- Policy load warning: `Not authenticated — please refresh the page`.

No post-cache-clear module parse/import error remained.

---

## Required Check 5 — Remaining Risks

1. **Push duplicate ownership risk is high**
   - `pushModal.js` is substantial and overlaps with live `index.js` Push behavior.
   - Do not wire it casually. It must be reconciled in a focused, low-risk migration with one binding owner at a time.

2. **Unused imports in `index.js` increase cache/import fragility**
   - The stale cache smoke failure occurred around an unused import (`imageOptionLabel`).
   - Current files are correct, but broad unused import lists make stale-cache errors more likely during local browser testing.

3. **`filters.js` and `aspectFlow.js` are extracted but not active**
   - This is not a runtime bug, but it makes ownership documentation misleading if not tracked.

4. **`index.js` remains large and behavior-critical**
   - Push and Edit save remain high-risk areas.
   - The current system is working after recovery; further extraction should pause until this checkpoint is committed/stabilized.

5. **Auth-limited smoke coverage**
   - Local smoke verified modal opening and UI wiring, but not live eBay reads/writes or save/publish payload execution because Edge calls returned `Not authenticated`.

6. **Minor doc/comment cleanup remains**
   - `index.js` has a duplicated `// ── Category / Aspects (Push Modal)` comment with extra blank lines. It is harmless and was not changed in this checkpoint.

---

## Recommendation

### Next move: pause refactor and commit/stabilize

Recommended order:

1. **Commit the recovery reconciliation + checkpoint docs.**
2. **Do a clean-browser/manual smoke pass** with service worker/cache disabled or a fresh browser profile.
3. **Optionally do one tiny cleanup commit** only for non-behavioral stale imports/state:
   - Remove unused imports from `index.js`.
   - Remove unused `SUPABASE_URL` and `linkAuditRunId` from `index.js`.
   - Remove duplicate comment/blank lines around the Push aspect section.
4. **Defer Push extraction.** Do not wire `pushModal.js` until the page has been committed and smoke-tested.
5. If continuing later, prefer one tiny migration at a time:
   - First wire `filters.js` via `filterProducts()` (low risk) OR
   - Replace Push taxonomy/aspect fetch with `taxonomyApi.js` / `aspectFlow.js` (medium risk) OR
   - Plan a dedicated Push migration with explicit event-listener ownership checks (high risk).

Do **not** start another large extraction immediately.

---

## Deliverable Summary

- `index.js` line count: **1263**
- Duplicate ownership audit: **No duplicate inline definitions for recovered helpers; active duplicate ownership remains around inactive `pushModal.js`, plus inactive `filters.js`/`aspectFlow.js` ownership overlap.**
- Import/wiring audit: **Runtime wiring works after cache clear; many unused imports and two unused local remnants remain.**
- Verification: **All JS modules pass `node --check`; browser smoke passes for render/view/open/toggle/bulk after cache clear, with expected auth-limited Edge warnings.**
- Recommendation: **pause refactor, commit/stabilize, then do tiny cleanup before any further extraction.**

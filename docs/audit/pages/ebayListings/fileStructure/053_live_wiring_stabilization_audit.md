# 053 — eBay Listings Live Wiring Stabilization Audit

**Date:** 2026-05-16  
**Scope:** `js/admin/ebayListings/`, `pages/admin/ebay-listings.html`, and checkpoints 051/052  
**Mode:** audit/stabilization only — no extraction, no Push wiring, no Edit save movement, no eBay payload/backend/database/UI changes.

---

## Executive Summary

The current eBay Listings page is **syntax-clean** and **browser-smoke functional** after cache/service-worker clearing. Products load, table/card views render, product action buttons use delegated `data-action` attributes with no inline `onclick`, Push opens, and Edit opens far enough to confirm modal wiring before expected local auth-limited Edge calls stop hydration.

The module graph is mostly live and intentionally modular, but it is still in a transitional state:

1. `index.js` remains the live owner of Push and Edit save/AI behavior.
2. `pushModal.js` is **not imported anywhere** and duplicates live Push logic; keep it deferred, do not wire it casually.
3. `filters.js` is extracted but completely not wired.
4. `aspectFlow.js` is only imported by inactive `pushModal.js`, so it is not live.
5. `taxonomyApi.js` is **partially live** through `editModal.js`, but its Push/category wrapper path is not live.
6. `index.js` still has many stale direct imports that appear unused because table/cards/edit modules now own those helpers.

**Recommendation:** no code changes yet. Pause and commit/stabilize this known-good state, then do one tiny cleanup pass for unused imports/state only if desired. Do not wire `pushModal.js` until a dedicated migration plan proves single listener ownership.

---

## 1) Live Module Map

Line counts use the same convention as checkpoint 052: content lines excluding the final trailing newline.

| File | Lines | Imported by `index.js`? | Imported by another live module? | Currently live? | Responsibility | Status |
|---|---:|---:|---:|---:|---|---|
| `actionDispatcher.js` | 60 | Yes | No | Yes | Delegated product action router for `data-action` buttons. | `live` |
| `api.js` | 74 | Yes | Yes — `editFetch.js`, `editModal.js`, `policyCache.js`, `reconcileActions.js`, `tableActions.js`, `taxonomyApi.js` | Yes | Edge Function helper plus product/workspace read helpers. | `live` |
| `aspectFlow.js` | 75 | No | No live import; only inactive `pushModal.js` imports it | No | Fetch/render bridge for Push aspect fields. | `not wired` |
| `aspectHelpers.js` | 86 | Yes | Yes — `editModal.js` | Yes | Push/Edit aspect field builders and Push aspect collection/validation. | `live` |
| `bulkActions.js` | 114 | Yes | Yes — `table.js` | Yes | Bulk selection bar and bulk price/quantity update modal. | `live` |
| `cards.js` | 56 | Yes | No | Yes | Card-view product rendering. | `live` |
| `editFetch.js` | 139 | Yes | Yes — `editModal.js`, `variantPanel.js` | Yes | Edit hydration helpers for eBay item/offer lookups and offer error messages. | `live` |
| `editModal.js` | 508 | Yes | No | Yes | Edit modal `openEdit()` and base Edit listeners; Edit save/AI remain in `index.js`. | `transitional` |
| `editor.js` | 116 | Yes | Yes — `editModal.js` | Yes | Quill toolbar, description mode state, HTML/visual/preview helpers. | `live` |
| `filters.js` | 60 | No | No | No | Pure product filter predicate helper. | `not wired` |
| `images.js` | 84 | Yes | Yes — `editModal.js` | Yes | Image strip rendering and gallery picker behavior. | `live` |
| `importPanel.js` | 67 | Yes | No | Yes | Import/migration panel and eBay scan/auto-link listeners. | `live` |
| `index.js` | 1263 | Entry from HTML | No | Yes | Page orchestrator; product load/filter/render; live Push; Edit save/AI; wiring/bootstrap. | `live` |
| `linkCheck.js` | 73 | Yes | Yes — `cards.js`, `editModal.js`, `productActions.js`, `reconcileActions.js`, `table.js` | Yes | Link state predicates, labels, badges, eBay link HTML. | `live` |
| `listingHealth.js` | 209 | Yes | Yes — `cards.js`, `table.js` | Yes | Listing health scoring and issue classification. | `live` |
| `modalPreviews.js` | 140 | Yes | Yes — `editModal.js` | Yes | Push/Edit profit preview and price reference rendering. | `live` |
| `policyCache.js` | 58 | Yes | Yes — `editModal.js` | Yes | eBay policy cache and dropdown population. | `live` |
| `priceReference.js` | 282 | Yes | Yes — `modalPreviews.js` | Yes | Internal price reference and recent-sales metrics helpers. | `live` |
| `productActions.js` | 45 | Yes | Yes — `cards.js`, `table.js` | Yes | Product action button HTML using `data-action`. | `live` |
| `profitPreview.js` | 384 | Yes | Yes — `modalPreviews.js`, `renderHelpers.js` | Yes | Profit estimate calculation and preview HTML. | `live` |
| `pushModal.js` | 827 | No | No | No | Full extracted Push modal factory and handlers, currently inactive. | `transitional` |
| `reconcileActions.js` | 147 | Yes | No | Yes | Stale-link reconcile/relink/clear/audit workflows. | `live` |
| `renderHelpers.js` | 128 | Yes | Yes — `cards.js`, `table.js` | Yes | Presentational table/card helper HTML for workspace chips and profit badges. | `live` |
| `salesHistory.js` | 212 | Yes | No | Yes | Read-only sales history modal. | `live` |
| `setupPanel.js` | 69 | Yes | No | Yes | Setup panel, policy display, location setup listener. | `live` |
| `table.js` | 63 | Yes | No | Yes | Table-view product rendering. | `live` |
| `tableActions.js` | 102 | Yes | No | Yes | Discard draft, withdraw/end, and publish-from-table actions. | `live` |
| `taxonomyApi.js` | 39 | No | Yes — `editModal.js`; inactive `aspectFlow.js`/`pushModal.js` also import it | Yes, partially | Wrappers around `ebay-taxonomy` Edge Function. Edit aspects path is live; Push category path is not. | `live` |
| `utils.js` | 176 | Yes | Yes — most live modules | Yes | Shared escaping, listing payload, selected policy, SKU, quantity, and UI helpers. | `live` |
| `variantPanel.js` | 271 | Yes | Yes — `editModal.js` | Yes | Push variant panel and Edit variant image/quantity controls. | `live` |
| `volPricing.js` | 70 | Yes | Yes — `editModal.js` | Yes | Volume pricing tier DOM helpers. | `live` |

### Status summary

| Status | Files |
|---|---|
| `live` | 28 files — all except `filters.js`, `aspectFlow.js`, and inactive `pushModal.js` |
| `not wired` | `filters.js`, `aspectFlow.js` |
| `dead/obsolete` | None proven safe to delete in this pass |
| `transitional` | `editModal.js`, `pushModal.js` |

Notes:

- `editModal.js` is live but transitional because only `openEdit()` and base Edit listeners are migrated; Edit save/AI still live in `index.js`.
- `pushModal.js` is transitional but **not live**. It is a preserved migration artifact/future candidate, not an active page module.
- `filters.js` and `aspectFlow.js` are not live. They should be treated as extracted-but-not-wired, not obsolete.

---

## 2) Special Audit — `pushModal.js`

### Import status

- `pushModal.js` is **not imported by `index.js`**.
- `pushModal.js` is **not imported by any other file** in `js/admin/ebayListings/`.
- The only relationship is one-way: `pushModal.js` imports live helper modules such as `utils.js`, `editor.js`, `images.js`, `variantPanel.js`, `aspectHelpers.js`, `modalPreviews.js`, `api.js`, `volPricing.js`, `taxonomyApi.js`, and `aspectFlow.js`.
- Because nothing imports `pushModal.js`, the browser does not evaluate it during the current page load.

### Functionality contained

`pushModal.js` contains a full `createPushModalContext()` factory with:

- Push-private state: current product, aspects, images, variants, group flag, sales metrics, Quill instance.
- `openPush()` modal hydration.
- Step 1 Create Item / Create Items handler.
- Step 2 Create Offer / Group + Offer handler.
- Step 3 Publish handler.
- Push AI Auto-Fill handler.
- Category search and aspect fetch/render path.
- Push close, live preview, price reference, image picker, description tabs.
- Best Offer, lot, volume-pricing toggles and tier add.

### Duplicate ownership with live `index.js`

`index.js` still owns the active Push flow:

- `window.openPush = async function openPush(code) { ... }`
- `fetchAspects(categoryId)`
- Push close listener
- Push price/ref listeners
- Push image picker listener
- Push description-mode listeners
- Push category search listener
- Push AI Auto-Fill listener
- `btnCreateItem`, `btnCreateOffer`, `btnPublish` listeners
- Push best-offer, lot, volume, and add-tier listeners

Therefore, `pushModal.js` currently duplicates live Push logic but is not double-binding anything because it is inactive.

### Status decision

**Decision:** keep `pushModal.js` deferred as `transitional`; do not remove it and do not wire it in this pass.

Rationale:

- It is not safe to call it dead/obsolete because it appears to be a prior extraction target with substantial preserved logic.
- It is not safe to wire because the live Push listeners in `index.js` would need to be removed or disabled first.
- Deleting it would erase a potentially useful migration reference without solving any runtime problem.
- Leaving it undocumented is risky, so this audit explicitly marks it inactive/transitional.

### What would be required to safely wire later

A safe Push migration later would need, at minimum:

1. A line-by-line payload comparison between `index.js` Push handlers and `pushModal.js` handlers.
2. A single-owner listener plan: remove `index.js` Push listeners before or at the same time as adding `pushCtx.bind...()` calls.
3. A dispatcher change from `window.openPush` to `pushCtx.openPush`, or an intentional compatibility bridge.
4. Confirmation that all Push state variables in `index.js` are no longer read by Edit/save/table code.
5. Browser smoke tests for Push open, category search/aspects, AI fill, create item, create offer/group offer, publish, volume pricing, variants, and draft resume.
6. Real authenticated/eBay write verification before marking complete.

Do **not** attempt this as a cleanup or drive-by wiring change.

---

## 3) Extracted-But-Not-Wired Module Findings

### `pushModal.js`

| Check | Finding |
|---|---|
| Imported by whom | Nobody. |
| Current usage | None at runtime. |
| Intended ownership | Would own all Push modal state and handlers if migrated. |
| Matches intended ownership? | Internally yes, but not wired; it conflicts with `index.js` active ownership. |
| Action needed | Defer. Keep documented as transitional/inactive. Do not wire without a dedicated Push migration. |

### `filters.js`

| Check | Finding |
|---|---|
| Imported by whom | Nobody. |
| Current usage | None at runtime. |
| Intended ownership | Pure product filtering predicate. |
| Matches intended ownership? | Yes as a helper, but `index.js.applyFilters()` still owns equivalent logic. |
| Action needed | Low-risk future candidate: import `filterProducts()` and replace only the predicate inside `applyFilters()`. Not necessary for stabilization. |

### `aspectFlow.js`

| Check | Finding |
|---|---|
| Imported by whom | Only `pushModal.js`. |
| Current usage | None at runtime because `pushModal.js` is not imported. |
| Intended ownership | Fetch/render bridge for Push aspect fields. |
| Matches intended ownership? | Yes for extracted Push flow, but it is inactive while Push stays in `index.js`. |
| Action needed | Defer with Push migration. Do not wire alone unless the active Push `fetchAspects()` path is intentionally replaced and smoke-tested. |

### `taxonomyApi.js`

| Check | Finding |
|---|---|
| Imported by whom | `editModal.js` live; `aspectFlow.js` and `pushModal.js` inactive/transitional. |
| Current usage | `fetchAspectsForCategory()` is live through Edit open. `fetchCategorySuggestions()` is only used by inactive `pushModal.js`. |
| Intended ownership | Edge-wrapper API for taxonomy category/aspect calls. |
| Matches intended ownership? | Partially. Edit aspect fetch is correctly using it. Active Push category/aspect flow still calls `callEdge("ebay-taxonomy", ...)` directly in `index.js`. |
| Action needed | No stabilization action. Future medium-risk cleanup could move active Push taxonomy calls to `taxonomyApi.js`/`aspectFlow.js`, but only with targeted smoke tests. |

---

## 4) Current `index.js` Import Audit

A rough symbol scan was run after removing import declarations from the counted text. Counts below indicate direct references in `index.js`, not whether a symbol is used by another module.

### Definitely used in `index.js`

| Import(s) | From | Direct use |
|---|---|---:|
| `initAdminNav` | `/js/shared/adminNav.js` | 1 |
| `initFooter` | `/js/shared/footer.js` | 1 |
| `getSupabaseClient` | `/js/shared/supabaseClient.js` | 1 |
| `requireAdmin` | `/js/shared/guard.js` | 1 |
| `esc` | `utils.js` | 3 |
| `sanitizeForEbay`, `wrapDescription` | `utils.js` | 3 each |
| `isComplexHtml`, `buildImageUrls` | `utils.js` | 1 each |
| `buildPackageWeightAndSize` | `utils.js` | 4 |
| `getSelectedPolicies` | `utils.js` | 5 |
| `getBestOfferTerms` | `utils.js` | 4 |
| `enableBtn` | `utils.js` | 17 |
| `addAiBadge` | `utils.js` | 4 |
| `quillToolbar`, `descState`, `resetQuillEditorMount`, `toggleDescMode`, `getDescriptionHtml` | `editor.js` | Used by live Push and Edit AI/save paths |
| `addVolTier`, `getVolTiers` | `volPricing.js` | Used by Push/Edit volume controls |
| `computeHealth` | `listingHealth.js` | Used by `applyFilters()` low-score quick filter |
| `openSalesHistory`, `closeSalesHistory` | `salesHistory.js` | Product action dispatcher and close listener |
| `renderImageStrip`, `showGalleryPicker` | `images.js` | Push open/add-image path |
| `createEditModalContext` | `editModal.js` | Edit context construction |
| `callEdge`, `mergeWorkspaceMetrics` | `api.js` | Push/Edit Edge calls and product metric merge |
| `isStaleLinkCheck`, `staleLinkMessage` | `linkCheck.js` | Edit save stale-link guard |
| `createReconcileActions` | `reconcileActions.js` | Reconcile context construction |
| `createTableActions` | `tableActions.js` | Table action context construction |
| `createProductActionDispatcher` | `actionDispatcher.js` | Product action routing |
| `renderTable`, `renderCards` | `table.js`, `cards.js` | View rendering |
| `initSetupPanel`, `initImportPanel`, `initBulkActions` | setup/import/bulk modules | `init()` wiring |
| `buildAspectField`, `collectAspects`, `validateRequiredAspects` | `aspectHelpers.js` | Active Push aspect and create-item path |
| `renderVariantPanel`, `getCheckedVariants` | `variantPanel.js` | Active Push variant path |
| `refreshPushPreview`, `refreshPushRef`, `loadAndRenderPriceRef` | `modalPreviews.js` | Active Push preview/reference path |
| `getOffersForEdit`, `offerUpdateErrorMessage` | `editFetch.js` | Edit save offer update path |
| `loadPoliciesCache` | `policyCache.js` | `init()` pre-warm |

### Imports that appear unused in `index.js`

These had zero direct references in the current `index.js` body:

| Import(s) | From | Likely reason |
|---|---|---|
| `variantSkuFromOption`, `publishQuantityForProduct`, `activeVariantCount`, `isEffectiveGroupListing`, `imageOptionLabel` | `utils.js` | Helper ownership moved to `tableActions.js`, `variantPanel.js`, `editModal.js`, or other modules. |
| `buildEstimate`, `renderPreview` | `profitPreview.js` | Used by `modalPreviews.js`/`renderHelpers.js`, not directly by `index.js`. |
| `buildPriceRef`, `renderPriceRef`, `fetchSalesMetrics` | `priceReference.js` | Used by `modalPreviews.js`, not directly by `index.js`. |
| `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` | `renderHelpers.js` | Used by `table.js`/`cards.js`, not directly by `index.js`. |
| `isLinkedOnEbay`, `isOutOfStockLinkCheck`, `isLinkWarningCheck`, `staleActionState`, `staleActionBadge`, `staleLinkLabel`, `currentActiveListingId`, `ebayCodeLinkHtml` | `linkCheck.js` | Used by render/reconcile/edit modules; only `isStaleLinkCheck` and `staleLinkMessage` are direct `index.js` needs. |
| `renderProductActions` | `productActions.js` | Used by `table.js`/`cards.js`, not directly by `index.js`. |
| `updateBulkBar` | `bulkActions.js` | Used by `table.js`/bulk module, not directly by `index.js`. |
| `buildEditAspectField` | `aspectHelpers.js` | Used by `editModal.js`, not directly by `index.js`. |
| `renderVariantAssignedImages`, `getAssignedVariantImages`, `setAssignedVariantImages`, `renderVariantCandidatePicker`, `refreshVariantCandidateButtons`, `wireVariantImageSetControls`, `renderEditVariantImageControls` | `variantPanel.js` | Used internally by `variantPanel.js`/`editModal.js`, not directly by `index.js`. |
| `refreshEditPreview`, `refreshEditRef` | `modalPreviews.js` | Edit base listeners now live in `editModal.js`. |
| `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure`, `getItemForEdit` | `editFetch.js` | Used internally by `editFetch.js`/`editModal.js`/`variantPanel.js`, not directly by `index.js`. |

### Transitional imports / imports not to remove in this pass

No imports were removed in this audit. Even obviously stale direct imports should be cleaned only in a separate tiny commit because:

- `index.js` still owns large Push and Edit save/AI workflows.
- A stale browser module cache previously produced misleading import errors.
- Removing many import names at once is low business value and can obscure whether later runtime errors are cache-related or code-related.

Safe future cleanup candidate:

1. Remove only zero-reference direct imports from `index.js`.
2. Remove unused local remnants such as `SUPABASE_URL` and `linkAuditRunId` if still zero-reference.
3. Run `node --check js/admin/ebayListings/index.js`.
4. Reload with cache disabled/service workers cleared.
5. Repeat table/card/Push/Edit smoke.

---

## 5) Browser Cache / Service Worker Note

This page has an important testing hazard:

- Earlier verification hit a stale browser/module cache where the browser reported that `./utils.js` did not export `imageOptionLabel` even though a direct cache-busted fetch of the current file showed the export existed.
- `localhost:5500` also showed an offline/service-worker page during cache-busted navigation.
- For this audit, `localhost:8080` was used with service workers unregistered and caches deleted before reloading a cache-busted URL.

Recommended dev workflow for this page:

1. Prefer `localhost:8080` or a known-current static server for admin smoke tests.
2. Before validating module wiring after refactors, unregister service workers and clear Cache Storage.
3. Disable browser cache while DevTools/browser automation is open, or use a fresh/incognito profile.
4. Add a query string to `pages/admin/ebay-listings.html` for each verification pass.
5. If a module export error appears, verify the source with a direct cache-busted fetch before editing code.
6. Treat stale-cache import errors as possible false positives until static `node --check` and direct file fetch disagree.

---

## 6) Verification Performed

### Static verification

| Check | Result |
|---|---|
| `node --check js/admin/ebayListings/index.js` | ✅ OK |
| `node --check` for every `js/admin/ebayListings/*.js` module | ✅ all 31 modules OK |
| Source grep for `onclick=` in `pages/admin/ebay-listings.html` | ✅ no matches |

### Browser smoke verification

Browser page used: `http://localhost:8080/pages/admin/ebay-listings.html?verify053=1778973000000`

Before reload, service workers were unregistered and Cache Storage entries were deleted in the browser context.

| Smoke item | Result | Evidence |
|---|---|---|
| Page loads after cache-busting | ✅ | Title `Admin · eBay Listings`. |
| Products load | ✅ | Stats showed total `59`, active `23`, draft `0`, not listed `35`; count label `59 items`. |
| Table renders | ✅ | `#productsBody tr` count `59`. |
| Card view renders | ✅ | Card toggle produced `59` card elements. |
| No inline `onclick` in rendered DOM | ✅ | Table inline `onclick` count `0`; card inline `onclick` count `0`; table/card `data-action` counts `106` each after render. |
| Push opens | ✅ | First Push action opened `pushModal`; product name `8-Ball Dice Charm Keychain`; Quill editor existed. |
| Edit opens | ⚠️ Partial/auth-limited | First Edit action opened `editModal`; product name `Blue Bell Flower Charm Keychain`; hydration stopped at `Not authenticated — please refresh the page`, expected for local unauthenticated Edge calls. |
| Module graph classification | ✅ | Import graph verified: all modules except `filters.js`, `aspectFlow.js`, and inactive `pushModal.js` are live through `index.js` or a live dependency. |

### Verification limits

- Authenticated eBay write paths were not exercised.
- Push Create Item/Create Offer/Publish were not executed.
- Edit Save and Edit AI Auto-Fill were not executed.
- Setup/Import/Bulk were not re-smoked in this pass because checkpoint 052 already covered them and this pass focused on live wiring classification.

---

## 7) Recommended Next Action

### Decision: pause and commit/stabilize

Pick: **pause and commit/stabilize**.

Rationale:

- The page is currently syntax-clean and smoke-functional.
- The live/inactive module boundaries are now documented.
- `pushModal.js` is a known inactive duplicate and should not be wired without a dedicated plan.
- The next highest-value change is not more extraction; it is preserving a stable baseline.

Recommended sequence:

1. Commit the recovery/checkpoint/audit docs and current working source state.
2. If cleanup is desired, do one tiny separate commit for `index.js` unused imports and stale locals only.
3. Re-run static checks and cache-cleared browser smoke after that cleanup.
4. Defer Push extraction entirely until a dedicated plan proves listener ownership and payload parity.
5. If a small module must be wired before Push work, `filters.js` is the lowest-risk candidate, but it is optional and should wait until after stabilization.

---

## 8) Code Change Summary

No runtime code was changed in this pass.

Created documentation only:

- `docs/audit/pages/ebayListings/fileStructure/053_live_wiring_stabilization_audit.md`

No source files were edited, no modules were wired, no imports were removed, and no backend/database/UI behavior was changed.

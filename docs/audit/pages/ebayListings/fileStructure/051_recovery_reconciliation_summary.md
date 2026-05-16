# 051 — eBay Listings: Recovery Reconciliation Summary

**Date:** 2025  
**Scope:** `js/admin/ebayListings/index.js` — duplicate-removal & module-wiring pass  
**Goal:** Remove all inline function duplicates from `index.js` and wire to modules; no behavior changes.

---

## Background

A prior `git checkout --` accidentally reverted `index.js` to the pre-refactor 2522-line version, losing module integration work. A recovery pass stabilized it at ~2254 lines with factory patterns (editCtx) and imports added. This document covers the subsequent reconciliation pass that removed all remaining inline duplicates.

---

## What Changed

### Inline Functions Removed (all moved to modules)

| Removed Inline Function(s) | Replaced By |
|---|---|
| `renderTable()` (55 lines) | `import { renderTable } from "./table.js"` |
| `renderCards()` (80 lines) | `import { renderCards } from "./cards.js"` |
| `updateStats()` | retained inline (uses `allProducts` closure; no module equiv.) |
| `getSelectedItems()` | `import { ... } from "./bulkActions.js"` |
| `updateBulkBar()` | `import { updateBulkBar } from "./bulkActions.js"` |
| `enableBtn()` | `import { enableBtn } from "./utils.js"` |
| `imageOptionLabel()` | `import { imageOptionLabel } from "./utils.js"` |
| `addAiBadge()` | `import { addAiBadge } from "./utils.js"` |
| `publishQuantityForProduct()` | `import { publishQuantityForProduct } from "./utils.js"` |
| `activeVariantCount()` | `import { activeVariantCount } from "./utils.js"` |
| `isEffectiveGroupListing()` | `import { isEffectiveGroupListing } from "./utils.js"` |
| `renderVariantAssignedImages()` + 6 related | `import { ... } from "./variantPanel.js"` |
| `renderVariantPanel(variants, baseCode)` (old) | `import { renderVariantPanel } from "./variantPanel.js"` |
| `getCheckedVariants()` (old) | `import { getCheckedVariants } from "./variantPanel.js"` |
| `buildAspectField()`, `collectAspects()`, `validateRequiredAspects()` | `import { ... } from "./aspectHelpers.js"` |
| `buildEditAspectField()` | dead code — `editModal.js` imports from `aspectHelpers.js` directly |
| `renderEditVariantImageControls()` | dead code — `editModal.js` owns this |
| `window.discardDraft` | `tableCtx.discardDraft` (via `createTableActions`) |
| `window.doWithdraw` | `tableCtx.doWithdraw` |
| `window.doPublish` | `tableCtx.doPublish` |
| `renderMigrateResults()` | `import { initImportPanel } from "./importPanel.js"` |
| `refreshPushPreview()` (0-arg) | `import { refreshPushPreview } from "./modalPreviews.js"` |
| `refreshEditPreview()` | same module (used by `editModal.js` directly) |
| `refreshPushRef()` (0-arg) | `import { refreshPushRef } from "./modalPreviews.js"` |
| `refreshEditRef()` | same module (used by `editModal.js` directly) |
| `loadAndRenderPriceRef(id, product, type)` (3-arg) | `import { loadAndRenderPriceRef } from "./modalPreviews.js"` |
| `loadPoliciesCache()`, `populatePolicyDropdowns()`, `mergeWorkspaceMetrics()` | imported from `policyCache.js`, `renderHelpers.js`, `api.js` |
| `callEdge()`, `shortDelay()`, all linkCheck/reconcile functions | imported from respective modules |

### Inline Event Listener Blocks Removed

| Removed Block | Replaced By |
|---|---|
| `checkAll` + `bulk-check` change + `btnBulkCancel/Price/Qty/Apply/Close` + `openBulkModal()` | `initBulkActions({ callEdge, supabase, loadProducts })` in `init()` |
| `btnSetup` + `btnSetupLocation` | `initSetupPanel({ callEdge })` in `init()` |
| `btnMigrate` + `btnScanEbay` + `btnAutoLink` | `initImportPanel({ callEdge, loadProducts })` in `init()` |
| `tableSection`/`cardSection` click → `open-sales` only | `dispatchProductAction` delegate handling ALL `data-action` events |

### Call Sites Updated

| Old Call | New Call |
|---|---|
| `renderVariantPanel(activeVariants, currentProduct.code)` | `renderVariantPanel(activeVariants, currentProduct.code, currentProduct)` |
| `refreshPushPreview()` | `refreshPushPreview(currentProduct)` |
| `loadAndRenderPriceRef("modalPriceRef", currentProduct, "push")` | `loadAndRenderPriceRef("modalPriceRef", currentProduct, "modalPrice", (m) => { pushSalesMetrics = m; }, (p) => currentProduct?.code === p.code)` |
| `getCheckedVariants()` (3 call sites) | `getCheckedVariants(pushVariants, currentProduct.code)` |
| `reconcileEbayLink(editProduct, false)` | `reconcileCtx.reconcileEbayLink(editProduct, false)` |
| `renderEditLinkWarning(linkCheck)` | `reconcileCtx.renderEditLinkWarning(linkCheck)` |
| `getOffersForEdit(vSku, "save")` | `getOffersForEdit(editOfferLookupCache, vSku, "save")` |
| `reconcileEbayLink: reconcileEbayLink` (in editCtx) | `reconcileEbayLink: reconcileCtx.reconcileEbayLink` |
| `renderEditLinkWarning` (in editCtx) | `reconcileCtx.renderEditLinkWarning` |
| `relinkEbayListing: window.relinkEbayListing` (in editCtx) | `reconcileCtx.relinkEbayListing` |
| `document.getElementById("modalPrice").addEventListener("input", refreshPushPreview)` | `() => refreshPushPreview(currentProduct)` |
| `document.getElementById("modalPrice").addEventListener("input", refreshPushRef)` | `() => refreshPushRef(currentProduct, pushSalesMetrics)` |
| `document.getElementById("modalWeightOz").addEventListener("input", refreshPushPreview)` | `() => refreshPushPreview(currentProduct)` |

---

## Result

| Metric | Before | After |
|---|---|---|
| `index.js` lines | ~2254 | ~1255 |
| Lines removed | — | ~999 |
| `node --check` | ✅ clean | ✅ clean |
| Duplicate function defs | many | 0 |

---

## Architecture State Post-Reconciliation

```
index.js
├── imports (all modules)
├── supabase + state vars
├── factory contexts: reconcileCtx, tableCtx, dispatchProductAction
├── factory context: editCtx (editModal.js)
├── showStatus (local)
├── updateStats (local — uses allProducts)
├── loadProducts → mergeWorkspaceMetrics, applyFilters, updateStats, reconcileCtx.auditListingLinks
├── applyFilters, renderAll, setView
├── fetchAspects (local — calls buildAspectField from aspectHelpers)
├── openPush (local — large, orchestrates the push modal)
├── openSalesHistory, closeSalesHistory
├── buildImageUrls, buildEstimate, buildPriceRef, renderPreview, renderPriceRef
├── event listeners: search, view toggle, push/edit modal buttons, AI auto-fill, ...
├── dispatchProductAction on tableSection + cardSection
├── btnSaveEdit handler
└── init() → calls all module panel inits
```

---

## Modules (all stable, no changes in this session)

- `table.js` — `renderTable(products, pageAdRatePct)`
- `cards.js` — `renderCards(products, pageAdRatePct)` 
- `utils.js` — `enableBtn`, `imageOptionLabel`, `addAiBadge`, `publishQuantityForProduct`, `activeVariantCount`, `isEffectiveGroupListing`, `esc`, `variantSkuFromOption`, `buildImageUrls`
- `bulkActions.js` — `initBulkActions`, `updateBulkBar`
- `setupPanel.js` — `initSetupPanel`
- `importPanel.js` — `initImportPanel`, `renderMigrateResults`
- `variantPanel.js` — `renderVariantPanel(variants, baseCode, product)`, `getCheckedVariants(variants, baseCode)`, all variant image helpers
- `aspectHelpers.js` — `buildAspectField`, `collectAspects`, `validateRequiredAspects`
- `modalPreviews.js` — `refreshPushPreview(product)`, `refreshEditPreview(product)`, `refreshPushRef(product, metrics)`, `refreshEditRef(product, metrics)`, `loadAndRenderPriceRef(id, product, priceInputId, onMetrics, isStillActive)`
- `reconcileActions.js` — `createReconcileActions` → reconcileCtx
- `tableActions.js` — `createTableActions` → tableCtx
- `actionDispatcher.js` — `createProductActionDispatcher` → dispatchProductAction
- `policyCache.js` — `loadPoliciesCache`, `populatePolicyDropdowns`
- `api.js` — `callEdge`, `mergeWorkspaceMetrics`
- `renderHelpers.js` — `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml`
- `linkCheck.js` — all link-check helpers
- `productActions.js` — `renderProductActions`
- `editModal.js` — `createEditModalContext` → editCtx
- `editFetch.js` — `getItemForEdit`, `getOffersForEdit(cache, sku, ctx)`, etc.

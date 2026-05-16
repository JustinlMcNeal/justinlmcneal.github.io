# Phase 4e — Link-Check Helper Extraction Summary

**Date:** 2026-05-16  
**New file:** `js/admin/ebayListings/linkCheck.js`  
**Files modified:** `js/admin/ebayListings/index.js`  
**Reference docs:** `003_refactor_phase_plan.md`, `015_bulk_actions_extraction_summary.md`

---

## What Moved

Ten pure/display helpers extracted from `index.js` into `linkCheck.js`:

| Function | Signature | Notes |
|---|---|---|
| `isLinkedOnEbay(p)` | pure predicate | Checks product is active and has eBay identifiers |
| `isStaleLinkCheck(check)` | pure predicate | Matches stale/ambiguous/no_active_match states |
| `isOutOfStockLinkCheck(check)` | pure predicate | Matches out_of_stock state |
| `isLinkWarningCheck(check)` | pure predicate | OR of the two above |
| `staleActionState(p)` | pure | Returns state string from `p._linkCheck` |
| `staleActionBadge(p)` | HTML string | Renders stale/sold-out badge; uses `esc` |
| `staleLinkLabel(check)` | pure | Returns human label for link check state |
| `staleLinkMessage(check)` | pure | Returns tooltip/warning message |
| `currentActiveListingId(check)` | pure | Extracts `activeMatch.listingId` |
| `ebayCodeLinkHtml(p, compact?)` | HTML string | Renders product code as link/warning; uses `esc` |

The block extracted was non-contiguous: `isLinkedOnEbay` → `currentActiveListingId` (lines 155–200) and `ebayCodeLinkHtml` (lines 221–244) were separated by `reconcileEbayLink` which stays in `index.js`. Both blocks were removed and replaced by the consolidated import.

---

## What Stayed in `index.js`

| Symbol | Reason |
|---|---|
| `reconcileEbayLink(product, relink)` | Calls `callEdge` — active workflow |
| `auditListingLinks(products)` | Calls `reconcileEbayLink` + `renderAll()` — active workflow |
| `relinkEbayListing(code)` | Calls `reconcileEbayLink` + `loadProducts()` — active workflow |
| `clearStaleEbayLink(code)` | Calls `callEdge` — active workflow |
| `renderEditLinkWarning(check)` | DOM mutation function — uses imported helpers |
| `renderProductActions(p, compact)` | Uses `staleActionState`, `esc` — stays with rendering |

---

## Why This Extraction Was Safe

- All 10 functions are pure (no side effects, no `callEdge`, no Supabase writes, no DOM mutations).
- `staleActionBadge` and `ebayCodeLinkHtml` produce HTML strings — no direct DOM mutations.
- The only external dependency is `esc` from `utils.js` — no circular import risk.
- No eBay mutation payloads involved.
- `reconcileEbayLink` was intentionally left in `index.js` to keep the boundary clean.

---

## Dependencies

| Dependency | Source |
|---|---|
| `esc` | Imported from `./utils.js` inside `linkCheck.js` |

`linkCheck.js` imports nothing from other module siblings — no circular import risk.

---

## Module graph (updated)

```
index.js
  └─ api.js           (callEdge, fetchProductsWithWorkspaceMetrics)
  └─ filters.js       (filterProducts)
  └─ renderHelpers.js (formatRelativeDate, wsChips, epCls, rowEstProfitHtml)
  └─ setupPanel.js    (initSetupPanel)
  └─ importPanel.js   (initImportPanel)
  └─ bulkActions.js   (initBulkActions, updateBulkBar)
  └─ linkCheck.js     (isLinkedOnEbay, isStaleLinkCheck, isOutOfStockLinkCheck,
  │                    isLinkWarningCheck, staleActionState, staleActionBadge,
  │                    staleLinkLabel, staleLinkMessage, currentActiveListingId,
  │                    ebayCodeLinkHtml)                          ← NEW
  └─ utils.js         (esc, …)
  └─ profitPreview.js
  └─ listingHealth.js
```

---

## Verification

| Check | Result |
|---|---|
| `node --check linkCheck.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| No inline definitions remain in `index.js` (grep) | ✅ Confirmed — 0 matches |
| Import block present in `index.js` (lines 44–56) | ✅ |
| Products load (60 rows) | ✅ |
| `button[onclick]` count | ✅ 0 |
| Product code links render in table view (`ebayCodeLinkHtml`) | ✅ |
| Card view renders 60 cards (`ebayCodeLinkHtml` in cards) | ✅ |
| Bulk checkboxes still render (23 active/draft) | ✅ |
| Setup panel opens | ✅ |
| Import/Migrate panel opens | ✅ |
| Push modal opens | ✅ |
| Edit modal opens | ✅ |
| Stale/sold-out badge live verification | ⚠️ No stale products present locally — verified via code path inspection only |
| Edit modal stale warning live verification | ⚠️ Requires eBay auth — verified via code path inspection |

---

## Next Phase

**Phase 4f — `renderTable` / `renderCards` extraction** into `table.js` / `cards.js` (or a unified `renderer.js`)

Now that `ebayCodeLinkHtml`, `staleActionBadge`, `wsChips`, `rowEstProfitHtml`, and `renderProductActions` are all either imported or in `index.js` with clean dependency lines, the render functions are close to extractable:

Prerequisites still in `index.js` needed by render:
- `renderProductActions(p, compact)` — needs `staleActionState`, `esc` (both available via imports)
- `filteredProducts` / `allProducts` — module-level state, must be passed in
- `pageAdRatePct` — module-level let, must be passed in
- `updateBulkBar` — already imported from `bulkActions.js`

Recommended: extract `renderProductActions` first (into `linkCheck.js` or a new `renderer.js`), then extract `renderTable` + `renderCards` together in Phase 4f.

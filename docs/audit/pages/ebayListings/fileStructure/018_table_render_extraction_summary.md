# 018 — Phase 4g: `renderTable()` Extraction

## Summary
Extracted `renderTable()` from `index.js` into the dedicated module `js/admin/ebayListings/table.js`.

## What moved

### `renderTable()` function body (56 lines)
- Table body DOM target (`#productsBody`)
- Empty table state (`colspan="7"` placeholder row)
- All 7 column cells: checkbox, product info, KK price, eBay price, est profit, status/badges, actions
- Bulk checkbox markup per row
- Sales history button cell
- `updateBulkBar()` call at end of render

## What stayed in `index.js`

- `filteredProducts` — page state
- `pageAdRatePct` — page state
- `renderAll()` — orchestrates table vs. card view
- `renderCards()` — card rendering (not extracted this phase)
- `setView()` — view toggle
- All event delegation handlers
- All modal logic (push, edit)
- Product loading / refresh
- Stats update

## New call site in `renderAll()`

```js
// Before:
renderTable();

// After:
renderTable(filteredProducts, pageAdRatePct);
```

## Dependencies of `table.js`

| Import | Source | Used for |
|---|---|---|
| `esc` | `./utils.js` | XSS-safe attribute values |
| `computeHealth` | `./listingHealth.js` | Health score/severity per product |
| `wsChips`, `rowEstProfitHtml` | `./renderHelpers.js` | Workspace chips, est profit badge |
| `ebayCodeLinkHtml`, `staleActionBadge` | `./linkCheck.js` | eBay code/link cell, stale badge |
| `renderProductActions` | `./productActions.js` | Action buttons per row |
| `updateBulkBar` | `./bulkActions.js` | Update bulk selection bar after render |

No circular imports — `bulkActions.js` has zero imports.

## Signature

```js
export function renderTable(products, pageAdRatePct) { ... }
```

`updateBulkBar` is imported directly from `bulkActions.js` (not passed as a parameter) since it has no circular dependency risk.

## Module inventory after Phase 4g

| File | Key exports |
|---|---|
| `api.js` | `callEdge`, `fetchProductsWithWorkspaceMetrics` |
| `filters.js` | `filterProducts` |
| `renderHelpers.js` | `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` |
| `setupPanel.js` | `initSetupPanel` |
| `importPanel.js` | `initImportPanel` |
| `bulkActions.js` | `initBulkActions`, `updateBulkBar` |
| `linkCheck.js` | 10 helpers incl. `staleActionState`, `ebayCodeLinkHtml`, `staleActionBadge` |
| `productActions.js` | `renderProductActions` |
| `table.js` | `renderTable` ✅ new |

## Verification checklist

| Check | Result |
|---|---|
| `node --check table.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| No circular imports | ✅ confirmed (bulkActions.js has no imports) |
| Page loads | ✅ |
| 60 products load in table view | ✅ rowCount: 60 |
| Empty state still works (structure preserved) | ✅ not tested destructively; code path identical |
| Workspace chips render | ✅ visible in screenshot |
| Est profit renders | ✅ visible in screenshot |
| eBay code/link area renders | ✅ visible in screenshot |
| Status/health badges render | ✅ visible in screenshot (ACTIVE, 70, 90, etc.) |
| Bulk checkboxes render | ✅ checkboxCount: 23 (matches 23 Active) |
| Selecting checkbox updates bulk bar | ✅ bulkBarVisible: true after click |
| Product actions render | ✅ Edit/End/Push buttons visible |
| `button[onclick]` count | ✅ 0 |
| Card view still works | ✅ cardCount: 60, layout unchanged |

Destructive eBay action verification (Push, End, Withdraw) was not executed. Code paths for `data-action` delegation in `index.js` are unchanged — no routing modifications made.

## Next recommended phase

**Phase 4h** — Extract `renderCards()` into `js/admin/ebayListings/cards.js`.

`renderCards()` uses the same set of helper dependencies as `table.js` (`computeHealth`, `esc`, `wsChips`, `rowEstProfitHtml`, `ebayCodeLinkHtml`, `staleActionBadge`, `renderProductActions`) plus reads `filteredProducts` and `pageAdRatePct` from `index.js` state.

Signature would be identical in shape:
```js
export function renderCards(products, pageAdRatePct) { ... }
```

After Phase 4h, `renderAll()` in `index.js` would call both imported renderers and `index.js` would own only orchestration, state, modals, event delegation, and product loading.

# 017 — Phase 4f: `renderProductActions` Extraction

## Summary
Extracted the `renderProductActions(p, compact)` function from `index.js` into the dedicated module `js/admin/ebayListings/productActions.js`.

## Changes

### New file
`js/admin/ebayListings/productActions.js`
- Imports: `esc` from `./utils.js`, `staleActionState` from `./linkCheck.js`
- Exports: `renderProductActions(p, compact = false)`
- No `index.js` state accessed — pure HTML-string generator

### `index.js` changes
- Added import: `import { renderProductActions } from "./productActions.js";`
- Removed 49-line `renderProductActions` function definition
- Call sites in `renderTable()` and `renderCards()` unchanged (same symbol name)

## Dependency graph (no circulars)
```
productActions.js
  └── utils.js      (esc)
  └── linkCheck.js  (staleActionState)
```

## Verification
- `node --check productActions.js` → OK
- `node --check index.js` → OK

## Module inventory after Phase 4f

| File | Key exports |
|---|---|
| `api.js` | `callEdge`, `fetchProductsWithWorkspaceMetrics` |
| `filters.js` | `filterProducts` |
| `renderHelpers.js` | `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` |
| `setupPanel.js` | `initSetupPanel` |
| `importPanel.js` | `initImportPanel` |
| `bulkActions.js` | `initBulkActions`, `updateBulkBar` |
| `linkCheck.js` | 10 helpers incl. `staleActionState`, `ebayCodeLinkHtml` |
| `productActions.js` | `renderProductActions` ✅ new |

## Next recommended phase
**Phase 4g** — Extract `renderTable()` + `renderCards()` into a `renderer.js` module. All their helper dependencies are now in external modules; the only remaining `index.js` state they need can be passed as arguments (`filteredProducts`, `pageAdRatePct`, `updateBulkBar`).

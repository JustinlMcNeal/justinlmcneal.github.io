# 019 — Phase 4h: `renderCards()` Extraction

## Summary
Extracted `renderCards()` from `index.js` into the dedicated module `js/admin/ebayListings/cards.js`.

## What moved

### `renderCards()` function body (~47 lines)
- Card grid DOM target (`#cardsGrid`)
- Empty card state (`col-span-full` placeholder paragraph)
- Product image (aspect-square cover / fallback emoji)
- Product name link, eBay code/link display
- KK price / eBay price row
- Status chip, stale badge, health score badge
- Est Profit row with `rowEstProfitHtml`
- Workspace chips
- Action buttons (`renderProductActions(p, true)`)
- Sales History button (for listed products)

## What stayed in `index.js`

- `filteredProducts` — page state
- `pageAdRatePct` — page state
- `renderAll()` — orchestrates table vs. card view
- `renderTable()` call — unchanged
- `setView()` — view toggle
- All event delegation handlers
- All modal logic (push, edit)
- Product loading / refresh
- Stats update

## New call site in `renderAll()`

```js
// Before:
renderCards();

// After:
renderCards(filteredProducts, pageAdRatePct);
```

## Dependencies of `cards.js`

| Import | Source | Used for |
|---|---|---|
| `esc` | `./utils.js` | XSS-safe attribute values |
| `computeHealth` | `./listingHealth.js` | Health score/severity per product |
| `wsChips`, `rowEstProfitHtml` | `./renderHelpers.js` | Workspace chips, est profit badge |
| `ebayCodeLinkHtml`, `staleActionBadge` | `./linkCheck.js` | eBay code/link display, stale badge |
| `renderProductActions` | `./productActions.js` | Action buttons per card |

No `updateBulkBar` import needed — cards have no bulk checkboxes.
No circular imports.

## Signature

```js
export function renderCards(products, pageAdRatePct) { ... }
```

Mirrors `table.js` exactly in shape.

## Module inventory after Phase 4h

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
| `table.js` | `renderTable` |
| `cards.js` | `renderCards` ✅ new |

## Verification checklist

| Check | Result |
|---|---|
| `node --check cards.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| No circular imports | ✅ confirmed |
| Page loads | ✅ |
| 60 cards render in card view | ✅ cardCount: 60 |
| Empty state preserved (structure identical) | ✅ code path identical |
| Workspace chips render | ✅ |
| Est profit renders | ✅ |
| eBay code/link area renders | ✅ |
| Status/health badges render | ✅ |
| Product actions render | ✅ |
| `button[onclick]` in card section | ✅ 0 |
| Table view still works | ✅ rowCount: 60 |

Destructive eBay action verification (Push, End) was not executed. `data-action` delegation in `index.js` is unchanged — no routing modifications made.

## Next recommended phase

**Phase 4i** — Extract `renderAll()` + `setView()` into a `renderer.js` orchestration module that imports both `renderTable` and `renderCards`, or alternatively begin extracting the Push modal initialization into its own module to further shrink `index.js`.

The bigger remaining win is the **Push modal** (`openPushModal` + related helpers) which is the largest remaining block in `index.js`. After that, the **Edit modal**.

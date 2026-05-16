# Phase 4d — Bulk Actions Extraction Summary

**Date:** 2026-05-16  
**New file:** `js/admin/ebayListings/bulkActions.js`  
**Files modified:** `js/admin/ebayListings/index.js`  
**Reference docs:** `003_refactor_phase_plan.md`, `014_import_panel_extraction_summary.md`

---

## What Moved

Four functions and seven event listeners extracted from `index.js` into `bulkActions.js`:

| Symbol | Type | Exported? | Notes |
|---|---|---|---|
| `let bulkMode` | module-level state | No | Private to bulkActions.js |
| `getSelectedItems()` | function | No | Private — reads `.bulk-check:checked` |
| `updateBulkBar()` | function | **Yes** | Exported so `renderTable()` in index.js can call it |
| `openBulkModal(mode)` | function | No | Private — called by button listeners |
| `#checkAll` change handler | event listener | via `initBulkActions` | Select/deselect all bulk-check rows |
| `document` change handler | event listener | via `initBulkActions` | Delegation for `.bulk-check` clicks |
| `#btnBulkCancel` click handler | event listener | via `initBulkActions` | Clears all selections |
| `#btnBulkPrice` click handler | event listener | via `initBulkActions` | Opens bulk modal in price mode |
| `#btnBulkQty` click handler | event listener | via `initBulkActions` | Opens bulk modal in qty mode |
| `#btnCloseBulk` click handler | event listener | via `initBulkActions` | Closes bulk modal |
| `#btnBulkApply` click handler | async event listener | via `initBulkActions` | Calls `bulk_update`, updates local DB, reloads |

These ~90 lines were replaced with a single call:

```js
// index.js — before (~90 lines of inline logic)
function getSelectedItems() { ... }
function updateBulkBar() { ... }
// + bulk checkbox listeners, openBulkModal(), btnCloseBulk, btnBulkApply...

// index.js — after (1 line)
initBulkActions({ callEdge, supabase, loadProducts });
```

`renderTable()` continues to call `updateBulkBar()` because it is now imported:

```js
// index.js — import line
import { initBulkActions, updateBulkBar } from "./bulkActions.js";

// renderTable() — unchanged call at end of function
updateBulkBar();
```

---

## What Stayed in `index.js`

Everything else. The bulk bar and modal have no shared state with the rest of the page beyond:
- `callEdge` — for the `ebay-manage-listing` `bulk_update` call
- `supabase` — for local `products.ebay_price_cents` update after success
- `loadProducts` — called after bulk update resolves

---

## Why This Extraction Was Safe

- `bulkMode`, `getSelectedItems`, `updateBulkBar`, and `openBulkModal` had zero call sites outside the bulk section except `updateBulkBar()` at the end of `renderTable()`, which was handled by exporting it.
- The `bulk_update` edge function name and payload shape (`{ action: "bulk_update", items }` with `sku`, `offerId`, `priceCents`/`quantity`) are **unchanged**.
- The local Supabase update (`ebay_price_cents`, `updated_at`) is **unchanged**.
- The post-success reload (`loadProducts()`) triggers exactly as before.

---

## Dependencies

| Dependency | Source |
|---|---|
| `callEdge` | Injected via `initBulkActions({ callEdge, supabase, loadProducts })` |
| `supabase` | Injected — used for local DB update after bulk price success |
| `loadProducts` | Injected — called after bulk update succeeds |

`bulkActions.js` imports nothing from other project modules — no circular import risk.

---

## Module graph (updated)

```
index.js
  └─ api.js           (callEdge, fetchProductsWithWorkspaceMetrics)
  └─ filters.js       (filterProducts)
  └─ renderHelpers.js (formatRelativeDate, wsChips, epCls, rowEstProfitHtml)
  └─ setupPanel.js    (initSetupPanel)
  └─ importPanel.js   (initImportPanel)
  └─ bulkActions.js   (initBulkActions, updateBulkBar)   ← NEW
  └─ utils.js         (esc, …)
  └─ profitPreview.js
  └─ listingHealth.js
```

No circular imports. `bulkActions.js` imports nothing from other project modules.

---

## Verification

| Check | Result |
|---|---|
| `node --check bulkActions.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| No stray bulk inline code in `index.js` (grep) | ✅ Confirmed |
| `updateBulkBar` imported and called in `renderTable` | ✅ (line 531) |
| `initBulkActions` wired in page init block | ✅ (line 2394) |
| Products load (60 rows) | ✅ |
| `button[onclick]` count | ✅ 0 |
| 23 bulk checkboxes render (active/draft rows) | ✅ |
| Clicking a checkbox shows bulk bar "1 selected" | ✅ |
| Check-all selects all 23 rows, bar shows "23 selected" | ✅ |
| Cancel clears all selections, bar hides | ✅ |
| Bulk price modal opens (title + step=0.01) | ✅ |
| Bulk qty modal opens (title + step=1) | ✅ |
| Close button dismisses bulk modal | ✅ |
| Setup panel still opens | ✅ |
| Migrate/Import panel still opens | ✅ |
| Push modal opens | ✅ |
| Edit modal opens | ✅ |
| Live bulk apply (`bulk_update` API call) | ⚠️ Not verified on localhost (requires eBay auth) |
| Local `ebay_price_cents` update | ⚠️ Not verified on localhost (requires eBay auth) |

---

## Next Phase

**Phase 4e — Link-Check Helper Cluster** (`linkCheck.js`)

Extract the stale/active link helper cluster from `index.js`:

| Function / variable | Type |
|---|---|
| `isLinkedOnEbay(p)` | pure |
| `isStaleLinkCheck(p)` | pure |
| `isOutOfStockLinkCheck(p)` | pure |
| `isLinkWarningCheck(p)` | pure |
| `staleActionState(p)` | pure |
| `staleActionBadge(p)` | pure (HTML string) |
| `staleLinkLabel(p)` | pure |
| `staleLinkMessage(p)` | pure |
| `ebayCodeLinkHtml(p, compact?)` | pure (HTML string) |
| `currentActiveListingId` | module-level `let` — keep in index.js for now or pass as getter |

All pure / stateless functions. Low risk. Prerequisite for Phase 4f (`renderTable` / `renderCards` full extraction).

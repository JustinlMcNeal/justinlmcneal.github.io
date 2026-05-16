# Phase 4c — Import / Migration Panel Extraction Summary

**Date:** 2026-05-16  
**New file:** `js/admin/ebayListings/importPanel.js`  
**Files modified:** `js/admin/ebayListings/index.js`  
**Reference docs:** `003_refactor_phase_plan.md`, `013_setup_panel_extraction_summary.md`

---

## What Moved

One private function and three event listeners extracted from `index.js` into `importPanel.js`:

| Symbol | Type | Notes |
|---|---|---|
| `renderMigrateResults(items)` | private function | Renders scan/auto-link results into `#migrateResults` / `#migrateBody` |
| `#btnMigrate` click handler | event listener | Toggles `#migratePanel` visibility |
| `#btnScanEbay` click handler | async event listener | Calls `ebay-migrate-listings` `{ action: "scan" }` |
| `#btnAutoLink` click handler | async event listener | Calls `ebay-migrate-listings` `{ action: "auto_link" }`; calls `loadProducts()` on success |

These ~44 lines were replaced with a single call:

```js
// index.js — before (44 lines of inline logic)
document.getElementById("btnMigrate").addEventListener(...);
document.getElementById("btnScanEbay").addEventListener(...);
document.getElementById("btnAutoLink").addEventListener(...);

// index.js — after (1 line)
initImportPanel({ callEdge, loadProducts });
```

---

## What Stayed in `index.js`

Everything else. The Import Panel has no shared state with the rest of the page — it only needs `callEdge` and `loadProducts` passed in, which is clean.

---

## Why This Extraction Was Safe

- `renderMigrateResults` was only ever called inside the two migrate event listeners — no other call sites.
- The scan and auto-link handlers read only their own local DOM elements (`#btnScanEbay`, `#btnAutoLink`, `#migrateStatus`, `#migrateResults`, `#migrateBody`) — no shared module-level state accessed.
- `loadProducts` only needed for the post-auto-link reload — passed as a dependency.
- Edge function name (`ebay-migrate-listings`) and payloads (`{ action: "scan" }`, `{ action: "auto_link" }`) are unchanged.

---

## Dependencies

| Dependency | Source |
|---|---|
| `callEdge` | Injected from `index.js` via `initImportPanel({ callEdge, loadProducts })` |
| `loadProducts` | Injected from `index.js` — called after successful auto-link |
| `esc` | Imported directly from `./utils.js` inside `importPanel.js` |

---

## Module graph (updated)

```
index.js
  └─ api.js           (callEdge, fetchProductsWithWorkspaceMetrics)
  └─ filters.js       (filterProducts)
  └─ renderHelpers.js (formatRelativeDate, wsChips, epCls, rowEstProfitHtml)
  └─ setupPanel.js    (initSetupPanel)
  └─ importPanel.js   (initImportPanel)          ← NEW
  └─ utils.js         (esc, …)
  └─ profitPreview.js
  └─ listingHealth.js
```

No circular imports. `importPanel.js` imports only from `utils.js`.

---

## Verification

| Check | Result |
|---|---|
| `node --check importPanel.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| No stray `renderMigrateResults` / `btnMigrate` in `index.js` | ✅ Confirmed |
| Products load (60 rows) | ✅ |
| `button[onclick]` count | ✅ 0 |
| `#btnMigrate` toggles `#migratePanel` open | ✅ |
| `#btnMigrate` toggles `#migratePanel` closed (second click) | ✅ |
| Setup panel still opens | ✅ |
| Push modal opens | ✅ |
| Edit modal opens | ✅ |
| Scan/auto-link payloads unchanged (code inspection) | ✅ |
| Live scan/auto-link calls | ⚠️ Not verified on localhost (requires eBay auth) |

---

## Next Phase

**Phase 4d — Link-Check Helper Cluster** (`linkCheck.js`)

Extract the stale/active link helper cluster from `index.js`:

| Function / variable | Type |
|---|---|
| `isLinkedOnEbay(p)` | pure |
| `isStaleLinkCheck(p)` | pure |
| `isOutOfStockLinkCheck(p)` | pure |
| `isLinkWarningCheck(p)` | pure |
| `staleActionState(p)` | pure |
| `staleActionBadge(p)` | pure |
| `staleLinkLabel(p)` | pure |
| `staleLinkMessage(p)` | pure |
| `ebayCodeLinkHtml(p)` | pure (HTML string) |
| `currentActiveListingId` | module-level `let` — needs careful handling if extracted |

All stateless pure functions. Low risk. Paves the way for Phase 4e (`renderTable` / `renderCards` extraction).

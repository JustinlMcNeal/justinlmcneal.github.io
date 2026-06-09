# Parcel Imports — Phase 6B: Save Draft + History + Open Draft

**Status:** Implemented and verified  
**Date:** 2026-06-08  
**Prerequisites:** Phase 6A RPC smoke passed ([009_phase_6a_rpc_smoke.md](./009_phase_6a_rpc_smoke.md))

**Goal:** Wire production Save Draft button, Previous Imports list, duplicate warnings, and Open Draft rehydration. No approval, expenses, inventory, or mapping memory.

---

## 1. Files changed

| File | Lines | Purpose |
|------|------:|---------|
| `js/admin/parcelImports/ui/saveDraft.js` | 164 | Save Draft button, status, duplicate warning UI |
| `js/admin/parcelImports/ui/historyTable.js` | 201 | Previous Imports list + Open Draft |
| `js/admin/parcelImports/api/parcelImportsLoader.js` | 76 | Load draft bundle from DB |
| `js/admin/parcelImports/api/parcelImportsApi.js` | 172 | `listParcelImports`, `checkDuplicateParcelImport`, fetch helpers |
| `js/admin/parcelImports/api/parcelImportsMappers.js` | 406 | DB → local decode helpers |
| `js/admin/parcelImports/state.js` | 289 | `applyLoadedDraft`, session/history/duplicate state |
| `js/admin/parcelImports/dom.js` | 57 | Save/status/history DOM refs |
| `js/admin/parcelImports/index.js` | 91 | Session gate + module init |
| `js/admin/parcelImports/events.js` | 125 | Enable save + duplicate check after parse |
| `pages/admin/parcelImports.html` | — | Save button hooks, status, history tbody id |
| `scripts/verify-parcel-phase6b.mjs` | — | Automated Phase 6B browser test |

**Unchanged:** `saveDraftSmokeTest.js` (still exposed on localhost as `ParcelImports.runSaveDraftSmokeTest()`).

---

## 2. What works

### Save Draft button
- Both header and action-bar buttons wired via `[data-parcel-action="save-draft"]`
- Disabled until admin session + parsed items exist
- Builds payload via `buildSaveDraftPayload(state)` → `saveParcelImportDraft(payload)`
- Stores `state.currentImportId` from RPC `import_id`
- Create path: `created: true`; re-save: `created: false` (update)
- Refreshes Previous Imports on success
- Status messages: saving / saved / updated / error

### Duplicate warnings (non-blocking)
- `checkDuplicateParcelImport({ parcelId, fileHash, currentImportId })`
- Stronger message for `file_hash` match; softer for `parcel_id` match
- Shown in `#parcelDuplicateWarning` after parse and before/after save

### Previous Imports
- `listParcelImports({ limit: 25 })` on page init (when authenticated)
- Renders into `#parcelHistoryTbody` ordered by `imported_at` desc
- Columns: parcel id, date, status badge, items, charged weight, CNY/USD totals, products affected, needs mapping + expense indicator, Open Draft

### Open Draft
- `loadParcelImport(importId)` fetches header + items + mappings
- Rehydrates `parcel`, `xlsBaseline`, `overrides`, `items`, `rowMappings`, parse warnings
- Sets `currentImportId`, clears `currentFile`, resets `dirtyFields`
- Re-renders summary, overrides, mapping table, stats, CPI preview (recomputed — not from stored allocations)

### Session gate
- `requireAuthenticatedSession()` + `requireAdmin()` on init
- No redirect; friendly status if not logged in
- Save/history/load disabled when gate fails
- No service role in browser

---

## 3. Testing results

| Test | Result |
|------|--------|
| `node scripts/verify-parcel-phase3.mjs` | PASS |
| `node scripts/verify-parcel-phase4.mjs` | PASS |
| `node scripts/verify-parcel-phase6a-smoke.mjs` | PASS |
| `node scripts/verify-parcel-phase6b.mjs` | PASS |

### Phase 6B automated flow (2026-06-08)

1. Admin magic-link session on `127.0.0.1`
2. Upload `sample_baestao_waybill_227461.xls`
3. Click Save Draft → `Draft saved — parcel 227461 (11 items).`, `currentImportId` set
4. Click Save Draft again → `Draft updated`, items stay **11** (not 22)
5. Previous Imports shows row(s)
6. Re-upload same fixture → duplicate warning visible
7. Open Draft → 11 items, 11 mappings, UI restored, `currentImportId` preserved

**Children stable on update:** `itemCount: 11`, `allocationCount: 11` after second save.

---

## 4. Issues / deviations

| Item | Detail |
|------|--------|
| `productId` / `productVariantId` | Still null — labels only (Phase 6B scope) |
| History KPI cards | Top stat cards remain static placeholders |
| New Import button | Not wired (out of scope) |
| `raw_file_storage_path` | Not populated — no Storage upload yet |
| Parse re-upload after Open Draft | Clears `currentImportId` (new draft path) — expected |

---

## 5. Next step (Phase 7+)

1. Mapping memory / saved match suggestions (DB-backed)
2. Real `product_id` / `product_variant_id` resolution
3. Approve + Update CPI (Phase 8)
4. Expense linkage on approve (Phase 9)
5. Wire New Import / history filters / KPI cards from live counts

Do **not** start approval, CPI product updates, expenses, or inventory without explicit request.

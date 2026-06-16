# Phase 13 — Final UI polish + export/reporting

**Status:** Complete — Parcel Imports **v1 release-ready** (UI/reporting only; no CPI/inventory/expense formula changes).

## Goal

Wire remaining non-core UI/reporting features for v1: CSV exports, expense unlink, history filters, import details/audit modal, workflow tab navigation, and button-state polish.

## Files changed

| File | Lines (approx) | Change |
|------|----------------|--------|
| `js/admin/parcelImports/utils/csvExport.js` | 44 | **New** — CSV build + browser download |
| `js/admin/parcelImports/ui/exportActions.js` | 184 | **New** — history + allocation export handlers |
| `js/admin/parcelImports/ui/importDetailsModal.js` | 116 | **New** — details/audit modal + timeline |
| `js/admin/parcelImports/ui/tabs.js` | 45 | **New** — scroll-to-section tab navigation |
| `js/admin/parcelImports/api/parcelImportsApi.js` | +99 | History filters (`received`, `expense`), export allocation query, event messages in smoke counts |
| `js/admin/parcelImports/ui/historyTable.js` | +97 | Received/expense filters, Details row action, filter footnote |
| `js/admin/parcelImports/ui/expenseLinkActions.js` | +62 | Unlink button + confirm + refresh |
| `pages/admin/parcelImports.html` | +123 | Export buttons, filters, details modal, unlink button, copy tweaks |
| `js/admin/parcelImports/dom.js` | +12 | Refs for export, filters, modal, unlink |
| `js/admin/parcelImports/index.js` | +19 | Init export, details, tabs; Details header button |
| `js/admin/parcelImports/ui/saveDraft.js` | +2 | `updateExportButtons()` after save |
| `js/admin/parcelImports/events.js` | +2 | `updateExportButtons()` after parse |
| `js/admin/parcelImports/ui/newImport.js` | +2 | `updateExportButtons()` after new import |
| `scripts/verify-parcel-phase13-finalize.mjs` | 415 | **New** — Phase 13 E2E + safety grep |
| `scripts/verify-parcel-phase4.mjs` | +1 | FX warning copy matcher update |

**Tracked diff summary:** ~558 insertions, ~76 deletions across 17 tracked paths (includes minor pre-Phase-13 fixes still in working tree).

## 1. Export History CSV

- **Button:** `#parcelHistoryExportBtn` (History section).
- **Behavior:** Calls `listParcelImports()` with current search/status/**received**/**expense** filters (up to 500 rows); falls back to loaded `historyRows` if empty.
- **Filename:** `parcel-imports-history-YYYY-MM-DD.csv`
- **Columns:** import_id, parcel_id, status, imported_at, source_file_name, xls_total_items, actual_total_charge_cny, effective_fx_rate, usd_equivalent, products_affected_count, rows_needing_mapping_count, expense_linked (yes/no), inventory_received (yes/no), approved_at, inventory_received_at
- **Server:** None — client-side only.

## 2. Export allocations CSV

- **Buttons:** `#parcelExportAllocationsBtnHeader`, `#parcelExportAllocationsBtnBar` (disabled until import open with items).
- **Behavior:** For **approved** imports with final allocations in DB, exports `allocation_run_type = final`; otherwise uses in-memory CPI preview rows.
- **Filename:** `parcel-import-{parcelId}-allocations-YYYY-MM-DD.csv`
- **Columns:** parcel_id, row_number, item_name, seller, qty, row_type, mapping_status, product_label, variant_label, product_id, product_variant_id, landed_total_cny, landed_cpi_cny, landed_cpi_usd, included_in_final_cpi

## 3. Expense unlink UI

- **Button:** `#parcelUnlinkExpenseBtn` — visible only when `expense_id` is set on the opened import.
- **Confirm:** `window.confirm` before unlink.
- **API:** `unlinkExpenseFromParcelImport()` — clears `parcel_imports.expense_id` only; does **not** delete the expense.
- **Event:** Inserts `expense_unlinked` into `parcel_import_events` with previous expense id in payload.
- **Refresh:** History table, KPIs, expense/inventory UI states after unlink.

## 4. History filters

Added alongside existing status filter and search:

| Filter | Values |
|--------|--------|
| Inventory received | All / received / not_received |
| Expense linked | All / linked / not_linked |

Footnote shows active filter summary. Load-more unchanged.

## 5. Import details / audit view

- **Open from:** Header **Details** button (opened import) or per-row **Details** in history.
- **Modal:** `#parcelImportDetailsModal`
- **Content:** Parcel ID, import ID, status, source file, imported/approved/received timestamps, expense + inventory status, KPI counts, charge/FX/USD summary.
- **Timeline:** `parcel_import_events` ordered ascending (`event_type`, `event_message`, `created_at`).

## 6. UX cleanup

- Workflow tabs scroll to sections (panels remain visible for regression compatibility).
- Export Allocations + Details buttons disabled until an import is open; tooltips explain why.
- History empty state: “No imports match your search or filter.”
- CPI FX warning copy: “Missing exchange rate — enter FX rate or total parcel charge + USD equivalent before approving.”

## 7. Tests passed

| Script | Result |
|--------|--------|
| `verify-parcel-phase3.mjs` | PASS |
| `verify-parcel-phase4.mjs` | PASS |
| `verify-parcel-phase6a-smoke.mjs` | PASS |
| `verify-parcel-phase6b.mjs` | PASS |
| `verify-parcel-phase7-mapping.mjs` | PASS |
| `verify-parcel-phase8-approve-cpi.mjs` | PASS |
| `verify-parcel-phase9-expense-link.mjs` | PASS |
| `verify-parcel-phase10-polish.mjs` | PASS |
| `verify-parcel-phase11-receive-inventory.mjs` | PASS |
| `verify-parcel-phase13-finalize.mjs` | PASS |

### Phase 13 verify highlights (last run)

- Export history: **12 rows**
- Export allocations: **11 rows**, parcel `227461`
- Details modal: parcel ID + timeline rendered
- Unlink: cleared `expense_id` in state and DB (re-linked via service role for cleanup)
- Received filter: **1 row**, all show “Received”
- Tabs: history tab `aria-selected=true`, panel visible

## 8. Safety grep result

Scanned `js/admin/parcelImports/**/*.js` for forbidden client patterns:

| Check | Result |
|-------|--------|
| Client `.update`/`.upsert` on `unit_cost` / overrides | **None** |
| Client stock writes | **None** |
| Client `stock_ledger` writes outside receive flow | **None** |
| Auto-create expense on approval | **None** |
| Client-side approval CPI formula changes | **None** (preview-only in `cpiPreview.js`) |

**Pass:** yes

## Remaining optional work (post-v1)

- Panel hide/show tabs (if desired) with test script tab-click helpers.
- `approved_by` in details modal (needs column/RPC if not on `parcel_imports`).
- Server-side export for very large history sets (>500).
- Bulk expense unlink from history without opening import.
- Toast notifications instead of `alert()` on export errors.

## Final v1 release status

**Parcel Imports v1 is complete and release-ready.**

Core flows unchanged and regression-clean: upload/parse, charge/FX overrides, mapping, save/open draft, approve CPI (RPC), expense create/link/unlink, receive inventory (RPC), history search/load-more, plus Phase 13 export/reporting and audit details.

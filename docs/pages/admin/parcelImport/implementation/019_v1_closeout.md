# Parcel Imports — v1 Closeout

**Status:** Complete  
**Date:** 2026-06-09  
**Branch:** `main` (parcel work uncommitted at closeout)

---

## 1. Final status

- **Parcel Imports v1 is complete.**
- **Full regression suite passes twice** on the linked test DB (Phases 3–11; Phase 12 stabilization verified by repeat runs).
- **Core workflow is implemented end-to-end** from Baestao upload through inventory receiving and searchable history.

Phases 1–12 delivered parser, persistence, mapping, approval, expense linkage, inventory receive, polish, and test/history stabilization. No blocking work remains for v1.

---

## 2. Workflow summary

```
Upload → Parse → Override → Map → Save Draft → Approve CPI → Link Expense → Receive Inventory → History Search
```

| Step | What happens |
|------|----------------|
| **Upload** | Baestao HTML-table `.xls` parsed client-side |
| **Parse** | Items, footer metadata, validation chips |
| **Override** | Charge/weight/FX overrides with dirty tracking |
| **Map** | Product/variant picker, row types, mapping memory |
| **Save Draft** | `save_parcel_import_draft` RPC — header, items, mappings, allocations, events |
| **Approve CPI** | `approve_parcel_import_cpi` RPC — product/variant cost updates, final allocations |
| **Link Expense** | User-initiated create/link via `expenseLinkApi` |
| **Receive Inventory** | `receive_parcel_import_inventory` RPC — `product_variants.stock` + `stock_ledger` |
| **History Search** | Parcel ID / filename / UUID search, status filter, load more, `openDraft(id)` |

---

## 3. Major migrations

| Migration | Purpose |
|-----------|---------|
| `20260818_create_parcel_imports.sql` | Tables: imports, items, mappings, allocations, events, mapping memory; RLS |
| `20260819_save_parcel_import_draft_rpc.sql` | `save_parcel_import_draft` — create/update draft atomically |
| `20260820_approve_parcel_import_cpi.sql` | `approve_parcel_import_cpi` — approval + CPI cost updates |
| `20260821_receive_parcel_import_inventory.sql` | `receive_parcel_import_inventory` — stock + ledger + received flags |

All applied to linked Supabase project and validated via SQL scripts.

---

## 4. Major implemented areas

| Area | Location / notes |
|------|------------------|
| **Parser** | `js/admin/parcelImports/parser/` — Baestao HTML XLS |
| **Overrides** | `ui/overrides.js`, `validation/overrideValidators.js` |
| **CPI preview** | `cpi/cpiPreview.js`, `ui/cpiPreviewPanel.js` |
| **Save/load drafts** | `api/parcelImportsApi.js`, `ui/saveDraft.js`, `ui/historyTable.js` |
| **Product/variant mapping** | `ui/productVariantPicker.js`, `api/productsApi.js` |
| **Mapping memory** | `ui/mappingMemory.js`, `api/mappingMemoryApi.js` |
| **Approval CPI update** | `api/approvalApi.js`, `ui/approvalActions.js` |
| **Expense linkage** | `api/expenseLinkApi.js`, `ui/expenseLinkActions.js` |
| **Inventory receiving** | `api/inventoryReceiveApi.js`, `ui/inventoryReceiveActions.js` |
| **History search / load more** | `ui/historyTable.js`, `api/parcelImportsApi.js` (Phase 12) |
| **KPI refresh** | `api/parcelImportStats.js`, `ui/stats.js` — refresh on all lifecycle actions |
| **Admin page** | `pages/admin/parcelImports.html` |
| **Fixtures** | `docs/pages/admin/parcelImport/fixtures/` |

---

## 5. Safety boundaries

| Rule | Enforcement |
|------|-------------|
| Product cost writes | **Only** `approve_parcel_import_cpi` RPC |
| Stock writes | **Only** `receive_parcel_import_inventory` RPC |
| Expense writes | **Only** user-initiated `expenseLinkApi` (create/link buttons) |
| No service role in browser | Anon key + authenticated session; magic-link tests use service role in Node only |
| No client-side stock/cost writes | Grep-verified across `js/admin/parcelImports/**` |

**Explicitly not in v1:**

- No expense auto-create on approval
- No stock changes during approval or expense link
- No `inventory_receipts` table
- No raw file storage bucket (column exists; upload not persisted)

---

## 6. Test status

All scripts pass on linked test DB (verified twice after Phase 12):

| Script | Phase | Result |
|--------|-------|--------|
| `scripts/verify-parcel-phase3.mjs` | 3 — Parser / overrides / mapping UI | PASS |
| `scripts/verify-parcel-phase4.mjs` | 4 — CPI preview | PASS |
| `scripts/verify-parcel-phase6a-smoke.mjs` | 6A — Save draft RPC smoke | PASS |
| `scripts/verify-parcel-phase6b.mjs` | 6B — Save + history + open draft | PASS |
| `scripts/verify-parcel-phase7-mapping.mjs` | 7 — Product/variant mapping | PASS |
| `scripts/verify-parcel-phase8-approve-cpi.mjs` | 8 — Approve + CPI | PASS |
| `scripts/verify-parcel-phase9-expense-link.mjs` | 9 — Expense linkage | PASS |
| `scripts/verify-parcel-phase10-polish.mjs` | 10 — Polish / New Import / KPIs | PASS |
| `scripts/verify-parcel-phase11-receive-inventory.mjs` | 11 — Receive inventory | PASS |
| *(Phase 12 — no dedicated script)* | 12 — Stabilization + history search | PASS (via full suite ×2) |

SQL validation scripts:

- `scripts/supabase/validate-parcel-migration-001.sql`
- `scripts/supabase/validate-parcel-migration-002-rpc.sql`
- `scripts/supabase/validate-parcel-phase8-approve-cpi.sql`
- `scripts/supabase/validate-parcel-phase11-receive-inventory.sql`

---

## 7. Remaining optional work (not blocking v1)

| Item | Notes |
|------|--------|
| **Export History** | Button placeholder in UI |
| **Unlink expense UI** | API exists; no admin button |
| **Full pagination** | Load-more only; no page numbers |
| **Cost ledger** | Stock-as-basis for weighted CPI; dedicated cost ledger deferred |
| **Admin product stock edits** | Should eventually write `stock_ledger` (pre-existing gap) |
| **Raw file storage** | Supabase bucket + `raw_file_storage_path` persistence |
| **Better expense browser/search** | Link-by-ID only today |

---

## 8. Recommended next phase

**Phase 13 — Export / reporting** (optional, non-blocking):

- Wire Export History
- CSV/JSON export of import history and allocation snapshots
- Optional expense unlink UI

Parcel Imports v1 is **shippable without Phase 13**.

---

## Implementation doc index

| Doc | Topic |
|-----|--------|
| `001_wiring_plan.md` | Initial wiring plan |
| `003_existing_schema_inspection.md` | Schema / stock_ledger audit |
| `009_phase_6a_rpc_smoke.md` | Save draft RPC |
| `010_phase_6b_save_draft_history.md` | History + open draft |
| `011_phase_7_product_mapping.md` | Product mapping |
| `013_phase_8_approve_cpi.md` | Approve CPI |
| `014_phase_9_expense_linkage.md` | Expense link |
| `015_phase_10_cleanup_polish.md` | Polish |
| `017_phase_11_receive_inventory.md` | Receive inventory |
| `018_phase_12_stabilization_history_search.md` | Test + history stabilization |
| **`019_v1_closeout.md`** | **This document** |

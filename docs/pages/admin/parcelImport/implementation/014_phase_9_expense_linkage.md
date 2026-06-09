# Parcel Imports — Phase 9: Expense Linkage

**Status:** Implemented and verified  
**Date:** 2026-06-08  
**Prerequisites:** Phase 8 ([013_phase_8_approve_cpi.md](./013_phase_8_approve_cpi.md))

**Goal:** Create or link an Inventory expense for an approved parcel import via `parcel_imports.expense_id`.

---

## Files changed

| File | Lines | Purpose |
|------|------:|---------|
| `js/admin/parcelImports/api/expenseLinkApi.js` | 198 | Create/link/unlink expense + events |
| `js/admin/parcelImports/ui/expenseLinkActions.js` | 196 | UI buttons, status, block reasons |
| `js/admin/parcelImports/state.js` | 373 | `expenseId`, link status |
| `js/admin/parcelImports/dom.js` | 62 | Expense DOM refs |
| `js/admin/parcelImports/index.js` | 103 | Init expense actions |
| `js/admin/parcelImports/events.js` | 130 | Refresh expense UI on parse |
| `js/admin/parcelImports/ui/historyTable.js` | 212 | Hydrate expense on Open Draft |
| `js/admin/parcelImports/ui/approvalActions.js` | 152 | Refresh expense UI after approve |
| `js/admin/parcelImports/api/parcelImportsRehydrate.js` | 115 | `expenseId` on parcel |
| `pages/admin/parcelImports.html` | — | Create/link expense controls |
| `scripts/verify-parcel-phase9-expense-link.mjs` | — | Phase 9 test |

**No migration.** No approval RPC changes. No inventory/stock/cost writes in this phase.

---

## Behavior

### Create expense (`createExpenseFromParcelImport`)

1. Require `status = approved`
2. Require `expense_id` null
3. Compute USD amount:
   - `usd_equivalent × 100` if present
   - else `round((actual_total_charge_cny / effective_fx_rate) × 100)`
   - else error: “Add FX/USD amount before creating expense.”
4. Insert `expenses` (category **Inventory**, vendor **Baestao**)
5. Update `parcel_imports.expense_id`
6. Insert `parcel_import_events` → `expense_linked`

### Link existing (`linkExpenseToParcelImport`)

- Same approval + no-duplicate guards
- Validates expense exists
- Blocks if expense already linked to another import

### UI

- **Create Linked Expense** + **Link Expense** (ID input) enabled when approved and unlinked
- Status area shows linked amount/description or block reason
- History table shows **Linked** in expense column (existing)

---

## Test results

| Script | Result |
|--------|--------|
| Phase 3 | PASS |
| Phase 4 | PASS |
| Phase 6A | PASS |
| Phase 6B | PASS |
| Phase 7 | PASS |
| Phase 8 | PASS |
| **Phase 9** | **PASS** |

### Phase 9 functional test (2026-06-08)

| Field | Value |
|-------|-------|
| Import ID | `2685388e-89bf-4d6e-986c-e3efd6cbc3e6` |
| Expense ID | `8e8b6f30-a9f4-49c7-9f94-e80fbe2ce477` |
| Amount calc | ¥585 ÷ 7.21 → **8114 cents ($81.14)** |
| Category / vendor | Inventory / Baestao |
| Description | `Baestao Parcel 227461 — 50 items` |
| Events | `expense_linked` inserted |
| Duplicate create | Blocked — “Expense already linked.” |
| History UI | Shows Linked |

---

## Safety grep

`js/admin/parcelImports/**`:

- No `stock_ledger`
- No `inventory_receipt`
- No product/variant **cost UPDATE** (SELECT only in `productsApi`)
- No Receive Inventory
- Expense writes only in `expenseLinkApi.js` → `expenses` INSERT + `parcel_imports.expense_id` UPDATE

---

## Remaining issues

| Item | Detail |
|------|--------|
| Unlink UI | API exists (`unlinkExpenseFromParcelImport`); no button yet |
| Expense search picker | Link-by-ID only; no browse modal |
| `usd_equivalent` on save | Test used CNY÷FX path; saving `usdEquivalent` override would use direct USD |
| Auto-expense on approve | Intentionally not implemented |

---

## Next recommended step

**Phase 10 — Receive Inventory** (when requested): stock updates + `stock_ledger` from approved imports with expense linked.

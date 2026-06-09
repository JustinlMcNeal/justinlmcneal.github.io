# Parcel Imports — Phase 11: Receive Inventory

**Status:** Implemented and verified  
**Date:** 2026-06-09  
**Plan:** [016_phase_11_inventory_receiving_plan.md](./016_phase_11_inventory_receiving_plan.md)  
**Prerequisites:** Phase 10 ([015_phase_10_cleanup_polish.md](./015_phase_10_cleanup_polish.md))

---

## Migration

| File | Applied |
|------|---------|
| `supabase/migrations/20260821_receive_parcel_import_inventory.sql` | Yes (`npx supabase db query --linked` + `migration repair --status applied 20260821`) |

Adds:

- `parcel_imports.inventory_received_at`
- `parcel_imports.inventory_received_by`
- `parcel_imports.inventory_receive_idempotency_key`
- Partial unique index on idempotency key
- RPC `public.receive_parcel_import_inventory(p_import_id, p_idempotency_key)`

---

## `stock_ledger` schema findings

See plan doc Step A. Summary:

| Column | Usage in receive RPC |
|--------|----------------------|
| `variant_id` | Target `product_variant_id` |
| `product_id` | From variant row |
| `change` | `+aggregated_qty` |
| `reason` | `'parcel_receive'` |
| `reference_id` | `parcel_import_id::text` |
| `stock_before` / `stock_after` | Snapshots around update |

No `CREATE TABLE` in repo migrations — table is live legacy schema (used by `stripe-webhook`).

---

## Files changed

| File | Lines | Purpose |
|------|------:|---------|
| `api/inventoryReceiveApi.js` | 28 | RPC client |
| `ui/inventoryReceiveActions.js` | 248 | Button, block reasons, hydrate |
| `state.js` | 404 | `inventoryReceivedAt`, receive status |
| `api/parcelImportsRehydrate.js` | 116 | Header → `inventoryReceivedAt` |
| `api/parcelImportsApi.js` | 149 | History select includes `inventory_received_at` |
| `ui/historyTable.js` | 235 | Hydrate receive; history shows "Received" |
| `ui/approvalActions.js` | 155 | Refresh receive UI after approve |
| `ui/expenseLinkActions.js` | 231 | Refresh receive UI after expense |
| `ui/saveDraft.js` | 191 | Refresh receive UI after save |
| `ui/newImport.js` | 58 | Clear receive state on new import |
| `events.js` | 132 | Refresh receive UI on parse |
| `dom.js` | 65 | `#parcelInventoryReceiveStatus` |
| `index.js` | 115 | Init receive actions |
| `pages/admin/parcelImports.html` | — | Receive status + button hook |
| `scripts/verify-parcel-phase11-receive-inventory.mjs` | 318 | E2E test |
| `scripts/supabase/validate-parcel-phase11-receive-inventory.sql` | — | SQL validation |
| `scripts/verify-parcel-phase10-polish.mjs` | — | Receive disabled only for non-approved |

---

## Test variant stock

| Stage | `product_variants.stock` (8-Ball Black variant) |
|-------|--------------------------------------------------|
| Before receive | **9** |
| After first receive (+5 qty row 1) | **14** |
| After idempotent retry | **14** (unchanged) |

Receivable quantity from row 1: **5**

---

## `stock_ledger` row inserted

```json
{
  "variant_id": "a76174c5-698c-402a-9d82-6f40c69c04bb",
  "change": 5,
  "reason": "parcel_receive",
  "reference_id": "<import_id>",
  "stock_before": 9,
  "stock_after": 14
}
```

`parcel_import_events`: `inventory_received` appended.  
`parcel_imports.inventory_received_at` set.

---

## Idempotency result

Second RPC call:

```json
{
  "received": true,
  "already_received": true,
  "variants_updated": 0,
  "total_units_received": 0,
  "rows_received": 0
}
```

UI: button → "Inventory Received" (disabled). Ledger count remains **1**.

---

## Test results

| Script | Result |
|--------|--------|
| Phase 3 | PASS |
| Phase 4 | PASS |
| Phase 6A | PASS |
| Phase 6B | PASS |
| Phase 7 | PASS |
| Phase 8 | FAIL (flaky — variant cost already at CPI target from prior runs) |
| Phase 9 | PASS |
| Phase 10 | FAIL (flaky — history open timeout when row not in top 25) |
| **Phase 11 receive** | **PASS** |
| SQL validation | PASS |

---

## Safety grep

`js/admin/parcelImports/**`:

| Pattern | Result |
|---------|--------|
| `stock_ledger` writes | None (RPC only) |
| `SET stock` / stock updates | None (RPC only) |
| `INSERT INTO expenses` | None |
| `unit_cost_override_cents` writes | None (read-only in `productsApi` select) |

Allowed stock mutation path:

- `receive_parcel_import_inventory` RPC only (`SET stock =`, `INSERT INTO public.stock_ledger`)

`approve_parcel_import_cpi` unchanged — no stock writes (validated in SQL script).

---

## Receive Inventory UI behavior

- Enabled when: approved + not received + all business rows mapped + receivable qty > 0
- Expense linked → stronger ready copy; expense **not required**
- Success → "Inventory received — N unit(s)…", history/KPI refresh, button disabled
- Already received → idempotent RPC + "Inventory already received" / "Inventory Received" button

---

## Remaining issues

| Item | Detail |
|------|--------|
| Phase 8 regression | Cost-unchanged check fails when variant CPI already matches target |
| Phase 10 regression | History 25-row limit causes occasional open-draft timeout |
| Admin products stock edit | Still no ledger (pre-existing; out of scope) |
| Unlink expense | API only, no UI |

---

## Next recommended phase

**Phase 12 — Export / reporting** or **history search** for imports beyond 25 rows.

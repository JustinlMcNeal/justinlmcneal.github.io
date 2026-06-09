# Parcel Imports — Phase 8: Approve + Update CPI

**Status:** Implemented and verified  
**Date:** 2026-06-08  
**Prerequisites:** Phase 7 ([011_phase_7_product_mapping.md](./011_phase_7_product_mapping.md))

---

## Migration

| File | Purpose |
|------|---------|
| `supabase/migrations/20260820_approve_parcel_import_cpi.sql` | `approve_parcel_import_cpi` RPC |
| `scripts/supabase/validate-parcel-phase8-approve-cpi.sql` | Metadata, grants, auth gate, forbidden-write grep |

**Applied:** `npx supabase db query --linked -f …` + `migration repair --status applied 20260820`

---

## RPC behavior

`public.approve_parcel_import_cpi(p_import_id uuid, p_idempotency_key text default null)`

1. Requires `auth.uid()`
2. Locks import `FOR UPDATE`
3. Idempotent return if already `approved`
4. Requires `ready_to_approve`, preview allocations, all business rows `matched` with product + variant
5. Aggregates landed CPI per `(product_id, product_variant_id)` from preview rows
6. Derives `landed_cpi_usd` from `landed_cpi_cny / effective_fx_rate` when USD column null
7. Weighted-average updates `product_variants.unit_cost_override_cents` (or `products.unit_cost` for product-only fallback)
8. Copies preview allocations → `final` snapshot
9. Sets import `approved`, snapshot fields, `cpi_update_applied_at`
10. Inserts events: `approved`, `cpi_update_applied`

**Not written:** stock, `stock_ledger`, expenses, inventory.

### Formula (v1)

```
new_landed_cpi_usd = Σ(qty × landed_cpi_usd) / Σ(qty)   -- per target

old_cost = variant.unit_cost_override_cents/100 ?? products.unit_cost ?? new_landed_cpi_usd

IF stock > 0:
  new_avg = (old_cost × stock + new_landed_cpi_usd × imported_qty) / (stock + imported_qty)
ELSE:
  new_avg = new_landed_cpi_usd
```

---

## Files changed

| File | Lines | Purpose |
|------|------:|---------|
| `api/approvalApi.js` | 21 | RPC client |
| `ui/approvalActions.js` | 128 | Approve button + block reasons |
| `ui/saveDraft.js` | 187 | Disable save when approved; refresh approve state |
| `state.js` | 335 | `importStatus`, approval status helpers |
| `dom.js` | 58 | `approveCpiBtns` refs |
| `index.js` | 97 | Init approval actions |
| `events.js` | 127 | Refresh approve state after parse |
| `ui/historyTable.js` | 205 | Refresh approve state on Open Draft |
| `pages/admin/parcelImports.html` | — | `data-parcel-action="approve-cpi"` hooks |
| `scripts/verify-parcel-phase8-approve-cpi.mjs` | — | Functional test |

---

## Test results

| Script | Result |
|--------|--------|
| `validate-parcel-phase8-approve-cpi.sql` | PASS |
| `verify-parcel-phase3.mjs` | PASS |
| `verify-parcel-phase4.mjs` | PASS |
| `verify-parcel-phase6a-smoke.mjs` | PASS |
| `verify-parcel-phase6b.mjs` | PASS |
| `verify-parcel-phase7-mapping.mjs` | PASS |
| `verify-parcel-phase8-approve-cpi.mjs` | PASS |

### Phase 8 functional test (2026-06-08)

- Fixture: `sample_baestao_waybill_227461.xls`
- Row 1: **8-Ball Dice Charm Keychain** / **Color: Black** (`a76174c5-698c-402a-9d82-6f40c69c04bb`)
- Rows 2–11: Personal / Excluded
- FX override: 7.21
- Save → `ready_to_approve`
- Approve → `approved`

| Check | Result |
|-------|--------|
| Import status | `approved` |
| Variant cost before | `null` (stock: 9) |
| Variant cost after | **70 cents** ($0.70) |
| Preview allocations | 11 |
| Final allocations | 11 |
| Events | `approved`, `cpi_update_applied` |
| Save Draft after approve | Disabled |
| Item count | 11 (no duplication) |

---

## Safety grep

**`js/admin/parcelImports/**`:** No product/variant UPDATE, no stock/expense/inventory writes.

**Migration RPC:** Only `unit_cost` / `unit_cost_override_cents` updates allowed. No `stock_ledger`, `expenses`, or stock column updates.

---

## Remaining issues

| Item | Detail |
|------|--------|
| FX required for CPI | Approval derives USD from CNY+FX when preview USD null; save should persist FX for consistency |
| Product-only matched rows | Fallback path exists but UI requires variant for `matched` status |
| Cost basis | Uses `product_variants.stock` as proxy — not true purchase history |
| Re-approve | Idempotent — already-approved imports skip CPI writes |
| Expense linkage | Phase 9 (not started) |

---

## Next recommended step

**Phase 9 — Expense linkage** (when requested): optional `expense_id` on approve, no auto-expense creation unless specified.

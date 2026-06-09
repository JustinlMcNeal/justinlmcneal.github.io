# Parcel Imports — Phase 11: Inventory Receiving Plan

**Status:** Plan + implementation  
**Date:** 2026-06-08  
**Prerequisites:** Phase 10 ([015_phase_10_cleanup_polish.md](./015_phase_10_cleanup_polish.md))

---

## Step A — `stock_ledger` inspection findings

### Table schema (live / audit docs — no `CREATE TABLE` in repo migrations)

| Column | Type / usage |
|--------|----------------|
| `variant_id` | `UUID NOT NULL` — target variant |
| `product_id` | `UUID NOT NULL` — parent product |
| `change` | `INTEGER` — signed delta (+ receive, − order) |
| `reason` | `TEXT` — e.g. `order`, `refund` |
| `reference_id` | `TEXT` — external reference (order session id, parcel import id) |
| `stock_before` | `INTEGER` — snapshot before change |
| `stock_after` | `INTEGER` — snapshot after change |

No `reference_type` column in live schema. No `created_at` confirmed in migrations (may exist live).

### Reason values in repo

| Reason | Source |
|--------|--------|
| `order` | `stripe-webhook` — stock decrement on purchase |
| `refund` | `stripe-webhook` — stock increment on refund |
| **`parcel_receive`** | **New — Phase 11 receive RPC** |

### Reference patterns

| Flow | `reference_id` |
|------|----------------|
| Order | `kk_order_id` or Stripe `sessionId` (text) |
| Refund | `orderSessionId` (text) |
| Parcel receive | `parcel_import_id` as text UUID |

### Stock update patterns

| Flow | Updates `product_variants.stock` | Inserts `stock_ledger` |
|------|----------------------------------|------------------------|
| Stripe order/refund | Yes (service role) | Yes |
| Admin products UI | Yes (direct) | No |
| **Parcel receive RPC** | **Yes (authenticated RPC)** | **Yes** |

### Migration gap

- `stock_ledger` is **legacy/live DDL** — not created in `supabase/migrations/`.
- Phase 11 RPC assumes table exists (confirmed in prod via `stripe-webhook` and sizes audit).

---

## Step B — Receive RPC plan

### Receive rules

1. Import must exist and `status = 'approved'`.
2. Import must not already be received (`inventory_received_at IS NULL`).
3. **No unmapped business rows:** every `row_type = business_inventory` row must have `mapping_status = matched` and `product_variant_id IS NOT NULL`.
4. **Receivable rows only:**
   - `row_type = business_inventory`
   - `mapping_status = matched`
   - `product_variant_id IS NOT NULL`
   - `quantity > 0`
5. `personal_excluded`, `supplies`, `unknown` rows are ignored.
6. If zero receivable quantity after filters → block with readable error.
7. Aggregate quantities by `product_variant_id`; one ledger row per variant.
8. Mark header received + append `inventory_received` event.

**Not in scope:** expenses, CPI/cost updates, `inventory_receipts` table.

### Idempotency

| Layer | Mechanism |
|-------|-----------|
| Primary | `inventory_received_at` — second call returns `already_received: true`, no stock change |
| Secondary | `inventory_receive_idempotency_key` partial unique index (same pattern as approval) |

### `stock_ledger` write (per variant)

```text
variant_id     = product_variant_id
product_id     = from product_variants row
change         = +aggregated_qty
reason         = 'parcel_receive'
reference_id   = parcel_import_id::text
stock_before   = variant.stock before update
stock_after    = stock_before + change
```

### Validation checklist (RPC)

- [ ] `auth.uid()` required
- [ ] `SECURITY INVOKER`
- [ ] `FOR UPDATE` lock on `parcel_imports`
- [ ] Reject non-approved
- [ ] Reject unmapped business rows
- [ ] Reject zero receivable units
- [ ] No `expenses` writes
- [ ] No `unit_cost` / `unit_cost_override_cents` writes
- [ ] Stock update only `product_variants.stock`
- [ ] Ledger insert only inside receive RPC

### New columns on `parcel_imports`

```sql
inventory_received_at timestamptz
inventory_received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
inventory_receive_idempotency_key text
-- partial unique index on inventory_receive_idempotency_key WHERE NOT NULL
```

### RPC signature

```sql
public.receive_parcel_import_inventory(
  p_import_id uuid,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
```

### Return shape

```json
{
  "import_id": "uuid",
  "received": true,
  "already_received": false,
  "variants_updated": 1,
  "total_units_received": 5,
  "rows_received": 1
}
```

---

## UI plan

- Wire `#parcelReceiveInventoryBtn` with `data-parcel-action="receive-inventory"`.
- Enabled when: approved + not received + receivable (client mirrors RPC block reasons).
- Expense linked → stronger ready copy; **expense not required**.
- Success → "Inventory received", disable button, refresh history/KPIs.
- Client calls RPC only — **no direct stock writes**.

---

## Files (implementation)

| File | Purpose |
|------|---------|
| `supabase/migrations/20260821_receive_parcel_import_inventory.sql` | Columns + RPC |
| `scripts/supabase/validate-parcel-phase11-receive-inventory.sql` | SQL validation |
| `js/admin/parcelImports/api/inventoryReceiveApi.js` | RPC client |
| `js/admin/parcelImports/ui/inventoryReceiveActions.js` | Button + status |
| `scripts/verify-parcel-phase11-receive-inventory.mjs` | E2E test |

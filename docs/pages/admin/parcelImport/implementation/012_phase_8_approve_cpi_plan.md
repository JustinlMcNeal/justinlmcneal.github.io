# Phase 8 — Approve + Update CPI (plan)

**Goal:** Approve a saved parcel import and apply weighted-average landed CPI to mapped products/variants via RPC.

## Approval rules

| Rule | Detail |
|------|--------|
| Auth | `auth.uid()` required |
| Status | Must be `ready_to_approve` (not `draft`, `needs_review`, `voided`, `error`) |
| Business rows | All `business_inventory` rows must be `matched` with `product_id` + `product_variant_id` |
| Blocked statuses | No business row with `needs_mapping`, `variant_uncertain`, or `parser_warning` |
| CPI rows | At least one matched business row; preview allocations must exist |
| Excluded | `personal_excluded` and `supplies` rows do not update CPI |
| Idempotent | If already `approved`, return success without reapplying CPI |

## Weighted average (v1)

Per target `(product_id, product_variant_id)` — aggregate parcel rows first:

```
new_landed_cpi_usd = Σ(qty × landed_cpi_usd) / Σ(qty)
imported_qty = Σ(qty)
```

Then per target:

```
old_cost = variant.unit_cost_override_cents/100
           ?? products.unit_cost
           ?? new_landed_cpi_usd

IF variant.stock > 0:
  new_avg = (old_cost × stock + new_landed_cpi_usd × imported_qty) / (stock + imported_qty)
ELSE:
  new_avg = new_landed_cpi_usd
```

**Write target:**
- `product_variant_id` set → `product_variants.unit_cost_override_cents = round(new_avg × 100)`
- else → `products.unit_cost = new_avg`

*Note: stock is a conservative basis proxy; a cost ledger can replace this later.*

## RPC design

`public.approve_parcel_import_cpi(p_import_id uuid, p_idempotency_key text default null)`

1. Lock import `FOR UPDATE`
2. Validate status + mappings + preview allocations
3. Aggregate CPI targets from preview + mappings
4. Update `products` / `product_variants` (cost only)
5. Copy preview allocations → `allocation_run_type = final`
6. Set import `approved`, snapshot fields, `cpi_update_applied_at`
7. Insert events: `approved`, `cpi_update_applied`

**Not in scope:** stock, `stock_ledger`, expenses, inventory receipt.

## Validation checklist

- [ ] Function exists, `SECURITY INVOKER`
- [ ] Grants: `authenticated` yes, `anon` no
- [ ] Auth gate rejects null `auth.uid()`
- [ ] Approved import returns `already_approved: true` without cost writes
- [ ] `ready_to_approve` import updates variant cost
- [ ] Final allocation rows created; preview rows retained
- [ ] Events `approved` + `cpi_update_applied` inserted
- [ ] Save Draft blocked after approval
- [ ] No `stock_ledger` / `expenses` / stock updates in migration

# Phase 6D-Prep — KK Reservation Cutover Readiness + Backfill Plan (Complete)

**Status:** Complete (read-only prep — no cutover, no behavior change)  
**Date:** 2026-06-09  
**Prerequisite:** Phase 6C (Stripe idempotency + shadow reservations)  
**Next:** ~~Phase 6D execute~~ **Done** — [013_phase_6d_kk_reserve_only_cutover.md](./013_phase_6d_kk_reserve_only_cutover.md)

---

## Summary

Phase 6D-Prep adds **read-only reconciliation and dry-run views** plus a **cutover settings placeholder** to plan the transition from legacy direct-deduct to reserve-only. **No stock, reservation, or webhook behavior changed.**

---

## Files created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260830_inventory_phase6d_prep_cutover_readiness.sql` | Views + settings table |
| `scripts/verify-inventory-phase6d-prep-cutover-readiness.mjs` | Read-only verification |

---

## Migration / views added

### `inventory_cutover_settings` (placeholder — webhook does not read yet)

| Column | Value (prod) |
|--------|----------------|
| `kk_reservation_mode` | `shadow` |
| Allowed modes | `legacy_direct_deduct`, `shadow`, `reserve_only` |

### Read-only views

| View | Purpose |
|------|---------|
| `v_inventory_kk_order_lines_resolved` | KK lines with `variant_id` resolved (line FK or product+option fallback) |
| `v_inventory_shadow_reservation_reconciliation` | Line-level shadow vs ledger vs order qty |
| `v_inventory_kk_paid_unshipped_reservation_candidates` | Paid, not shipped — cutover reservation targets |
| `v_inventory_kk_cutover_backfill_dry_run` | Variant-level stock backfill math (dry-run) |
| `v_inventory_cutover_readiness_summary` | Single-row advisory snapshot |

---

## KK order audit — tables and logic

### Tables

| Table | Role |
|-------|------|
| `orders_raw` | KK orders; keyed by `stripe_checkout_session_id` |
| `line_items_raw` | Order lines; `variant_id` nullable |
| `fulfillment_shipments` | Fulfillment state via `label_status` |
| `stock_ledger` | Audit trail; `reason='order'` deducts, `reason='refund'` restores |
| `inventory_reservations` | Shadow rows (`is_shadow=true`) since Phase 6C |

### KK identification

Session id **does not** start with `ebay%` or `amazon%` (Stripe `cs_*` sessions).

### Paid logic

| Condition | Meaning |
|-----------|---------|
| Order exists in `orders_raw` | Payment recorded via Stripe webhook |
| `refund_status IS NULL` or `<> 'full'` | Not fully refunded |
| `refund_status = 'partial'` | Still counted as paid-unshipped candidate; shadow release not implemented (documented gap) |

### Fulfillment / shipped logic

From `fulfillment_shipments.label_status`:

| Status | Cutover treatment |
|--------|-------------------|
| `pending`, `label_purchased` | **Paid unshipped** — reservation candidate |
| `shipped`, `delivered` | Fulfilled — no reservation needed |
| `cancelled`, `voided` | Excluded from candidates |

### Canceled / refunded

| Case | Behavior |
|------|----------|
| Full refund | Excluded from paid-unshipped; shadow should be `released` (Phase 6C) |
| Partial refund | Remains in candidates; `partial_refund_not_handled_by_shadow` in reconciliation |

### Variant resolution (SQL)

1. `line_items_raw.variant_id` when set  
2. Else `products.code = line.product_id` + `option_value` match on `line.variant`  
3. Else default variant (`is_default = true`) when no variant text  
4. Else `missing_variant`

---

## Shadow reconciliation results (live prod snapshot)

**Computed:** 2026-06-09 (immediately after migration apply)

| Metric | Count |
|--------|------:|
| Total KK order lines (all time in DB) | 188 |
| Matched (shadow + ledger + qty) | 0 |
| Mismatched | 188 |

### Mismatch breakdown

| `mismatch_reason` | Count | Interpretation |
|-------------------|------:|----------------|
| `no_ledger_no_shadow` | 92 | Legacy/test orders without stock ledger or shadow (often pre-stock-tracking or unmapped variant) |
| `missing_variant` | 63 | Cannot resolve variant — no cutover reservation possible until mapped |
| `ledger_without_shadow` | 30 | **Pre-Phase 6C orders** — stock deducted, no shadow row (expected until backfill) |
| `partial_refund_not_handled_by_shadow` | 3 | Known Phase 6C gap |

**Interpretation:** Shadow coverage is **0% on historical orders** because Phase 6C only writes shadow on **new checkouts after deploy**. Reconciliation will improve as new orders flow through. The 30 `ledger_without_shadow` lines are the primary pre-cutover backfill concern among fulfilled/paid history.

---

## Paid / unshipped candidate audit (live prod)

| Metric | Value |
|--------|------:|
| Paid/unshipped **lines** | 8 |
| Paid/unshipped **orders** | 3 |
| Paid/unshipped **units** | 8 |
| Promote existing shadow | 0 |
| Insert active + backfill stock | 8 |
| Missing variant (candidates) | 0 |

All 8 current paid-unshipped lines need **`insert_active_reservation_and_backfill_stock`** — no shadow rows exist yet for these orders.

---

## Backfill dry-run math

### Model

| Concept | Legacy (today) | Future (after cutover) |
|---------|----------------|------------------------|
| On payment | `stock -= qty` (sellable) | `reservation += qty` (physical unchanged) |
| On ship | (no stock change today) | `stock -= qty`, `reservation finalized/released` |
| Available | ≈ current `stock` | `on_hand - reserved` |

### Cutover transform (per variant)

For each paid-unshipped unit already deducted from `product_variants.stock`:

```
proposed_on_hand_after_backfill = current_stock + paid_unshipped_qty
proposed_active_reserved        = paid_unshipped_qty
proposed_available              = proposed_on_hand - proposed_active = current_stock
```

**Available stays the same** for operators if backfill + active reservations are applied together.

### Live dry-run totals

| Metric | Value |
|--------|------:|
| Variants with paid-unshipped qty | 8 |
| Total backfill units (`+stock`) | 8 |
| Total stock increase | +8 across 8 variants |
| Risk flag | `shadow_candidate_qty_mismatch` on all 8 (shadow=0, candidates=1 each — expected pre-new-checkout) |

Example variant rows:

| Variant | Current stock | +Backfill | Proposed on_hand |
|---------|--------------:|----------:|-----------------:|
| Blue | 1 | 1 | 2 |
| 55cm | 0 | 1 | 1 |
| Black | 2 | 1 | 3 |
| … | … | … | … |

**No backfill executed** — dry-run view only.

---

## Recommended promotion strategy (Phase 6D)

**Recommend hybrid A + B:**

### A. Promote existing shadow rows (preferred when present)

For lines where Phase 6C created shadow reservations:

```sql
UPDATE inventory_reservations
SET is_shadow = false, updated_at = now()
WHERE channel = 'kk'
  AND is_shadow = true
  AND status = 'reserved'
  AND order_id = :session_id
  AND order_item_id = :line_item_id;
```

- Keeps same `idempotency_key` (`kk:{session}:{line}:reserve`)
- Preserves audit trail in one row
- Official KPIs begin counting these rows once `is_shadow=false`

### B. Insert active rows for pre-6C paid-unshipped (required today)

For `ledger_without_shadow` / `insert_active_reservation_and_backfill_stock` candidates:

```sql
INSERT INTO inventory_reservations (..., is_shadow = false, status = 'reserved',
  idempotency_key = 'kk:' || session_id || ':' || line_item_id || ':reserve')
ON CONFLICT (idempotency_key) DO NOTHING;
```

Plus stock backfill:

```sql
-- Per variant, dry-run qty from v_inventory_kk_cutover_backfill_dry_run
UPDATE product_variants SET stock = stock + :paid_unshipped_qty WHERE id = :variant_id;
INSERT INTO stock_ledger (change = +qty, reason = 'manual_adjustment' or new reason 'cutover_backfill', ...);
```

**Why not promote-only:** Current prod has **0 shadow rows** and **8 paid-unshipped lines with ledger deduct** — cutover must insert active reservations + backfill for these.

**Avoid duplicates:** Use same `idempotency_key` namespace; never insert active if shadow `reserved` row exists (promote instead).

---

## Feature flag / cutover control (design)

### Recommended: `inventory_cutover_settings.kk_reservation_mode`

| Mode | Stripe checkout | Stock on payment | Reservations |
|------|-----------------|------------------|--------------|
| `legacy_direct_deduct` | Pre-6C | Direct deduct | None |
| `shadow` | **Current** | Direct deduct | Shadow (`is_shadow=true`, excluded from KPIs) |
| `reserve_only` | Phase 6D target | **No deduct** | Active (`is_shadow=false`) |

### Webhook read pattern (Phase 6D — not implemented yet)

```typescript
const { data: settings } = await supabase.from("inventory_cutover_settings").select("kk_reservation_mode").eq("id", 1).single();
const mode = settings?.kk_reservation_mode ?? "shadow";

if (mode === "reserve_only") {
  // insert/update active reservation only; skip stock decrement
} else if (mode === "shadow") {
  // current behavior: deduct + shadow insert
} else {
  // legacy: deduct only
}
```

### Alternative fallbacks

- Env var `KK_INVENTORY_RESERVATION_MODE` as override for edge function deploy
- Admin UI toggle later — settings table already exists

**Phase 6D-Prep:** table seeded to `shadow`; webhook **does not read it**.

---

## Rollback plan (Phase 6D)

If cutover causes incorrect available/on_hand:

1. **Set mode back to `shadow` or `legacy_direct_deduct`** in `inventory_cutover_settings` (immediate webhook effect once wired).
2. **Identify cutover reservations:**
   ```sql
   SELECT * FROM inventory_reservations
   WHERE channel = 'kk' AND is_shadow = false AND status = 'reserved'
     AND created_at >= :cutover_started_at;
   ```
3. **Release active reservations** → `status = 'canceled'` or `'released'` with note `rollback_6d`.
4. **Reverse stock backfill** using ledger entries tagged `cutover_backfill` (Phase 6D should use dedicated ledger reason).
5. **Re-enable direct deduct** only for **new** checkouts if mode=`legacy_direct_deduct`; do not double-deduct existing reserved orders.
6. **Validate:** `v_inventory_cutover_readiness_summary`, variant stock vs ledger sum, official KPI reserved ≈ 0 after rollback.

**Critical:** Rollback must use **idempotency** and ledger-tagged backfill reversals — never blind `UPDATE stock` without audit rows.

---

## Safe to proceed?

**`safe_to_proceed_hint = false`** (live prod advisory)

Reasons:

- 30 historical `ledger_without_shadow` lines need backfill plan
- 63 `missing_variant` lines block reservation until mapped
- 0 shadow matches (expected until new post-6C orders accumulate)
- 8 paid-unshipped units need insert+backfill path validated in staging first

**Proceed to Phase 6D only after:**

1. At least one new post-6C checkout shows `match` in reconciliation  
2. Paid-unshipped candidate list reviewed manually (3 orders)  
3. Staging dry-run of backfill + mode flip tested  
4. Rollback script/RPC drafted  

---

## Recommended Phase 6D implementation slice

1. **RPC `execute_kk_cutover_backfill`** (admin-only, idempotent) — reads `v_inventory_kk_cutover_backfill_dry_run`, applies stock + active reservations for paid-unshipped candidates  
2. **Promote shadow** for any lines with `promote_shadow_at_cutover`  
3. **Wire webhook** to read `inventory_cutover_settings`; flip to `reserve_only`  
4. **Stop direct deduct** when `reserve_only` (keep dedup guards)  
5. **Update official views** — already count `is_shadow=false` only (no view change needed)  
6. **Verification** — reconciliation match rate, available unchanged at cutover instant, new checkout creates active reservation only  

---

## Verification

**Script:** `scripts/verify-inventory-phase6d-prep-cutover-readiness.mjs` — **PASS**

- All new views load  
- `inventory_cutover_settings` mode = `shadow`  
- Webhook does not reference settings table  
- Stock totals unchanged  
- Inventory page loads cleanly  

---

## Query cheat sheet

```sql
-- One-row readiness snapshot
SELECT * FROM v_inventory_cutover_readiness_summary;

-- Paid/unshipped cutover targets
SELECT * FROM v_inventory_kk_paid_unshipped_reservation_candidates;

-- Variant backfill dry-run
SELECT * FROM v_inventory_kk_cutover_backfill_dry_run WHERE paid_unshipped_qty > 0;

-- Reconciliation mismatches
SELECT mismatch_reason, COUNT(*) FROM v_inventory_shadow_reservation_reconciliation
GROUP BY 1 ORDER BY 2 DESC;
```

---

## Validation phase (6D-Validation)

See [011_phase_6d_validation_shadow_checkout.md](./011_phase_6d_validation_shadow_checkout.md).

Readiness view now reports:

- `post_6c_matched_lines` — requires ≥ 1 before cutover
- `active_cutover_blocker_count` — paid/unshipped blockers only
- `historical_warning_count` — informational (does not alone block cutover)
- `requires_post_6c_checkout_validation` — true until manual checkout proven


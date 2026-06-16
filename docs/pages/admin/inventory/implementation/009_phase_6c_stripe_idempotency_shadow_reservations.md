# Phase 6C — Stripe Idempotency + KK Shadow Reservations (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 6B (reservation schema + read views)  
**Page:** `pages/admin/inventory.html` (dashboard unchanged; shadow excluded from official KPIs)

---

## Summary

Phase 6C adds **idempotent guards** for Stripe webhook stock mutations and **KK shadow reservation rows** written in parallel with existing checkout deduct / full-refund restore. **Stock behavior on first processing is unchanged** — `product_variants.stock` still deducts at payment and restores on full refund. Official Inventory KPIs **exclude shadow reservations** to avoid double-counting while direct deduct remains active.

---

## Stripe webhook audit (pre-change)

**File:** `supabase/functions/stripe-webhook/index.ts`

| Area | Behavior |
|------|----------|
| **Events handled** | `checkout.session.completed` (order + stock), `charge.refunded` (refund + stock restore) |
| **Order write** | Upsert `orders_raw` → ensure `fulfillment_shipments` → upsert `line_items_raw` |
| **Stock deduct** | §2.5 loop over checkout line items; variant via `variant_id` metadata then SKU + `option_value` fallback |
| **Stock restore** | Full refund only (`amount_refunded >= amount`); same variant resolution from `line_items_raw` |
| **Ledger** | `stock_ledger` insert with `reason=order|refund`, `reference_id=kk_order_id\|sessionId` |
| **Metadata** | `kk_variant_id`, `kk_product_id`, `kk_variant`, `kk_order_id` from Stripe product/session metadata |
| **Pre-6C gap** | No dedup — webhook retries could double-deduct or double-restore |

**Assumptions documented:**

- KK reservations use **`stripe_checkout_session_id` as `order_id`** (stable join key; `kk_order_id` stored on `orders_raw` only).
- Shadow reservations require **resolved variant** (same rules as stock); no guess when variant cannot be resolved.
- **Partial refunds** do not release shadow reservations (matches stock behavior).
- **No historical backfill** — only new checkouts/refunds after deploy get shadow rows / dedup.

---

## Migration / tables

**File:** `supabase/migrations/20260829_inventory_phase6c_stripe_idempotency_shadow.sql`

### `inventory_event_dedup`

| Column | Purpose |
|--------|---------|
| `stripe_event_id` + `action_type` | Unique guard (one stock mutation per event) |
| `reference_id` | Session id for debugging |
| `metadata` | Optional JSON |

**Action types guarded:**

| action_type | When |
|-------------|------|
| `checkout_stock_deduct` | Before checkout stock decrement + ledger inserts |
| `refund_stock_restore` | Before full-refund stock restore + ledger inserts |

Non-stock webhook work (orders upsert, SMS, promotions, push) is **not** dedup-guarded.

### `inventory_reservations.is_shadow`

- `boolean NOT NULL DEFAULT false`
- Phase 6C KK rows: `is_shadow = true`, `status = reserved`
- Official views filter `COALESCE(is_shadow, false) = false`

### Views updated

| View | Change |
|------|--------|
| `v_inventory_kpis` | Official `reserved_units` excludes shadow |
| `v_inventory_workspace` | Official `reserved` / `available` exclude shadow |

### Views added

| View | Purpose |
|------|---------|
| `v_inventory_shadow_reservation_audit` | Row-level shadow audit with product labels |
| `v_inventory_shadow_kpis` | Aggregate shadow reserved/released counts |

---

## Idempotency strategy

1. **Claim dedup slot** — `INSERT INTO inventory_event_dedup (stripe_event_id, action_type, …)`
2. **Unique violation (23505)** → skip stock mutation + ledger for that action
3. **First claim** → run existing stock logic unchanged

Shadow reservations use **separate idempotency**:

- Key: `kk:{sessionId}:{stripe_line_item_id}:reserve`
- Unique index on `inventory_reservations.idempotency_key`
- Attempted on every checkout delivery; duplicates no-op

---

## Shadow reservation behavior

On `checkout.session.completed`, after variant resolution (same as stock):

```
channel = kk
order_id = stripe_checkout_session_id
order_item_id = stripe_line_item_id
variant_id / product_id = resolved variant
quantity = line quantity
status = reserved
is_shadow = true
idempotency_key = kk:{sessionId}:{lineItemId}:reserve
notes = Shadow reservation recorded while Stripe webhook still deducts stock directly
```

- **No shadow row** when variant cannot be resolved (unmapped line remains in `v_inventory_unmapped_order_lines`).
- **Stock still decrements** on first dedup claim (unchanged).

---

## Refund behavior (shadow)

On **full refund** (`charge.refunded`, `isFullRefund`):

1. Stock restore guarded by `refund_stock_restore` dedup (unchanged restore logic on first claim)
2. Shadow release: `UPDATE inventory_reservations SET status='released' WHERE channel='kk' AND order_id=sessionId AND is_shadow=true AND status='reserved'`
3. Idempotent on replay (already-released rows not matched)

**Partial refunds:** no shadow release (future work if line-level refund qty becomes reliable).

---

## Dashboard impact

| Metric | Phase 6C behavior |
|--------|-------------------|
| **Official reserved** | Excludes `is_shadow=true` — **no double-count** while stock still deducts at payment |
| **Official available** | `on_hand − official_reserved` — unchanged semantics for operators |
| **Shadow audit** | Query `v_inventory_shadow_kpis` / `v_inventory_shadow_reservation_audit` |

Example semantic mismatch (expected until 6D):

- `product_variants.stock` already reduced by payment
- Shadow rows show what **would** be reserved under the future model
- Comparing shadow totals to ledger `reason=order` helps plan cutover

**No Inventory JS changes required** — official views already exclude shadow.

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260829_inventory_phase6c_stripe_idempotency_shadow.sql` | Dedup table, `is_shadow`, views |
| `supabase/functions/_shared/stripeWebhookInventory.ts` | **New** — dedup, shadow reserve/release helpers |
| `supabase/functions/stripe-webhook/index.ts` | Idempotency + shadow integration |
| `scripts/verify-inventory-phase6c-stripe-shadow.mjs` | Verification |

---

## Known limitations

1. **Event-level dedup** — if first attempt crashes mid-loop, retry skips entire stock block (shadow lines still idempotent per line).
2. **No historical backfill** — pre-deploy orders have no shadow rows.
3. **Partial refund shadow release** — not implemented.
4. **Live Stripe replay** — verify script tests DB constraints + view exclusion; full webhook replay needs Stripe CLI.
5. **Edge function deploy** — must deploy `stripe-webhook` after migration for production behavior.

---

## Verification

**Script:** `scripts/verify-inventory-phase6c-stripe-shadow.mjs`

Verified:

- Migration objects exist (`inventory_event_dedup`, `is_shadow`)
- Dedup unique constraint blocks duplicate `(stripe_event_id, action_type)`
- Shadow reservation idempotency_key blocks duplicate insert
- Official KPI `reserved_units` / `available_units` unchanged when shadow row inserted
- `v_inventory_shadow_kpis` counts shadow rows
- `v_inventory_shadow_reservation_audit` loads
- Webhook imports dedup + shadow helpers
- Inventory page loads with zero console errors

**Manual (recommended):** Stripe CLI replay `checkout.session.completed` twice — stock and ledger should change once; shadow row once.

---

**Prerequisite for cutover:** Complete manual checklist in [009](./009_phase_6c_stripe_idempotency_shadow_reservations.md) / [011](./011_phase_6d_validation_shadow_checkout.md) — at least one post-6C matched checkout.

---

## Deploy checklist

```bash
npx supabase db query --linked -f supabase/migrations/20260829_inventory_phase6c_stripe_idempotency_shadow.sql
npx supabase functions deploy stripe-webhook
node scripts/verify-inventory-phase6c-stripe-shadow.mjs
```

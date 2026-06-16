# Phase 6E — Fulfillment Finalize + Reservation Release Semantics (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 6D Execute (`kk_reservation_mode = reserve_only`)  
**Next:** Phase 7 — channel quantity sync (or partial refund line-level release)

---

## Summary

Implemented **KK reservation finalization on shipment**: when a reserved order ships, reservations move `reserved → finalized` and `product_variants.stock` decrements exactly once. Refund semantics for pre/post finalize unchanged from Phase 6D (release reserved only; no auto-restock after ship).

---

## Fulfillment flow audit

### Where shipments are created

| Path | Creates `fulfillment_shipments` | Initial `label_status` |
|------|--------------------------------|------------------------|
| `stripe-webhook` checkout | Upsert (ignore duplicates) | `pending` |
| `shippo-create-label` | Upsert on label purchase | `label_purchased` |
| `shippo-webhook` track_updated | Update by tracking number | `shipped` / `delivered` |
| Admin workspace save | `upsertFulfillmentShipment` | manual |
| eBay/Amazon sync | Separate paths | varies |

### Fulfillment model

- **Per-order** — one `fulfillment_shipments` row per `stripe_checkout_session_id`
- **Not per-line** — reservations are per line item; finalize RPC finalizes **all** active KK reservations for the order session
- **Partial shipments** — not implemented; multi-package orders would finalize all reserved lines on first ship event (documented risk)

### `label_status` values (KK / Shippo)

| Status | Meaning | Finalize? |
|--------|---------|-----------|
| `pending` | Paid, no label | No |
| `label_purchased` | Label bought, not scanned | **No** (voidable) |
| `shipped` | In transit (Shippo `TRANSIT`) | **Yes** |
| `delivered` | Delivered (catch-up if missed) | **Yes** (idempotent) |
| `voided` | Label voided | No |
| `cancelled` | Cancelled | No |

### Reservation linkage

- `inventory_reservations.order_id` = Stripe `stripe_checkout_session_id` (`cs_live_*`)
- `order_item_id` = Stripe line item id
- Cutover + checkout use idempotency `kk:{order_id}:{order_item_id}:reserve`

### Event repeat safety

- Shippo `track_updated` can repeat; finalize RPC uses ledger idempotency `finalize:kk:{order_id}:{order_item_id}:{reference_id}`
- Re-run returns `skipped_already_finalized`

---

## Finalization event chosen

**Primary:** Shippo webhook `track_updated` when:

- `tracking_status.status = TRANSIT` (first transition to in-transit)
- **Catch-up:** `DELIVERED` if not already finalized

**Secondary:** Admin order workspace save when `label_status` changes to `shipped` or `delivered` (KK sessions only).

**Not on:** `label_purchased`, void, checkout, reservation create.

---

## RPC: `finalize_kk_order_reservations`

```sql
SELECT public.finalize_kk_order_reservations(
  p_order_id,        -- stripe_checkout_session_id
  p_reference_id,    -- tracking number or session id
  p_source,          -- e.g. shippo_track_updated, admin_fulfillment
  p_reservation_id   -- optional single row
);
```

### Behavior

1. Skip eBay/Amazon session prefixes
2. Lock each `inventory_reservations` row: `channel=kk`, `is_shadow=false`, `status=reserved`
3. Decrement `product_variants.stock` by `quantity`
4. Insert `stock_ledger`: `reason=order_finalized`, `source=fulfillment`
5. Set reservation `status=finalized`, `finalize_ledger_id`

### Returns

`finalized_count`, `finalized_units`, `skipped_already_finalized`, `missing_reservations`, `affected_variants`

### Auth

Admin (`is_admin()`) or service role (Edge Functions / direct DB).

---

## Stock / ledger / reservation changes

| Stage | On-hand | Reserved | Available |
|-------|--------:|---------:|----------:|
| Paid (reserve_only) | unchanged | +qty | −qty |
| Shipped (finalize) | −qty | −qty | unchanged |

Example: on_hand 10, reserved 2, available 8 → after ship: on_hand 8, reserved 0, available 8.

---

## Refund / cancel semantics (reserve_only)

| Scenario | Behavior |
|----------|----------|
| Full refund **before** finalize | `releaseKkActiveReservations` — status `reserved` only; **no stock restore** |
| Full refund **after** finalize | Finalized rows **not** released; **no auto stock restore** (future return/restock flow) |
| Partial refund | Unchanged — future work |
| Void label before ship | No finalize; reservation stays `reserved` |

Verified: `releaseKkActiveReservations` filters `.eq("status", "reserved")`.

---

## Files created / changed

| File | Change |
|------|--------|
| `supabase/migrations/20260902_inventory_phase6e_fulfillment_finalize.sql` | RPC + audit view + ledger label |
| `supabase/functions/_shared/finalizeKkReservations.ts` | **Created** |
| `supabase/functions/shippo-webhook/index.ts` | Finalize on TRANSIT/DELIVERED |
| `js/admin/lineItemsOrders/api.js` | `finalizeKkOrderReservations` RPC wrapper |
| `js/admin/lineItemsOrders/workspace.js` | Finalize on manual shipped/delivered save |
| `scripts/verify-inventory-phase6e-fulfillment-finalize.mjs` | **Created** |

**Not changed:** eBay/Amazon sync, parcel receive, CPI, channel sync, manual adjust, Products stock edit.

---

## Views

| View | Update |
|------|--------|
| `v_inventory_reservation_audit` | **New** — reservation + fulfillment cross-ref |
| `v_inventory_ledger_recent` | `order_finalized` → source label "Fulfillment" |
| `v_inventory_kpis` / `v_inventory_workspace` | No change — already use active reserved |

---

## Verification

```bash
node scripts/verify-inventory-phase6e-fulfillment-finalize.mjs
```

**Result:** PASS — ephemeral reservation finalize, idempotent re-run, KPI math, page load, code paths.

**Deployed:** `npx supabase functions deploy shippo-webhook`

---

## Rollback notes

- No rollback RPC added (cutover rollback exists from 6D)
- To undo a mistaken finalize: manual stock adjust + reservation status fix (no automated un-finalize)
- Prefer void label **before** TRANSIT to avoid finalize

---

## Risks / unknowns

1. **Partial shipments** — first ship finalizes all line reservations for the order
2. **Manual shipped without tracking** — admin save path finalizes; ensure status is accurate
3. **Amazon auto-shipped path** — Amazon sessions skipped (no KK reservations)
4. **Returns after delivery** — no automatic restock; Phase 7+ or dedicated returns flow

---

## Recommended next phase

**Phase 7 — Channel quantity sync** (eBay/Amazon qty from `available`), or **partial refund / returns restock** if operations need it sooner.

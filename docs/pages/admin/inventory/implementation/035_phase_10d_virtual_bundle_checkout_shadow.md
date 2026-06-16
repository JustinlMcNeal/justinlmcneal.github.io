# Phase 10D — Virtual Bundle Checkout Shadow Hook (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 10C (simulation + shadow events)  
**Next:** Phase 10E — live Model B cutover

---

## Summary

Added a **checkout/fulfillment shadow hook** that logs what virtual bundle component reservation/finalization *would* do on real paid orders — without changing inventory, reservations, ledger, storefront availability, or channel sync.

Operators can enable **shadow mode** globally or per-bundle from the Bundle Preview modal. When shadow mode is active and a paid order includes a variant with active bundle rules, the Stripe webhook records `reservation_shadow` events. Shippo fulfillment finalization optionally records `finalize_shadow` events.

**Live mode remains blocked** in UI and admin RPCs for Phase 10D.

---

## Mode behavior

| Mode | Checkout shadow | Admin simulation save | Live deduction |
|------|-----------------|----------------------|----------------|
| `preview_only` (default) | No | Yes (manual) | No |
| `shadow` | Yes (idempotent log) | Yes | No |
| `live` | N/A in 10D | Blocked by 10C admin RPC | **Not implemented** |

**Effective shadow mode** = global `shadow` OR (per-bundle `shadow` + `is_virtual_enabled`).

Admin RPCs `update_inventory_bundle_global_mode` and `update_inventory_bundle_variant_mode` accept only `preview_only` and `shadow`.

---

## Hook point chosen

**Primary:** `checkout.session.completed` in `supabase/functions/stripe-webhook/index.ts` — after existing inventory/reservation logic (section 2.6). Reflects **paid order activity** with persisted `line_items_raw` rows.

**Secondary (optional):** `shippo-webhook` after `finalizeKkOrderReservations` — records `finalize_shadow` per order line when tracking triggers KK finalization. Does not alter finalization RPC behavior.

Both hooks are **non-fatal** — failures log only; checkout/webhook/fulfillment still succeed.

---

## Idempotency behavior

| Event | Idempotency key pattern |
|-------|-------------------------|
| Reservation shadow | `bundle_shadow:reservation:{session_id}:{line_item_id}` |
| Finalize shadow | `bundle_shadow:finalize:{order_id}:{line_item_id}:{reference_id}` |

RPC `try_record_inventory_bundle_shadow_event`:

1. Returns `{ inserted: false, reason: 'duplicate' }` if key exists
2. Skips if effective mode ≠ `shadow` or no active rules
3. Runs `simulate_virtual_bundle_order` internally
4. Inserts shadow event with `metadata.no_inventory_side_effects = true`

Webhook retries do not duplicate shadow rows.

---

## Shadow event schema / metadata

**New columns on `inventory_bundle_shadow_events`:**

| Column | Purpose |
|--------|---------|
| `idempotency_key` | Unique dedup (nullable for manual admin saves) |
| `metadata` | Hook context jsonb |

**Metadata examples:**

```json
{
  "hook": "stripe_checkout_completed",
  "kk_order_id": "KK-1234",
  "no_inventory_side_effects": true,
  "effective_mode": "shadow",
  "hook_phase": "10d"
}
```

**View:** `v_inventory_bundle_shadow_events_recent` for admin UI.

---

## UI behavior

### Bundle Preview modal

- **Global virtual bundle mode** select: Preview only / Shadow (live disabled)
- Per-bundle mode select on configured bundle cards
- **Recent shadow events** list with filter: All / Simulation / Reservation shadow / Finalize shadow
- Cutover readiness shows: effective mode, shadow active, event count, last event date

---

## Verification

```bash
node scripts/verify-inventory-phase10d-virtual-bundle-checkout-shadow.mjs
```

**Result:** PASS

- Default global mode `preview_only`; live blocked in RPC + UI
- Shadow events insert only when effective mode is `shadow`
- Idempotency prevents duplicate on webhook retry
- No stock / ledger / reservation mutations
- Stripe checkout + Shippo finalize hooks present
- Recent shadow events UI + mode controls wired

**Linked DB at verify:** shadow events **0** (ephemeral test cleaned up)

**Shadow example (test):** `inserted: true`, simulation `can_fulfill_virtual`

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260923_inventory_phase10d_checkout_shadow.sql` | Idempotency, mode RPCs, try_record RPC, views |
| `supabase/functions/_shared/bundleCheckoutShadow.ts` | Webhook helpers |
| `js/admin/inventory/ui/bundleModeControls.js` | Global/per-bundle mode UI |
| `js/admin/inventory/ui/bundleShadowEventsPanel.js` | Recent events viewer |
| `scripts/verify-inventory-phase10d-virtual-bundle-checkout-shadow.mjs` | Verification |
| `docs/pages/admin/inventory/implementation/035_phase_10d_virtual_bundle_checkout_shadow.md` | This doc |

| Changed | |
|---------|--|
| `supabase/functions/stripe-webhook/index.ts` | Checkout shadow hook |
| `supabase/functions/shippo-webhook/index.ts` | Finalize shadow hook |
| `js/admin/inventory/api/bundleShadowApi.js` | Mode + events API |
| `js/admin/inventory/ui/bundlePreviewModal.js` | Wire mode + events |
| `js/admin/inventory/ui/bundlePreviewSummary.js` | Per-bundle mode select |
| `js/admin/inventory/ui/bundleSimulationPanel.js` | Readiness shadow stats |

---

## What remains not live

- Live component reservation on checkout
- Live component finalization / stock decrement
- Virtual availability in storefront / channel sync
- Returns/restock bundle logic
- Parcel/CPI/manual adjustment bundle handling
- Live mode UI and cutover execution

---

## Limitations

- Shadow hook requires global or per-bundle shadow mode — default preview_only logs nothing from checkout
- `line_items_raw.variant_id` must be populated for bundle detection (same as reservation path)
- Finalize shadow runs on Shippo tracking finalization path only (not manual finalize assist yet)
- Mode changes require admin Supabase session

---

**Next:** Phase 10F — live Model B wiring. See [036](./036_phase_10e_virtual_bundle_live_readiness.md).

## Recommended Phase 10F

1. Admin UI acknowledgment for independent stock + live readiness checklist
2. Explicit **live** mode enablement (global + per-bundle) with hard guards
3. Wire Model B into `upsertKkReservation` / `finalize_kk_order_reservations` for component lines
4. Virtual availability in `v_kk_variant_available_stock` when live
5. Channel sync policy for virtual bundles
6. Finalize shadow on manual finalize assist path for parity

Stop after Phase 10D.

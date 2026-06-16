# Phase 6D Execute — KK Reserve-Only Cutover (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 6D-Validation (post-6C checkout `KKO-314754` matched)  
**Next:** Phase 6E — fulfillment finalize + reservation release semantics — **Complete:** [014](./014_phase_6e_fulfillment_finalize.md)

---

## Summary

Executed KK reservation cutover on linked Supabase (`yxdzvzscufkvewecvagq`):

- Promoted **1** shadow reservation → active (`KKO-314754`, 2 units)
- Inserted **8** active reservations for pre-6C paid/unshipped lines
- Backfilled **+8** units to `product_variants.stock` (pre-6C legacy deduct recovery)
- Flipped `kk_reservation_mode`: **`shadow` → `reserve_only`**
- Deployed `stripe-webhook` to read cutover mode (new checkouts reserve only; no stock decrement)

---

## Preflight values (before execute)

| Metric | Value |
|--------|------:|
| `safe_to_proceed_hint` | true |
| `active_cutover_blocker_count` | 0 |
| `post_6c_matched_lines` | 1 |
| `paid_unshipped_line_count` | 9 |
| `paid_unshipped_unit_total` | 10 |
| `promote_shadow_lines` | 1 |
| `insert_and_backfill_lines` | 8 |
| `total_backfill_units` (dry-run) | 10 |
| `current_mode` | shadow |

Validated checkout reference:

- Event `evt_1TgV95LzNgqX2t8KY5OT8t9y`
- Session `cs_live_a1EB9X5eaXtzxsAhU8XuQUSJziXneEwV1WRvzlLhO7nYZjygIV4doGAa40`
- Order `KKO-314754`

---

## Cutover RPC results

```json
{
  "promoted_shadow_count": 1,
  "inserted_active_reservation_count": 8,
  "backfilled_variant_count": 8,
  "backfilled_units": 8,
  "skipped_existing_count": 0,
  "mode_before": "shadow",
  "mode_after": "reserve_only",
  "already_executed": false
}
```

Re-run returns `already_executed: true` — no duplicate reservations or backfill.

---

## Dashboard before / after

| KPI | Before cutover | After cutover |
|-----|---------------:|--------------:|
| On-hand (`product_variants.stock`) | 669 | 677 |
| Official reserved | 0 | 10 |
| Available (`on_hand - reserved`) | 669 | 667 |

**Available −2 vs pre-cutover:** Expected. Post-6C order (`KKO-314754`) had stock already deducted and a shadow reservation excluded from official reserved. After promote, those **2 units** count in reserved KPI without backfill (stock already reflected deduct).

Pre-6C lines: backfill **+8** on-hand + **8** reserved → net available unchanged per line.

---

## Files created / changed

| File | Change |
|------|--------|
| `supabase/migrations/20260901_inventory_phase6d_execute_cutover.sql` | **Created** — cutover + rollback RPCs |
| `supabase/functions/_shared/stripeWebhookInventory.ts` | **Updated** — mode read, active reserve, refund release |
| `supabase/functions/stripe-webhook/index.ts` | **Updated** — mode-aware checkout/refund |
| `scripts/verify-inventory-phase6d-reserve-only-cutover.mjs` | **Created** |

---

## Migration / RPC details

### `execute_kk_reservation_cutover()`

- Admin or service-role (direct DB) only
- Requires `kk_reservation_mode = 'shadow'` and `safe_to_proceed_hint = true`
- Promotes shadow → active for paid/unshipped candidates
- Inserts active reservations for pre-6C lines (idempotency `kk:{session}:{line}:reserve`)
- Backfill ledger: `reason=cutover_backfill`, `source=inventory_cutover`, idempotency `cutover_backfill:kk:{session}:{line}`
- Sets `kk_reservation_mode = 'reserve_only'`, `cutover_executed_at = now()`
- Idempotent: if already `reserve_only`, returns without mutation

### `rollback_kk_reservation_cutover()`

- Requires `kk_reservation_mode = 'reserve_only'`
- Cancels cutover-tagged active reservations
- Reverses `cutover_backfill` ledger rows (idempotent `rollback:cutover_backfill:...`)
- Sets mode back to `shadow`
- **Not executed in this phase** — emergency use only

---

## Webhook behavior by mode

| Mode | Checkout | Full refund |
|------|----------|-------------|
| `legacy_direct_deduct` | Decrement stock + order ledger | Restore stock |
| `shadow` | Decrement stock + shadow reservation | Restore stock + release shadow |
| **`reserve_only`** | **Active reservation only** (dedup `checkout_reserve`) | **Release active reservation, no stock restore** |

Webhook reads `inventory_cutover_settings.kk_reservation_mode` on each event.

Deployed: `npx supabase functions deploy stripe-webhook` (2026-06-09).

---

## Verification

```bash
node scripts/verify-inventory-phase6d-reserve-only-cutover.mjs
```

**Result:** PASS

- Mode `reserve_only`
- 9 active reservation rows / 10 units
- 0 shadow reserved
- 8 cutover backfill ledger rows
- Re-run RPC idempotent
- Inventory page loads
- Webhook code paths verified

**Manual follow-up:** Place one live test checkout post-deploy to confirm reserve-only path (active reservation, no `stock_ledger reason='order'`).

---

## Rollback plan

If cutover must be reversed:

```sql
SELECT public.rollback_kk_reservation_cutover();
```

Then redeploy prior webhook or set mode manually after review.

Rollback does **not** restore legacy direct-deduct semantics for new checkouts until webhook/mode reviewed.

---

## Out of scope (unchanged)

- Fulfillment finalize (Phase 6E)
- Partial refund line-level release
- eBay/Amazon/parcel/CPI/channel sync
- Products admin stock edit refactor
- Bundle/component deduction

---

## Recommended next phase

**Phase 6E — Fulfillment finalize:** On ship, transition `inventory_reservations` from `reserved` → `finalized` and decrement on-hand (or equivalent finalize ledger). Pair with refund/cancel rules for shipped vs unshipped.

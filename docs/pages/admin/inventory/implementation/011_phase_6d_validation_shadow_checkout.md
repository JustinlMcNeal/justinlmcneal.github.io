# Phase 6D-Validation — Shadow Checkout Validation + Cutover Readiness Cleanup (Complete)

**Status:** Complete — validation passed; Phase 6D execute completed ([013](./013_phase_6d_kk_reserve_only_cutover.md))  
**Date:** 2026-06-09  
**Prerequisite:** Phase 6D-Prep  
**Next:** Phase 6E — fulfillment finalize

---

## Summary

This phase adds a **validation checklist**, sharpens readiness views to separate **historical warnings** from **active blockers**, and documents manual steps to prove Phase 6C shadow flow before cutover. **No cutover, stock backfill, mode flip, or webhook changes.**

---

## Current readiness (live prod snapshot)

| Metric | Value |
|--------|------:|
| `kk_reservation_mode` | `shadow` |
| `shadow_mode_started_at` | 2026-06-09 UTC |
| `post_6c_matched_lines` | **0** |
| `requires_post_6c_checkout_validation` | **true** |
| `active_cutover_blocker_count` | **0** |
| `historical_warning_count` | 180 |
| `safe_to_proceed_hint` | **false** |
| Paid/unshipped candidates | 8 lines, 3 orders, 8 units |
| Dry-run backfill | +8 units |
| Shadow rows | 0 |
| Official KPI reserved | 0 |

### Why cutover is not safe yet

1. **No post-6C checkout validated** — `post_6c_matched_lines = 0`; Phase 6C shadow + idempotency never proven on a real order.
2. **Mode still `shadow`** — direct stock deduct active (correct for this phase).
3. **8 pre-6C paid/unshipped lines** need insert+backfill at cutover (planned, not validated in staging).

**Not blocking alone:** 180 historical warnings (fulfilled/old orders, missing variant on shipped orders, etc.).

---

## Why `safe_to_proceed_hint` is false (updated logic)

The readiness view now requires **all** of:

- `post_6c_matched_lines >= 1` (validated shadow checkout)
- `active_cutover_blocker_count = 0`
- `kk_reservation_mode = 'shadow'`

Historical `ledger_without_shadow` on **shipped** orders does **not** increment active blockers.

---

## Files created / changed

| File | Action |
|------|--------|
| `docs/pages/admin/inventory/implementation/011_phase_6d_validation_shadow_checkout.md` | **This doc** |
| `supabase/migrations/20260831_inventory_phase6d_validation_readiness.sql` | Readiness view cleanup |
| `scripts/verify-inventory-phase6d-validation-readiness.mjs` | Read-only verification |

### Migration additions

- `inventory_cutover_settings.shadow_mode_started_at`
- `v_inventory_cutover_active_blockers` — paid/unshipped blockers only
- `v_inventory_cutover_readiness_summary` — split historical vs active metrics

---

## Manual validation checklist — post-6C KK checkout

### A. Pick a safe test product

- Low unit cost, qty ≥ 2 in stock, **`variant_id` in Stripe metadata** (modern checkout path).
- Avoid multi-variant ambiguity; note `product_variants.id` and `product_variants.stock` before test.

### B. Record before values

Run and save outputs:

```sql
-- Variant stock
SELECT id, stock FROM product_variants WHERE id = :variant_id;

-- Recent ledger for variant
SELECT id, change, reason, reference_id, stock_before, stock_after, created_at
FROM stock_ledger
WHERE variant_id = :variant_id
ORDER BY created_at DESC LIMIT 5;

-- Reservations for variant
SELECT * FROM inventory_reservations
WHERE variant_id = :variant_id OR order_id = :expected_session_id;

SELECT * FROM v_inventory_kpis;
SELECT * FROM v_inventory_shadow_kpis;
SELECT post_6c_matched_lines, safe_to_proceed_hint
FROM v_inventory_cutover_readiness_summary;
```

### C. Run checkout

Complete one **real or Stripe test-mode** KK checkout for **quantity 1**.

Record:

- `stripe_checkout_session_id` (from Stripe dashboard or `orders_raw`)
- Stripe `checkout.session.completed` event id (for replay test)

### D. Confirm after checkout

| Check | Expected |
|-------|----------|
| `product_variants.stock` | Decreased by **1** (legacy behavior unchanged) |
| `stock_ledger` | **Exactly one** new row: `reason='order'`, `change=-1`, matching variant |
| `inventory_event_dedup` | One row: `action_type='checkout_stock_deduct'`, `stripe_event_id=<event id>` |
| `inventory_reservations` | **One** row: `channel='kk'`, `is_shadow=true`, `status='reserved'`, qty=1 |
| `idempotency_key` | `kk:{session_id}:{line_item_id}:reserve` |
| Official `v_inventory_kpis.reserved_units` | **Unchanged** (shadow excluded) |
| `v_inventory_shadow_kpis.shadow_reserved_units` | **+1** |
| Reconciliation | At least one row with `is_match=true` for this session |

### E. Replay idempotency test

Replay the same Stripe event (Stripe CLI or Dashboard resend):

| Check | Expected |
|-------|----------|
| Stock | **No second decrement** |
| `stock_ledger` | **No duplicate** order row |
| `inventory_reservations` | **No duplicate** (unique `idempotency_key`) |
| Dedup table | Still one `checkout_stock_deduct` row for event id |

### F. Optional full-refund test (separate order)

On a **dedicated test order**, issue full refund and confirm:

- Stock restored once (dedup `refund_stock_restore`)
- Shadow row → `status='released'`
- Replay does not double-restore

---

## Rollback for test checkout

If test order should be undone **before cutover**:

1. Issue **full refund** via Stripe admin (triggers existing webhook restore + shadow release).
2. Verify stock returned to pre-checkout level via `product_variants` + `stock_ledger`.
3. Delete test reservation row **only if** refund webhook failed (manual):
   ```sql
   -- Last resort — prefer refund webhook
   UPDATE inventory_reservations SET status='canceled', notes='test rollback'
   WHERE order_id = :session_id AND is_shadow = true;
   ```
4. Do **not** delete `inventory_event_dedup` rows (audit trail).

---

## Decision criteria — proceed to Phase 6D execute?

| Criterion | Required | Current |
|-----------|----------|---------|
| Post-6C matched checkout | ≥ 1 | **0 — BLOCKED** |
| Active cutover blockers | 0 | **0 — OK** |
| Mode | `shadow` | **OK** |
| Idempotency replay tested | Yes | **Not yet** |
| Paid/unshipped candidates reviewed | Yes | **OK (8 lines)** |
| Staging cutover dry-run | Recommended | Not done |

**Recommendation:** **Do not execute Phase 6D** until manual checklist §D–§E passes on at least one checkout.

---

## Active cutover candidates review (8 lines)

All **8 lines verified** — should become active reservations + stock backfill at cutover:

| Order | KKO | Lines | Paid | Fulfillment | Refund | variant_id | Action at 6D |
|-------|-----|------:|------|-------------|--------|------------|--------------|
| `cs_live_b1iD32smYyetIQY...` | KKO-824779 | 3 | ✓ | pending | none | ✓ all | insert + backfill |
| `cs_live_a1MVe4VhaGQU1Pg...` | KKO-533883 | 1 | ✓ | pending | none | ✓ | insert + backfill |
| `cs_live_b1Xn7BMCyCDhk7T...` | KKO-288136 | 4 | ✓ | pending | none | ✓ all | insert + backfill |

**Excluded:** None — all 8 lines qualify.

Details:

| Product | Variant | Qty | Stock deducted |
|---------|---------|----:|:--------------:|
| Sleek Silver Chain | 65cm | 1 | yes |
| Funny Heads or Tails Challenge Coin-Silver | Silver | 1 | yes |
| Starry Bear Keychain | Blue | 1 | yes |
| Sleek Silver Chain | 55cm | 1 | yes |
| Mini Croc Charms | Black | 1 | yes |
| Mini Croc Charms | Red | 1 | yes |
| People Pin | Default | 1 | yes |
| Titanium Steel Crocodile Chain Bracelet | Black | 1 | yes |

These 8 are also the entire `paid_unshipped_ledger_without_shadow` set (pre-6C, no shadow rows yet).

---

## Historical problem groups

### `ledger_without_shadow` (30 total)

| Subset | Count | Blocker? |
|--------|------:|:--------:|
| Paid/unshipped (cutover candidates) | **8** | No — handled by 6D insert+backfill |
| Historical (shipped/fulfilled/other) | **22** | **No** — informational only |

### `missing_variant` (63 total)

| Subset | Count | Blocker? |
|--------|------:|:--------:|
| Paid/unshipped active | **0** | — |
| Fulfilled/shipped/other | 63 | **No** for cutover (cannot reserve retroactively without mapping) |

**No guess mappings.** Lines stay in reconciliation as historical warnings.

### `partial_refund_not_handled_by_shadow` (3 total)

All **3 lines** on order `cs_live_b1c9XHfj0BG6fa0rmXMI3cgzvGw5hlwatciaG5VjK5bd7YSGbs5o6m1OSD`:

| Product | Fulfillment | Refund |
|---------|-------------|--------|
| Hello Kitty Jean Shoulder Bag | **delivered** | partial |
| Mini Tote - B!TCH#S IS WEIRD | **delivered** | partial |
| Mini Duffel - Hello Kitty Pink | **delivered** | partial |

**Not active cutover candidates** (already delivered). Document for **Phase 6E+** partial refund / shadow release policy. **Not active blockers.**

### `no_ledger_no_shadow` (92)

Legacy/test orders without stock tracking or variant resolution — **historical informational**.

---

## Post-6C checkout validation status

| Item | Status |
|------|--------|
| Operator reported manual checkout | **Yes** (2026-06-09) |
| Checkout visible in linked Supabase | **No — not found** |
| `post_6c_matched_lines` after validation | **0** (unchanged) |
| Matched shadow/ledger rows | **0** |
| Phase 6D execute recommended | **No** |

### Validation run — 2026-06-09 (read-only)

**Script:** `node scripts/verify-inventory-phase6d-validation-readiness.mjs` — PASS (script checks only; warns validation pending)

**Readiness summary (`v_inventory_cutover_readiness_summary`):**

| Field | Value |
|-------|------:|
| `post_6c_matched_lines` | 0 |
| `requires_post_6c_checkout_validation` | true |
| `active_cutover_blocker_count` | 0 |
| `safe_to_proceed_hint` | **false** |
| `shadow_reservation_rows` | 0 |
| `shadow_reserved_units` | 0 |

**Shadow KPIs (`v_inventory_shadow_kpis`):** 0 rows, 0 reserved units.

**Expected post-checkout artifacts — not found in linked project:**

| Artifact | Expected | Found |
|----------|----------|------:|
| New `orders_raw` KK row (order_date ≥ 2026-06-09) | 1 | **0** |
| New `stock_ledger` `reason='order'` (today) | 1 | **0** |
| `inventory_event_dedup` `checkout_stock_deduct` | 1 | **0** (table empty) |
| `inventory_reservations` `is_shadow=true` | 1 | **0** (table empty) |
| Official KPI `reserved_units` increase | 0 | **0** ✓ |
| Reconciliation `is_match=true` | ≥ 1 | **0** |

**Latest KK order in linked DB:** `KKO-824779` / `cs_live_b1iD32smYyetIQY...` on **2026-06-06** (pre-6C). Latest order ledger entries same date.

**Today's `stock_ledger` activity:** only `parcel_receive` and `manual_adjustment` — no order deductions.

**Conclusion:** The reported checkout did **not** reach the linked Supabase project (`yxdzvzscufkvewecvagq`), or the Stripe webhook did not process `checkout.session.completed` after Phase 6C deploy. Shadow validation **cannot pass** until a new order appears with the artifacts above.

**Troubleshooting before retry:**

1. Confirm payment in Stripe Dashboard → check `checkout.session.completed` delivery (200 vs 4xx/5xx).
2. Confirm webhook endpoint points at deployed `stripe-webhook` on this Supabase project.
3. Confirm `stripe-webhook` was deployed after Phase 6C (`upsertShadowReservation`, dedup).
4. After successful webhook, re-query:
   ```sql
   SELECT * FROM orders_raw ORDER BY order_date DESC LIMIT 3;
   SELECT * FROM inventory_reservations ORDER BY created_at DESC LIMIT 5;
   SELECT * FROM inventory_event_dedup ORDER BY created_at DESC LIMIT 5;
   SELECT post_6c_matched_lines, safe_to_proceed_hint
   FROM v_inventory_cutover_readiness_summary;
   ```
5. Optional: Stripe CLI resend event to verify idempotency (no duplicate deduct/reservation).

**Action required:** Complete a checkout whose webhook lands in linked prod, then re-run:

```bash
node scripts/verify-inventory-phase6d-validation-readiness.mjs
```

Expect `post_6c_matched_lines >= 1` and `safe_to_proceed_hint = true` before Phase 6D execute.

---

## Verification

**Script:** `scripts/verify-inventory-phase6d-validation-readiness.mjs` — **PASS**

- Mode = shadow, no webhook cutover wiring
- Stock/reservations unchanged by script
- Readiness views load
- Warns when post-6C validation pending

---

## Recommended Phase 6D execute slice (after validation)

1. Confirm `post_6c_matched_lines >= 1`
2. Run admin RPC: backfill + active reservations for 8 paid/unshipped lines
3. Wire webhook to `inventory_cutover_settings`; flip `reserve_only`
4. Verify new checkout: reservation only, no stock deduct
5. Keep rollback plan from [010](./010_phase_6d_prep_kk_cutover_readiness.md)

---

## Query cheat sheet

```sql
SELECT * FROM v_inventory_cutover_readiness_summary;
SELECT * FROM v_inventory_cutover_active_blockers;
SELECT * FROM v_inventory_shadow_reservation_reconciliation WHERE is_match;
SELECT * FROM v_inventory_kk_paid_unshipped_reservation_candidates;
```

# Phase 8F — Manual Finalize Assist for Mapped Shipped Lines (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 8E (shipped finalize audit)  
**Next:** Phase 8G — eBay safe mapping hints or bulk mapping assist

---

## Summary

Added **admin-confirmed, idempotent manual finalize** for individual mapped shipped/delivered order lines that lack inventory accounting signals. Decrements on-hand once, writes `order_finalized` ledger, optionally records a **finalized** (non-active) reservation. No channel API writes, no bulk automation.

---

## Eligibility rules

Manual finalize is available only when **all** are true (via `is_finalize_eligible` on audit view):

| Rule | Check |
|------|--------|
| Mapped | `variant_id` present |
| Quantity | `quantity > 0` |
| Shipped/delivered | In audit view (label shipped/delivered) |
| Not canceled | `order_status <> canceled` |
| Not fully refunded | `refund_status <> full` |
| Not AFN/FBA | `suggested_audit_status <> skipped_afn` |
| Needs audit | `needs_audit_issue = true` |
| No finalize signal | No finalized reservation / matching ledger |
| Audit status | `missing_finalize_record` or `missing_ledger` |

**Excluded:** `missing_variant`, `skipped_afn`, `accounted_for`, `refunded_after_ship`, `manual_review`.

Channels: **KK**, **eBay**, **Amazon MFN** (local inventory affected).

---

## RPC: `manual_finalize_shipped_order_line`

**Inputs:** `source_channel`, `source_order_id`, `source_order_item_id`, `expected_variant_id`, `note` (required)

**Behavior:**

1. Require authenticated admin (`is_admin()`).
2. Re-read row from `v_inventory_shipped_finalize_audit`.
3. Refuse if not `is_finalize_eligible` or variant mismatch.
4. Idempotency key: `manual_finalize:{channel}:{order_id}:{order_item_id}` on `stock_ledger`.
5. Lock variant, decrement `product_variants.stock`.
6. Insert `stock_ledger`: reason `order_finalized`, source `manual_finalize_assist`, reference_type `manual_shipped_order_line`.
7. If existing `reserved` reservation → update to `finalized` with ledger id.
8. Else insert reservation with status **`finalized`** (does not affect active reserved counts).
9. Insert `inventory_manual_finalize_actions` audit row.

**Returns:** `ok`, `idempotent`, `ledger_id`, `reservation_id`, `stock_before`, `stock_after`, `audit_status`.

---

## Idempotency

Re-running with the same order line returns success with `idempotent: true` when ledger idempotency key already exists. No double decrement.

---

## UI behavior

| Surface | Behavior |
|---------|----------|
| Shipped audit modal | **Manual Finalize** on eligible rows only; ineligible shows reason |
| Confirmation | Strong copy + required admin note via prompt |
| Impact shown | On-hand −qty; reserved unchanged or released if existing reserved row finalized |
| After success | Refresh audit modal, KPIs, table, issues; toast with ledger ref |
| Issue detail | Manual Finalize on eligible samples only |

---

## Audit / logging

Table: `inventory_manual_finalize_actions` — channel, order line, variant, qty, ledger/reservation ids, stock before/after, status (`success` / `idempotent` / `failed`), note, `created_by`.

---

## Current eligible count (linked DB)

| Metric | Count |
|--------|------:|
| `is_finalize_eligible` | 0 |
| `shipped_finalize_audit_needed` issue | 0 |

Tooling is ready; rows become eligible after mapping shipped lines via Phase 8C.

---

## Verification

```bash
node scripts/verify-inventory-phase8f-manual-finalize-assist.mjs
```

- RPC + audit table + `is_finalize_eligible` column
- Refuse paths: missing_variant, AFN, unauthenticated pg
- No stock/ledger/reserved mutations during verify
- No live finalize executed (0 eligible rows; admin session required for writes)
- Audit modal + inventory page load

---

## Limitations

- Single-line, admin-confirmed only — no bulk finalize
- Requires mapped variant before use (209 shipped lines still unmapped)
- Direct pg verify cannot test authenticated happy path without eligible row + admin JWT
- Order deep-link still lacks session filter
- Partial-refund shipped lines may need manual review before finalize

---

## Recommended next phase

**Phase 8G — eBay safe mapping hints:** ✅ Complete — [027_phase_8g_ebay_safe_mapping_hints.md](./027_phase_8g_ebay_safe_mapping_hints.md).

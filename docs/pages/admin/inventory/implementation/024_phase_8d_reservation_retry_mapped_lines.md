# Phase 8D — Reservation Retry for Newly Mapped Order Lines (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 8C (mapping assist wizards)  
**Next:** Phase 9 — eBay safe mapping hints or bulk reservation assist

---

## Summary

Added **admin-only, confirmation-gated reservation retry** for mapped order lines that are paid and unshipped. Creates `inventory_reservations` rows only — no on-hand decrement, no channel API writes, no auto-run after mapping.

---

## Eligibility rules

| Rule | Behavior |
|------|----------|
| `variant_id` present | Required |
| `quantity > 0` | Required |
| Channel | `kk`, `ebay`, or `amazon` (from session prefix) |
| Payment | Not fully refunded (`skip_refunded`) |
| Partial refund | `manual_review` — not eligible |
| Fulfillment | Not shipped/delivered (`skip_shipped`) |
| Canceled | `skip_canceled` |
| AFN/FBA Amazon | `skip_afn` — excluded |
| Existing reservation | `already_reserved` (active non-shadow) |
| Eligible | `create_reservation` |

### Channel notes

| Channel | Notes |
|---------|-------|
| **KK** | Historical paid/unshipped lines with `variant_id` after mapping assist |
| **eBay** | MFN lines with mapped `variant_id`; no auto-import reserve |
| **Amazon MFN** | Local reservation allowed when not AFN |
| **Amazon AFN/FBA** | Always skipped — no local stock action |

---

## View — `v_inventory_reservation_retry_candidates`

Read-only classification with `suggested_action`, `reason`, `is_eligible`, `mapping_source` (from `inventory_mapping_assist_actions` when present).

---

## RPC — `retry_inventory_reservation_for_order_line`

- Admin-only (`is_admin()`)
- Re-reads candidate; refuses ineligible
- Idempotency key: `retry_reserve:{channel}:{order_id}:{order_item_id}`
- Inserts `inventory_reservations` with `status=reserved`, `is_shadow=false`
- **Does not** write `stock_ledger` or decrement `product_variants.stock`
- Audit: `inventory_reservation_retry_actions`

**Impact:** reserved +qty, available −qty, on-hand unchanged.

---

## UI behavior

| Location | Behavior |
|----------|----------|
| **Mapping Assist modal** | After order-line mapping, optional “Create Reservation” step with impact copy + confirm |
| **Issue detail modal** | “Reservation retry candidates” list for `unmapped_order_line`; **Retry Reservation** only when `is_eligible` |
| Ineligible rows | Show reason (shipped, refunded, AFN, already reserved, etc.) |

Amazon mapping assist (8C) does **not** offer reservation retry — mapping only.

---

## Audit — `inventory_reservation_retry_actions`

Tracks channel, order ids, variant, quantity, reservation_id, status, error, note, created_by.

---

## Candidate counts (linked DB at verify)

Verify run reported **0 eligible** `create_reservation` rows — mapped lines in DB were already reserved, shipped, or classified as skip. View and RPC verified present; classification logic tested structurally.

---

## Verification

```bash
node scripts/verify-inventory-phase8d-reservation-retry.mjs
```

**Result:** PASS

---

## Limitations

- No auto-retry after mapping (admin must confirm)
- No finalize/shipped historical backfill
- Partial-refund lines require manual review
- RPC requires authenticated admin session (not callable anonymously)
- Negative available after reserve is surfaced by existing issue detection, not blocked

---

## Recommended next phase

**Phase 8E / 8F:** Manual finalize assist for marketplace shipped lines, bulk reservation assist, or eBay safe mapping hints.

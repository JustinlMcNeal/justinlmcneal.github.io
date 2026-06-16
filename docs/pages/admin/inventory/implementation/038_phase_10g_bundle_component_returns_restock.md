# Phase 10G — Bundle Component Returns / Restock

**Status:** Complete  
**Depends on:** [037_phase_10f_live_virtual_bundle_inventory.md](./037_phase_10f_live_virtual_bundle_inventory.md)  
**Verification:** `node scripts/verify-inventory-phase10g-bundle-component-returns-restock.mjs`

---

## Summary

Phase 10G adds an **admin-confirmed returns/restock workflow** for finalized live bundle component reservations. Refunds alone never auto-restock. Component stock is restored only via explicit admin action.

---

## 1. Return candidates — `v_inventory_bundle_component_return_candidates`

| Field | Description |
|-------|-------------|
| `reservation_id` | Finalized `bundle_component` reservation |
| `parent_bundle_variant_id` / label | Parent bundle context |
| `component_variant_id` / label / sku | Component being restocked |
| `quantity_finalized` | Original finalized component qty |
| `quantity_already_restocked` | Sum of prior restock actions |
| `quantity_available_to_restock` | Remaining restockable qty |
| `refund_status` | From `orders_raw` (informational) |
| `suggested_action` | See below |

**Suggested actions**

| Action | When |
|--------|------|
| `eligible_restock` | Finalized, qty available, no refund flag |
| `already_restocked` | Fully restocked |
| `not_finalized` | Status ≠ finalized |
| `refunded_no_return` | Refund recorded — requires manual confirm in UI |
| `manual_review` | Other cases |

Pre-finalization refunds remain **release-only** (Phase 10F) — not restock candidates.

---

## 2. Restock RPC — `restock_bundle_component_line`

**Inputs:** `p_restock_qty`, `p_reservation_id` (or order/line/component lookup), `p_reason`, `p_note`, optional `p_idempotency_key`

**Behavior**

1. Admin auth required when `auth.uid()` present
2. Validates `bundle_component` + `finalized`
3. Validates `restock_qty <= quantity_available_to_restock`
4. Increments **component** `product_variants.stock` only
5. Inserts `stock_ledger`:
   - `reason = return_restock`
   - `source = bundle_component_return`
   - `reference_type = bundle_component_return`
6. Inserts audit row in `inventory_bundle_component_restock_actions`
7. Over-restock attempts log `bundle_component_over_restock_attempt` issue and raise

**Does not:** touch parent bundle stock, channel sync, or reservation status.

---

## 3. Duplicate protection

- `inventory_bundle_component_restock_actions` sums prior `restock_qty` per reservation
- Multiple partial restocks allowed until `quantity_finalized` reached
- Optional `p_idempotency_key` for retry safety
- RPC rejects qty exceeding available remainder

---

## 4. UI

**Location:** Bundle Preview modal → **Returns / Restock** section

Shows return candidates with:
- Parent bundle → component
- Finalized / restocked / available qty
- Refund status badge
- Qty + note fields + **Restock component** button

**Confirmation:** “This will add stock back to the component variant only. It will not restock the parent bundle SKU.”

Issue panel routes `bundle_component_return_pending` and related types to Bundle Preview.

---

## 5. Issue groups

| Issue type | Trigger |
|------------|---------|
| `bundle_component_return_pending` | `eligible_restock` candidates |
| `bundle_component_restock_manual_review` | Refunded/flagged lines with restock qty remaining |
| `bundle_component_over_restock_attempt` | Blocked over-restock RPC |

---

## 6. Refund vs return distinction

| Scenario | Behavior |
|----------|----------|
| Full refund before finalize | Release component reservations (10F) — no restock |
| Full refund after finalize | No auto-restock — admin may restock via 10G UI |
| Partial refund | Manual review — no automatic qty handling |

---

## 7. Migrations

| File | Objects |
|------|---------|
| `20260926_inventory_phase10g_bundle_component_returns_restock.sql` | Audit table, candidates view, restock RPC |
| `20260926_inventory_phase10g_returns_issues.sql` | Extended `v_inventory_issues` |

---

## 8. Verification results

Run: `node scripts/verify-inventory-phase10g-bundle-component-returns-restock.mjs`

---

## 9. Limitations

- No automatic restock on Stripe refund webhook
- Partial refund guidance added in Phase 10H (no auto qty allocation in 10G)
- No return label / RMA integration
- No channel quantity push after restock

---

## 10. Phase 10H follow-up (complete)

See [039_phase_10h_partial_refund_return_guidance.md](./039_phase_10h_partial_refund_return_guidance.md).

---

## 11. Recommended next phase — 10I

1. Line Items auto-focus from deep link  
2. Per-line Stripe refund amounts  
3. RMA / return label workflow integration

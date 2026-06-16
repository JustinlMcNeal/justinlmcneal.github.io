# Phase 8E — Shipped-Order Finalize Audit Tooling (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 8D (reservation retry for mapped lines)  
**Next:** Phase 8G — eBay safe mapping hints (Phase 8F manual finalize assist complete)

---

## Summary

Added **read-only audit tooling** for mapped shipped/delivered order lines so admins can see whether inventory appears properly accounted for. No automatic stock deduction, no retroactive finalize, no channel API writes.

---

## Shipped data audit

### Channels inspected

| Channel | Session prefix | Shipped signal |
|---------|----------------|----------------|
| KK | (none) | `fulfillment_shipments.label_status` ∈ `shipped`, `delivered` |
| eBay | `ebay_%` | Same |
| Amazon MFN | `amazon_%` (non-AFN) | Same |
| Amazon AFN/FBA | `amazon_%` + carrier/service | Skipped — external fulfillment |

### Field signals

| Signal | Source |
|--------|--------|
| Paid | `orders_raw.refund_status` not `full` |
| Shipped / delivered | `fulfillment_shipments.label_status` |
| Canceled | Label `cancelled` / `voided` → `order_status` canceled |
| Refunded | `refund_status = full` → `refunded_after_ship` |
| Fulfillment channel | Session prefix + AFN carrier/service heuristic |
| `variant_id` | `line_items_raw.variant_id` |
| Quantity | `line_items_raw.quantity` |
| Existing reservation | Latest non-shadow `inventory_reservations` for order line |
| Finalized reservation | `reservation.status = finalized` or `finalize_ledger_id` |
| Stock ledger decrement | Negative `stock_ledger` with reason `order` / `order_finalized` matching order ref |
| AFN skip | Amazon + `carrier = Amazon` + service ILIKE `%Fulfilled by Amazon%` |

---

## View: `v_inventory_shipped_finalize_audit`

Read-only view over shipped/delivered lines with reservation and ledger signals plus classification.

### Audit status definitions

| Status | Meaning |
|--------|---------|
| `accounted_for` | Finalized reservation and/or matching stock ledger decrement |
| `missing_finalize_record` | Mapped shipped line lacks finalize + ledger signal |
| `missing_ledger` | Reserved for issue filter parity (same bucket as missing finalize in current data) |
| `skipped_afn` | Amazon AFN/FBA — external fulfillment |
| `missing_variant` | Shipped without `variant_id` |
| `refunded_after_ship` | Fully refunded after shipment |
| `manual_review` | Ambiguous / canceled edge cases |

### Issue flag

`needs_audit_issue = true` when:

- `variant_id` present
- Not AFN/FBA
- Not fully refunded / not canceled
- `suggested_audit_status` ∈ (`missing_finalize_record`, `missing_ledger`)

---

## Issue integration

New group in `v_inventory_issues`:

- **Type:** `shipped_finalize_audit_needed`
- **Label:** Shipped Finalize Audit Needed
- **Primary action:** Open Shipped Audit (read-only modal)
- **Workflow:** Reuses `inventory_issue_states` (review / snooze / resolve / ignore)

Issue detail modal shows sample audit rows and a dedicated **Open Shipped Finalize Audit** button.

---

## UI behavior

| Surface | Behavior |
|---------|----------|
| Issue alert pill | “N Shipped Lines Need Audit” when count > 0 |
| Issue detail | Sample rows + workflow + primary opens audit modal |
| Shipped audit modal | Status badges, order/variant/qty/reason; navigation only |
| Open order | Line Items Orders page |
| Open inventory | Clears filters (variant scroll TBD) |
| Adjust | Opens existing adjust modal after confirm copy |

**Adjust copy:** “Only adjust stock if you confirmed this shipped order was never deducted.”

---

## Files

| Area | Path |
|------|------|
| Migration | `supabase/migrations/20260913_inventory_phase8e_shipped_finalize_audit.sql` |
| API | `js/admin/inventory/api/shippedFinalizeAuditApi.js` |
| Modal | `js/admin/inventory/ui/shippedFinalizeAuditModal.js` |
| Issue matrix | `js/admin/inventory/services/issueActions.js` |
| Issue samples | `js/admin/inventory/api/issuesApi.js` |
| Verify | `scripts/verify-inventory-phase8e-shipped-finalize-audit.mjs` |

---

## Candidate counts (linked DB — verification run)

| Metric | Count |
|--------|------:|
| Total shipped audit rows (sample cap 100) | 216 |
| `skipped_afn` | 7 |
| `missing_variant` | 209 |
| `accounted_for` | 0 |
| `needs_audit_issue` | 0 |
| Issue group `shipped_finalize_audit_needed` | 0 |

Interpretation: historical shipped lines are predominantly **unmapped** (`missing_variant`) or **AFN** (`skipped_afn`). No mapped shipped lines currently lack finalize/ledger signals in the linked database.

---

## Limitations

- Read-only — no one-click deduction or auto-finalize
- Ledger match uses order id / kk order id / line item id heuristics — may miss unusual reference formats
- Order deep-link to Line Items Orders has no session filter yet
- Inventory row navigation does not auto-scroll to variant
- `missing_ledger` status reserved; current data classifies as `missing_finalize_record`
- Partial-refund shipped lines may need manual review

---

## Verification

```bash
node scripts/verify-inventory-phase8e-shipped-finalize-audit.mjs
```

Checks:

- Audit view loads and classifies AFN / accounted / missing rows
- No stock, reservation, or ledger mutations
- Issue panel + 8C mapping assist + 8D reservation retry intact
- Inventory page loads with shipped audit mount

---

## Recommended next phase

**Phase 8G — eBay safe mapping hints:** ✅ Complete — [027_phase_8g_ebay_safe_mapping_hints.md](./027_phase_8g_ebay_safe_mapping_hints.md).  
**Next:** Map lines via Shipped Audit → Map Line; then Manual Finalize when eligible.

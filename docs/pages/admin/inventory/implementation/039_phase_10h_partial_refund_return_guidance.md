# Phase 10H — Partial Refund + Return Guidance for Bundle Components

**Status:** Complete  
**Depends on:** [038_phase_10g_bundle_component_returns_restock.md](./038_phase_10g_bundle_component_returns_restock.md)  
**Verification:** `node scripts/verify-inventory-phase10h-partial-refund-return-guidance.mjs`

---

## Summary

Phase 10H adds **read-only refund context and restock guidance** for finalized live bundle component lines. No automatic restock from Stripe refunds. Admins see suggested quantities, refund ratios, and next-step checklists — all restock still goes through the Phase 10G confirmed RPC.

---

## 1. Refund vs return rules

| Scenario | Inventory behavior | Guidance |
|----------|-------------------|----------|
| No refund | No auto change | `restock_available` — suggest max restockable after physical confirm |
| Full refund after finalize | No auto-restock | `full_refund_after_finalize` — suggest full remaining component qty (advisory) |
| Partial refund (order-level) | No auto-restock | `partial_refund_review` — no suggested qty unless line fully covered |
| Partial refund covering parent line $ | No auto-restock | May suggest qty if `refund_amount >= line_total_cents` |
| Refund before finalize | Release only (10F) | Not in restock guidance view |

**Principle:** Refund detected ≠ item returned. Physical return confirmation required.

---

## 2. Guidance view — `v_inventory_bundle_component_return_guidance`

Extends Phase 10G candidates with:

| Field | Source |
|-------|--------|
| `order_total_cents`, `refunded_amount_cents` | `orders_raw` |
| `line_total_cents`, `parent_line_quantity` | `line_items_raw` (parent bundle line) |
| `estimated_refund_ratio` | `refunded / order_total` |
| `suggested_restock_qty` | Capped at `max_restockable_qty`; NULL for partial review |
| `guidance_status` | See below |
| `guidance_reason` | Human-readable explanation |

**Guidance statuses:** `no_refund` (mapped as `restock_available`), `full_refund_after_finalize`, `partial_refund_review`, `restock_available`, `already_restocked`, `manual_review`

**Suggested qty logic:**
- Full refund → `max_restockable_qty`
- No refund → `max_restockable_qty`
- Partial + line $ covered → `max_restockable_qty`
- Partial otherwise → `NULL`
- Always `LEAST(suggested, max_restockable_qty)`

---

## 3. UI behavior

**Bundle Preview → Returns / Restock**

- Refund disclaimer banner
- Per-line: refund amounts, ratio, guidance status/reason
- **Open Order Line** (`buildLineItemsOrdersUrl` with `session_id`, `line_id`, `channel`) — enhanced in 10I
- **Restock suggested qty** button when guidance provides a safe suggestion
- **Restock custom qty** always available when max > 0
- Confirmation copy unchanged from 10G

**Post-restock checklist** (no auto-sync):
- Inventory updated
- Component available changed
- Bundle virtual availability may have changed
- Channel sync may be needed
- Buttons: Open Sync Channels, Open Bundle Preview, Open Inventory

---

## 4. Issue detection

Issue samples for `bundle_component_return_pending`, `bundle_component_restock_manual_review`, and `bundle_component_over_restock_attempt` now include guidance fields and order deep links in Issue Detail modal.

---

## 5. No new RPCs

Restock continues via `restock_bundle_component_line` only. Phase 10H is views + UI + guidance.

---

## 6. Verification results

`node scripts/verify-inventory-phase10h-partial-refund-return-guidance.mjs` — **PASS**

---

## 7. Limitations

- No Stripe webhook restock automation
- Partial refund qty not allocated per line unless dollar threshold infers full line coverage
- No RMA / return label integration
- No automatic Amazon/eBay sync after restock
- ~~Line Items workspace does not auto-focus line from `line_id` param yet~~ → **Addressed in [040_phase_10i_line_items_deeplink_return_polish.md](./040_phase_10i_line_items_deeplink_return_polish.md)**

---

## 8. Follow-up — Phase 10I (complete) · Phase 10J (complete)

1. ~~Line Items workspace auto-focus from `line_id` deep link~~ ✅ (10I)  
2. ~~RMA / return workflow status~~ ✅ (10J — `inventory_return_workflow`)  
3. Per-line refund amount from Stripe when available → **recommended 10K**  
4. Reservation `returned` status column (optional) → future  
5. Channel sync policy doc + optional manual push reminder per component SKU (partial — post-restock checklist in 10H/10I)

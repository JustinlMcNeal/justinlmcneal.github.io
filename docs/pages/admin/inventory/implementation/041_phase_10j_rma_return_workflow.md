# Phase 10J — RMA / Returned Status for Bundle Component Reservations

**Status:** Complete  
**Depends on:** [040_phase_10i_line_items_deeplink_return_polish.md](./040_phase_10i_line_items_deeplink_return_polish.md)  
**Verification:** `node scripts/verify-inventory-phase10j-rma-return-workflow.mjs`

---

## Summary

Phase 10J adds **admin RMA/return workflow tracking** for finalized live bundle component reservations. Physical return state is tracked separately from refund state and stock restock. **Workflow-only** — no automatic restock, no channel sync, no checkout/reservation/finalize behavior changes.

---

## 1. Return / RMA schema — `inventory_return_workflow`

| Field | Purpose |
|-------|---------|
| `source_channel`, `source_order_id`, `source_order_item_id` | Order line reference |
| `reservation_id` | Link to finalized `bundle_component` reservation |
| `parent_bundle_variant_id`, `component_variant_id` | Denormalized variant refs |
| `quantity_expected` | Units expected back |
| `quantity_received` | Units physically received |
| `quantity_restocked` | Units recorded as restocked on workflow (linked after confirmed restock) |
| `status` | Workflow lifecycle (see below) |
| `condition` | `unknown`, `resellable`, `damaged`, `missing`, `partial` |
| `rma_number`, `tracking_number`, `note` | Admin metadata |
| `created_by`, `updated_by`, `created_at`, `updated_at`, `closed_at` | Audit |

**RLS:** authenticated SELECT; writes via admin RPCs only (`SECURITY DEFINER`).

---

## 2. Status meanings

| Status | Meaning |
|--------|---------|
| `open` | Workflow created, not yet categorized |
| `return_expected` | Awaiting inbound return shipment |
| `received` | Full expected qty received |
| `partially_received` | Some units received |
| `inspected` | Condition assessed |
| `restocked` | Workflow restock qty linked (stock already changed via restock RPC) |
| `closed` | Workflow complete / archived |
| `canceled` | Workflow voided |

---

## 3. RPC behavior

| RPC | Behavior |
|-----|----------|
| `create_inventory_return_workflow` | Creates row from reservation; prefills order/variant ids; **no stock change** |
| `update_inventory_return_workflow` | Updates status/qty/condition/metadata; validates `received <= expected`; `restocked <= received` unless override note; **no stock change** |
| `close_inventory_return_workflow` | Sets `closed`, `closed_at`; **no stock change** |
| `link_return_workflow_restock` | After confirmed `restock_bundle_component_line`, increments `quantity_restocked` and updates status; **no stock change** |

Admin check: `is_admin()` when `auth.uid()` present (same lenient pattern as 10G restock).

---

## 4. Guidance view — `v_inventory_bundle_component_return_workflow_guidance`

Extends Phase 10H guidance with workflow fields:

- `workflow_id`, `workflow_status`, `workflow_condition`
- `workflow_quantity_expected/received/restocked`
- `workflow_rma_number`, `workflow_tracking_number`, `workflow_note`
- `workflow_next_action`: `create_rma`, `wait_for_return`, `inspect_return`, `restock_received`, `close_return`, `manual_review`

Candidates view (`v_inventory_bundle_component_return_candidates`) now populates `return_status` from latest active workflow.

---

## 5. Restock linkage

1. Admin confirms restock via existing **`restock_bundle_component_line`** (10G) — only path that mutates component stock.
2. UI prompts: **“Mark this return workflow as restocked?”**
3. If yes → `link_return_workflow_restock(workflow_id, restock_qty)` updates workflow row only.

No automatic workflow update inside restock RPC (avoids risky coupling).

---

## 6. UI behavior — Bundle Return/Restock panel

Per candidate:

- RMA/Return status block with next recommended action
- **Create Return Workflow** (when none)
- **Mark Received**, **Mark Inspected** (resellable / damaged / missing)
- **Add Note**, **Close Return**
- **Open Order Line** deep link (10I)
- Restock buttons unchanged — require admin confirm; blocked when condition is `damaged`/`missing`

Copy:

- *“Return workflow status does not change stock.”*
- *“Stock changes only after confirmed restock.”*

---

## 7. Issue detection

| Issue type | When |
|------------|------|
| `bundle_return_expected` | Workflow `open` / `return_expected` |
| `bundle_return_received_not_restocked` | Received + `resellable` + restock qty remaining |
| `bundle_return_manual_review` | Condition `damaged`/`missing` or `workflow_next_action = manual_review` |

Routes: Open Bundle Preview → Returns tab; issue samples include order-line deep links.

---

## 8. Verification results

```bash
node scripts/verify-inventory-phase10j-rma-return-workflow.mjs
```

Checks:

- Table + RPCs + workflow guidance view exist
- Create/update/close/link change workflow rows only
- Quantity validation enforced
- Confirmed restock remains sole stock mutation path
- Reservation status stays `finalized`
- UI disclaimers + actions present
- Inventory page loads

---

## 9. Limitations

| Limitation | Notes |
|------------|-------|
| No carrier/RMA label integration | Manual RMA # and tracking fields only |
| No auto-create from Stripe refund | Admin must create workflow |
| Workflow `quantity_restocked` is advisory link | May differ from audit sum if prompt declined |
| One active workflow per reservation (latest wins in view) | Multiple historical rows possible if not closed |
| No reservation `returned` status column yet | Workflow table is source of truth for return state |

---

## 10. Recommended next phase — 10L

**Webhook idempotent refund enrichment**

- Upsert `order_refund_details` from `charge.refunded` (same idempotency as admin refresh)
- Keep observational-only — no auto-RMA, no auto-restock
- Optional eBay/Amazon refund read-only context in a later sub-phase

Phase 10K delivered admin refresh + guidance — see [042_phase_10k_stripe_refund_return_guidance.md](./042_phase_10k_stripe_refund_return_guidance.md).

---

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20260928_inventory_phase10j_rma_return_workflow.sql` | Table, RPCs, views |
| `supabase/migrations/20260928_inventory_phase10j_return_workflow_issues.sql` | Issue groups |
| `js/admin/inventory/api/returnWorkflowApi.js` | Client API |
| `js/admin/inventory/ui/bundleReturnRestockPanel.js` | Workflow UI + restock link prompt |
| `js/admin/inventory/api/issuesApi.js` | Workflow issue samples |
| `js/admin/inventory/services/issueActions.js` | New issue defs |
| `js/admin/inventory/api/inventoryApi.js` | Issue labels |
| `js/admin/inventory/ui/issueDetailModal.js` | Return issue deep links |
| `scripts/verify-inventory-phase10j-rma-return-workflow.mjs` | Verification |
| Roadmap / wiring plan / 10H / 10I docs | Status updates |

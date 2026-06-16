# Phase 9A — Post-Map Workflow Assist (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 8H (eBay bulk mapping worklist)  
**Next:** Phase 9C — queue resolution assist. **Completed:** [030_phase_9b_post_map_action_queue.md](./030_phase_9b_post_map_action_queue.md).

---

## Summary

After single-line or batch mapping, admins now see a **read-only post-map checklist** classifying each mapped line’s suggested next step. Action buttons **navigate only** to existing confirmed workflows (Reservation Retry, Shipped Finalize Audit, Manual Finalize, Line Items Orders). Nothing auto-runs reservation retry, manual finalize, stock/reservation/ledger changes, or channel API writes.

---

## Classification logic

### View: `v_inventory_post_mapping_workflow_candidates`

One row per successful `inventory_mapping_assist_actions` record (`order_line_variant`). Joins:

| Source | Reuse |
|--------|-------|
| `v_inventory_reservation_retry_candidates` | Paid/unshipped eligibility |
| `v_inventory_shipped_finalize_audit` | Shipped accounting + `is_finalize_eligible` |
| `inventory_mapping_assist_batches` | Optional `batch_id` correlation |

### `next_step` priority

| Step | When |
|------|------|
| `skipped_afn` | AFN/FBA skip |
| `skipped_refunded` | Full refund |
| `skipped_canceled` | Canceled fulfillment |
| `already_accounted_for` | Ledger/reservation already present |
| `manual_finalize_possible` | `is_finalize_eligible` on shipped audit |
| `shipped_finalize_audit` | Shipped, needs audit, not accounted |
| `reservation_retry` | `create_reservation` on retry candidates |
| `manual_review` | Partial refund / ambiguous |

### `action_target`

| Target | Meaning |
|--------|---------|
| `reservation_retry` | Open reservation retry confirm flow |
| `manual_finalize_assist` | Open manual finalize confirm flow |
| `shipped_finalize_audit` | Open shipped audit modal (filtered) |
| `line_items_orders` | Deep-link to order |
| `none` | No action needed |

---

## UI behavior

### Checklist modal (`postMappingChecklistModal.js`)

- Title: **Mapped Lines — Next Steps**
- Grouped count tiles: Reservation Retry, Shipped Audit, Manual Finalize, Accounted For, Skipped/Review
- Line table: product, channel, qty, next-step badge, reason, action button
- Batch apply summary when provided (mapped/failed/skipped)
- **Done** closes without side effects

### Integration points

| After | Behavior |
|-------|----------|
| Mapping Assist (order line) | Inline checklist in assist modal |
| eBay worklist batch apply | Dedicated checklist modal; worklist closes first |
| Amazon mapping | Checklist skipped (no order-line post-map path) |

### Action buttons (navigation only)

| Button | Opens |
|--------|-------|
| Open Reservation Retry → | `promptReservationRetry` (still requires confirm) |
| Open Shipped Audit → | `openShippedFinalizeAuditModal` filtered to line |
| Open Manual Finalize → | `promptManualFinalize` (still requires note + confirm) |
| Open Order → | `buildLineItemsOrdersUrl` deep link |

---

## Deep-link behavior

### `buildLineItemsOrdersUrl` (`orderLinks.js`)

Query params:

| Param | Purpose |
|-------|---------|
| `session_id` / `order_id` | Pre-fill search + auto-open workspace when row loaded |
| `q` | Search mirror of session id |
| `channel` | Hint for disambiguation (client-side only) |
| `line_id` | Passed through; workspace does not auto-focus line yet |
| `tab` | Workspace tab (`overview`, `fulfillment`, etc.) |

### Line Items Orders (`index.js`)

After initial load, `applyLineItemsDeepLink` opens workspace when session id matches a loaded row.

---

## What remains separately confirmed

- Reservation creation (`retry_inventory_reservation_for_order_line`)
- Manual finalize (`manual_finalize_shipped_order_line`)
- All mapping apply (unchanged from 8C/8H)

The checklist **does not** call these RPCs automatically.

---

## Verification

```bash
node scripts/verify-inventory-phase9a-post-map-workflow-assist.mjs
```

**Result:** PASS

- View exists; read-only queries do not mutate stock/ledger/reservations
- Checklist UI + integrations present in source
- Inventory page loads with `#inventoryPostMapChecklistMount`
- Linked DB: 0 post-map candidate rows (no successful mapping actions in audit table at verify time)

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260917_inventory_phase9a_post_map_workflow_assist.sql` | Classification view |
| `js/admin/inventory/api/postMappingWorkflowApi.js` | Fetch + summarize |
| `js/admin/inventory/ui/postMappingChecklistModal.js` | Checklist UI |
| `scripts/verify-inventory-phase9a-post-map-workflow-assist.mjs` | Verification |

| Changed | |
|---------|--|
| `pages/admin/inventory.html`, `dom.js` | Checklist mount |
| `mappingAssistModal.js` | Replaces reservation-only post-map with checklist |
| `ebayMappingWorklistModal.js` | Checklist after batch apply |
| `shippedFinalizeAuditModal.js` | `filterOrderId` / `filterOrderItemId` |
| `constants/orderLinks.js` | `buildLineItemsOrdersUrl` |
| `js/admin/lineItemsOrders/index.js` | Deep-link open workspace |

---

## Limitations

- View rows only exist after successful mapping audit records
- `batch_id` correlated by time window + results JSON (not FK on action rows)
- Shipped audit filter is client-side on first 40 rows — very old lines may need manual search
- `line_id` query param does not scroll/highlight a specific line in workspace yet
- `channel` param is a hint only (no server-side channel filter)
- Clicking “Open Reservation Retry” still opens confirm flow — not a passive link

---

## Phase 9B extension

Post-map action queue — ✅ [030_phase_9b_post_map_action_queue.md](./030_phase_9b_post_map_action_queue.md).

---

## Recommended next phase

**Phase 9C — Queue resolution assist:** Auto-suggest marking done when reservation/finalize completes; bulk navigation screen (still confirm per action).

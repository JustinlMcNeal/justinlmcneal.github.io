# Phase 9B — Post-Map Action Queue (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 9A (post-map workflow checklist)  
**Superseded by:** Phase 9C — [031_phase_9c_queue_resolution_assist.md](./031_phase_9c_queue_resolution_assist.md)

---

## Summary

Persisted post-map follow-up steps in **`inventory_post_map_action_queue`**. After mapping, actionable checklist rows are upserted into the queue. Admins manage todos via a **Post-Map Queue** modal (status, snooze, done/ignore) while action buttons remain **navigation-only** into existing confirmed workflows.

---

## Queue schema

Table: `inventory_post_map_action_queue`

| Field | Notes |
|-------|-------|
| Line identity | `source_channel`, `source_order_id`, `source_order_item_id` |
| Mapping refs | `mapping_action_id`, `mapping_batch_id` (nullable) |
| Product | `product_id`, `variant_id`, `product_label`, `internal_sku`, `quantity` |
| Workflow | `next_step`, `reason`, `action_target` (jsonb) |
| Status | `open`, `reviewed`, `snoozed`, `done`, `ignored` |
| Snooze | `snoozed_until` |
| Audit | `created_by`, `updated_by`, `created_at`, `updated_at`, `completed_at` |

**Unique key:** `(source_channel, source_order_id, source_order_item_id, next_step)`

---

## Queue creation logic

RPC: `upsert_post_map_queue_from_checklist(p_items jsonb)`

**Inserted/updated for actionable steps only:**

- `reservation_retry`
- `shipped_finalize_audit`
- `manual_finalize_possible`
- `manual_review`

**Skipped (not queued):**

- `already_accounted_for`
- `skipped_afn`, `skipped_refunded`, `skipped_canceled`

**Idempotency:**

- Unique key prevents duplicates
- Upsert updates metadata only when status ∈ `open`, `reviewed`, `snoozed`
- `done` / `ignored` rows are not reopened automatically

Triggered from `showPostMappingChecklist` after Phase 9A candidate fetch (best-effort).

---

## UI behavior

### Entry points

| Surface | Action |
|---------|--------|
| Issues panel | **Post-Map Queue (N)** button |
| Mapping checklist | **Open Post-Map Queue** + queue-updated banner |
| Queue modal | Filters: Active, Snoozed, Reviewed, Done, Ignored |

### Row actions (navigation + workflow)

| Button | Behavior |
|--------|----------|
| Reservation Retry / Shipped Audit / Manual Finalize / Order | Opens existing 8D/8E/8F / Line Items flows |
| Reviewed / Snooze / Done / Ignore | Updates queue status only |

After reservation retry or manual finalize, optional **Mark Done** prompt when resolution view shows `appears_completed` (Phase 9C — user must confirm).

---

## Status meanings

| Status | Meaning |
|--------|---------|
| `open` | Needs follow-up |
| `reviewed` | Admin acknowledged; still visible in active filter |
| `snoozed` | Hidden until `snoozed_until` (expired snoozes show in active) |
| `done` | Todo complete (does not prove stock action unless separately confirmed) |
| `ignored` | Intentionally skipped |

---

## Line Items deep-link improvement

- `line_id` query param passed to `openWorkspace({ focusLineItemId })`
- Overview tab line cards use `data-ws-line-item` + pink ring highlight + scroll into view

---

## What remains navigation-only

- No auto reservation retry
- No auto manual finalize
- No stock/reservation/ledger/channel API writes from queue create/status updates
- **Done** marks todo only — optional suggest after confirmed downstream action

---

## Verification

```bash
node scripts/verify-inventory-phase9b-post-map-action-queue.mjs
```

**Result:** PASS

- Table + RPCs exist
- Unique key idempotent
- Done rows not reopened
- No stock/ledger/reservation mutations from verify
- Queue mount + line focus anchors present

**Linked DB at verify:** 0 queue rows (no mapping apply yet)

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260918_inventory_phase9b_post_map_action_queue.sql` | Table + upsert/update RPCs |
| `js/admin/inventory/api/postMapQueueApi.js` | Fetch, upsert, update, detect complete |
| `js/admin/inventory/ui/postMapQueueModal.js` | Queue UI |
| `js/admin/inventory/services/postMapQueueRowActions.js` | Shared navigation helpers |
| `scripts/verify-inventory-phase9b-post-map-action-queue.mjs` | Verification |

| Changed | |
|---------|--|
| `postMappingChecklistModal.js` | Queue creation + open queue link |
| `renderIssues.js`, `events.js`, `state.js`, `index.js`, `refreshInventoryData.js` | Issues panel queue button + count |
| `dom.js`, `inventory.html` | Queue modal mount |
| `workspace.js`, `workspaceOverview.js`, `lineItemsOrders/index.js` | Line item focus |

---

## Limitations

- Queue rows appear only after successful mapping + checklist upsert
- Active count capped at 100 rows fetched
- Shipped audit navigation still client-filters first 40 audit rows
- `done` does not auto-detect all completion paths
- No email/notification reminders for snoozed items

---

## Recommended next phase

**Phase 9C complete** — resolution assist + work screen. See [031_phase_9c_queue_resolution_assist.md](./031_phase_9c_queue_resolution_assist.md).

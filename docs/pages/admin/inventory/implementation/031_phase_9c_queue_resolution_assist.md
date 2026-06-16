# Phase 9C — Post-Map Queue Resolution Assist + Work Screen (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 9B (post-map action queue)  
**Next:** Phase 10 — bundle / component rules (or Phase 9D bulk navigation polish)

---

## Summary

Added **read-only resolution detection** on top of the post-map action queue and upgraded the queue modal into a focused **Work Queue** screen. Admins see counts, filters, resolution banners, evidence drilldown, and bulk workflow-only status changes. Detection **suggests** mark done / ignore / review — it never auto-marks items or runs inventory actions.

---

## Resolution detection logic

View: `v_inventory_post_map_queue_with_resolution`

Joins each queue row to:

- `v_inventory_reservation_retry_candidates`
- `v_inventory_shipped_finalize_audit`
- Latest successful `inventory_manual_finalize_actions` row

### `detected_resolution_status`

| Value | When |
|-------|------|
| `appears_completed` | Underlying follow-up appears done (see per-step rules) |
| `no_longer_applicable` | AFN skip, refund/cancel, or audit no longer needs action |
| `needs_manual_review` | `next_step = manual_review` (never auto-completes) |
| `still_open` | Follow-up still recommended |

### Per-step completion rules

| `next_step` | `appears_completed` when |
|-------------|---------------------------|
| `reservation_retry` | Active reservation exists **or** retry candidate is `already_reserved` |
| `shipped_finalize_audit` | Audit `accounted_for` **or** matching ledger / manual finalize audit |
| `manual_finalize_possible` | Same as shipped audit |
| `manual_review` | Never — always `needs_manual_review` |

### `underlying_signal`

`reservation_exists` · `audit_accounted_for` · `ledger_found` · `skipped_afn` · `refunded_or_canceled` · `none`

### `suggested_status_action`

| Detection | Suggestion |
|-----------|------------|
| `appears_completed` | `mark_done` |
| `no_longer_applicable` | `ignore` |
| `needs_manual_review` | `review` |
| `still_open` | `keep_open` |

Detection is **read-only**. Status changes require explicit admin action (single or bulk).

---

## UI behavior — Work Queue screen

Modal title: **Post-Map Work Queue**

### Counts (header chips)

Open · Snoozed · Appears Completed · Manual Review · Done/Ignored

### Filters

- Status: Active, Appears Done, Snoozed, Reviewed, Done, Ignored
- Next step: reservation retry, shipped audit, manual finalize, manual review
- Source channel: eBay, Amazon, KK

### Row presentation

**Appears completed** rows show a green banner:

- “Looks complete — reservation exists”
- “Looks complete — finalized/accounted for”
- “Looks complete — ledger/finalize signal found”

Banner actions: **Mark Done** · **Open Evidence** · **Keep Open**

**Still open** rows show existing navigation:

- Reservation Retry →
- Shipped Audit →
- Manual Finalize →
- Open Order →

Per-row: Reviewed · Snooze · Done · Ignore

### Bulk workflow-only actions

Checkbox selection + toolbar:

- Mark Reviewed Selected
- Snooze Selected (prompt for days)
- Mark Done Selected — **confirmation:** “This only marks queue items done. It does not change inventory.”
- Ignore Selected

Bulk updates call RPC `update_post_map_queue_items_bulk` (admin auth). **No** reservation retry, manual finalize, stock, ledger, or channel writes.

### Evidence drilldown

Expandable read-only panel (`postMapQueueEvidence.js`):

- Order / line identity
- Resolution status + reason + signal
- Mapping action / batch refs
- Reservation id + status
- Shipped audit status
- Ledger id + reason
- Manual finalize audit id + ledger

---

## Integration with confirmed actions

After **Reservation Retry** or **Manual Finalize** completes through existing 8D/8F flows:

- Queue refreshes (or user returns to Work Queue)
- If resolution view shows `appears_completed`, optional confirm prompt: “Mark this queue item as done?”
- **Never** auto-mark done without user confirm

---

## Database objects

| Object | Purpose |
|--------|---------|
| `v_inventory_post_map_queue_with_resolution` | Read-only resolution join view |
| `update_post_map_queue_items_bulk(p_ids, p_status, p_snoozed_until)` | Admin bulk queue status update |

Migration: `supabase/migrations/20260919_inventory_phase9c_queue_resolution_assist.sql`

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260919_inventory_phase9c_queue_resolution_assist.sql` | View + bulk RPC |
| `js/admin/inventory/api/postMapQueueResolutionApi.js` | Fetch with resolution, work counts, bulk update, banner text |
| `js/admin/inventory/ui/postMapQueueEvidence.js` | Read-only evidence HTML |
| `scripts/verify-inventory-phase9c-queue-resolution-assist.mjs` | Verification |

| Changed | |
|---------|--|
| `js/admin/inventory/ui/postMapQueueModal.js` | Work Queue UI: counts, filters, bulk, banners, evidence |
| `js/admin/inventory/services/postMapQueueRowActions.js` | `maybeSuggestMarkDone` uses resolution view |

---

## Verification

```bash
node scripts/verify-inventory-phase9c-queue-resolution-assist.mjs
```

**Result:** PASS

- Resolution view exists and loads
- Empty / sparse queue state handled
- `manual_review` → `needs_manual_review` (never `appears_completed`)
- Bulk RPC exists; rejects unauthenticated direct pg calls
- Queue status-only SQL update works; on-hand / ledger / reservations unchanged
- No auto retry/finalize strings in modal source
- Inventory page loads with queue mount
- File line counts within limits (`postMapQueueModal.js` grandfathered at 373 lines)

**Linked DB at verify:** resolution view rows: 1 (sparse production data; reservation/audit signal paths not exercised — no matching candidates in DB)

---

## Limitations

- Resolution depends on existing 8D/8E/8F views — stale or missing join data yields `still_open`
- Work counts fetch capped at 200 rows
- Bulk RPC requires authenticated admin session (not callable from service-role pg verify)
- No reservation/audit test fixtures in linked DB during verify
- Evidence is display-only — no deep links into ledger/reservation admin yet
- Snooze bulk uses single days prompt for all selected rows

---

## Recommended next phase

**Phase 9D (optional polish):** Deep links from evidence into reservation detail / ledger row; queue sort by priority; “appears completed” inbox default filter; optional email/snooze reminders.

**Phase 10:** Bundle / component deduction rules per separate spec.

---

## What remains out of scope (unchanged)

- Automatic reservation retry
- Automatic manual finalize
- Bulk finalize / bulk reservation creation
- Channel sync / eBay relist automation
- Amazon/eBay API writes
- Parcel/CPI/manual adjustment changes
- Bundle/component deduction

# Phase 8B — Inventory Issue Resolution Tracking (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 8A (issue workflows + action routing)  
**Next:** Phase 8C complete — [023_phase_8c_mapping_assist_wizards.md](./023_phase_8c_mapping_assist_wizards.md). Phase 8D — reservation retry / eBay hints.

---

## Summary

Added **persistent admin workflow state** layered on top of detected issues from read-only views. Admins can mark issues reviewed, snooze, resolve, or ignore without mutating inventory, reservations, or channel data.

---

## Table schema — `inventory_issue_states`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `issue_key` | text UNIQUE | Stable key (group or sample) |
| `issue_type` | text | Matches `v_inventory_issues.issue_type` |
| `source` | text | Optional |
| `reference_type` / `reference_id` | text | Optional entity refs |
| `variant_id` / `product_id` | uuid FK | Optional |
| `status` | text | `open`, `reviewed`, `snoozed`, `resolved`, `ignored` |
| `snoozed_until` | timestamptz | Required for active snooze |
| `resolution_note` | text | Optional admin note |
| `assigned_to` | uuid | Optional |
| `created_by` / `updated_by` | uuid | From auth session |
| `created_at` / `updated_at` | timestamptz | `set_updated_at` trigger |

**RLS:** authenticated SELECT/INSERT/UPDATE; service_role ALL. No DELETE from UI.

**Migration:** `20260910_inventory_phase8b_issue_resolution_tracking.sql`

---

## Issue key strategy

| Level | Pattern | Example |
|-------|---------|---------|
| Group (panel row) | `group:{issue_type}` | `group:unmapped_order_line` |
| Sample | `{type}:{part}:{id}…` | `negative_available:variant:{uuid}` |
| Order line | `unmapped_order_line:channel:order:item` | |
| Sync failure | `channel_sync_failed:channel:run:sku` | |

**Helper:** `js/admin/inventory/services/issueKeys.js`

Phase 8B UI writes **group-level** keys only. Sample keys are generated in `fetchIssueSamples` for future per-row workflow.

---

## View — `v_inventory_issues_with_state`

Joins `v_inventory_issues` with `inventory_issue_states` on `issue_key = 'group:' || issue_type`.

| Column | Meaning |
|--------|---------|
| `workflow_status` | Coalesced state (`open` if no row) |
| `is_active_workflow` | false when resolved/ignored or snoozed until future |
| `is_snoozed_active` | true when snooze not expired |

Underlying `v_inventory_issues` unchanged.

---

## State meanings

| Status | Panel (Active filter) | Alerts | Notes |
|--------|----------------------|--------|-------|
| `open` | Visible | Counted | Default |
| `reviewed` | Visible + badge | Counted | Acknowledged, still actionable |
| `snoozed` | Hidden until expiry | Excluded | Expired snooze → active again in view |
| `resolved` | Hidden (Resolved filter) | Excluded | Does not fix underlying data |
| `ignored` | Hidden (Resolved filter) | Excluded | Same as resolved for visibility |

---

## UI actions (issue detail modal)

- **Mark Reviewed** — workflow only
- **Snooze** — 1 day, 7 days, custom date
- **Mark Resolved** — optional note; hides from Active + alerts
- **Ignore** — optional note; same visibility as resolved
- **Reopen** — when viewing resolved/ignored state

Copy states clearly that actions do not change inventory.

**Issues panel filters:** Active (default) · Reviewed · Snoozed · Resolved/Ignored

---

## Alert behavior

Alert pills use **`is_active_workflow`** from joined issue rows:

- Exclude resolved/ignored
- Exclude active snoozes
- **Reviewed issues remain in alert counts** (still need attention unless snoozed/resolved)

---

## Files

| Created | Purpose |
|---------|---------|
| `supabase/migrations/20260910_inventory_phase8b_issue_resolution_tracking.sql` | Table + view |
| `js/admin/inventory/services/issueKeys.js` | Stable keys |
| `js/admin/inventory/services/issueWorkflow.js` | Filter + alert helpers |
| `js/admin/inventory/api/issueStateApi.js` | State CRUD |
| `scripts/verify-inventory-phase8b-issue-resolution-tracking.mjs` | Verification |

| Changed | |
|---------|--|
| `inventoryApi.js` | Fetch from `v_inventory_issues_with_state` |
| `state.js` | `issueRowsAll`, workflow filter |
| `renderIssues.js` | Badges + filter pills |
| `issueDetailModal.js` | Workflow actions |
| `buildAlerts.js` | Active-workflow-only counts |
| `events.js` | `refreshIssuesPanel`, `findIssueByType` |
| `issuesApi.js` | Sample `issueKey` on rows |

---

## Verification

```bash
node scripts/verify-inventory-phase8b-issue-resolution-tracking.mjs
```

**Result:** PASS

---

## Limitations

- Group-level workflow only (not per sample row in UI)
- No DELETE — history retained
- Resolved state keyed by issue type, not affected count; re-detection after fix does not auto-clear state
- Custom snooze uses browser `prompt` (simple; replace with date picker later)

---

## Recommended next phase

**Phase 8C** — Unmapped order line mapping-assist wizard, or sample-level snooze/resolve for high-volume issue types.

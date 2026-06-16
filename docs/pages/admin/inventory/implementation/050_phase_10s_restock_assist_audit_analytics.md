# Phase 10S — Restock Assist Audit Viewer + Queue Analytics

**Status:** Complete  
**Depends on:** [049_phase_10r_marketplace_restock_assist_queue.md](./049_phase_10r_marketplace_restock_assist_queue.md)  
**Verification:** `node scripts/verify-inventory-phase10s-restock-assist-audit-analytics.mjs`

---

## Goal

Add visibility and reporting for the marketplace restock assist queue and audit trail. Read-only audit viewer, KPI summary strip, and lightweight snooze/review triage — **no stock mutations** outside existing confirmed restock RPC.

---

## 1. Queue KPI strip

**View:** `v_inventory_marketplace_restock_assist_queue_summary` (single aggregate row)

| KPI | Definition |
|-----|------------|
| Ready to Restock | `ready_to_restock` bucket, not snoozed/dismissed |
| Needs Physical Confirmation | `needs_physical_confirmation`, not snoozed/dismissed |
| Needs RMA | `needs_rma`, not snoozed/dismissed |
| Stale Observations | `stale_observation`, not snoozed/dismissed |
| Manual Review | `manual_review`, not snoozed/dismissed |
| Blocked | `blocked`, not snoozed/dismissed |
| Already Done | `already_done` (all rows) |
| Total Open Queue Items | All buckets except `already_done`, not snoozed/dismissed |
| Snoozed | Actively snoozed (`snoozed_until > now()`) |
| Oldest stale observation age | Max `observation_age_hours` where stale |
| Total restockable qty | Sum `max_restockable_qty` for non-done rows |
| Estimated pending component qty | Sum suggested/max qty for ready rows |

Rendered above queue tabs in the modal via `marketplaceRestockAssistQueueKpi.js`.

---

## 2. Audit history view

**View:** `v_inventory_marketplace_restock_assist_audit`

Joins `marketplace_restock_assist_actions` with candidates/queue context for denormalized SKU/title/order fields. Includes `ledger_id` extracted from `raw_context`.

Read-only — no mutations.

---

## 3. Queue triage state

**Table:** `marketplace_restock_assist_queue_states`

| status | Meaning |
|--------|---------|
| `open` | Default — visible in bucket filters |
| `reviewed` | Admin reviewed; badge shown; still visible |
| `snoozed` | Hidden from bucket views until `snoozed_until` expires |
| `dismissed` | Hidden from open bucket views (does not remove stale/blocked semantics from underlying bucket) |

**RPC:** `upsert_marketplace_restock_assist_queue_state` — admin-only, no stock change.

**View:** `v_inventory_marketplace_restock_assist_queue_with_triage` — 10R queue + triage overlay.

Snooze expires automatically when `snoozed_until` passes — row reappears in original bucket.

---

## 4. Audit viewer UI

**Module:** `marketplaceRestockAssistAuditPanel.js`  
**Tab:** Audit History in queue modal

**Filters:** action type, channel, SKU/title search, order id, date range; per-reservation filter via **View Audit** row action.

**Rows show:** action type, qty, component, parent bundle, order line link, observation id, ledger reference, note, timestamp.

---

## 5. Queue UI updates

**Tabbed modal:** Queue | Audit History

**New bucket filter:** Snoozed

**Per-row actions:** Mark Reviewed, Snooze, Unsnooze, Add Note, View Audit (plus existing 10R actions)

**Batch actions:** Mark selected reviewed, Snooze selected, Unsnooze selected, Refresh selected — **no batch restock**

Audit action types extended: `snoozed`, `unsnoozed`, `dismissed`

---

## 6. Verification

```bash
node scripts/verify-inventory-phase10s-restock-assist-audit-analytics.mjs
```

---

## 7. Limitations

- KPI summary is point-in-time; not cached
- Audit list capped at 150 rows per query
- Admin display uses UUID prefix only (no email join)
- Snooze duration entered as hours via prompt — no calendar picker
- Dismissed status available in schema but not exposed as primary UI action (skip covers similar workflow)
- No export/CSV for audit history

---

## 8. Recommended next phase — 10T

**Delivered in:** [051_phase_10t_restock_channel_followup.md](./051_phase_10t_restock_channel_followup.md)

Post-restock channel follow-up checklist, sync modal links, follow-up state tracking.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20261013_inventory_phase10s_restock_assist_audit_analytics.sql` | Summary/audit/triage views, states table, RPCs |
| `js/admin/inventory/api/marketplaceRestockAssistAnalyticsApi.js` | **New** summary, audit, triage API |
| `js/admin/inventory/api/marketplaceRestockAssistQueueApi.js` | Triage view fetch + field mapping |
| `js/admin/inventory/ui/marketplaceRestockAssistQueueActions.js` | **New** row/batch action handlers |
| `js/admin/inventory/ui/marketplaceRestockAssistQueueKpi.js` | **New** KPI strip |
| `js/admin/inventory/ui/marketplaceRestockAssistAuditPanel.js` | **New** audit tab |
| `js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js` | KPI, tabs, snooze/review/audit actions |

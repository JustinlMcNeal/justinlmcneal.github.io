# Phase 10U — Unified Returns / Restock Dashboard

**Status:** Complete  
**Depends on:** [051_phase_10t_restock_channel_followup.md](./051_phase_10t_restock_channel_followup.md)  
**Verification:** `node scripts/verify-inventory-phase10u-returns-restock-dashboard.mjs`

---

## Goal

Single admin workbench combining returns/RMA guidance, marketplace restock assist, post-restock channel follow-ups, and recent restock audit — **navigation and guidance only**. No new inventory mutation paths.

---

## 1. Dashboard views

### Summary — `v_inventory_returns_restock_dashboard_summary`

| KPI | Definition |
|-----|------------|
| `open_return_workflows` | Return workflows not closed/canceled |
| `received_not_restocked` | Resellable received qty not yet restocked |
| `ready_to_restock` | Restock assist queue bucket `ready_to_restock` |
| `stale_observations` | Queue rows with observations &gt; 48h |
| `open_channel_followups` | Open follow-up candidates needing channel review |
| `sync_needed_after_restock` | Same as open channel follow-ups (informational) |
| `blocked_manual_review` | Queue buckets `manual_review` or `blocked` (not snoozed/dismissed) |
| `recent_restocks_count` | Applied restocks in last 7 days |
| `recent_restocked_qty` | Sum of restock qty in last 7 days |
| `dashboard_attention_count` | Composite attention score for issue routing |

### Worklist — `v_inventory_returns_restock_dashboard_worklist`

| row_type | Source |
|----------|--------|
| `restock_assist` | `v_inventory_marketplace_restock_assist_queue_with_triage` |
| `channel_followup` | `v_inventory_restock_followup_candidates` |
| `return_workflow` | `v_inventory_bundle_component_return_workflow_guidance` |
| `audit` | `v_inventory_marketplace_restock_assist_audit` (`restock_confirmed`, 7d) |
| `manual_review` | Queue rows in `manual_review` / `blocked` |

Fields: priority, source channel, order/line ids, component/parent SKUs and titles, status, reason, recommended_action, observation staleness, suggested/max restock qty, event timestamp.

---

## 2. UI

**Entry:** Bundle Rules panel → **Returns & Restock Dashboard** (alongside Marketplace Restock Queue).

**Module:** `returnsRestockDashboardModal.js` (+ `returnsRestockDashboardKpi.js`, `returnsRestockDashboardActions.js`, `returnsRestockDashboardApi.js`)

- KPI strip from summary view
- Tabs: Worklist · Ready to Restock · Returns/RMA · Channel Follow-Ups · Audit
- Filters: channel, status, SKU/title search, priority ceiling, stale only
- Row actions **reuse existing handlers** — no duplicated restock logic

---

## 3. Reused actions

| Action | Delegates to |
|--------|----------------|
| Open Order Line | Line Items deep link |
| Bundle Return/Restock | Bundle Preview + scroll to returns section |
| Restock Assist Queue | `openMarketplaceRestockAssistQueueModal` (bucket from row) |
| Follow-Up Checklist | `openRestockFollowupChecklistModal` |
| Sync Preview | `openSyncDryRunModal` with SKU/variant context (no auto-run) |
| Mark Reviewed / Snooze | Existing queue state + audit log RPCs (assist rows only) |

**Final restock** still only via Restock Assist Queue or Bundle Return/Restock panel → `restock_bundle_component_line`.

---

## 4. Issue integration

**Issue:** `returns_restock_dashboard_attention` (low severity)

Triggers when `dashboard_attention_count > 0`. Primary action opens dashboard worklist; secondary opens Restock Assist Queue (ready bucket). Does not replace existing return/restock issue groups.

---

## 5. What remains manual

- Physical return confirmation
- RMA / return workflow creation
- Admin-confirmed component restock
- Marketplace observation refresh
- Channel quantity sync push
- Follow-up checklist completion

---

## 6. Files

| File | Role |
|------|------|
| `supabase/migrations/20261015_inventory_phase10u_returns_restock_dashboard.sql` | Summary + worklist views; issues patch |
| `js/admin/inventory/api/returnsRestockDashboardApi.js` | Read-only API |
| `js/admin/inventory/ui/returnsRestockDashboardModal.js` | Dashboard modal |
| `js/admin/inventory/ui/returnsRestockDashboardKpi.js` | KPI strip |
| `js/admin/inventory/ui/returnsRestockDashboardActions.js` | Action routing |
| `js/admin/inventory/renderers/renderBundle.js` | Entry button |
| `js/admin/inventory/dom.js` + `pages/admin/inventory.html` | Modal mount |
| `js/admin/inventory/services/issueActions.js` | Issue definition |
| `js/admin/inventory/services/issueActionHandlers.js` | Issue route |

---

## 7. Verification results

Run: `node scripts/verify-inventory-phase10u-returns-restock-dashboard.mjs`

- Static: files present, line limits, no restock RPC in dashboard modules
- DB (when migration applied): summary + worklist views query OK
- Browser: entry button, modal mount, existing queue/bundle entries preserved

---

## 8. Limitations

- Worklist is read-only union — duplicate reservation may appear as assist + manual_review rows
- No saved filters or deep-link URL params yet
- Dashboard does not batch-restocks; use Restock Assist Queue for batch actions
- `sync_needed_after_restock` KPI mirrors open follow-ups (not a separate sync-failure detector)

---

## 9. Recommended next phase

**Phase 10V** — implemented in [053_phase_10v_dashboard_deeplinks_exports.md](./053_phase_10v_dashboard_deeplinks_exports.md): deep links, presets, grouping, export metrics.

---

## Related

- [051_phase_10t_restock_channel_followup.md](./051_phase_10t_restock_channel_followup.md) — follow-up checklist (superseded as primary entry by dashboard, not removed)
- [049_phase_10r_marketplace_restock_assist_queue.md](./049_phase_10r_marketplace_restock_assist_queue.md) — batch restock queue

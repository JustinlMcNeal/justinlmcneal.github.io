# Phase 10V — Dashboard Deep Links, Saved Presets, and Export Metrics

**Status:** Complete  
**Depends on:** [052_phase_10u_returns_restock_dashboard.md](./052_phase_10u_returns_restock_dashboard.md)  
**Verification:** `node scripts/verify-inventory-phase10v-dashboard-deeplinks-exports.mjs`

---

## Goal

Improve Returns & Restock Dashboard usability with URL deep links, filter presets, duplicate row grouping, and read-only export/reporting — **no new inventory mutation paths**.

---

## 1. URL deep links

**Param:** `returns_dashboard=1` opens the dashboard on inventory page load.

| Param | Purpose |
|-------|---------|
| `tab` | `worklist`, `ready`, `returns`, `followup` / `followups`, `audit` |
| `channel` | `amazon`, `ebay`, `kk` |
| `status` | Worklist status / queue bucket |
| `priority` | Max priority (inclusive) |
| `stale_only` | `1` = stale observations only |
| `q` | SKU/title search |
| `row_type` | Filter by worklist row type |
| `reservation_id` | Highlight target row |
| `order_id` | Highlight target row |
| `observation_id` | Highlight target row |
| `restock_action_id` / `followup_id` | Highlight target row |

**Example:**  
`/pages/admin/inventory.html?returns_dashboard=1&tab=followups&channel=amazon&stale_only=1`

Behavior:

- Bootstrap in `index.js` auto-opens modal after admin auth.
- Filters applied from URL; `history.replaceState` keeps URL in sync on Apply/tab/preset.
- Matching row gets amber highlight + scroll-into-view.
- Missing target shows friendly banner (completed/snoozed/outside window).

**Module:** `returnsRestockDashboardDeepLink.js`

---

## 2. Saved filter presets

**Static presets (8):**

| Preset | Tab / filters |
|--------|----------------|
| Ready to Restock | `tab=ready` |
| Needs Physical Confirmation | `status=needs_physical_confirmation`, `row_type=restock_assist` |
| Stale Observations | `stale_only` |
| Open Channel Follow-Ups | `tab=followup` |
| Manual Review | `row_type=manual_review` |
| Recent Restocks | `tab=audit` |
| Amazon Attention | `channel=amazon`, `priority≤250` |
| eBay Attention | `channel=ebay`, `priority≤250` |

**User presets:** saved to `localStorage` (`inventory_returns_dashboard_presets_v1`, max 12) via **Save Preset**.

**Module:** `returnsRestockDashboardPresets.js`

---

## 3. Duplicate worklist grouping

Grouped view (default on) clusters rows by:

1. `reservation_id`, else
2. `source_order_id` + `source_order_item_id`, else
3. unique `row_id`

Each group shows:

- Shared component/bundle header
- Type chips: Return workflow · Restock assist · Follow-up · Audit · Manual review
- Nested sub-rows with **full per-row actions** preserved

Toggle **Grouped** off for flat raw list.

**Module:** `returnsRestockDashboardGrouping.js`

---

## 4. Export / metrics

**Export actions (clipboard or CSV download):**

| Action | Source |
|--------|--------|
| Copy/Download Worklist | Current filtered rows |
| Copy Audit | `v_inventory_marketplace_restock_assist_audit` (30d) |
| Copy Follow-Ups | Open follow-up candidates |
| Copy Metrics | Dashboard metrics view |

**Worklist export fields:** source channel, order/line ids, component/parent SKUs & titles, row type, status, reason, qty, follow-up status, audit action, timestamps, reservation/restock ids.

**Module:** `returnsRestockDashboardExport.js`

---

## 5. Metrics view

**View:** `v_inventory_returns_restock_dashboard_metrics`

| Metric | Definition |
|--------|------------|
| `restocks_7d` / `restocks_30d` | Applied component restocks |
| `qty_restocked_7d` / `qty_restocked_30d` | Sum restock qty |
| `open_followups` | Open channel follow-ups (30d window) |
| `completed_followups` | Reviewed/sync/dismissed follow-ups |
| `avg_hours_restock_to_followup_completion` | Mean hours restock → follow-up done (90d) |
| `stale_observation_count` | From summary view |
| `manual_review_count` | Blocked/manual queue items |

Rendered in KPI strip when migration applied.

---

## 6. Files

| File | Role |
|------|------|
| `supabase/migrations/20261016_inventory_phase10v_dashboard_deeplinks_exports.sql` | Metrics view |
| `js/admin/inventory/ui/returnsRestockDashboardDeepLink.js` | URL parse/build/highlight |
| `js/admin/inventory/ui/returnsRestockDashboardPresets.js` | Static + user presets |
| `js/admin/inventory/ui/returnsRestockDashboardGrouping.js` | Grouped worklist render |
| `js/admin/inventory/ui/returnsRestockDashboardExport.js` | CSV/clipboard export |
| `js/admin/inventory/services/returnsRestockDashboardBootstrap.js` | Auto-open from URL |
| `js/admin/inventory/ui/returnsRestockDashboardModal.js` | Integrated UI |
| `js/admin/inventory/api/returnsRestockDashboardApi.js` | Metrics fetch |
| `js/admin/inventory/api/restockFollowupApi.js` | List follow-ups for export |

---

## 7. Verification results

Run: `node scripts/verify-inventory-phase10v-dashboard-deeplinks-exports.mjs`

Static + browser checks pass; DB checks run when migration applied.

---

## 8. Limitations

- User presets are browser-local only (no DB preferences).
- Highlight search is client-side over loaded worklist (250 rows) — very old rows may not appear.
- Export audit capped at 500 rows / 30 days.
- Grouping by reservation may still split rows without reservation id.
- Metrics avg follow-up time excludes dismissed-only paths.

---

## 9. Recommended next phase

**Phase 10W** — implemented in [054_phase_10w_returns_restock_digest.md](./054_phase_10w_returns_restock_digest.md): scheduled digest + preview.

---

## Related

- [052_phase_10u_returns_restock_dashboard.md](./052_phase_10u_returns_restock_dashboard.md) — base dashboard

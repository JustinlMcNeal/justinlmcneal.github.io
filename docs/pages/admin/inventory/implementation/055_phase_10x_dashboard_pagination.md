# Phase 10X — Server-Side Paginated Returns / Restock Worklist

**Status:** Complete  
**Depends on:** [054_phase_10w_returns_restock_digest.md](./054_phase_10w_returns_restock_digest.md)  
**Verification:** `node scripts/verify-inventory-phase10x-dashboard-pagination.mjs`

---

## Goal

Harden the Returns & Restock Dashboard for large backlogs with server-side pagination, count-aware filters, and target-row lookup — **read-only workbench only**.

---

## 1. Paginated RPC

**Function:** `get_returns_restock_dashboard_worklist_page`

| Input | Purpose |
|-------|---------|
| `p_tab` | worklist / ready / returns / followup / audit |
| `p_channel`, `p_status`, `p_row_type`, `p_q`, `p_priority_max`, `p_stale_only` | Filters |
| `p_offset`, `p_limit` | Pagination (limit max 250) |
| `p_reservation_id`, `p_order_id`, `p_observation_id`, `p_restock_action_id`, `p_followup_id` | Target lookup |
| `p_seek_target` | Jump to page containing target row |

**Returns:** `rows`, `total_count`, `page_count`, `offset`, `limit`, `has_more`, `next_offset`, `prev_offset`, `bucket_counts`, `target_found`, `target_offset`, `target_row`, `target_rn`

**Rules:** Admin-only (authenticated `is_admin()`), read-only, sources `v_inventory_returns_restock_dashboard_worklist`.

---

## 2. Count-aware filters

`bucket_counts` includes:

| Key | Meaning |
|-----|---------|
| `tab_worklist`, `tab_ready`, `tab_returns`, `tab_followup`, `tab_audit` | Tab totals (filters applied, tab filter excluded) |
| `stale_only` | Stale observation count |
| `by_channel`, `by_status`, `by_row_type` | Breakdown objects |

Tab buttons show counts without loading all rows.

---

## 3. Target-row lookup

Deep links with `reservation_id`, `order_id`, `observation_id`, or `restock_action_id`:

- First load uses `p_seek_target=true` to jump to the correct page
- If target exists but not on current page: **Load Target Row** button
- If not found: friendly banner (completed/snoozed/outside filters)

URL also supports `page`, `page_size`, and `offset`.

---

## 4. UI pagination

- Page size: **50 / 100 / 250**
- Previous / Next
- Range display: `1–50 of 237`
- Filters + tab changes reset to offset 0
- Grouping applies to **current page** only
- Export labels: **Copy Page**, **CSV Page**, **CSV Filtered** (up to 2,000 rows)

---

## 5. Export behavior

| Action | Scope |
|--------|--------|
| Copy Page / CSV Page | Current page rows only |
| CSV Filtered | Paginated RPC loop, cap 2,000 |
| Audit / Follow-ups / Metrics | Unchanged (separate sources) |

---

## 6. Performance / indexes

- Worklist remains the unified view (no duplicate business logic)
- Added index: `inventory_bundle_component_restock_actions (created_at DESC) WHERE status = 'applied'` for audit section ordering
- No over-indexing on view unions — revisit if query plans degrade

---

## 7. Files

| File | Role |
|------|------|
| `supabase/migrations/20261018_inventory_phase10x_dashboard_pagination.sql` | RPC + index |
| `js/admin/inventory/api/returnsRestockDashboardApi.js` | Page fetch + filtered export loop |
| `js/admin/inventory/ui/returnsRestockDashboardPage.js` | Load/target helpers |
| `js/admin/inventory/ui/returnsRestockDashboardPagination.js` | Pagination bar |
| `js/admin/inventory/ui/returnsRestockDashboardModal.js` | Paginated UI |
| `js/admin/inventory/ui/returnsRestockDashboardDeepLink.js` | page/page_size URL params |

---

## 8. Verification results

Run: `node scripts/verify-inventory-phase10x-dashboard-pagination.mjs`

**2026-06-09:** Static + browser checks PASSED. DB RPC check skipped (apply migration for live RPC test).

---

## 9. Limitations

- Grouping is per-page (reservation groups may split across pages)
- Filtered export capped at 2,000 rows
- Channel/status dropdown options come from bucket aggregates (may omit zero-count values)
- `fetchReturnsRestockDashboardWorklist` direct view fetch retained for legacy callers but dashboard uses RPC only

---

## 10. Recommended next phase

**Phase 10Y-Pool** — implemented in [056_phase_10y_final_stabilization_pool_safety.md](./056_phase_10y_final_stabilization_pool_safety.md). Returns/Restock dashboard remains **feature-frozen** per [056_phase_10y_final_stabilization.md](./056_phase_10y_final_stabilization.md). Paginated worklist RPC is read-only and does not contribute to pool exhaustion when opened alone — pool risk is primarily from main inventory **issues view** architecture (fixed by 10AA).

**Verify pool safety:** `node scripts/verify-inventory-issue-view-safety.mjs`

---

## Related

- [052_phase_10u_returns_restock_dashboard.md](./052_phase_10u_returns_restock_dashboard.md)
- [053_phase_10v_dashboard_deeplinks_exports.md](./053_phase_10v_dashboard_deeplinks_exports.md)

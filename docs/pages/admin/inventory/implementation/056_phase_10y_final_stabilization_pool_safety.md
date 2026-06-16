# Phase 10Y — Production Pool-Safety Stabilization (DB Recovery Only)

**Status:** Complete — **no new product features**  
**Depends on:** [055_phase_10x_dashboard_pagination.md](./055_phase_10x_dashboard_pagination.md)  
**Supersedes scope of:** [056_phase_10y_final_stabilization.md](./056_phase_10y_final_stabilization.md) (Returns/Restock feature freeze — unchanged)  
**Runbook:** [057_supabase_pool_exhaustion_runbook.md](./057_supabase_pool_exhaustion_runbook.md)  
**Verification:** `node scripts/verify-inventory-phase10y-final-stabilization.mjs`

---

## Goal

Stop Supabase **connection pool exhaustion** caused by the inventory admin read path. Ensure `pages/admin/inventory.html` and mapping/finalize workflows cannot knock the project **Unhealthy** again.

**Explicitly out of scope for this phase:**

- New Returns/Restock dashboard features
- Slack digest
- New dashboard sections
- Restock workflow changes
- Legacy Stripe full-refund stock-restore deprecation
- New channel sync behavior
- Virtual bundle channel sync automation
- RMA carrier/label integration

---

## Root cause

The inventory issues panel (`v_inventory_issues`) was built to surface **core + extended** issue counts (mapping gaps, bundle returns, shipped-finalize audit, marketplace refunds, etc.). Phase **10Z** inlined live scans of heavy SQL views into `v_inventory_issues`. Every page load held a Postgres connection for **15–180+ seconds**. Combined with:

- Parallel panel fan-out (KPIs, workspace, ledger, channel, parcel, issues)
- Browser-triggered `refresh_inventory_issue_snapshots_admin` after Map Assist
- pg_cron snapshot jobs overlapping admin sessions

…this exhausted Supabase’s small connection pool → **Unhealthy** project, REST timeouts, ABORTED health checks.

Storefront Storage traffic is **not** the cause.

---

## Permanent architecture (Phase 10AA + 10AB)

### 10AA — Snapshot-backed issues

| Object | Role |
|--------|------|
| `v_inventory_issues_core` | Fast live counts (product scan + cheap table counts) — safe every page load |
| `inventory_issue_snapshots` | Precomputed extended issue counts |
| `refresh_inventory_issue_snapshots()` | Heavy scan — **service_role / pg_cron only** |
| `refresh_inventory_issue_snapshots_admin()` | Admin RPC wrapper — **not called from browser** |
| `v_inventory_issues` | `core UNION ALL snapshots WHERE affected_count > 0` |
| pg_cron `inventory-issue-snapshots-every-15m` | Refreshes snapshots every 15 minutes |

**Migration:** `supabase/migrations/20261020_inventory_phase10aa_issues_snapshot.sql`

### 10AB — Missing SKU false alarms

Products admin stores SKU on `products.code`, not always on `product_variants.sku`. 10AB only flags **Missing SKU** when **both** are empty, and aligns `v_inventory_workspace` unmapped flags.

**Migration:** `supabase/migrations/20261021_inventory_phase10ab_missing_sku_product_code.sql`

### 10Z — DO NOT APPLY

`supabase/migrations/20261019_inventory_phase10z_optimize_issues_view.sql` is **retained for history only**. It replaces `v_inventory_issues` with a live heavy view and **will exhaust the pool**. Header comment + verification script guard against accidental re-application.

---

## Client-side pool safety (Phase 10Y)

| Change | File | Behavior |
|--------|------|----------|
| Staggered issues load | `js/admin/inventory/state.js` | Core panels first; issues after ~400ms delay |
| Issues timeout + mock fallback | `state.js` | 45s timeout; mock on failure |
| No browser snapshot RPC | `state.js`, `inventoryApi.js` | Removed `scheduleIssueSnapshotRefresh` and `refreshInventoryIssueSnapshotsAdmin` |
| Lightweight post-mapping refresh | `refreshInventoryData.js` | After Map Assist/finalize: **issues panel + post-map queue only** — not full workspace/KPI/ledger |
| Extended counts may lag | UI | Up to **15 minutes** until cron refreshes snapshots |

---

## Emergency recovery

When project status is **Unhealthy**:

1. **Restart Postgres** — Supabase Dashboard → Settings → Infrastructure → Restart database  
2. Wait for **Healthy**  
3. Run:

```bash
node scripts/supabase/wait-and-recover-db.mjs
```

This script:

- Waits for REST to respond
- Applies `scripts/supabase/emergency-recover-db.sql` (lite issues view + unschedule crons temporarily)
- Re-applies **10AA + 10AB**
- Restores pg_cron via `scripts/supabase/restore-pg-cron-jobs.mjs`

Manual fallback: paste `scripts/supabase/emergency-recover-db.sql` into SQL Editor, then apply 10AA/10AB migrations in order.

---

## Production deployment checklist

Apply **in filename order** (skip 10Z):

| Order | Migration | Purpose |
|-------|-----------|---------|
| 1 | `20261020_inventory_phase10aa_issues_snapshot.sql` | Snapshot architecture |
| 2 | `20261021_inventory_phase10ab_missing_sku_product_code.sql` | Missing SKU / workspace fix |

**Do not apply:** `20261019_inventory_phase10z_optimize_issues_view.sql`

**Post-apply verification:**

```bash
node scripts/verify-inventory-issue-view-safety.mjs
node scripts/verify-inventory-phase10aa-issues.mjs
node scripts/verify-inventory-phase10y-final-stabilization.mjs
node scripts/verify-inventory-page-load.mjs
```

**Restore crons** (if emergency recovery unscheduled them):

```bash
node scripts/supabase/restore-pg-cron-jobs.mjs
```

---

## Verification scripts

| Script | Purpose |
|--------|---------|
| `scripts/verify-inventory-issue-view-safety.mjs` | 10AA path, no heavy refs in `v_inventory_issues`, no browser snapshot RPC |
| `scripts/verify-inventory-phase10aa-issues.mjs` | Issues query &lt; 3s, cron active, snapshots populated |
| `scripts/verify-inventory-phase10y-final-stabilization.mjs` | Composes safety + client policy + Returns/Restock smoke |
| `scripts/verify-inventory-page-load.mjs` | Playwright inventory page + Supabase health |
| `scripts/supabase/emergency-recover-db.sql` | Emergency lite view |
| `scripts/supabase/wait-and-recover-db.mjs` | Automated recovery |
| `scripts/supabase/restore-pg-cron-jobs.mjs` | Restore all pg_cron jobs |

---

## Operator guidelines

1. **Avoid multiple inventory tabs** during bulk Map Assist / eBay Worklist sessions.  
2. **Do not spam hard refresh** while the DB is slow — wait for Healthy status.  
3. **Extended issue counts can lag up to 15 minutes** — core counts (unmapped lines, low stock) are live.  
4. **Mapping still works** when snapshots lag; only bundle/return/audit *extended* issue badges may be stale briefly.  
5. If Unhealthy persists after restart → run `wait-and-recover-db.mjs`, verify 10AA applied, check logs for long-running queries.

---

## Deferred features (not this phase)

| Feature | Notes |
|---------|-------|
| Slack digest | Email digest exists; Slack deferred |
| Server-side reservation-grouped pagination | Main workspace still client-side up to 5000 rows |
| Legacy Stripe full-refund stock-restore deprecation | Separate migration phase |
| Virtual bundle channel sync policy automation | No new sync behavior |
| RMA carrier/label integration | Future |

---

## Acceptance criteria

- [x] No new inventory product features in this phase  
- [x] `v_inventory_issues` is snapshot-backed (10AA), not live-heavy (10Z)  
- [x] Browser does not call `refresh_inventory_issue_snapshots_admin`  
- [x] Post-mapping refresh is issues/queue only  
- [x] Verification fails if production `v_inventory_issues` references heavy views  
- [x] Emergency recovery scripts documented and present  
- [x] Returns/Restock Dashboard, Restock Assist Queue, Digest preview, Sync Dry Run still open (no auto-push)

---

## Related docs

- [057_supabase_pool_exhaustion_runbook.md](./057_supabase_pool_exhaustion_runbook.md) — incident timeline and technical deep dive  
- [056_phase_10y_final_stabilization.md](./056_phase_10y_final_stabilization.md) — Returns/Restock feature freeze (unchanged)  
- [055_phase_10x_dashboard_pagination.md](./055_phase_10x_dashboard_pagination.md) — dashboard pagination (read-only; separate from pool issue)

# Phase 4F — Sync Run History UI

**Prior:** [4A scheduled sync + stale detection](035_scheduled_sync_and_stale_detection.md)

Admin-visible log of `amazon_sync_runs` and row-level `amazon_sync_errors` for debugging sync issues without Supabase dashboard access.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Read-only sync run table (last 50 runs) | New edge functions |
| Client-side type/status filters | Server pagination |
| Expandable row error details | Activity audit for PATCH (→ 6F) |
| Refresh after manual/SKU sync | Export sync logs CSV |

---

## Part A — API helpers

**File:** `js/admin/amazon/api.js`

| Function | Purpose |
|----------|---------|
| `fetchAmazonSyncRuns({ limit, syncType, status, statuses })` | Query `amazon_sync_runs` (authenticated SELECT) |
| `fetchAmazonSyncRunErrors(syncRunId)` | Query `amazon_sync_errors` for a run |
| `fetchAmazonSyncSummary()` | Thin wrapper — last 10 runs for freshness line |

Default log limit: **50** runs. Error limit per run: **25**.

---

## Part B — Render module

**File:** `js/admin/amazon/renderSyncRuns.js`

- Status badges (success, partial, failed, running, …)
- Sync type labels: Manual, Scheduled (`incremental`), Single SKU, Full
- Trigger column: **Admin** (`triggered_by` set) vs **Cron** (null)
- Marketplace shorthand: US / CA / MX
- Expandable detail row with error list

---

## Part C — Sync log panel

**File:** `js/admin/amazon/syncRunHistory.js`

- Toggle: **View sync log ▾** / **Hide sync log ▴**
- Panel `#amazonSyncHistoryPanel` (collapsed by default)
- Filters: sync type, status (client-side on loaded 50 runs)
- **Details** button loads `amazon_sync_errors` lazily (cached per session)
- Refreshes when:
  - Panel opened
  - Manual **Sync Amazon** completes
  - Row **Sync SKU** completes

Wired in `js/admin/amazon/index.js`.

---

## Part D — HTML placement

**File:** `pages/admin/amazon.html`

Inside `#amazonSyncOpsBar` (Synced tab, all breakpoints):

- `#amazonSyncFreshness` — compact last scheduled/manual summary (unchanged behavior)
- `#amazonSyncHistoryToggle` — opens collapsible log
- `#amazonSyncHistoryPanel` — filters + `#amazonSyncRunsBody` table

---

## Columns

| Column | Source |
|--------|--------|
| When | `finished_at` or `created_at` |
| Type | `sync_type` |
| Mkt | `marketplace_id` |
| Status | `status` |
| Seen / New / Updated / Failed | `records_*` |
| Trigger | `triggered_by` null → Cron |
| Pages | `summary.pagesFetched` |
| Details | Expand errors |

---

## Security

- Read-only Supabase queries (RLS: authenticated SELECT on sync tables)
- No Amazon API calls from browser
- No secrets exposed

---

## Deployment

Frontend-only — no migration or edge function deploy required.

Ensure Phase 4A migration is applied if stale columns are used elsewhere; sync log reads base tables that exist since Phase 2F.

---

## Known limitations

- Shows last **50** runs only (no pagination)
- Filters apply client-side to loaded batch
- Does not show `summary.warnings` json inline (errors table only)
- Panel lives in `#amazonSyncOpsBar` (visible on mobile + desktop)
- Does not show `summary.warnings` json inline (errors table only)

---

## Recommended next phase

**5A — Live profit column** or **4E — Bulk price/qty** (deferred).

---

## Manual test checklist

1. Connect Amazon and run manual sync
2. Open **View sync log** — run appears with type Manual, trigger Admin
3. After cron tick — Scheduled run with trigger Cron
4. Row **Sync SKU** — Single SKU run appears
5. Failed run with errors — **Details** shows `amazon_sync_errors` rows
6. Filters narrow visible rows without reload

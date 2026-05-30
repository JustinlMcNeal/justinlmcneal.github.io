# Phase 4A — Scheduled Sync Cron + Stale Listing Detection

**Prior:** [2I incremental/full sync](021_incremental_full_sync.md) · [2V synced tab ops](034_synced_tab_search_and_row_actions.md)

Automated read-only incremental sync for active Amazon seller accounts, plus stale listing visibility on the Synced tab.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Cron edge function (`CRON_SECRET`) | Amazon listing writes |
| Shared sync orchestration refactor | Browser Amazon calls |
| Stale fields on workspace view | Stale purge / auto-deactivate |
| Stale badge + sync freshness UI | Full sync logs UI (→ 4F ✅) |
| Normal `amazon_sync_runs` rows | New stats card |

---

## Part A — Cron edge function

**Function:** `amazon-sync-listings-cron`

| Method | Behavior |
|--------|----------|
| `OPTIONS` | CORS |
| `POST` | Run scheduled sync |
| Other | `405 method_not_allowed` |

### Auth

Uses existing cron pattern from verify cron:

- Header: `x-cron-secret: <CRON_SECRET>`
- Or: `Authorization: Bearer <CRON_SECRET>`

No admin JWT. No browser access.

### Behavior

1. Validate `CRON_SECRET` + server env
2. Load up to `AMAZON_SYNC_CRON_BATCH_ACCOUNTS` (default **3**) active accounts:
   - `is_active = true`
   - `token_status = active`
3. For each account, run **incremental** sync on enabled marketplaces
4. `maxPages` from `AMAZON_SYNC_CRON_MAX_PAGES` (default **5**, cap 10)
5. `triggered_by = null` on sync runs (distinguishes cron from manual admin sync)
6. Aggregate response across accounts/marketplaces

Example response:

```json
{
  "ok": true,
  "accountsProcessed": 1,
  "marketplacesSynced": 1,
  "recordsSeen": 40,
  "recordsCreated": 2,
  "recordsUpdated": 38,
  "recordsFailed": 0,
  "status": "success",
  "runs": [],
  "warnings": []
}
```

Per-account failures are logged and appended to `warnings`; other accounts still process.

---

## Part B — Shared sync reuse

**New:** `supabase/functions/_shared/amazonSyncAccountUtils.ts`

Extracted from manual sync:

- `resolveConnectedAccount` / `loadActiveSellerAccounts`
- `resolveEnabledMarketplaceIds`
- `ensureAccountAccessToken`
- `runSellerAccountSync` → per-marketplace `runMarketplaceSync`

**New:** `supabase/functions/_shared/amazonSyncCronUtils.ts`

- Re-exports `requireCronSecret`
- `getCronMaxPages()` / `getCronBatchAccounts()`

**Refactored:** `amazon-sync-listings/index.ts` now calls shared helpers (manual sync behavior unchanged).

---

## Part C — Stale listing detection

**Migration:** `supabase/migrations/20260801_amazon_stale_listing_views.sql`

Updates `v_amazon_listing_workspace` with:

| Field | Logic |
|-------|--------|
| `is_stale` | `last_synced_at IS NULL` OR older than **24 hours** |
| `stale_reason` | `never_synced` \| `sync_older_than_24h` \| `NULL` |
| `hours_since_sync` | Hours since `last_synced_at` (null if never synced) |

Also adds **`v_amazon_stale_listings`** (filtered view for ops queries).

---

## Part D — Frontend stale UI

| File | Change |
|------|--------|
| `js/admin/amazon/api.js` | Select stale columns; `countStaleListings()` |
| `js/admin/amazon/renderListings.js` | Orange **Stale** badge on Last Synced (table + mobile) |
| `js/admin/amazon/liveListings.js` | Pass `staleCount` to table header helper |
| `pages/admin/amazon.html` | `#amazonStaleCountLabel` near table count |

Badge title: *Last synced more than 24 hours ago*

Stale count shows total stale rows in loaded dataset (e.g. `3 stale`), not mixed into Issues stat.

---

## Part E — Sync freshness panel

**New:** `js/admin/amazon/syncFreshness.js`

**API:** `fetchAmazonSyncSummary()` — last 10 `amazon_sync_runs` (authenticated read)

Rendered in `#amazonSyncFreshness` under Listing Table header:

- Last scheduled sync → latest successful `sync_type = incremental`
- Last manual sync → latest successful `sync_type = manual`
- Tooltip on recent failed run (if any in last 10)

Refreshes after manual sync and row **Sync SKU**.

---

## Env vars

| Variable | Required | Default |
|----------|----------|---------|
| `CRON_SECRET` | Yes | — |
| `SUPABASE_URL` | Yes | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — |
| `AMAZON_LWA_CLIENT_ID` | Yes | — |
| `AMAZON_LWA_CLIENT_SECRET` | Yes | — |
| `AWS_ACCESS_KEY_ID` | Yes* | — |
| `AWS_SECRET_ACCESS_KEY` | Yes* | — |
| `AWS_SESSION_TOKEN` | No | — |
| `AWS_REGION` | No | — |
| `AMAZON_SP_API_ENDPOINT` | No | — |
| `AMAZON_SYNC_CRON_MAX_PAGES` | No | `5` |
| `AMAZON_SYNC_CRON_BATCH_ACCOUNTS` | No | `3` |

\*Unless `AMAZON_ALLOW_UNSIGNED_SP_API=true` (dev only).

---

## Cron setup

```http
POST /functions/v1/amazon-sync-listings-cron
x-cron-secret: <CRON_SECRET>
```

**Suggested schedule:** every **60 minutes** (conservative; can tighten to 30m once stable).

---

## Deployment

```bash
supabase db push
supabase functions deploy amazon-sync-listings
supabase functions deploy amazon-sync-listings-cron
```

Re-deploy `amazon-sync-listings` because shared orchestration was refactored.

---

## Security rules

- [x] No Amazon listing writes
- [x] Cron requires `CRON_SECRET`
- [x] Manual sync still requires admin JWT
- [x] No secrets in frontend
- [x] Sync runs remain read-only (`searchListingsItems` upsert only)

---

## Known limitations

- Stale threshold fixed at **24 hours** (not configurable yet)
- Cron processes up to **3 accounts** per run (env override)
- Incremental sync per marketplace capped at **5 pages** per cron tick
- Stale badge based on loaded rows (max 500), not full catalog count
- No dedicated sync logs UI yet — only freshness summary (→ **4F** ✅)
- `single_sku` row sync does not update “Last scheduled sync” line (by design)

---

## Recommended next phase

**4C — Listing PATCH** (price/qty updates via edge function). Sync run log: [`036_sync_run_history_ui.md`](036_sync_run_history_ui.md).

---

## Manual test checklist

1. Call cron with wrong secret → `401 unauthorized`
2. Call cron with valid secret → aggregate JSON, `amazon_sync_runs` rows with `sync_type = incremental`, `triggered_by IS NULL`
3. Manual **Sync Amazon** still works (admin JWT, `sync_type = manual`)
4. Row **Sync SKU** still works (`single_sku`)
5. After migration, Synced tab loads `is_stale` without error
6. Listings with old `last_synced_at` show **Stale** badge + count
7. `#amazonSyncFreshness` shows scheduled vs manual timestamps after syncs

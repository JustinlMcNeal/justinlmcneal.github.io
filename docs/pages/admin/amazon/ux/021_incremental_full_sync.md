# Phase 2I — Incremental + Full Sync Strategy

Upgrade read-only `amazon-sync-listings` from prototype to incremental/full sync foundation.

**Prior:** [2F read-only sync](018_read_only_sync_prototype.md) · [2H SigV4](019_sigv4_sync_signing.md) · [2G frontend wiring](020_frontend_live_wiring.md)

---

## Files Created / Modified

| Path | Change |
|------|--------|
| `supabase/functions/_shared/amazonSyncRunUtils.ts` | **New** — sync modes, pagination caps, cursor, per-marketplace runs |
| `supabase/functions/amazon-sync-listings/index.ts` | Multi-marketplace orchestration, token refresh, aggregate response |
| `supabase/functions/_shared/amazonSpApiUtils.ts` | Optional `searchListingsItems` filters + `source_submission_id` on issues |

No frontend changes required. Current UI manual sync (`syncType: "manual"`, `maxPages: 1`) remains compatible.

---

## Sync Modes

| Mode | Default pages | Max pages | Behavior |
|------|---------------|-----------|----------|
| `manual` | 1 | 5 | Safe UI default; same as prior prototype |
| `incremental` | 5 | 10 | Uses `lastUpdatedAfter` watermark from prior successful runs |
| `full` | 10 | 25 | Multi-page catalog pull; resumes stored `nextToken` on partial full runs |
| `single_sku` | 1 | 1 | Requires `sellerSku`; uses `identifiers` + `identifiersType=SKU` |

Input `syncType` values are validated against the schema enum.

### `manual`

Admin/UI triggered. No destructive behavior. Respects `maxPages` input (default 1, cap 5).

### `incremental`

1. Finds most recent `success` or `partial_success` run for same `seller_account_id` + `marketplace_id` among types `manual`, `incremental`, `full`.
2. Uses `summary.completedAt`, `sync_cursor.completedAt`, or `finished_at` as anchor.
3. Subtracts **5-minute overlap** to reduce missed updates.
4. Sends `lastUpdatedAfter` to SP-API when watermark exists.
5. If no prior run: warning `incremental_no_prior_watermark_used_full_scan` (unfiltered search).

### `full`

- Higher page cap for reconciliation syncs.
- If prior `full` run ended `partial_success` with `summary.hasMore` and stored `sync_cursor.nextToken`, resumes from that token.
- **Does not purge** listings missing from sync results.

### `single_sku`

Request body:

```json
{
  "syncType": "single_sku",
  "sellerSku": "KK-EXAMPLE-SKU",
  "marketplaceIds": ["ATVPDKIKX0DER"]
}
```

Uses read-only `searchListingsItems` with SKU identifier filter (not `getListingsItem` — same read endpoint, simpler transport).

---

## Multi-Marketplace Behavior

Input:

```json
{
  "marketplaceIds": ["ATVPDKIKX0DER"]
}
```

- Resolves against `amazon_marketplaces` (`is_enabled = true`).
- Falls back to account `marketplace_ids`, then `ATVPDKIKX0DER`.
- **One `amazon_sync_runs` row per marketplace** (clean tracking).
- Iterates all enabled IDs in request/account (removed prototype “first marketplace only” warning).

---

## Pagination Strategy

| Mode | Default `maxPages` | Cap |
|------|-------------------|-----|
| manual | 1 | 5 |
| incremental | 5 | 10 |
| full | 10 | 25 |
| single_sku | 1 | 1 |

- Page size: 20 (1 for `single_sku`).
- Respects Amazon `pageToken` pagination.
- Stores continuation in `amazon_sync_runs.sync_cursor`:

```json
{
  "lastUpdatedAfter": "2026-05-29T00:00:00.000Z",
  "nextToken": "<stored in DB only>",
  "completedAt": "2026-05-29T01:00:00.000Z"
}
```

Summary fields:

```json
{
  "pagesFetched": 3,
  "hasMore": true,
  "nextTokenStored": true,
  "completedAt": "2026-05-29T01:00:00.000Z"
}
```

**Raw `nextToken` is not returned to the browser** — DB only.

Non-SKU searches default to `sortBy=lastUpdatedDate&sortOrder=DESC`.

---

## Incremental Cursor / Watermark

Stored per run in `sync_cursor` and `summary.completedAt`.

Overlap: 5 minutes before last successful completion.

Prior run types considered: `manual`, `incremental`, `full`.

Live SP-API param: `lastUpdatedAfter` (ISO 8601) on `searchListingsItems` when watermark exists.

---

## Created vs Updated Accounting

Before upserting each page:

1. Batch-load existing `seller_sku` values for the page.
2. If SKU exists → `records_updated++`
3. If new → `records_created++`

`records_seen` = items returned by SP-API for the run.

---

## Issue Refresh Behavior

Per listing after upsert:

1. **Delete** open issues where `source = 'sync'` only.
2. **Preserve** manual, push, validation, and amazon_notification issues.
3. Insert normalized issues from SP-API `issues` dataset with `source = 'sync'`.
4. Populate `source_submission_id` when Amazon payload includes `submissionId` (or nested in `enforcements`).

---

## Stale Listing / No-Purge Strategy

- Listings **not** returned by a sync are **never deleted or auto-inactivated**.
- Full sync summary includes `staleHandling: "not_implemented_no_purge"`.
- Warning in run summary: `staleHandling:not_implemented_no_purge`.
- Future phase may mark stale candidates in summary only.

---

## Rate Limit Handling (429)

- One retry after **2 seconds** on HTTP 429.
- If still failing:
  - Some rows synced → `partial_success`, warning `rate_limited`
  - No rows → `failed`, error code `rate_limited` in `amazon_sync_errors`
- No aggressive multi-retry loop in this phase.

---

## Response Shape

### Backward-compatible top-level (first run + totals)

```json
{
  "ok": true,
  "syncRunId": "uuid-of-first-run",
  "status": "success",
  "recordsSeen": 20,
  "recordsCreated": 3,
  "recordsUpdated": 17,
  "recordsFailed": 0,
  "pagesFetched": 1
}
```

### New fields

```json
{
  "runs": [
    {
      "syncRunId": "uuid",
      "marketplaceId": "ATVPDKIKX0DER",
      "status": "success",
      "recordsSeen": 20,
      "recordsCreated": 3,
      "recordsUpdated": 17,
      "recordsFailed": 0,
      "pagesFetched": 1
    }
  ],
  "marketplacesSynced": 1,
  "warnings": ["staleHandling:not_implemented_no_purge"]
}
```

Current frontend (`syncActions.js`) uses `ok`, `status`, `recordsUpdated`, `recordsFailed` — unchanged.

Aggregate `status`:

- All runs `success` → `success`
- All runs `failed` → `failed`
- Mixed or any `partial_success` → `partial_success`

---

## SP-API Helper Updates

`searchListingsItemsPage` optional query params (included only when set):

| Param | Purpose |
|-------|---------|
| `sellerSku` | Sets `identifiers` + `identifiersType=SKU` |
| `lastUpdatedAfter` | Incremental watermark filter |
| `issueSeverity` | Optional issue filter (future use) |

Read-only GET only. No write endpoints added.

---

## Security

- No LWA/AWS secrets logged.
- No tokens in HTTP response.
- No raw pagination tokens returned to browser.
- Admin JWT + `is_admin()` unchanged.

---

## Known Limitations

1. Amazon `searchListingsItems` returns max **1000** items per search chain — full catalog may need scheduled multi-run pagination.
2. Incremental accuracy depends on Amazon updating `lastUpdatedDate` reliably — live validation recommended.
3. No stale SKU detection or inactive marking.
4. No FBA inventory enrichment.
5. No mapping save or push.
6. Multi-marketplace runs share one LWA token refresh per request (efficient but serial marketplace loops).

---

## Deployment Notes

Redeploy edge function after merge:

```bash
supabase functions deploy amazon-sync-listings
```

Requires existing secrets: `AMAZON_LWA_*`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_REGION`.

No new migrations in this phase.

Optional manual tests:

```json
{ "syncType": "manual", "maxPages": 1 }
{ "syncType": "incremental" }
{ "syncType": "full", "maxPages": 10 }
{ "syncType": "single_sku", "sellerSku": "YOUR-SKU" }
```

---

## Recommended Next Phase

**2J** — ✅ Mapping save — [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md)

**2K** — Push to Amazon submit (Listings Items PUT/PATCH) behind edge functions.

**2L** — Scheduled sync jobs + stale listing detection — ✅ [`035_scheduled_sync_and_stale_detection.md`](035_scheduled_sync_and_stale_detection.md)

---

## Related Docs

- [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md)
- [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md)
- [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)
- [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md)
- [`027_post_submit_verification.md`](027_post_submit_verification.md)
- [`035_scheduled_sync_and_stale_detection.md`](035_scheduled_sync_and_stale_detection.md)

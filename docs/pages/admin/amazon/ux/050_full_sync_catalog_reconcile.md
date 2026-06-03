# Full sync catalog reconcile (Needs Mapping cleanup)

**Prior:** [021 incremental/full sync](021_incremental_full_sync.md) · [022 mapping workflow](022_mapping_save_workflow.md)

When a **full** Amazon catalog sync completes **all pages** successfully, local rows whose `seller_sku` was **not** returned by SP-API are marked `amazon_sku_absent_at` (same as single-SKU “not found”). They disappear from **Needs Mapping** and **Synced**.

---

## When reconcile runs

| Condition | Reconcile |
|-----------|-----------|
| `syncType === "full"` | Eligible |
| Pagination complete (`hasMore === false`) | Required |
| Run status `success` (no SP-API failure / rate limit) | Required |
| `incremental` / `manual` / `single_sku` | Never |
| More pages remain (`pagination_incomplete_more_pages_available`) | Skipped — sync again |
| Run `partial_success` or `failed` | Skipped |

---

## Resumed full sync

If a prior full sync stopped mid-catalog (`partial_success` + stored `nextToken`):

1. Next full sync resumes pagination and **merges** `sync_cursor.seenSellerSkus` from the prior run.
2. Reconcile runs only after the **final** page succeeds.

---

## Side effects

- Sets `amazon_sku_absent_at` on stale rows (does not delete DB rows).
- Active `mapped` mappings on hidden rows → `legacy` (same as single-SKU absent).

---

## Admin UI

- **Sync catalog** button → `POST amazon-sync-listings` with `{ syncType: "full", maxPages: 25 }`.
- Toast includes `recordsMarkedAbsent` when cleanup ran.

---

## Deploy

Redeploy edge function: `amazon-sync-listings` (uses `_shared/amazonSyncRunUtils.ts`).

---

## Code

| File | Role |
|------|------|
| `supabase/functions/_shared/amazonSyncRunUtils.ts` | `reconcileAbsentAfterFullSync`, `seenSellerSkus` cursor |
| `js/admin/amazon/syncActions.js` | Full sync + toast |
| `pages/admin/amazon.html` | Button label / title |

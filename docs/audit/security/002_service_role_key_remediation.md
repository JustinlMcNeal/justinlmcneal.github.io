# Service Role Key Remediation

Audit date: 2026-05-17

## Files Remediated

- `pages/admin/settings.html`
- `supabase/SETUP_ANALYTICS_AGGREGATE_CRON.sql`
- `supabase/SETUP_EBAY_FINANCES_CRON.sql`
- `supabase/SETUP_EBAY_SYNC_CRON.sql`
- `supabase/SETUP_INSIGHTS_CRON.sql`
- `cleanup-stale-shipments.mjs` remains deleted in the working tree

## What Changed

### SQL setup files

The hardcoded Supabase service-role JWT was replaced with the placeholder:

```txt
<SUPABASE_SERVICE_ROLE_KEY>
```

Cron logic was otherwise left unchanged. These setup files now require the service-role key to be inserted manually when running local setup and must not be committed with a real key.

### `pages/admin/settings.html`

The hardcoded browser-delivered service-role credential was removed.

The unsafe privileged browser-side admin actions were disabled with an admin-facing message:

- Push subscription stats
- Register current browser as admin push device
- Send push notification
- eBay marketplace token status read
- eBay order sync trigger with service bearer
- eBay finance sync trigger with service bearer
- eBay token refresh trigger with service bearer
- eBay disconnect direct REST delete

The rest of the settings page behavior was not intentionally changed. The eBay OAuth redirect/callback request remains present, but status checks that depended on service-role browser access are disabled until moved behind a secure backend.

### Deleted cleanup script

`cleanup-stale-shipments.mjs` remains deleted from the working tree. It is not recreated.

Current status showed it as a deleted tracked file (`D cleanup-stale-shipments.mjs`). It still exists in `HEAD` until the deletion is committed, so git history may still contain the old key if it was previously committed or pushed.

### Local ignored script

While validating, an ignored local script `supabase/_sync_stripe_refunds.mjs` also contained a service-role JWT. It is ignored by `.gitignore`, so it was not part of the tracked-file exposure, but it was updated locally to read `SUPABASE_SERVICE_ROLE_KEY` from the environment instead of embedding a key.

## Validation Commands Run

```powershell
node "$env:TEMP\replace-service-placeholders.cjs"
```

```powershell
node "$env:TEMP\remediate-settings.cjs"
```

```powershell
node "$env:TEMP\scan-current-service-role-refined.cjs"
```

Result:

```json
{
  "serviceRoleFindings": [],
  "anonJwtCount": 4
}
```

```powershell
node --check "supabase/_sync_stripe_refunds.mjs"
```

```powershell
git status --short -- "pages/admin/settings.html" "supabase/SETUP_ANALYTICS_AGGREGATE_CRON.sql" "supabase/SETUP_EBAY_FINANCES_CRON.sql" "supabase/SETUP_EBAY_SYNC_CRON.sql" "supabase/SETUP_INSIGHTS_CRON.sql" "cleanup-stale-shipments.mjs" "supabase/_sync_stripe_refunds.mjs"
```

```powershell
git diff --check -- "pages/admin/settings.html" "supabase/SETUP_ANALYTICS_AGGREGATE_CRON.sql" "supabase/SETUP_EBAY_FINANCES_CRON.sql" "supabase/SETUP_EBAY_SYNC_CRON.sql" "supabase/SETUP_INSIGHTS_CRON.sql" "supabase/_sync_stripe_refunds.mjs"
```

```powershell
git check-ignore -v "supabase/_sync_stripe_refunds.mjs"
```

## Manual Follow-Up

- Rotate the Supabase service role key in the Supabase dashboard.
- Update local `.env` / shell environment values after rotation.
- Update Supabase Edge Function secrets if any functions depend on `SUPABASE_SERVICE_ROLE_KEY`.
- Update GitHub Actions, deployment provider secrets, cron setup secrets, or any other hosted secrets that use the old service-role key.
- Re-run the SQL cron setup files only with the rotated key inserted locally at execution time, never committed.
- Commit the deletion of `cleanup-stale-shipments.mjs` and the remediation edits.
- Assume git history may still contain the old service-role key if these files were previously committed or pushed.

## Required Backend Follow-Up

Privileged push and eBay admin actions from `pages/admin/settings.html` should be reintroduced only through secure Supabase Edge Functions or another server-side admin API that performs authentication/authorization without exposing service-role credentials to the browser.

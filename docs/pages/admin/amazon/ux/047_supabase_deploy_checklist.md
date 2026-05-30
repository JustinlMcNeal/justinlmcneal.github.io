# Supabase Deploy Checklist — KK Amazon Admin

One-time setup for the Amazon Listings admin page against project **`yxdzvzscufkvewecvagq`**.

---

## Done automatically (2026-05-29)

All **21 Amazon edge functions** deployed to Supabase:

| Function | Purpose |
|----------|---------|
| `amazon-auth-status` | Connection panel (read-only) |
| `amazon-auth-start` | Begin OAuth |
| `amazon-auth-callback` | OAuth callback |
| `amazon-auth-disconnect` | Disconnect seller |
| `amazon-map-listing` | Map KK product ↔ listing |
| `amazon-save-draft` | Local draft CRUD |
| `amazon-preview-draft` | Draft preview |
| `amazon-product-type-definition` | PTD fetch |
| `amazon-submit-draft-preview` | Validation preview |
| `amazon-submit-draft` | Live submit |
| `amazon-verify-submitted-draft` | Post-submit verify |
| `amazon-verify-submitted-drafts-cron` | Scheduled verify |
| `amazon-requeue-draft-verification` | Requeue verify |
| `amazon-bulk-requeue-draft-verification` | Bulk requeue |
| `amazon-search-product-types` | Product type search |
| `amazon-sync-listings` | Manual / single-SKU sync |
| `amazon-sync-listings-cron` | Scheduled sync |
| `amazon-patch-listing` | Price/qty patch |
| `amazon-bulk-patch-listings` | Bulk patch |
| `amazon-delete-draft` | Delete local draft |
| `amazon-estimate-listing-fees` | Product Fees API tooltip |

CORS preflight on `amazon-auth-status` returns **200** after deploy.

---

## Still required — database migrations

CLI `supabase db push` failed locally (stored Postgres password out of date). Apply Amazon schema with:

```powershell
cd d:\SMOJO\Online\Buisness\kk6\justinlmcneal.github.io
$env:SUPABASE_DB_PASSWORD = "<from Supabase Dashboard → Settings → Database>"
node scripts/supabase/apply-amazon-migrations.mjs
```

This creates tables/views including:

- `amazon_seller_accounts`, `amazon_listings`, `amazon_sync_runs`
- `v_amazon_listing_workspace` (Synced tab)
- Ready to push / drafts / health / profit views (20260721–20260806 chain)

**Alternative:** Supabase Dashboard → SQL Editor → paste each file under `supabase/migrations/20260721_*` through `20260806_*` in order.

---

## Still required — Amazon secrets

No `AMAZON_*` secrets exist on the project yet. **Do not paste keys in chat.**

Minimum for **Connect Amazon**:

```powershell
supabase secrets set AMAZON_APP_ID=...
supabase secrets set AMAZON_LWA_CLIENT_ID=...
supabase secrets set AMAZON_LWA_CLIENT_SECRET=...
supabase secrets set AMAZON_AUTH_REDIRECT_URI=https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/amazon-auth-callback
supabase secrets set AMAZON_SP_API_REGION=na
supabase secrets set AMAZON_DEFAULT_MARKETPLACE_ID=ATVPDKIKX0DER
```

Template: `scripts/supabase/amazon-secrets.example.env`

For **live sync/patch/submit**, also set AWS SigV4 credentials and feature flags — see `019_sigv4_sync_signing.md`.

---

## Verify

1. Hard refresh `/pages/admin/amazon.html` while logged in as admin
2. Auth panel → **Amazon is not connected** (not infinite spinner)
3. After migrations → no 404 on `v_amazon_listing_workspace`
4. After secrets + Connect → auth panel shows connected seller

---

## Local dev notes

- Live Server (`127.0.0.1:5500`) works once functions + migrations exist
- Tailwind CDN warning is harmless for local preview
- Amazon OAuth redirect URI must match `AMAZON_AUTH_REDIRECT_URI` exactly (include local URL only if registered in Amazon app)

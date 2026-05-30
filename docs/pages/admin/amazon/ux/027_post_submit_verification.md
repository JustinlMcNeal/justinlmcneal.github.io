# Phase 2O — Post-Submit Verification + Published Reconciliation

After live submit, drafts stay at `submitted` until a read-only verification confirms the SKU exists in the synced Amazon read model. Only then is the draft promoted to `published` and optionally mapped to the KK product.

**Prior:** [2N live submit](026_live_submit.md) · [2I incremental/full sync](021_incremental_full_sync.md)

---

## Why Submitted Before Published

Live submit (2N) calls Amazon Listings Items PUT and records `draft_status = submitted`. Amazon may accept the listing before it appears in Seller Central or in SP-API search results. Promoting to `published` immediately would falsely imply the listing is visible and mappable.

Verification is a separate admin action that:

1. Optionally runs a **single-SKU read-only sync**
2. Looks up `amazon_listings` by seller account + marketplace + seller SKU
3. Promotes the draft only when a verifiable listing row exists

No new Amazon write operations are added in this phase.

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/amazon-verify-submitted-draft/index.ts` | Admin verification edge function |
| `supabase/functions/_shared/amazonDraftVerifyUtils.ts` | Sync, lookup, mapping, promotion helpers |
| `js/admin/amazon/pushDraftVerify.js` | Verify Now UI + click handler |
| `docs/pages/admin/amazon/ux/027_post_submit_verification.md` | This document |

## Files Modified

| Path | Change |
|------|--------|
| `js/admin/amazon/api.js` | `verifySubmittedAmazonDraft()` |
| `js/admin/amazon/pushDraft.js` | Wire verify module + readiness |
| `js/admin/amazon/pushDraftLive.js` | Post-submit message + `onSubmitComplete` hook |
| `js/admin/amazon/index.js` | Refresh drafts, listings, unmapped after verify |
| `js/admin/amazon/renderDraftsIssues.js` | Verify Listing button for submitted drafts |
| `pages/admin/amazon.html` | Verify Now button in push modal footer |
| `docs/pages/admin/amazon/ux/026_live_submit.md` | Link to 2O |
| `docs/pages/admin/amazon/ux/021_incremental_full_sync.md` | Link to single-SKU verify usage |
| `docs/pages/admin/amazon/ux/020_frontend_live_wiring.md` | Link to verify wiring |

---

## Verification Edge Function

**Path:** `supabase/functions/amazon-verify-submitted-draft/index.ts`

| Method | Behavior |
|--------|----------|
| `OPTIONS` | CORS preflight |
| `POST` | Verify one submitted draft |
| Other | `405 method_not_allowed` |

### Auth

- `requireAdminJson()` — admin JWT required
- Uses service role for DB reads/writes only (no secrets in response)

### Input

```json
{
  "draftId": "uuid",
  "runSingleSkuSync": true
}
```

`runSingleSkuSync` defaults to `true`. When true, reuses existing read-only sync via `runMarketplaceSync` with `syncType: "single_sku"`.

### Behavior

1. Load draft; require `draft_status = submitted`
2. Require `seller_sku`, `marketplace_id`, and seller account
3. Optional single-SKU sync (read-only GET/search path only)
4. Lookup `amazon_listings` by `seller_account_id + marketplace_id + seller_sku`
5. If verifiable listing found:
   - Set `published_amazon_listing_id`
   - Set `draft_status = published`
   - Create or confirm mapping when `kk_product_id` present
6. Return verification status (see responses below)

### Verification Rules

Listing is **verified** when a row exists and `listing_status` is one of:

- `active`, `inactive`, `issue`, `suppressed`, `unknown`

`listing_status_buyable = true` is returned when present but **not required** for v1 — Amazon may still be processing the listing.

### Responses

**Verified:**

```json
{
  "ok": true,
  "verified": true,
  "draftStatus": "published",
  "amazonListingId": "uuid",
  "listingStatus": "active"
}
```

**Not yet found:**

```json
{
  "ok": true,
  "verified": false,
  "draftStatus": "submitted",
  "reason": "listing_not_found_yet"
}
```

**Safe errors:** `unauthorized`, `forbidden`, `method_not_allowed`, `invalid_request`, `draft_not_found`, `draft_not_submitted`, `amazon_not_connected`, `sync_failed`, `database_error`, `server_misconfigured`

---

## Single-SKU Read-Only Sync

Implemented in `amazonDraftVerifyUtils.ts` → `runSingleSkuSyncForDraft()`.

- Resolves credentials via `resolveAmazonCredentials`
- Calls `runMarketplaceSync` with:
  - `syncType: "single_sku"`
  - `sellerSku` from draft
  - `marketplaceIds: [draft.marketplace_id]`
- Does **not** call `putListingsItem`, `patchListingsItem`, or `deleteListingsItem`

Same read-only path as manual sync documented in [021_incremental_full_sync.md](021_incremental_full_sync.md).

---

## Published Reconciliation

When verification succeeds, `promoteDraftToPublished()`:

| Field | Value |
|-------|-------|
| `published_amazon_listing_id` | Matching `amazon_listings.id` |
| `draft_status` | `published` |
| `updated_at` | Now |

Draft is never marked `published` inside `amazon-submit-draft` (2N).

---

## Mapping Creation

When draft has `kk_product_id` and verification finds a listing:

1. If a `mapped` row already exists for same `amazon_listing_id + kk_product_id`, reuse it
2. Otherwise demote any prior `mapped` row for that listing to `legacy`
3. Insert new row:
   - `mapping_status = mapped`
   - `mapping_confidence = manual`
   - `mapped_by = admin.userId`
   - `notes = "Created from Amazon push draft verification"`

---

## Frontend Verify Now Behavior

### API

`verifySubmittedAmazonDraft(draftId, { runSingleSkuSync })` in `api.js` → POST `amazon-verify-submitted-draft`.

No browser Amazon calls.

### Push modal (after live submit)

When live submit returns `needsSync: true`:

- Toast: *Submitted to Amazon. Run verification sync to confirm it appears in Seller Central.*
- **Verify Now** button appears (`data-action="verify-submitted-draft"`) when hidden draft status field is `submitted`

### Drafts / Issues tab

Submitted draft cards show **Verify Listing** with the same `data-action`.

### On success

- Toast: *Amazon listing verified and draft marked published.*
- Refresh: Drafts / Issues, Synced Listings, Needs Mapping counts

### On not found

- Toast: *Amazon has not returned this listing yet. Try again in a few minutes.*

---

## Security Rules

| Rule | Status |
|------|--------|
| Admin JWT required | ✅ |
| No tokens/secrets in frontend | ✅ |
| No browser → Amazon calls | ✅ |
| No Amazon write endpoints in verify flow | ✅ |
| Service role DB access server-side only | ✅ |

---

## Deploy

```bash
supabase functions deploy amazon-verify-submitted-draft
```

No new migration required (uses existing `amazon_listings`, `amazon_listing_drafts`, `amazon_listing_mappings`).

---

## Phase 2Q — Scheduled Verification Retry (Not Implemented in 2O)

See [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md) for the implemented cron system.

Historical plan:

- Scheduled edge function checks submitted drafts older than 5 minutes
- Runs single-SKU sync
- Promotes if listing appears
- Stops after N attempts or marks `max_attempts`

---

## Known Limitations

1. Verification does not poll Amazon in a loop in the UI — cron handles automated retries (2Q).
2. Buyable status is informational only; non-buyable listings can still verify.
3. Single-SKU sync may miss listings if SKU mismatch or wrong marketplace.
4. Cron auto-verify runs on schedule; manual Verify Listing remains available.
5. Full incremental sync still available separately from header sync actions.

---

## Recommended Next Phase

**2P** — ✅ Live Ready to Push — [`028_ready_to_push_live.md`](028_ready_to_push_live.md)

**2Q** — ✅ Scheduled verification retry — [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md)

---

## Related Docs

- [`026_live_submit.md`](026_live_submit.md)
- [`021_incremental_full_sync.md`](021_incremental_full_sync.md)
- [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)
- [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md)
- [`028_ready_to_push_live.md`](028_ready_to_push_live.md)
- [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md)

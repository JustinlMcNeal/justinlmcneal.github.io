# Phase 2N — Live Submit to Amazon

Live Listings Items PUT submit for saved drafts, behind strict safety gates.

**Prior:** [2M validation preview](025_submit_validation_preview.md) · [2L PTD validation](024_product_type_validation_preview.md)

Official docs confirm `putListingsItem` supports `mode=VALIDATION_PREVIEW` for preview-only calls. Live submit omits that mode.

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/amazon-submit-draft/index.ts` | Admin live submit edge function |
| `js/admin/amazon/pushDraftLive.js` | Submit readiness + confirmation modal |
| `supabase/migrations/20260727_amazon_drafts_issues_view_submit.sql` | Adds `last_submission_response` to drafts view |
| `docs/pages/admin/amazon/ux/026_live_submit.md` | This document |

## Files Modified

| Path | Change |
|------|--------|
| `supabase/functions/_shared/amazonListingPayloadUtils.ts` | Shared PUT helper, `putListingsItemLiveSubmit`, readiness helpers |
| `js/admin/amazon/api.js` | `submitAmazonDraftLive()` |
| `js/admin/amazon/pushDraft.js` | Wire live submit module + draft meta |
| `js/admin/amazon/pushDraftPtd.js` | Update submit meta after validation preview |
| `pages/admin/amazon.html` | Confirmation modal, hidden readiness fields, enabled submit button |

---

## Backend: `amazon-submit-draft`

**Route:** `POST /functions/v1/amazon-submit-draft`

**Auth:** `requireAdminJson()`

**Env gate:** `AMAZON_ENABLE_LIVE_SUBMIT=true` (else `live_submit_disabled`)

**Confirmation:** request body must include `"confirmation": "PUBLISH_TO_AMAZON"`

**Amazon call:** `PUT /listings/2021-08-01/items/{sellerId}/{sellerSku}?marketplaceIds=...` — **no** `mode=VALIDATION_PREVIEW`

### Preconditions

| Check | Required |
|-------|----------|
| Draft exists | Yes |
| Not `published` / `archived` | Yes |
| `draft_status = ready_to_submit` | Yes |
| Recent `VALIDATION_PREVIEW` with `VALID` or `ACCEPTED` | Yes |
| No open error issues (validation or push) | Yes |

If not ready → `draft_not_ready`

### Draft updates after submit

| Field | Value |
|-------|-------|
| `draft_status` | `submitted` on `ACCEPTED`; `rejected` on `INVALID` |
| `submission_id` | From Amazon |
| `submission_status` | `ACCEPTED` / `INVALID` |
| `submitted_at` | Set on successful live submit |
| `last_submission_response` | `{ mode: "LIVE_SUBMIT", ... }` |

**Does not** set `published` or write `amazon_listings`.

### Issues

- Deletes open `source=push` issues
- Inserts Amazon issues as `source=push`, `issue_type=amazon_submit`
- Leaves `source=validation` issues untouched

### Response (success)

```json
{
  "ok": true,
  "draftId": "uuid",
  "submissionId": "...",
  "submissionStatus": "ACCEPTED",
  "draftStatus": "submitted",
  "needsSync": true
}
```

Safe errors: `live_submit_disabled`, `confirmation_required`, `draft_not_ready`, `draft_not_found`, `sp_api_submit_failed`, `listing_payload_error`

---

## Payload Builder

Reuses `buildListingsItemRequestBody()` from 2M. Shared internal `putListingsItemRequest()` handles preview vs live via optional `mode=VALIDATION_PREVIEW`.

---

## Frontend Behavior

### Submit readiness

**Submit to Amazon** enables only when:

1. Saved draft ID exists
2. `draft_status === ready_to_submit`
3. Amazon validation preview succeeded (`VALID` or `ACCEPTED`)

### Confirmation modal

- User must type `PUBLISH_TO_AMAZON`
- Calls `amazon-submit-draft` with confirmation phrase
- On success: notifies admin to run **Sync** to verify live listing state

---

## Why `submitted`, Not `published`

Amazon may accept a submission asynchronously. A listing becomes buyable after Amazon processing. **Published** should only be set after read-only sync confirms the SKU is live — future phase.

---

## Follow-up Sync

Response includes `needsSync: true`. Admin should click **Sync Amazon Listings** (read-only `searchListingsItems`) to import the live offer.

---

## Security Rules

| Rule | Status |
|------|--------|
| `AMAZON_ENABLE_LIVE_SUBMIT=true` required | ✅ |
| Confirmation phrase required | ✅ |
| Admin-only edge function | ✅ |
| No browser Amazon calls | ✅ |
| No Feeds API | ✅ |
| No `deleteListingsItem` | ✅ |
| No bulk submit | ✅ |
| Submit disabled until ready | ✅ |
| Not marked published immediately | ✅ |

---

## Deployment

```bash
supabase db push
supabase secrets set AMAZON_ENABLE_LIVE_SUBMIT=true
supabase functions deploy amazon-submit-draft
```

Enable only in environments where live Seller Central writes are intended.

---

## Rollback / Recovery

1. If submit returns `rejected`, fix attributes and re-run validation preview.
2. If Amazon accepted but listing not visible, run sync; check Seller Central manually.
3. Disable live submit: unset or set `AMAZON_ENABLE_LIVE_SUBMIT` to anything other than `true`.
4. No automatic delete/recreate — manual Seller Central action if needed.

---

## Known Limitations

1. PUT only — no PATCH path for existing listings yet.
2. Conservative payload mapping may miss product-type-specific attributes.
3. USD hardcoded for offers.
4. Post-submit verification is a separate admin action — see [2O verification](027_post_submit_verification.md).
5. Published status requires successful verification sync — not immediate after submit.

---

## Recommended Next Phase

**2O** — ✅ Post-submit verification — [`027_post_submit_verification.md`](027_post_submit_verification.md)

**2P** — Live Ready to Push query; auto-prompt verify after submit.

---

## Related Docs

- [`025_submit_validation_preview.md`](025_submit_validation_preview.md)
- [`024_product_type_validation_preview.md`](024_product_type_validation_preview.md)
- [`027_post_submit_verification.md`](027_post_submit_verification.md)
- [`032_product_type_recommendation_submit_gate.md`](032_product_type_recommendation_submit_gate.md)

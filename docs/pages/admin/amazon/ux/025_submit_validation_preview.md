# Phase 2M — Submit Validation Preview Only

Amazon `putListingsItem` with `mode=VALIDATION_PREVIEW` for saved drafts. No live publish.

**Prior:** [2L PTD validation](024_product_type_validation_preview.md) · [2K push draft](023_push_draft_workflow.md)

Official docs confirm `mode=VALIDATION_PREVIEW` on `putListingsItem` returns `status=VALID` without publishing ([putListingsItem](https://developer-docs.amazon.com/sp-api/reference/putlistingsitem)).

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/_shared/amazonListingPayloadUtils.ts` | Draft → Listings Items payload + preview PUT |
| `supabase/functions/amazon-submit-draft-preview/index.ts` | Admin validation-preview submit |

## Files Modified

| Path | Change |
|------|--------|
| `supabase/functions/_shared/amazonSigV4Utils.ts` | SigV4 signing supports `PUT` / `PATCH` |
| `js/admin/amazon/api.js` | `submitAmazonDraftPreview()` |
| `js/admin/amazon/pushDraftPtd.js` | Preview Amazon Submit handler |
| `js/admin/amazon/pushDraft.js` | Wire `preview-amazon-submit` action |
| `pages/admin/amazon.html` | Preview Amazon Submit button |

---

## Payload Builder (`amazonListingPayloadUtils.ts`)

Conservative mapping from `draft_payload`:

| Draft field | Amazon attribute |
|-------------|------------------|
| `title` | `item_name` |
| `brand` | `brand` |
| `description` | `product_description` |
| `bulletPoints` | `bullet_point` |
| `conditionType` | `condition_type` |
| `price` | `purchasable_offer` |
| `quantity` + `fulfillmentChannel` | `fulfillment_availability` |
| `matchedAsin` / `asin` | `merchant_suggested_asin` |

Omits empty/missing fields. Not full PTD schema coverage.

---

## Backend: `amazon-submit-draft-preview`

**Route:** `POST /functions/v1/amazon-submit-draft-preview`

**Auth:** `requireAdminJson()`

**Amazon call:** `PUT /listings/2021-08-01/items/{sellerId}/{sellerSku}?marketplaceIds=...&mode=VALIDATION_PREVIEW`

**Does not:** publish listings, update `amazon_listings`, set `draft_status=published`, submit feeds.

### Safety gate

Requires server env:

```bash
AMAZON_ENABLE_VALIDATION_PREVIEW=true
```

If unset → `validation_preview_disabled` (403).

### Flow

1. Load draft (reject `published` / `archived`)
2. Run local + PTD validation (`forceLocalPreview` default true)
3. Block if error-level issues → `draft_not_ready`
4. Build Listings Items body
5. PUT with `mode=VALIDATION_PREVIEW` + SigV4
6. Store `submission_id`, `submission_status`, `last_submission_response`, `last_validation_result`
7. Sync `amazon_listing_issues` with `source=push`, `issue_type=amazon_validation`
8. Leave `source=validation` issues untouched

### Draft status

| Result | Status |
|--------|--------|
| Local/PTD errors (preflight) | blocked — `draft_not_ready` |
| Amazon `INVALID` or error issues | `rejected` or `needs_attributes` |
| Amazon `VALID` / `ACCEPTED`, clean | `ready_to_submit` |
| Amazon preview warnings only | `draft` |

### Response

```json
{
  "ok": true,
  "draftId": "uuid",
  "submissionId": "...",
  "submissionStatus": "VALID",
  "draftStatus": "ready_to_submit",
  "amazonIssues": [],
  "validationErrors": []
}
```

Safe errors: `validation_preview_disabled`, `draft_not_ready`, `draft_not_found`, `listing_payload_error`, `sp_api_validation_failed`, `amazon_not_connected`, `token_missing`, `token_refresh_failed`

---

## Push Modal UI

| Button | Behavior |
|--------|----------|
| Preview Amazon Submit | Calls `amazon-submit-draft-preview` (requires saved draft) |
| Submit to Amazon | **Disabled** — live publish in future phase |

Shows Amazon issues in validation panel + missing attributes list. Refreshes Drafts / Issues tab.

---

## What Remains Disabled

- Live `putListingsItem` / `patchListingsItem` without `VALIDATION_PREVIEW`
- Feeds submit
- Final Submit to Amazon button
- `amazon_listings` write on preview

---

## Security Rules

| Rule | Status |
|------|--------|
| Env gate before Amazon PUT | ✅ |
| Admin-only edge function | ✅ |
| No browser Amazon calls | ✅ |
| No tokens/secrets in frontend | ✅ |
| Preview mode only | ✅ |
| Submit button disabled | ✅ |

---

## Deployment

```bash
supabase secrets set AMAZON_ENABLE_VALIDATION_PREVIEW=true
supabase functions deploy amazon-submit-draft-preview
```

Also requires existing Amazon auth + SigV4 env vars from prior phases.

---

## Known Limitations

1. Payload builder is conservative — complex product-type attributes may still fail Amazon preview.
2. Uses PUT only (no PATCH path for existing listings yet).
3. `USD` currency hardcoded for offer mapping.
4. Live testing required to confirm seller account accepts `VALIDATION_PREVIEW` for all product types.
5. Gate must be explicitly enabled per environment.

---

## Recommended Next Phase

**2N** — ✅ Live submit — [`026_live_submit.md`](026_live_submit.md)

**2O** — Post-submit sync + promote draft to published when sync confirms listing.

---

## Related Docs

- [`024_product_type_validation_preview.md`](024_product_type_validation_preview.md)
- [`026_live_submit.md`](026_live_submit.md)
- [`023_push_draft_workflow.md`](023_push_draft_workflow.md)
- [`012_official_sp_api_research.md`](012_official_sp_api_research.md)
- [`032_product_type_recommendation_submit_gate.md`](032_product_type_recommendation_submit_gate.md)

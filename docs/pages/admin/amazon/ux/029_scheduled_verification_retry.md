# Phase 2Q — Scheduled Verification Retry for Submitted Drafts

Optional cron-driven read-only verification for submitted Amazon drafts. Reuses 2O single-SKU sync + listing lookup; promotes to `published` only when a listing row exists.

**Prior:** [2O manual verification](027_post_submit_verification.md) · [2P Ready to Push](028_ready_to_push_live.md)

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/migrations/20260729_amazon_draft_verify_tracking.sql` | Retry tracking columns + view update |
| `supabase/functions/_shared/amazonDraftVerifyQueueUtils.ts` | Backoff, queue marks, cron auth |
| `supabase/functions/amazon-verify-submitted-drafts-cron/index.ts` | Scheduled batch verification |
| `docs/pages/admin/amazon/ux/029_scheduled_verification_retry.md` | This document |

## Files Modified

| Path | Change |
|------|--------|
| `supabase/functions/_shared/amazonDraftVerifyUtils.ts` | `verifySubmittedDraftOnce`, `asDraftRowForVerify`, verify metadata on promote |
| `supabase/functions/amazon-verify-submitted-draft/index.ts` | Uses shared verify helper + manual not-found metadata |
| `supabase/functions/amazon-submit-draft/index.ts` | Queues draft for auto-verify after live submit |
| `js/admin/amazon/api.js` | Drafts view columns include retry fields |
| `js/admin/amazon/renderDraftsIssues.js` | Submitted draft retry metadata display |

---

## Migration Fields

Added to `amazon_listing_drafts`:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `verify_attempts` | integer | `0` | Automated attempt count (cron only) |
| `last_verify_attempt_at` | timestamptz | null | Last cron or manual check time |
| `next_verify_after` | timestamptz | null | Earliest next cron retry |
| `verify_status` | text | `idle` | Queue state |
| `verify_last_error` | text | null | Sanitized last error |

**Check constraint:** `verify_status IN ('idle', 'queued', 'running', 'verified', 'not_found', 'failed', 'max_attempts')`

**Index:** `idx_amazon_listing_drafts_verify_queue` on `(draft_status, next_verify_after, verify_attempts)` WHERE `draft_status = 'submitted'`

**View:** `v_amazon_drafts_issues` extended with all five retry fields.

---

## Cron Function

**Path:** `supabase/functions/amazon-verify-submitted-drafts-cron`

| Method | Behavior |
|--------|----------|
| `OPTIONS` | CORS preflight |
| `POST` | Process verification batch |
| Other | `405 method_not_allowed` |

### Cron Auth

Requires `CRON_SECRET` env var. Accept either:

- Header: `x-cron-secret: <CRON_SECRET>`
- Header: `Authorization: Bearer <CRON_SECRET>`

Normal admin JWT is **not** accepted. Browser users cannot invoke this function without the secret.

If `CRON_SECRET` is unset, function returns `server_misconfigured`.

---

## Batch Behavior

1. Select submitted drafts where:
   - `draft_status = submitted`
   - `verify_attempts < maxAttempts`
   - `verify_status != max_attempts`
   - `next_verify_after IS NULL OR next_verify_after <= now()`
2. Default batch size: **5** (`AMAZON_VERIFY_BATCH_SIZE`)
3. For each draft:
   - Set `verify_status = running`
   - Increment `verify_attempts`
   - Set `last_verify_attempt_at = now()`
   - Run read-only single-SKU sync + listing lookup (shared 2O helper)
   - Promote to `published` only if listing found
   - Otherwise schedule retry or mark `max_attempts`

### Response

```json
{
  "ok": true,
  "processed": 3,
  "verified": 1,
  "notFound": 2,
  "failed": 0,
  "maxAttempts": 0
}
```

---

## Backoff

After each unsuccessful automated attempt (not found or error):

| Attempt # | Next retry |
|-----------|------------|
| 1 | +5 minutes |
| 2 | +15 minutes |
| 3 | +30 minutes |
| 4+ | +60 minutes |

Stored in `next_verify_after`.

---

## Max Attempts

- Default: **12** (`AMAZON_VERIFY_MAX_ATTEMPTS`)
- When reached: `verify_status = max_attempts`, `next_verify_after = null`
- Manual **Verify Listing** still works (does not increment `verify_attempts`)

---

## Published Promotion Rules

Same as 2O:

- Listing must exist in `amazon_listings` with verifiable status
- Sets `draft_status = published`, `published_amazon_listing_id`
- Sets `verify_status = verified`, clears `next_verify_after`
- Creates mapping when `kk_product_id` present
- **No Amazon write calls** in cron path

---

## Live Submit Queue Seed

On successful live submit (`amazon-submit-draft`):

- `verify_status = queued`
- `verify_attempts = 0`
- `next_verify_after = now + 5 minutes` (first auto-check delay)

---

## Manual Verify Changes

`amazon-verify-submitted-draft` now uses `verifySubmittedDraftOnce()`.

| Outcome | Metadata |
|---------|----------|
| Verified | `verify_status = verified`, `next_verify_after = null` (via promote) |
| Not found | `verify_status = not_found`, `last_verify_attempt_at = now()` |
| Error | Unchanged retry metadata; returns safe error |

Manual verify does **not** increment `verify_attempts` or enforce max attempts.

---

## Frontend Metadata Display

Submitted draft cards in Drafts / Issues show when available:

- Verification attempts: N
- Next auto-check: formatted datetime
- Last check: formatted datetime
- Max attempts message when `verify_status = max_attempts`

**Verify Listing** button remains for manual override.

---

## Security Rules

| Rule | Status |
|------|--------|
| No Amazon write endpoints added | ✅ |
| Cron requires `CRON_SECRET` | ✅ |
| No tokens/secrets in responses or logs | ✅ (errors sanitized) |
| Published only after listing row found | ✅ |
| Manual verify preserved | ✅ |
| Service role server-side only | ✅ |

---

## Deployment

```bash
supabase db push
supabase functions deploy amazon-verify-submitted-drafts-cron
```

### Environment

| Variable | Required | Default |
|----------|----------|---------|
| `CRON_SECRET` | Yes (cron) | — |
| `AMAZON_VERIFY_MAX_ATTEMPTS` | No | `12` |
| `AMAZON_VERIFY_BATCH_SIZE` | No | `5` |
| Amazon LWA/AWS vars | Yes | (same as sync) |

### Cron setup

Schedule POST to the edge function every **5–15 minutes** using your scheduler (Supabase cron, pg_cron + `net.http_post`, GitHub Actions, etc.).

Example headers (do not commit secrets):

```http
POST /functions/v1/amazon-verify-submitted-drafts-cron
x-cron-secret: <CRON_SECRET>
```

Or:

```http
Authorization: Bearer <CRON_SECRET>
```

---

## Known Limitations / TODOs

1. No in-app cron configuration UI
2. Stale `running` state not auto-recovered if function crashes mid-batch
3. Manual verify does not reset `max_attempts` status (admin must verify manually anyway)
4. Batch size/count env vars require redeploy to change
5. ~~No email/Slack alert when max attempts reached~~ — ✅ [2U alerts](033_bulk_requeue_and_max_attempt_alerts.md)

---

## Recommended Next Phase

**2R** — ✅ Product type search + eligibility — [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)

**2S** — ✅ Requeue + header product picker — [`031_verify_requeue_and_product_picker.md`](031_verify_requeue_and_product_picker.md)

**2T** — ✅ [`032_product_type_recommendation_submit_gate.md`](032_product_type_recommendation_submit_gate.md)

**2U** — ✅ [`033_bulk_requeue_and_max_attempt_alerts.md`](033_bulk_requeue_and_max_attempt_alerts.md)

---

## Related Docs

- [`027_post_submit_verification.md`](027_post_submit_verification.md)
- [`028_ready_to_push_live.md`](028_ready_to_push_live.md)
- [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)
- [`031_verify_requeue_and_product_picker.md`](031_verify_requeue_and_product_picker.md)
- [`033_bulk_requeue_and_max_attempt_alerts.md`](033_bulk_requeue_and_max_attempt_alerts.md)
- [`026_live_submit.md`](026_live_submit.md)

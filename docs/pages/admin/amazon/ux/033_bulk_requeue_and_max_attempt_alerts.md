# Phase 2U — Bulk Requeue + Max-Attempt Operator Alerts

**Prior:** [2S requeue + product picker](031_verify_requeue_and_product_picker.md) · [2T pre-submit gate](032_product_type_recommendation_submit_gate.md)

Bulk requeue for submitted drafts that hit `verify_status = max_attempts`, plus optional Slack/email operator alerts when auto-verify exhausts retries.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Bulk requeue edge function | New Amazon listing write endpoints |
| Drafts/Issues max-attempt banner + bulk button | SMS alerts |
| Slack webhook + Resend email on max attempts | Alert if draft already alerted (deduped) |
| Migration for alert dedupe column | Immediate verify on requeue (cron still picks up) |

---

## Part A — Migration

**File:** `supabase/migrations/20260731_amazon_verify_max_attempts_alert.sql`

Adds:

| Column | Purpose |
|--------|---------|
| `verify_max_attempts_alerted_at` | When operator alert was sent; cleared on requeue |

---

## Part B — Operator Alerts

**Shared:** `supabase/functions/_shared/amazonDraftVerifyAlertUtils.ts`

`maybeSendMaxAttemptsOperatorAlert(client, draftId, now)`:

1. Requires `verify_status = max_attempts`
2. Skips if `verify_max_attempts_alerted_at` already set
3. Sends alert when configured:
   - **Slack:** `AMAZON_VERIFY_ALERT_SLACK_WEBHOOK_URL`
   - **Email:** `AMAZON_VERIFY_ALERT_EMAIL_TO` + `RESEND_API_KEY`
   - Optional: `AMAZON_VERIFY_ALERT_EMAIL_FROM`, `AMAZON_ADMIN_PAGE_URL`
4. Marks `verify_max_attempts_alerted_at` after send (or when alerts disabled, to avoid retry spam)

Alert body includes draft id, product title, SKU, marketplace, attempt count, last error, admin page link.

**Hook:** `amazon-verify-submitted-drafts-cron` calls alert helper when `markVerifyNotFound` / `markVerifyFailed` returns `reachedMax = true`.

Single requeue clears `verify_max_attempts_alerted_at` so a future max-attempt cycle can alert again.

---

## Part C — Bulk Requeue Backend

**Function:** `amazon-bulk-requeue-draft-verification`

| Method | Behavior |
|--------|----------|
| `OPTIONS` | CORS |
| `POST` | Bulk requeue |
| Other | `405` |

### Auth

Admin JWT via `requireAdminJson()`. **No Amazon API calls.**

### Input

```json
{
  "draftIds": ["uuid", "uuid"],
  "allMaxAttempts": true
}
```

- If `draftIds` is non-empty → requeue those ids (submitted only; same rules as single requeue).
- Else if `allMaxAttempts !== false` → load up to **50** submitted drafts with `verify_status = max_attempts`.

### Response

```json
{
  "ok": true,
  "requeuedCount": 2,
  "skippedCount": 0,
  "requeued": ["uuid"],
  "skipped": [{ "draftId": "uuid", "reason": "draft_not_submitted" }]
}
```

Shared helpers in `amazonDraftVerifyQueueUtils.ts`:

- `bulkRequeueDraftVerification()`
- `loadMaxAttemptsDraftIds()`

---

## Part D — Frontend

### API

`bulkRequeueAmazonDraftVerification({ draftIds?, allMaxAttempts? })` in `api.js`

### Drafts / Issues UI

| Element | Behavior |
|---------|----------|
| `#amazonDraftsMaxAttemptsBanner` | Visible when max-attempt count > 0 |
| **Requeue All Max-Attempt Drafts** | `data-action="bulk-requeue-max-attempt-drafts"` |
| Count label | Appends `· N max attempts` |
| Draft cards | `data-max-attempt-draft="true"` for scroll targeting |

Single **Requeue Auto-Verify** per card unchanged.

---

## Security Rules

| Rule | Status |
|------|--------|
| No Amazon listing writes | ✅ |
| Bulk requeue admin-only | ✅ |
| Alerts server-side only | ✅ |
| No webhook/API keys in frontend | ✅ |
| Cron + manual verify preserved | ✅ |

---

## Deploy

```bash
supabase db push   # or apply 20260731 migration
supabase functions deploy amazon-bulk-requeue-draft-verification
supabase functions deploy amazon-verify-submitted-drafts-cron
```

### Optional alert env

```env
AMAZON_VERIFY_ALERT_SLACK_WEBHOOK_URL=https://hooks.slack.com/...
AMAZON_VERIFY_ALERT_EMAIL_TO=ops@example.com
RESEND_API_KEY=re_...
AMAZON_VERIFY_ALERT_EMAIL_FROM=Karry Kraze Admin <noreply@karrykraze.com>
AMAZON_ADMIN_PAGE_URL=https://yoursite.com/pages/admin/amazon.html
```

If neither Slack nor email is configured, max-attempt state is still recorded; alerts are skipped and dedupe column is set to avoid log spam.

---

## Known Limitations

1. Bulk requeue capped at 50 drafts per request (same as list page limit).
2. Alerts fire once per max-attempt cycle until requeue clears dedupe.
3. Email requires Resend API key (no generic send-email function yet).
4. Banner count reflects loaded tab rows (max 50), not total DB count.
5. Requeue does not run verification immediately — cron picks up on next run.

---

## Recommended Next Phase

**2V** — Synced tab search/filter/export + row actions — see [`000_milestone_checklist.md`](../000_milestone_checklist.md).

---

## Related Docs

- [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md)
- [`031_verify_requeue_and_product_picker.md`](031_verify_requeue_and_product_picker.md)
- [`032_product_type_recommendation_submit_gate.md`](032_product_type_recommendation_submit_gate.md)

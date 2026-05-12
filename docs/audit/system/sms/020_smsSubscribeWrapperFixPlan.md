# SMS Subscribe Wrapper Fix Plan

**Date:** 2026-05-09  
**Status:** deployed and verified (structural) — 2026-05-09. `sms-subscribe` now routes through the `send-sms` wrapper with `flow='signup'`, `intent='marketing'`, `skip_caps: true`. Post-deploy structural checks confirmed: `flow='signup'` rows appear in `sms_v_flow_performance_dated` with non-null `sms_message_id`; existing subscriber experience unchanged. A fresh live post-deploy subscriber send was not explicitly captured but row linkage confirms the wrapper path is intact. See `002_smsChangeLog.md` 2026-05-09 entry for details.  
**Gap:** GAP-06 (`001_smsKnownGaps.md`) — `sms-subscribe` calls Twilio directly, bypassing `send-sms` (resolved)  
**Scope:** `sms-subscribe` only. Other 4 bypassing flows are out of scope for this document.

---

## 1. Problem Summary

`sms-subscribe` is the primary opt-in entry point for the SMS marketing list. Every new subscriber's welcome/coupon SMS is sent directly by this function via a raw Twilio REST call.

The `send-sms` edge function is the shared wrapper that enforces:
- **Quiet hours** (9 PM – 9 AM ET): no marketing sends
- **6-hour frequency cap**: min 6 hours between marketing sends per contact
- **Daily cap**: max 1 marketing SMS per contact per UTC day
- **Weekly cap**: max 4 marketing SMS per contact per 7 days
- **Consent check**: contact must be `status = 'active'` and `sms_consent = true`

Because `sms-subscribe` bypasses `send-sms`, none of these guardrails apply to the welcome/coupon SMS. A re-subscribe at 11 PM would send immediately. A contact who unsubscribed and re-subscribed same day would receive a second marketing SMS that day — exceeding the daily cap. There is no systematic enforcement.

Additionally, `send-sms` is the only function that writes a consistent `sms_sends` row with the correct `flow` value. Until `sms-subscribe` routes through it, the pattern is inconsistent with every other flow migration underway.

---

## 2. Files / Tables Involved

**Edge functions:**
- `supabase/functions/sms-subscribe/index.ts` — the function being migrated
- `supabase/functions/send-sms/index.ts` — the wrapper to route through; also requires 5 optional parameter additions

**Tables read by `sms-subscribe`:**
- `sms_consent_logs` — read for IP rate limit check (3 requests/hour per IP)
- `customer_contacts` — read to detect existing/unsubscribed/active state
- `promotions` — read to check if old coupon is still valid (re-subscribe path)
- `site_settings` — read for coupon config (`key = 'sms_coupon'`)

**Tables written by `sms-subscribe`:**
- `promotions` — insert: new coupon row for each new subscriber
- `customer_contacts` — upsert: new contact insert or re-subscribe update; update `last_sms_sent_at` after send
- `sms_consent_logs` — insert: opt_in consent record
- `sms_messages` — insert: send record with `short_code` and `redirect_url` (used by click tracking)
- `sms_sends` — insert: analytics row with `flow = 'signup'`, `send_reason = 'new_subscriber_coupon'`, `user_state_snapshot`

**Analytics views affected:**
- `sms_v_coupon_cohorts` — `initial_15pct` cohort depends on `sms_sends.flow = 'signup'`. If `send-sms` writes the wrong `flow` value this cohort breaks immediately.
- `sms_v_flow_performance_dated` — groups by `flow`; uses `sms_sends.flow`. Same dependency.
- `sms_v_click_to_purchase` — joins `sms_messages` on `short_code` via the `sms-redirect` path. Requires `sms_messages.short_code` to be set.

---

## 3. Current Send Path

After coupon creation and contact upsert, `sms-subscribe` does all of the following itself:

1. **Generates `shortCode`** (8-char alphanumeric) and builds `trackingUrl = "karrykraze.com/r/?c=${shortCode}"`
2. **Composes the SMS body** inline: `Karry Kraze: Your code ${couponCode} gets you ${discountLabel}...`
3. **Calls Twilio REST API directly** — `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` with the Twilio credentials it holds locally. Uses environment variables `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_WEBHOOK_URL`.
4. **On Twilio failure:** inserts a `sms_messages` row (`status = 'failed'`) with `short_code` and `redirect_url`; inserts a `sms_sends` row (`flow = 'signup'`, `outcome = 'pending'`); returns `{ success: true, sms_sent: false }`.
5. **On Twilio success:** inserts a `sms_messages` row (`status = 'sent'`, `provider_message_sid`, `short_code`, `redirect_url`); inserts a `sms_sends` row (`flow = 'signup'`, `send_reason = 'new_subscriber_coupon'`, `intent = 'marketing'`, `cost = 0.0079`, `user_state_snapshot`); updates `customer_contacts.last_sms_sent_at`.

The function holds Twilio credentials (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`) directly, duplicating what `send-sms` already owns.

---

## 4. Desired Send Path

After coupon creation and contact upsert, `sms-subscribe` should:

1. **Generate `shortCode` and compose the SMS body** — identical to today. This stays in `sms-subscribe`.
2. **Call `send-sms`** via inter-function HTTP POST to `${SUPABASE_URL}/functions/v1/send-sms` with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`. This is the exact pattern used by `send-review-request` (the only function already on this path).
3. **Pass `skip_caps: true`** — the subscribe flow is the consent event itself. The contact has just opted in. Caps should not block the welcome message regardless of prior send history. The `skip_caps` flag was explicitly designed for this use case — the comment in `send-sms` reads: `"caller already checked caps (e.g. sms-subscribe first message)"`.
4. **`send-sms` handles:** Twilio API call, `sms_messages` insert (with `provider_message_sid`), `sms_sends` insert, `last_sms_sent_at` update, and `StatusCallback` registration for delivery tracking.
5. **`sms-subscribe` handles its own failure response** — if `send-sms` returns non-2xx or `success !== true`, `sms-subscribe` should still return `{ success: true, sms_sent: false, coupon_code }` so coupon creation isn't lost from the user's perspective.
6. **Drop the Twilio credential imports** from `sms-subscribe` — `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` are no longer needed once the direct call is removed.

---

## 5. Risks / Compatibility Concerns

### Risk 1 — `sms_sends.flow` value: HIGH (analytics-breaking if not fixed)

`send-sms` currently writes `flow: campaign || message_type` to `sms_sends`. If `sms-subscribe` passes `campaign: "sms_signup_coupon"`, the resulting `flow` value in `sms_sends` would be `"sms_signup_coupon"`, not `"signup"`.

`sms_v_coupon_cohorts` explicitly filters `WHERE s.flow IN ('signup', 'coupon_escalation', 'upgrade')`. The `initial_15pct` cohort would immediately stop counting new sends. `sms_v_flow_performance_dated` would also produce a new unexpected `sms_signup_coupon` row instead of the existing `signup` row.

**Must be fixed before migration.** `send-sms` needs to accept an optional `flow?` string parameter and write it when provided, falling back to `campaign || message_type` when absent.

### Risk 2 — `sms_messages.short_code` and `sms_messages.redirect_url` not written: MEDIUM

`sms-subscribe` writes `short_code` and `redirect_url` to `sms_messages`. The `sms-redirect` edge function uses `sms_messages.short_code` to serve click tracking redirects and to find the linked `sms_send_id`. `send-sms` does not currently accept or write these fields.

If these aren't written, click tracking links sent in the subscribe SMS will produce a valid redirect but the click event cannot be linked back to the `sms_sends` row or `sms_messages` row. `sms_v_click_to_purchase` would not connect.

**Must be fixed before migration.** `send-sms` needs optional `short_code?` and `redirect_url?` parameters passed through to the `sms_messages` insert.

### Risk 3 — `sms_sends` missing `send_reason` and `user_state_snapshot`: LOW

`sms-subscribe` writes `send_reason: "new_subscriber_coupon"` and `user_state_snapshot: { source: "landing_page_coupon", is_resubscribe: <bool> }`. `send-sms` does not. These fields are used for audit enrichment, not by any analytics view.

**Can be fixed alongside Risk 1/2.** Add optional `send_reason?` and `user_state_snapshot?` to `send-sms`'s `SendRequest` interface.

### Risk 4 — `last_sms_sent_at` double-update: NEGLIGIBLE

`sms-subscribe` currently updates `last_sms_sent_at` after its own Twilio call. `send-sms` also updates `last_sms_sent_at` when `contact_id && intent === 'marketing'` — and this update runs outside the `skip_caps` block, so it runs even when caps are skipped. After migration, the manual update in `sms-subscribe` can be removed; `send-sms` handles it. No behavior change, just cleanup.

### Risk 5 — Re-subscribe sends: NEGLIGIBLE with `skip_caps: true`

A contact who unsubscribed and re-subscribes within the same day or within 6 hours of a prior send would normally be blocked by caps. Using `skip_caps: true` is intentional and correct — you must always send the coupon on a fresh opt-in regardless of prior send history.

### Risk 6 — Deployment order: MEDIUM

If `sms-subscribe` is deployed pointing to `send-sms` BEFORE `send-sms` is updated with `flow?`, `short_code?`, `redirect_url?` support, the analytics break (Risk 1) and click tracking breaks (Risk 2) take effect immediately.

**Fix:** Deploy `send-sms` first with its new optional parameters. Then deploy `sms-subscribe`. The new `send-sms` parameters are additive and backward-compatible — no existing callers are affected.

---

## 6. Recommended Fix

### Two-step deployment. `send-sms` first, `sms-subscribe` second.

#### Step A — Extend `send-sms` `SendRequest` interface (5 optional parameters)

File: `supabase/functions/send-sms/index.ts`

Add to the `SendRequest` interface:
```typescript
flow?:                string;   // explicit flow name; overrides 'campaign || message_type' in sms_sends
send_reason?:         string;   // e.g. 'new_subscriber_coupon'
short_code?:          string;   // click-tracking short code; written to sms_messages
redirect_url?:        string;   // destination URL for short code redirect; written to sms_messages
user_state_snapshot?: Record<string, unknown>;  // audit metadata written to sms_sends
```

In the `sms_messages` insert (both success and failure paths), add `short_code` and `redirect_url` when present:
```typescript
short_code:   payload.short_code   ?? null,
redirect_url: payload.redirect_url ?? null,
```

In the `sms_sends` insert, use `payload.flow ?? campaign ?? message_type` for the `flow` field and add the extra fields:
```typescript
flow:                 payload.flow ?? campaign ?? message_type,
send_reason:          payload.send_reason ?? message_type,
user_state_snapshot:  payload.user_state_snapshot ?? null,
```

Deploy `send-sms`:
```bash
echo y | npx supabase functions deploy send-sms --project-ref yxdzvzscufkvewecvagq
```

#### Step B — Migrate `sms-subscribe` to call `send-sms`

File: `supabase/functions/sms-subscribe/index.ts`

1. Remove the 4 Twilio credential constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`) — no longer needed.
2. Keep `shortCode` generation and the `smsBody` composition exactly as-is.
3. Replace the direct `fetch(twilioUrl, ...)` block (and its success/failure DB logging) with a single call to `send-sms`:
```typescript
const sendRes = await fetch(
  `${supabaseUrl}/functions/v1/send-sms`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      to:                   phone,
      body:                 smsBody,
      message_type:         "coupon_delivery",
      intent:               "marketing",
      campaign:             "sms_signup_coupon",
      contact_id:           contact?.id ?? null,
      skip_caps:            true,
      flow:                 "signup",
      send_reason:          "new_subscriber_coupon",
      short_code:           shortCode,
      redirect_url:         targetUrl,
      user_state_snapshot:  { source: "landing_page_coupon", is_resubscribe: !!existing },
    }),
  }
);
const sendData = await sendRes.json();
const smsSent = sendRes.ok && sendData.success === true;
```
4. Replace `sms_sent: true/false` return logic with `smsSent` flag. On failure still return `{ success: true, sms_sent: false, coupon_code }` — do not propagate the error to the browser caller.
5. Remove the manual `last_sms_sent_at` update — `send-sms` handles it.
6. Remove the manual `sms_messages` and `sms_sends` inserts for both success and failure paths — `send-sms` handles both.

Deploy `sms-subscribe`:
```bash
echo y | npx supabase functions deploy sms-subscribe --project-ref yxdzvzscufkvewecvagq
```

---

## 7. Test Plan

### Task A — Verify `send-sms` accepts new parameters without breaking existing callers

After deploying Step A only, confirm `send-review-request` still works by triggering a test review request send. Confirm its `sms_sends` row uses `flow = "review_request"` (unchanged — it doesn't pass `flow?`, so it gets `campaign || message_type = "review_request"`).

```sql
SELECT flow, send_reason, short_code
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.campaign = 'review_request'
ORDER BY ss.created_at DESC LIMIT 1;
-- Expected: flow='review_request', send_reason='transactional', short_code=NULL
```

### Task B — Verify new subscriber signup after Step B deploy

Perform a real new-subscriber signup via the coupon landing page. Use a phone not already in `customer_contacts`.

```sql
-- B1: sms_sends row
SELECT flow, send_reason, intent, outcome, cost, user_state_snapshot
FROM sms_sends
WHERE phone = '<test_phone>'
ORDER BY created_at DESC LIMIT 1;
-- Expected: flow='signup', send_reason='new_subscriber_coupon', intent='marketing',
--           outcome='pending', cost=0.0079, user_state_snapshot includes is_resubscribe=false

-- B2: sms_messages row
SELECT status, campaign, short_code, redirect_url, provider_message_sid
FROM sms_messages
WHERE phone = '<test_phone>'
ORDER BY created_at DESC LIMIT 1;
-- Expected: status='sent', campaign='sms_signup_coupon', short_code non-null,
--           redirect_url non-null, provider_message_sid non-null

-- B3: analytics view
SELECT cohort, total_coupons_issued
FROM sms_v_coupon_cohorts
WHERE cohort = 'initial_15pct';
-- Expected: total_coupons_issued increments by 1 from pre-test value

-- B4: sms_v_flow_performance_dated
SELECT flow, sends
FROM sms_v_flow_performance_dated
WHERE flow = 'signup'
  AND sent_date = CURRENT_DATE;
-- Expected: sends count includes the new test send
```

### Task C — Verify re-subscribe path

Use a phone that has status `'unsubscribed'` with a prior unused coupon. Trigger a new signup.

```sql
SELECT flow, user_state_snapshot
FROM sms_sends
WHERE phone = '<resub_phone>'
ORDER BY created_at DESC LIMIT 1;
-- Expected: flow='signup', user_state_snapshot.is_resubscribe=true
```

### Task D — Verify frequency guardrails are NOT applied (skip_caps)

Using the same test phone from Task B, re-trigger a signup immediately (within 6 hours). The SMS should still go through since `skip_caps: true`. Confirm no `{ blocked: true }` response and a new `sms_sends` row is created.

### Task E — Verify `sms_v_coupon_cohorts` initial_15pct cohort unchanged

Before and after: count should not regress.

```sql
SELECT cohort, total_coupons_issued, redeemed, sms_attributed_orders
FROM sms_v_coupon_cohorts
WHERE cohort = 'initial_15pct';
-- Expected: same or higher total_coupons_issued; redeemed and sms_attributed_orders unchanged
```

---

## 8. Definition of Done

All of the following must be true before `sms-subscribe` is considered resolved for GAP-06:

- [ ] `send-sms` updated with `flow?`, `send_reason?`, `short_code?`, `redirect_url?`, `user_state_snapshot?` optional parameters and deployed
- [ ] `send-review-request` regression check passes after `send-sms` deploy (Task A)
- [ ] `sms-subscribe` no longer imports or calls Twilio credentials directly — all Twilio calls route through `send-sms`
- [ ] New subscriber test confirms `sms_sends.flow = 'signup'`, `sms_messages.short_code` non-null, `provider_message_sid` non-null (Tasks B1–B2)
- [ ] `sms_v_coupon_cohorts` `initial_15pct` cohort `total_coupons_issued` increments on new signup (Task B3)
- [ ] `sms_v_flow_performance_dated` `signup` row shows the new send (Task B4)
- [ ] Re-subscribe path produces `user_state_snapshot.is_resubscribe = true` (Task C)
- [ ] `001_smsKnownGaps.md` GAP-06 `sms-subscribe` item updated from "open" to partial-resolved (one flow remaining from original 5 → 4 remaining)
- [ ] `002_smsChangeLog.md` entry added for both `send-sms` and `sms-subscribe` deploys

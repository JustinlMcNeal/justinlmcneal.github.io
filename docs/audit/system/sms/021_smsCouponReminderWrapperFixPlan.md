# SMS Coupon Reminder Wrapper Fix Plan

**Date:** 2026-05-09  
**Status:** deployed — 2026-05-09. Both Pass 1 (coupon reminder) and Pass 2 (coupon escalation) now route through the `send-sms` wrapper. Structural verification confirmed: `flow='coupon_reminder'` and `flow='coupon_escalation'` rows appear in `sms_v_flow_performance_dated` with non-null `sms_message_id`; no double-send regression detected; frequency caps now enforced cross-flow. Live confirmation of a fresh Pass 1 reminder trigger post-deploy is pending — the cron only runs when contacts fall in the 24–48h eligible window. See `002_smsChangeLog.md` 2026-05-09 entry for details.  
**Gap:** GAP-06 (`001_smsKnownGaps.md`) — `sms-coupon-reminder` calls Twilio directly, bypassing `send-sms` (resolved)  
**Scope:** `sms-coupon-reminder` only. Other remaining bypassing flows are out of scope for this document.

---

## 1. Problem Summary

`sms-coupon-reminder` is a cron-triggered function that fires two distinct send passes per run:

- **Pass 1 — Coupon Reminder:** sends a nudge to contacts whose signup coupon is 24–48 hours old and still unused
- **Pass 2 — Coupon Escalation:** detects contacts whose original coupon expired without use, issues a new 20% upgrade code, and sends once per lifetime per contact

Both passes call Twilio directly via a local `sendAndLog()` helper function defined at the top of the file. This helper holds Twilio credentials directly (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`) and performs all logging to `sms_messages` and `sms_sends` itself.

Because neither pass routes through `send-sms`, the following guardrails in `send-sms` are bypassed:

- **Daily cap** (max 1 marketing SMS per contact per UTC day)
- **Weekly cap** (max 4 marketing SMS per contact per 7 days)
- **Consent/status check** (contact must be `status = 'active'` and `sms_consent = true`)

The function does implement its own **6-hour frequency cap** (`passesFrequencyCap()`) and its own **quiet hours check** (`isQuietHours()`) independently. Both duplicate logic already present in `send-sms`.

Additionally, `sms-coupon-reminder` does **not** implement the daily or weekly cap checks that `send-sms` enforces. A contact who received a signup SMS earlier the same day could receive a coupon reminder the same day if the 6-hour window had passed.

---

## 2. Files / Tables Involved

**Edge functions:**
- `supabase/functions/sms-coupon-reminder/index.ts` — the function being migrated; contains a `sendAndLog()` private helper that will be replaced
- `supabase/functions/send-sms/index.ts` — already extended with `flow?`, `send_reason?`, `short_code?`, `redirect_url?`, `user_state_snapshot?` from the `sms-subscribe` migration

**Tables read by `sms-coupon-reminder`:**
- `customer_contacts` — read for eligible contacts (both passes), consent/status check, `last_sms_sent_at` for 6-hour cap
- `sms_sends` — read to check whether a reminder or escalation has already been sent (dedup guards)
- `promotions` — read to check coupon status (active, expired, usage_count)

**Tables written by `sms-coupon-reminder`:**
- `sms_messages` — insert: send record with `short_code`, `redirect_url`, `provider_message_sid`
- `sms_sends` — insert: analytics row with `flow`, `send_reason`, `campaign`, `intent = 'marketing'`, `outcome = 'pending'`, `cost = 0.0079`, `user_state_snapshot`
- `customer_contacts` — update: `last_sms_sent_at` on successful send (Pass 1 and Pass 2); `coupon_code` updated to new escalation code (Pass 2 only)
- `promotions` — insert: new escalation promotion row (Pass 2 only); update: existing promotion `is_active = false` (Pass 2 only)

**Analytics views affected:**
- `sms_v_coupon_cohorts` — `coupon_reminder` dedup guard uses `sms_sends.flow = 'coupon_reminder'`; `escalation_20pct` cohort uses `sms_sends.flow = 'coupon_escalation'`. Both `flow` values must be preserved exactly.
- `sms_v_flow_performance_dated` — groups by `flow` and `sent_date`. Rows appear for `coupon_reminder` and `coupon_escalation`. Must not change.
- `sms_v_click_to_purchase` — joins `sms_messages.short_code` to click events. `short_code` and `redirect_url` must be written to `sms_messages`.

---

## 3. Current Send Path

Both passes share a single private `sendAndLog()` helper declared at lines ~53–120 of the file. Per send:

1. **Builds Twilio form** with `To`, `From`, `Body`, and optionally `StatusCallback`
2. **Calls Twilio REST directly** — `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`
3. **Inserts `sms_messages`** — with `short_code`, `redirect_url`, `provider_message_sid` (on success), `error_code`/`error_message` (on failure), `status = 'sent'|'failed'`
4. **Inserts `sms_sends`** — with `flow`, `send_reason`, `campaign`, `intent = 'marketing'`, `outcome = 'pending'`, `cost = 0.0079`, `user_state_snapshot`
5. **Updates `customer_contacts.last_sms_sent_at`** — only on Twilio success

Call sites pass the following values:

**Pass 1 (reminder):**
- `flow: "coupon_reminder"`, `campaign: "coupon_reminder"`, `send_reason: "unused_coupon_24h"`, `messageType: "reminder"`
- `snapshot: { coupon_code, hours_since_signup: 24 }`

**Pass 2 (escalation):**
- `flow: "coupon_escalation"`, `campaign: "coupon_escalation"`, `send_reason: "expired_coupon_upgrade"`, `messageType: "coupon_delivery"`
- `snapshot: { original_coupon, original_value, escalated_value: 20, hours_since_signup }`

Both passes generate a `shortCode` and `targetUrl = "https://karrykraze.com/pages/catalog.html"` and pass them to `sendAndLog()`.

The function also implements its own:
- **Quiet hours check** at the top of `Deno.serve()` — returns `{ skipped: true }` early if before 9 AM or after 9 PM ET
- **6-hour frequency cap** via `passesFrequencyCap()` helper — reads `customer_contacts.last_sms_sent_at` directly

---

## 4. Desired Send Path

After migration, both pass 1 and pass 2 should:

1. **Continue all existing pre-send logic unchanged** — eligibility queries, dedup guards (`sms_sends` count checks), coupon validity checks, escalation promo creation, `customer_contacts.coupon_code` update. None of this changes.
2. **Drop the local `sendAndLog()` helper** and the 4 Twilio credential constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`).
3. **Replace the `sendAndLog()` call** with a `fetch` to `${supabaseUrl}/functions/v1/send-sms` with `Authorization: Bearer ${serviceKey}`, passing the same field values currently passed to `sendAndLog()`.
4. **Drop the local `passesFrequencyCap()` helper** and the local `isQuietHours()` function — `send-sms` enforces both. The cron function should let `send-sms` make the call and treat a `{ blocked: true }` response as a skip.
5. **Drop the local quiet hours early-return** — `send-sms` will block quiet-hours marketing sends natively. The cron can run at any time and `send-sms` will gate each individual send.
6. **Treat `{ blocked: true }` from `send-sms` as a skip** (not a hard error) — increment `results.*.skipped` and continue to the next contact.
7. **`send-sms` handles:** Twilio REST call, `sms_messages` insert (both success and failure paths), `sms_sends` insert, `last_sms_sent_at` update, quiet hours, daily cap, weekly cap, consent check.

**`send-sms` is already capable of this.** The `flow?`, `send_reason?`, `short_code?`, `redirect_url?`, `user_state_snapshot?` parameters were added in the Step A deployment for the `sms-subscribe` migration.

---

## 5. Required Data To Preserve

All of the following must be passed through to `send-sms` to preserve existing behavior:

| Field | Pass 1 value | Pass 2 value | Where used |
|---|---|---|---|
| `to` | `contact.phone` | `contact.phone` | Twilio recipient |
| `body` | reminder SMS body | escalation SMS body | Twilio message body |
| `message_type` | `"reminder"` | `"coupon_delivery"` | `sms_messages.message_type` |
| `intent` | `"marketing"` | `"marketing"` | caps logic, `sms_sends.intent` |
| `campaign` | `"coupon_reminder"` | `"coupon_escalation"` | `sms_messages.campaign`, `sms_sends.campaign` |
| `contact_id` | `contact.id` | `contact.id` | `sms_messages.contact_id`, `sms_sends.contact_id`, cap check, `last_sms_sent_at` |
| `flow` | `"coupon_reminder"` | `"coupon_escalation"` | **CRITICAL** — dedup guard reads this; `sms_v_coupon_cohorts` `escalation_20pct` cohort depends on `flow = 'coupon_escalation'`; `sms_v_flow_performance_dated` groups by it |
| `send_reason` | `"unused_coupon_24h"` | `"expired_coupon_upgrade"` | `sms_sends.send_reason` (audit) |
| `short_code` | generated per send | generated per send | `sms_messages.short_code`; click tracking via `sms-redirect` |
| `redirect_url` | `"https://karrykraze.com/pages/catalog.html"` | same | `sms_messages.redirect_url`; click tracking target |
| `user_state_snapshot` | `{ coupon_code, hours_since_signup: 24 }` | `{ original_coupon, original_value, escalated_value: 20, ... }` | `sms_sends.user_state_snapshot` (audit) |
| `skip_caps` | **`false` (omit)** | **`false` (omit)** | These flows must obey daily/weekly caps — do NOT pass `skip_caps: true` |

**Critical note on `skip_caps`:** Unlike `sms-subscribe`, these are not consent-event sends. `skip_caps` must NOT be passed (or explicitly set `false`). The daily and weekly caps should apply. The existing 6-hour cap and quiet hours currently handled locally will be covered by `send-sms`'s native enforcement.

---

## 6. Risks / Compatibility Concerns

### Risk 1 — `flow` value must be explicit: HIGH if omitted

`send-sms` writes `flow: payload.flow ?? campaign ?? message_type`. For Pass 1: `campaign = "coupon_reminder"` and `flow = "coupon_reminder"` — the fallback would produce the correct value even without an explicit `flow?`. For Pass 2: `campaign = "coupon_escalation"` and `flow = "coupon_escalation"` — same.

However, since `flow` is now a supported explicit parameter, it should always be passed explicitly. Relying on the fallback is fragile. **Always pass `flow` explicitly.**

`sms_v_coupon_cohorts`'s `escalation_20pct` cohort is defined as `WHEN s.flow = 'coupon_escalation'`. If the `flow` value in `sms_sends` ever differs from `'coupon_escalation'`, that cohort disappears. This is the highest-impact risk.

The dedup guard in Pass 1 reads `sms_sends.flow = 'coupon_reminder'` — if the flow value changes, contacts will be re-reminded indefinitely.

### Risk 2 — Quiet hours and frequency cap behavior change: LOW (net improvement)

Currently:
- Quiet hours: checked once at the top of the handler; if triggered, the entire cron run returns early and no contacts are processed
- 6-hour frequency cap: checked per contact via `passesFrequencyCap()`

After migration:
- Quiet hours: `send-sms` checks per individual send. If a cron run starts just before 9 PM ET, some contacts earlier in the loop may succeed and later contacts may be blocked. This is more precise than the current early-return.
- 6-hour cap: `send-sms` checks `last_sms_sent_at` per contact — same logic as `passesFrequencyCap()`, functionally identical.
- Daily/weekly caps: newly enforced. If a contact already received a marketing SMS today, they will get `{ blocked: true, reason: 'daily_cap' }`. This is a behavior change but a cap improvement, not a regression.

**The cron function must treat `{ blocked: true }` responses as skips, not errors.** It already treats Twilio failures as skips. The same pattern applies here.

### Risk 3 — `sms_sends` dedup guard on escalation: LOW if `flow` is preserved

Pass 2 dedup check: `sms_sends WHERE flow = 'coupon_escalation'`. As long as `send-sms` writes `flow = 'coupon_escalation'` correctly (guaranteed by passing it explicitly), the lifetime-once escalation guard is unaffected.

### Risk 4 — Promotion/contact writes must complete before `send-sms` call: NEGLIGIBLE

Pass 2 creates a new `promotions` row and updates `customer_contacts.coupon_code` before calling `sendAndLog()`. After migration, these writes still happen before the `send-sms` call. No ordering change needed.

### Risk 5 — `send-sms` failure does not partially write: LOW

Currently `sendAndLog()` writes `sms_messages` and `sms_sends` regardless of Twilio success/failure. After migration, `send-sms` also writes `sms_messages` on both success and failure paths (the failure insert was confirmed in the Step A diff). The `sms_sends` insert only happens on the success path in `send-sms`. This means a Twilio failure will produce a `sms_messages` row but no `sms_sends` row — a minor difference from the current behavior where both are written even on failure. Acceptable for a cron flow.

### Risk 6 — Deployment order: LOW

`send-sms` is already deployed with all required optional parameters. No prerequisite deploy needed before migrating `sms-coupon-reminder`.

---

## 7. Recommended Fix

Single-step deployment — no prerequisite `send-sms` changes needed.

**File:** `supabase/functions/sms-coupon-reminder/index.ts`

**Changes:**

1. **Remove** the 4 Twilio credential constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`)
2. **Remove** the `sendAndLog()` helper function entirely (~67 lines)
3. **Remove** the `passesFrequencyCap()` helper function (~12 lines) — `send-sms` handles it
4. **Remove** the `isQuietHours()` helper function (~5 lines) — `send-sms` handles it
5. **Remove** the quiet hours early-return at the top of `Deno.serve()`
6. **Add** a `sendViaSendSms()` helper that wraps the `fetch` call to `send-sms` and returns `'sent' | 'skipped' | 'failed'`, where `'skipped'` means `{ blocked: true }` was returned

Replace the `sendAndLog()` call in Pass 1:
```typescript
const result = await sendViaSendSms(sb, {
  to:                  contact.phone,
  body:                smsBody,
  message_type:        "reminder",
  intent:              "marketing",
  campaign:            "coupon_reminder",
  contact_id:          contact.id,
  flow:                "coupon_reminder",
  send_reason:         "unused_coupon_24h",
  short_code:          shortCode,
  redirect_url:        targetUrl,
  user_state_snapshot: { coupon_code: contact.coupon_code, hours_since_signup: 24 },
});
if (result === "sent") results.reminders.sent++;
else results.reminders.skipped++;
```

Replace the `sendAndLog()` call in Pass 2:
```typescript
const result = await sendViaSendSms(sb, {
  to:                  contact.phone,
  body:                smsBody,
  message_type:        "coupon_delivery",
  intent:              "marketing",
  campaign:            "coupon_escalation",
  contact_id:          contact.id,
  flow:                "coupon_escalation",
  send_reason:         "expired_coupon_upgrade",
  short_code:          shortCode,
  redirect_url:        targetUrl,
  user_state_snapshot: {
    original_coupon: promo.code,
    original_value:  promo.value,
    escalated_value: 20,
  },
});
if (result === "sent") results.escalations.sent++;
else results.escalations.skipped++;
```

The `sendViaSendSms()` helper:
```typescript
async function sendViaSendSms(
  _sb: ReturnType<typeof createClient>,
  opts: {
    to: string; body: string; message_type: string; intent: string;
    campaign: string; contact_id: string; flow: string; send_reason: string;
    short_code: string; redirect_url: string; user_state_snapshot: Record<string, unknown>;
  }
): Promise<"sent" | "skipped" | "failed"> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
    if (data.blocked === true) return "skipped";
    if (res.ok && data.success === true) return "sent";
    console.warn("[sms-coupon-reminder] send-sms did not succeed:", JSON.stringify(data));
    return "failed";
  } catch (err: unknown) {
    console.error("[sms-coupon-reminder] send-sms call failed:",
      err instanceof Error ? err.message : String(err));
    return "failed";
  }
}
```

Note: `_sb` parameter is included in the signature to avoid changing the call sites structurally, but `send-sms` does not need the Supabase client — it can be dropped or kept as unused.

Deploy:
```bash
echo y | npx supabase functions deploy sms-coupon-reminder --project-ref yxdzvzscufkvewecvagq
```

---

## 8. Verification Plan

Since `sms-coupon-reminder` is cron-triggered (not directly callable without a POST to trigger it), verification must use database queries after the next cron run or a manual trigger.

### Pre-deploy: record current counts

```sql
-- Baseline for regression checks
SELECT
  flow,
  COUNT(*) AS total_sends,
  MAX(created_at) AS most_recent_send
FROM sms_sends
WHERE flow IN ('coupon_reminder', 'coupon_escalation')
GROUP BY flow;
```

Record these values. Call the `coupon_reminder` total **R** and `coupon_escalation` total **E**.

### After the next cron run:

**V1 — sms_sends fields for most recent reminder send:**
```sql
SELECT ss.flow, ss.send_reason, ss.campaign, ss.intent, ss.outcome,
       sm.short_code, sm.redirect_url, sm.provider_message_sid
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.flow = 'coupon_reminder'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** `flow='coupon_reminder'`, `send_reason='unused_coupon_24h'`, `campaign='coupon_reminder'`, `intent='marketing'`, `outcome='pending'`, `short_code` non-null, `redirect_url='https://karrykraze.com/pages/catalog.html'`, `provider_message_sid` non-null

**V2 — sms_sends fields for most recent escalation send (if any):**
```sql
SELECT ss.flow, ss.send_reason, ss.campaign, ss.intent, ss.outcome,
       sm.short_code, sm.redirect_url, sm.provider_message_sid
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.flow = 'coupon_escalation'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** `flow='coupon_escalation'`, `send_reason='expired_coupon_upgrade'`, `campaign='coupon_escalation'`, `intent='marketing'`, `short_code` non-null, `provider_message_sid` non-null

**V3 — Analytics view regression:**
```sql
SELECT cohort, total_coupons_issued, redeemed, sms_attributed_orders
FROM sms_v_coupon_cohorts
WHERE cohort IN ('initial_15pct', 'escalation_20pct');
```
**Expected:** `initial_15pct` unchanged from prior baseline; `escalation_20pct` total_coupons_issued ≥ **E** from baseline

**V4 — Flow performance view intact:**
```sql
SELECT flow, total_sends, sent_date
FROM sms_v_flow_performance_dated
WHERE flow IN ('coupon_reminder', 'coupon_escalation')
ORDER BY sent_date DESC LIMIT 6;
```
**Expected:** Both flows appear by their correct names. No new `coupon_delivery` or `reminder` row appearing in place of the named flows.

**V5 — Dedup guard still works (no double-reminders):**
```sql
SELECT contact_id, COUNT(*) AS reminder_count
FROM sms_sends
WHERE flow = 'coupon_reminder'
GROUP BY contact_id
HAVING COUNT(*) > 1;
```
**Expected:** Zero rows. Any row here means a contact received more than one reminder, which would indicate the dedup guard broke.

---

## 9. Definition of Done

All of the following must be true before `sms-coupon-reminder` is considered resolved for GAP-06:

- [ ] `sms-coupon-reminder` no longer imports or calls Twilio credentials directly — all Twilio calls route through `send-sms`
- [ ] `sendAndLog()`, `passesFrequencyCap()`, and `isQuietHours()` helper functions removed
- [ ] After next cron run: V1 confirms `flow='coupon_reminder'`, `short_code` non-null, `provider_message_sid` non-null
- [ ] After next cron run: V2 confirms `flow='coupon_escalation'` (or N/A if no escalation was eligible)
- [ ] V3: `sms_v_coupon_cohorts` `escalation_20pct` cohort count ≥ baseline **E**; `initial_15pct` unchanged
- [ ] V4: `sms_v_flow_performance_dated` shows `coupon_reminder` and `coupon_escalation` rows under correct flow names
- [ ] V5: No contact has received more than one `coupon_reminder` send (dedup guard intact)
- [ ] `{ blocked: true }` responses from `send-sms` (daily/weekly cap, quiet hours) are treated as skips — not errors — in the cron result summary
- [ ] `001_smsKnownGaps.md` GAP-06 updated from 4 remaining flows to 3 remaining
- [ ] `002_smsChangeLog.md` entry added for the `sms-coupon-reminder` deploy

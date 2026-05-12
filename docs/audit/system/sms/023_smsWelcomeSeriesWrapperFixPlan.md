# SMS Welcome Series Wrapper Fix Plan

**Date:** 2026-05-09  
**Status:** deployed and verified — 2026-05-09. V1 (Day 2 fields): PASS — `provider_message_sid` non-null, all metadata fields correct. V3 (flow leakage): PASS. V4 (Day 2 dedup): PASS. V5 (Day 5 dedup): PASS. V6 (counts stable): PASS (D2=44, D5=39, no phantom sends). V2 (Day 5 fields): N/A — no new Day 5 sends occurred in the window since deploy; Day 5 live confirmation is pending the next qualifying cron run. See `002_smsChangeLog.md` 2026-05-09 entry for full verification results.  
**Gap:** GAP-06 (`001_smsKnownGaps.md`) — `sms-welcome-series` calls Twilio directly, bypassing `send-sms` (resolved)  
**Scope:** `sms-welcome-series` only. Other remaining bypassing flows (`coupon-upgrade`, `sms-abandoned-cart`) are out of scope for this document.

---

## 1. Problem Summary

`sms-welcome-series` is a cron-triggered function that fires two sequential marketing sends per contact window:

- **Day 2 — Value/Discovery:** Sent 2–7 days after signup (window start). No discount. Introduces the store.
- **Day 5 — Conversion Push:** Sent 5–7 days after signup. Only if Day 2 was already sent and the contact has not yet made a purchase. Generates a unique 10% off coupon (`WS-` prefix, 48hr, single-use).

Both steps call Twilio directly via a local `sendAndLog()` helper — the same pattern as `sms-coupon-reminder` before its migration. Neither step routes through `send-sms`, which means:

- **Daily cap** (max 1 marketing SMS per contact per UTC day) is not enforced for these sends
- **Weekly cap** (max 4 marketing SMS per contact per 7 days) is not enforced
- **Consent/status check** (contact must be `status = 'active'` and `sms_consent = true`) is not re-validated at send time — only the initial query selects on those fields, but there is no atomic check inside `sendAndLog()`
- **Quiet hours** are checked at the handler level (single early-return for the whole run), not per-contact — `send-sms` enforces quiet hours per individual send, which is more precise

The function does implement its own **6-hour frequency cap** via `passesFrequencyCap()` and its own **quiet hours check** via `isQuietHours()`. Both duplicate logic already present in `send-sms`.

The function also has a **fatigue score check** (`contact.fatigue_score >= 8`) and an **abandoned cart suppression check** (`hasActiveAbandonedCart()`) and a **purchase suppression check for Day 5** (`hasPurchased()`). These are business-logic filters, not cap logic — they must all remain in `sms-welcome-series` after migration.

---

## 2. Files / Tables Involved

**Edge functions:**
- `supabase/functions/sms-welcome-series/index.ts` — the function being migrated; contains a `sendAndLog()` private helper that will be replaced
- `supabase/functions/send-sms/index.ts` — already extended with `flow?`, `send_reason?`, `short_code?`, `redirect_url?`, `user_state_snapshot?` (deployed 2026-05-09)

**Tables read by `sms-welcome-series`:**
- `customer_contacts` — eligible contact query (status, sms_consent, created_at window, fatigue_score); also read by `passesFrequencyCap()` for `last_sms_sent_at`
- `sms_sends` — read by `alreadySent()` to check whether `welcome_day_2` or `welcome_day_5` was already sent (dedup guard using `send_reason`)
- `saved_carts` — read by `hasActiveAbandonedCart()` to suppress contacts in an active cart flow
- `orders_raw` — read by `hasPurchased()` to suppress Day 5 if the contact already purchased post-signup
- `promotions` — read to check for duplicate coupon code candidates (Day 5 only)

**Tables written by `sms-welcome-series`:**
- `sms_messages` — insert per send: `phone`, `contact_id`, `message_body`, `message_type`, `campaign`, `status`, `provider_message_sid`, `short_code`, `redirect_url`, `sent_at`
- `sms_sends` — insert per send: `phone`, `contact_id`, `campaign`, `flow`, `send_reason`, `intent = 'marketing'`, `outcome = 'pending'`, `cost = 0.0079`, `sms_message_id`, `user_state_snapshot`
- `customer_contacts` — update `last_sms_sent_at` on successful send
- `promotions` — insert new 10% WS coupon (Day 5 only)

**Analytics views affected:**
- `sms_v_flow_performance_dated` — groups by `sms_sends.flow`. Both steps write `flow = 'welcome_series'`. Must not change — the view uses this name as-is.
- `sms_v_click_to_purchase` — joins `sms_messages.short_code` to click events. `short_code` and `redirect_url` must be written to `sms_messages` correctly.
- `sms_v_coupon_cohorts` — no direct reference to `welcome_series` in the cohort definitions, but WS coupon codes (`WS-` prefix) could appear as uncategorized coupons. No structural dependency.
- Analyst daily report (`docs/audit/system/sms/003_smsAudit.md` line 361) — records that metrics are collected via `sms_sends.flow='welcome_series'` with `send_reason` per step. Both `send_reason` values must be preserved.

---

## 3. Current Send Path

Both steps share a single private `sendAndLog()` helper. Per send:

1. **Builds Twilio form** with `To`, `From`, `Body`, and optionally `StatusCallback`
2. **Calls Twilio REST directly** — `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`
3. **Inserts `sms_messages`** — with `short_code`, `redirect_url`, `provider_message_sid` (on success), `error_code`/`error_message` (on failure), `status = 'sent'|'failed'`
4. **Inserts `sms_sends`** — with `flow`, `send_reason`, `campaign`, `intent = 'marketing'`, `outcome = 'pending'`, `cost = 0.0079`, `user_state_snapshot`
5. **Updates `customer_contacts.last_sms_sent_at`** — only on Twilio success

The contact loop also calls `passesFrequencyCap()` (reads `customer_contacts.last_sms_sent_at`) before each send attempt. The handler itself calls `isQuietHours()` at startup and returns early if true — this exits the entire run, not individual contacts.

**Per-step parameters passed to `sendAndLog()`:**

Day 2:
- `campaign: "welcome_series"`, `flow: "welcome_series"`, `sendReason: "welcome_day_2"`, `messageType: "welcome_discovery"`
- `snapshot: { days_since_signup, fatigue_score }`

Day 5:
- `campaign: "welcome_series"`, `flow: "welcome_series"`, `sendReason: "welcome_day_5"`, `messageType: "welcome_conversion"`
- `snapshot: { days_since_signup, fatigue_score, coupon_code }`

The `alreadySent()` dedup guard reads `sms_sends.send_reason` (specifically `'welcome_day_2'` and `'welcome_day_5'`) to prevent re-sending the same step. This is business logic, not a cap, and is separate from `passesFrequencyCap()`.

---

## 4. Desired Send Path

After migration, both Day 2 and Day 5 should:

1. **Continue all existing pre-send logic unchanged:** fatigue check, frequency cap (now enforced by send-sms), abandoned cart suppression, `alreadySent()` dedup guard, purchase suppression for Day 5, coupon generation and promo row creation. All of this stays in `sms-welcome-series`.
2. **Drop the local `sendAndLog()` helper** and the 4 Twilio credential constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`).
3. **Replace each `sendAndLog()` call** with a `fetch` to `${supabaseUrl}/functions/v1/send-sms` with `Authorization: Bearer ${serviceKey}`.
4. **Drop the local `passesFrequencyCap()` helper** — `send-sms` enforces the 6-hour cap natively when `intent = 'marketing'`.
5. **Drop the local `isQuietHours()` function** and the handler-level quiet hours early-return — `send-sms` enforces quiet hours per individual send. Each contact is evaluated on its own. This is a net behavioral improvement over the current all-or-nothing exit.
6. **Treat `{ blocked: true }` from `send-sms`** as a skip (increment `results.skipped`) — not a hard error. This covers daily cap, weekly cap, quiet hours, consent, and frequency cap blocks uniformly.
7. **Keep `alreadySent()`, `hasActiveAbandonedCart()`, `hasPurchased()`, `generateShortCode()`, `generateCouponCode()`** exactly as-is — these are business logic, not cap logic.
8. **Do NOT pass `skip_caps: true`** — these are scheduled marketing sends, not consent-event sends. The daily and weekly caps must apply.

`send-sms` already handles: Twilio REST call, `sms_messages` insert (success and failure), `sms_sends` insert, `last_sms_sent_at` update, quiet hours, daily cap, weekly cap, consent check, 6-hour frequency cap.

---

## 5. Required Data To Preserve

All of the following must be passed through to `send-sms`:

| Field | Day 2 value | Day 5 value | Where used |
|---|---|---|---|
| `to` | `contact.phone` | `contact.phone` | Twilio recipient |
| `body` | Day 2 SMS text | Day 5 SMS text (includes coupon code) | Twilio message body |
| `message_type` | `"welcome_discovery"` | `"welcome_conversion"` | `sms_messages.message_type` |
| `intent` | `"marketing"` | `"marketing"` | caps logic, `sms_sends.intent` |
| `campaign` | `"welcome_series"` | `"welcome_series"` | `sms_messages.campaign`, `sms_sends.campaign` |
| `contact_id` | `contact.id` | `contact.id` | `sms_messages.contact_id`, `sms_sends.contact_id`, cap check, `last_sms_sent_at` |
| `flow` | `"welcome_series"` | `"welcome_series"` | `sms_sends.flow`; `sms_v_flow_performance_dated` groups on this value |
| `send_reason` | `"welcome_day_2"` | `"welcome_day_5"` | **CRITICAL** — `alreadySent()` dedup guard reads `sms_sends.send_reason`; if this is not written correctly, contacts will receive duplicate step sends |
| `short_code` | generated per send | generated per send | `sms_messages.short_code`; click tracking via `sms-redirect` |
| `redirect_url` | `"https://karrykraze.com/pages/catalog.html"` | same | `sms_messages.redirect_url`; click tracking target |
| `user_state_snapshot` | `{ days_since_signup, fatigue_score }` | `{ days_since_signup, fatigue_score, coupon_code }` | `sms_sends.user_state_snapshot` (audit) |
| `skip_caps` | **omit** (do not pass) | **omit** (do not pass) | Must obey daily/weekly caps |

---

## 6. Risks / Compatibility Concerns

### Risk 1 — `send_reason` must be written exactly: HIGH if wrong

The `alreadySent()` helper checks `sms_sends WHERE send_reason = 'welcome_day_2'` and separately `send_reason = 'welcome_day_5'`. These are the only dedup guards preventing a contact from receiving multiple Day 2 or Day 5 sends.

If `send_reason` is not passed explicitly, `send-sms` falls back to `payload.send_reason ?? message_type`. For Day 2: `message_type = 'welcome_discovery'` — not `'welcome_day_2'`. For Day 5: `message_type = 'welcome_conversion'` — not `'welcome_day_5'`. If the fallback fires, `alreadySent()` will fail to dedup and contacts in the 2–7 day window will be re-sent both steps on every subsequent cron run.

**Always pass `send_reason` explicitly.**

### Risk 2 — Both steps share `flow: "welcome_series"`: LOW (by design)

Unlike the coupon flows where each pass had a distinct `flow` value, both welcome series steps intentionally use `flow = 'welcome_series'`. The `sms_v_flow_performance_dated` view aggregates both steps into a single `welcome_series` row. This is correct and must not be changed.

Differentiation between Day 2 and Day 5 is entirely via `send_reason`. Analytics that need step-level granularity query `sms_sends.send_reason` directly.

### Risk 3 — Quiet hours behavior change: LOW (net improvement)

Currently: quiet hours check happens once at the top of the handler. If the cron fires during quiet hours, the entire run returns early and no contacts are processed.

After migration: `send-sms` checks quiet hours per individual send. A cron run that starts just before 9 PM ET may succeed for early contacts in the loop and block later ones. This is more precise but is a minor behavioral change. No analytics impact — blocked sends do not produce rows.

**The cron function must treat `{ blocked: true, reason: "quiet_hours" }` as a skip, not an error.**

### Risk 4 — Daily/weekly cap is newly enforced: LOW (improvement)

Before migration, a contact who received a coupon reminder or signup SMS earlier the same UTC day could still receive a Day 2 welcome send if the 6-hour window had passed. After migration, the daily cap enforced by `send-sms` will block that second send.

This is a desired tightening. The impact is that a small number of contacts may be skipped on a given cron run that would previously have been sent to. They will be re-evaluated on the next cron run.

### Risk 5 — `alreadySent()`, `hasActiveAbandonedCart()`, `hasPurchased()` must remain: NEGLIGIBLE

These three functions are pure business logic — they do not overlap with caps or Twilio. They read `sms_sends`, `saved_carts`, and `orders_raw` respectively. None have any dependency on `sendAndLog()`. All three must remain unchanged in `sms-welcome-series` after migration.

### Risk 6 — Day 5 coupon creation precedes the send call: NEGLIGIBLE

Day 5 creates the `promotions` row and has the `couponCode` value ready before calling `sendAndLog()`. After migration, the promo is still created before the `send-sms` call. If `send-sms` blocks the send (daily cap, quiet hours, etc.), the promotion row will exist but will not be referenced in `customer_contacts.coupon_code` — the contact's `coupon_code` field is never updated by `sms-welcome-series` itself (unlike `sms-coupon-reminder` which updates `coupon_code`). The orphaned promotion row has no practical impact — it expires in 48 hours.

This behavior is unchanged from the pre-migration state (a Twilio failure already orphans the promotion row today).

### Risk 7 — `sms_sends` insert only on success (not failure): LOW

Currently, `sendAndLog()` writes both `sms_messages` and `sms_sends` regardless of Twilio success/failure. After migration, `send-sms` writes `sms_messages` on both success and failure, but only writes `sms_sends` on success. Minor behavioral difference, acceptable for a cron marketing flow.

---

## 7. Recommended Fix

Single-step deployment — no prerequisite `send-sms` changes needed. All required optional parameters (`flow?`, `send_reason?`, `short_code?`, `redirect_url?`, `user_state_snapshot?`) are already deployed.

**File:** `supabase/functions/sms-welcome-series/index.ts`

**Changes:**

1. **Remove** the 4 Twilio credential constants
2. **Remove** `sendAndLog()` helper entirely (~65 lines)
3. **Remove** `passesFrequencyCap()` helper (~12 lines)
4. **Remove** `isQuietHours()` function (~5 lines)
5. **Remove** the quiet hours early-return at the top of `Deno.serve()`
6. **Remove** the per-contact `passesFrequencyCap()` call inside the loop
7. **Add** a `sendViaSendSms()` helper (same pattern as `sms-coupon-reminder`):

```typescript
async function sendViaSendSms(opts: {
  to: string;
  body: string;
  message_type: string;
  intent: string;
  campaign: string;
  contact_id: string;
  flow: string;
  send_reason: string;
  short_code: string;
  redirect_url: string;
  user_state_snapshot: Record<string, unknown>;
}): Promise<"sent" | "skipped" | "failed"> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
    if (data.blocked === true) return "skipped";
    if (res.ok && data.success === true) return "sent";
    console.warn("[sms-welcome-series] send-sms did not succeed:", JSON.stringify(data));
    return "failed";
  } catch (err: unknown) {
    console.error("[sms-welcome-series] send-sms call failed:",
      err instanceof Error ? err.message : String(err));
    return "failed";
  }
}
```

**Day 2 call site** (replace `sendAndLog(sb, { ... })` call):
```typescript
const result = await sendViaSendSms({
  to:                  contact.phone,
  body:                smsBody,
  message_type:        "welcome_discovery",
  intent:              "marketing",
  campaign:            "welcome_series",
  contact_id:          contact.id,
  flow:                "welcome_series",
  send_reason:         "welcome_day_2",
  short_code:          shortCode,
  redirect_url:        targetUrl,
  user_state_snapshot: snapshot,
});
if (result === "sent") results.day2_sent++; else results.skipped++;
continue;
```

**Day 5 call site** (replace `sendAndLog(sb, { ... })` call):
```typescript
const result = await sendViaSendSms({
  to:                  contact.phone,
  body:                smsBody,
  message_type:        "welcome_conversion",
  intent:              "marketing",
  campaign:            "welcome_series",
  contact_id:          contact.id,
  flow:                "welcome_series",
  send_reason:         "welcome_day_5",
  short_code:          shortCode,
  redirect_url:        targetUrl,
  user_state_snapshot: { ...snapshot, coupon_code: couponCode },
});
if (result === "sent") results.day5_sent++; else results.skipped++;
```

Deploy:
```bash
echo y | npx supabase functions deploy sms-welcome-series --project-ref yxdzvzscufkvewecvagq
```

---

## 8. Verification Plan

`sms-welcome-series` is cron-triggered (hourly at :45 per `SETUP_WELCOME_SERIES_CRON.sql`). Verification requires a cron run with contacts in the 2–7 day signup window, or a manual function invocation.

### Pre-deploy: record baseline counts

```sql
SELECT
  flow,
  send_reason,
  COUNT(*) AS total_sends,
  MAX(created_at) AS most_recent_send
FROM sms_sends
WHERE flow = 'welcome_series'
GROUP BY flow, send_reason;
```

Record `welcome_day_2` total as **D2** and `welcome_day_5` total as **D5**.

---

### After next cron run or manual trigger:

**V1 — most recent Day 2 send has correct fields:**
```sql
SELECT ss.flow, ss.send_reason, ss.campaign, ss.intent, ss.outcome,
       sm.message_type, sm.short_code, sm.redirect_url, sm.provider_message_sid
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.send_reason = 'welcome_day_2'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** `flow='welcome_series'`, `send_reason='welcome_day_2'`, `campaign='welcome_series'`, `intent='marketing'`, `outcome='pending'`, `message_type='welcome_discovery'`, `short_code` non-null, `redirect_url='https://karrykraze.com/pages/catalog.html'`, `provider_message_sid` non-null

**V2 — most recent Day 5 send has correct fields (if any eligible):**
```sql
SELECT ss.flow, ss.send_reason, ss.campaign, ss.intent, ss.outcome,
       sm.message_type, sm.short_code, sm.redirect_url, sm.provider_message_sid
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.send_reason = 'welcome_day_5'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** `flow='welcome_series'`, `send_reason='welcome_day_5'`, `campaign='welcome_series'`, `intent='marketing'`, `message_type='welcome_conversion'`, `short_code` non-null, `provider_message_sid` non-null

**V3 — flow performance view shows correct flow name:**
```sql
SELECT flow, total_sends, sent_date
FROM sms_v_flow_performance_dated
WHERE flow = 'welcome_series'
ORDER BY sent_date DESC LIMIT 4;
```
**Expected:** Rows appear with `flow = 'welcome_series'` exactly. No rows with `flow = 'welcome_discovery'` or `'welcome_conversion'` (which would indicate `send_reason?` or `message_type` leaked into `flow` because `flow?` was not passed explicitly).

**V4 — Dedup guard intact for Day 2 (no double sends):**
```sql
SELECT contact_id, COUNT(*) AS day2_count
FROM sms_sends
WHERE send_reason = 'welcome_day_2'
GROUP BY contact_id
HAVING COUNT(*) > 1;
```
**Expected:** Zero rows. Any row here means a contact received Day 2 twice, which would indicate `send_reason` was not written correctly and `alreadySent()` failed to dedup.

**V5 — Dedup guard intact for Day 5 (no double sends):**
```sql
SELECT contact_id, COUNT(*) AS day5_count
FROM sms_sends
WHERE send_reason = 'welcome_day_5'
GROUP BY contact_id
HAVING COUNT(*) > 1;
```
**Expected:** Zero rows.

**V6 — Regression: total send counts not lower than baseline:**
```sql
SELECT
  flow,
  send_reason,
  COUNT(*) AS total_sends
FROM sms_sends
WHERE flow = 'welcome_series'
GROUP BY flow, send_reason;
```
**Expected:** `welcome_day_2` total ≥ **D2** from baseline; `welcome_day_5` total ≥ **D5** from baseline.

---

## 9. Definition of Done

All of the following must be true before `sms-welcome-series` is considered resolved for GAP-06:

- [ ] `sms-welcome-series` no longer imports or calls Twilio credentials directly — all Twilio calls route through `send-sms`
- [ ] `sendAndLog()`, `passesFrequencyCap()`, and `isQuietHours()` helper functions removed from the file
- [ ] `alreadySent()`, `hasActiveAbandonedCart()`, `hasPurchased()` remain unchanged
- [ ] After next cron run: V1 confirms `flow='welcome_series'`, `send_reason='welcome_day_2'`, `short_code` non-null, `provider_message_sid` non-null
- [ ] After next cron run: V2 confirms `flow='welcome_series'`, `send_reason='welcome_day_5'` (or N/A if no eligible Day 5 contacts)
- [ ] V3: `sms_v_flow_performance_dated` shows `flow='welcome_series'` rows, not `'welcome_discovery'` or `'welcome_conversion'`
- [ ] V4: No contact has received Day 2 more than once
- [ ] V5: No contact has received Day 5 more than once
- [ ] V6: Cumulative `welcome_day_2` and `welcome_day_5` counts ≥ pre-deploy baseline
- [ ] `{ blocked: true }` responses from `send-sms` treated as skips (not errors) in cron result
- [ ] `001_smsKnownGaps.md` GAP-06 updated from 3 remaining flows to 2 remaining
- [ ] `002_smsChangeLog.md` entry added for the `sms-welcome-series` deploy

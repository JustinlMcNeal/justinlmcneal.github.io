# SMS Abandoned Cart Wrapper Fix Plan

**Date:** 2026-05-09  
**Status:** deployed and verified — 2026-05-09. V1–V3: N/A (no active carts), V4–V7: PASS. See `002_smsChangeLog.md` for full verification results. This was the final flow in GAP-06; all direct-Twilio bypasses are now resolved.  
**Gap:** GAP-06 (`001_smsKnownGaps.md`) — `sms-abandoned-cart` calls Twilio directly, bypassing `send-sms`  
**Scope:** `sms-abandoned-cart` only. This is the final flow in the GAP-06 series.

---

## 1. Problem Summary

`sms-abandoned-cart` is a cron-triggered function that detects active carts worth $15+ and sends up to a 3-step SMS sequence per cart:

- **Step 1 (30 min):** Plain reminder, no discount
- **Step 2 (6 hr):** Urgency/social proof message
- **Step 3 (24 hr):** Discount offer — 15% off $40+ (or $5 flat for $75+ carts), generates a unique coupon (`AC-` or `ACV-` prefix, 48hr, single-use)

All three steps call Twilio directly via a local `sendAndLog()` helper — the same pattern as the cron flows already migrated. Neither step routes through `send-sms`, which means:

- **Daily and weekly frequency caps** are not enforced — a contact who already received a different marketing SMS earlier that day (e.g., a welcome series or coupon reminder) could still receive an abandoned-cart message on the same day
- **Consent/status check** is performed in the outer loop (`customer_contacts.status`, `sms_consent`) before determining the step — this is correct — but it is not re-validated inside `sendAndLog()` at the moment of the Twilio call
- **Quiet hours** are checked once at the top of the handler (handler-level early-return), not per-contact — `send-sms` enforces quiet hours per individual send, which is more precise

The function does implement its own **6-hour frequency cap** via `passesFrequencyCap()`, its own **quiet hours check** via `isQuietHours()`, and **per-step dedup guards** via `step_2_sent_at` / `step_3_sent_at`. These are maintained at the `saved_carts` row level and must remain after migration.

The function also has a **repeat abandoner suppression** (`abandon_count >= 3`), a **purchase suppression** (orders_raw check), and a **cart expiry check** (3+ days). All are business logic that must remain unchanged.

---

## 2. Files / Tables Involved

**Edge functions:**
- `supabase/functions/sms-abandoned-cart/index.ts` — the function being migrated; contains `sendAndLog()`, `passesFrequencyCap()`, `isQuietHours()`, `generateShortCode()`, `generateCouponCode()`
- `supabase/functions/send-sms/index.ts` — already extended with `flow?`, `send_reason?`, `short_code?`, `redirect_url?`, `user_state_snapshot?` (deployed 2026-05-09). No further changes needed.

**Tables read by `sms-abandoned-cart`:**
- `saved_carts` — primary loop source: `status='active'`, `cart_value_cents >= 1500`, plus per-cart fields: `abandoned_step`, `last_sms_at`, `step_1_sent_at`, `step_2_sent_at`, `step_3_sent_at`, `abandon_count`
- `customer_contacts` — reads `status`, `sms_consent` (per-cart consent check); also read by `passesFrequencyCap()` for `last_sms_sent_at`
- `orders_raw` — reads for purchase suppression check (has the contact ordered since `cart.updated_at`?)
- `promotions` — dedup check for Step 3 coupon code generation

**Tables written by `sms-abandoned-cart`:**
- `saved_carts` — update per step: `abandoned_step`, `last_sms_at`, `abandoned_at`, `step_1_sent_at`, `step_2_sent_at`, `step_3_sent_at`; also `status='purchased'` or `status='expired'` in suppression paths
- `promotions` — Step 3 only: insert new discount coupon (`AC-` or `ACV-` prefix)
- `sms_messages` — **currently written directly by `sendAndLog()`**; after migration, written by `send-sms`
- `sms_sends` — **currently written directly by `sendAndLog()`**; after migration, written by `send-sms`
- `customer_contacts` — update `last_sms_sent_at` on successful Twilio send (inside `sendAndLog()`)

**Analytics views affected:**
- `sms_v_abandoned_cart` — reads `saved_carts` directly (`step_1_sent_at`, `step_2_sent_at`, `step_3_sent_at`, `status`, `purchased_at`, `abandoned_at`, etc.). **Zero dependency on `sms_sends` or `sms_messages`.** Migration does not affect this view at all — its data comes exclusively from `saved_carts` columns which are updated after each `sendAndLog()` call, not inside it.
- `sms_v_flow_performance_dated` — groups by `sms_sends.flow`. Abandoned cart sends appear as `flow='abandoned_cart'`. Flow name must remain `'abandoned_cart'` after migration.
- `sms_v_click_to_purchase` — joins `sms_messages.short_code` to click events. `short_code` and `redirect_url` must be written to `sms_messages` correctly (via `send-sms`).

---

## 3. Current Send Path

After all pre-send checks (purchase suppression, expiry, frequency cap, step eligibility), `sms-abandoned-cart` calls `sendAndLog()` per send:

1. **Builds Twilio form** with `To`, `From`, `Body`, and optionally `StatusCallback`
2. **Calls Twilio REST directly** — `POST https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json`
3. **Inserts `sms_messages`** — with `phone`, `contact_id`, `message_body`, `message_type`, `campaign`, `status='sent'|'failed'`, `provider_message_sid` (on success), `short_code`, `redirect_url`
4. **Inserts `sms_sends`** — inside `if (msgRow)` block — with `phone`, `contact_id`, `campaign`, `flow`, `send_reason`, `intent='marketing'`, `outcome='pending'`, `cost=0.0079`, `sms_message_id`, `user_state_snapshot`
5. **Updates `customer_contacts.last_sms_sent_at`** — only on Twilio success
6. **Returns `true`** on Twilio success, `false` on failure

On `true`, the caller updates `saved_carts` fields (`abandoned_step`, `last_sms_at`, `step_N_sent_at`). These updates happen **outside** `sendAndLog()` — they are not affected by the migration.

**Per-step parameters passed to `sendAndLog()`:**

| | Step 1 | Step 2 | Step 3 |
|---|---|---|---|
| `campaign` | `"abandoned_cart"` | `"abandoned_cart"` | `"abandoned_cart"` |
| `flow` | `"abandoned_cart"` | `"abandoned_cart"` | `"abandoned_cart"` |
| `sendReason` | `"cart_abandoned_30min"` | `"cart_abandoned_6hr_urgency"` | `"cart_abandoned_24hr_discount"` |
| `messageType` | `"abandoned_cart_reminder"` | `"abandoned_cart_urgency"` | `"abandoned_cart_discount"` |
| `snapshot` | `{ cart_value_cents, item_count, abandoned_step, minutes_since_update }` | same | `{ ...same, coupon_code, high_value }` |

The quiet-hours check (`isQuietHours()`) fires once at the top of `Deno.serve()` before the cart loop. If true, the entire function exits early and zero carts are processed.

The frequency cap (`passesFrequencyCap()`) checks `customer_contacts.last_sms_sent_at` per cart before determining the step.

---

## 4. Desired Send Path

After migration, all three steps should:

1. **Continue all existing pre-send logic unchanged:** purchase suppression, expiry check, repeat abandoner suppression, consent check, frequency cap (now enforced atomically by `send-sms`), step eligibility windows, Step 3 coupon generation.
2. **Drop the local `sendAndLog()` helper** and the 4 Twilio credential constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`).
3. **Replace each `sendAndLog()` call** with a `fetch` to `${supabaseUrl}/functions/v1/send-sms` with `Authorization: Bearer ${serviceKey}`.
4. **Drop the local `passesFrequencyCap()` helper** — `send-sms` enforces the 6-hour cap natively when `intent='marketing'`.
5. **Drop the local `isQuietHours()` function** and the handler-level quiet hours early-return — `send-sms` checks quiet hours per individual send, which is per-contact rather than all-or-nothing.
6. **Treat `{ blocked: true }` from `send-sms`** as a skip — increment `results.skipped` and do NOT update `saved_carts` step fields. If `send-sms` blocks a send, the cart must remain in its current step state so it can be retried on the next cron run. **This is critical:** updating `abandoned_step` or `step_N_sent_at` on a blocked (non-delivered) send would permanently skip that step for the cart.
7. **`sent = true`** only when `send-sms` returns `{ success: true }`. All other responses (blocked, failed) count as not-sent — the `saved_carts` update must be gated on `sent === true`, same as today.
8. **Do NOT pass `skip_caps: true`** — this is a scheduled marketing flow, not a consent-event send. Daily and weekly caps must apply.

`generateShortCode()`, `generateCouponCode()`, and all cart-loop business logic remain in `sms-abandoned-cart` unchanged.

---

## 5. Required Data To Preserve

All of the following must be passed to `send-sms` for each step:

| Field | Step 1 | Step 2 | Step 3 | Where used |
|---|---|---|---|---|
| `to` | `cart.phone` | `cart.phone` | `cart.phone` | Twilio recipient |
| `body` | Step 1 SMS text | Step 2 SMS text | Step 3 SMS text | Twilio message body |
| `message_type` | `"abandoned_cart_reminder"` | `"abandoned_cart_urgency"` | `"abandoned_cart_discount"` | `sms_messages.message_type` (CHECK constraint enforces these values) |
| `intent` | `"marketing"` | `"marketing"` | `"marketing"` | caps logic, `sms_sends.intent` |
| `campaign` | `"abandoned_cart"` | `"abandoned_cart"` | `"abandoned_cart"` | `sms_messages.campaign`, `sms_sends.campaign` |
| `contact_id` | `cart.contact_id` | `cart.contact_id` | `cart.contact_id` | `sms_messages.contact_id`, `sms_sends.contact_id`, cap check, `last_sms_sent_at` |
| `flow` | **`"abandoned_cart"`** | **`"abandoned_cart"`** | **`"abandoned_cart"`** | **CRITICAL** — `sms_v_flow_performance_dated` groups on this; fallback resolves to `campaign='abandoned_cart'` which is the same value, but must be explicit |
| `send_reason` | **`"cart_abandoned_30min"`** | **`"cart_abandoned_6hr_urgency"`** | **`"cart_abandoned_24hr_discount"`** | `sms_sends.send_reason`; identifies which step in analytics. `send-sms` fallback is `message_type` — not these values. Must be passed explicitly. |
| `short_code` | `shortCode` (generated) | `shortCode` (generated) | `shortCode` (generated) | `sms_messages.short_code`; click tracking via `sms-redirect` |
| `redirect_url` | `"https://karrykraze.com/pages/catalog.html"` | same | same | `sms_messages.redirect_url`; click tracking target |
| `user_state_snapshot` | `{ cart_value_cents, item_count, abandoned_step, minutes_since_update }` | same | `{ ...same, coupon_code, high_value }` | `sms_sends.user_state_snapshot` (audit) |
| `skip_caps` | **omit** | **omit** | **omit** | Must obey daily/weekly caps |

**Note on `flow` fallback:** `send-sms` resolves `flow` as `payload.flow ?? campaign ?? message_type`. If `flow` is omitted, the fallback is `campaign = 'abandoned_cart'` — which happens to be the correct value. However, it must still be passed explicitly for clarity and to prevent any future `campaign` rename from silently breaking the flow value.

**Note on `send_reason` fallback:** `send-sms` resolves `send_reason` as `payload.send_reason ?? message_type`. Step 1 fallback would be `'abandoned_cart_reminder'` (incorrect — should be `'cart_abandoned_30min'`). Step 2 fallback would be `'abandoned_cart_urgency'` (incorrect). Step 3 fallback would be `'abandoned_cart_discount'` (incorrect). All three `send_reason` values must be passed explicitly.

---

## 6. Risks / Compatibility Concerns

### Risk 1 — `saved_carts` step state must NOT be updated on blocked sends: HIGH if wrong

The `saved_carts` update blocks (`abandoned_step`, `step_N_sent_at`, `last_sms_at`) are gated on `if (sent)`. After migration, `sent` must only be `true` when `send-sms` returns `{ success: true }`. If `{ blocked: true }` is incorrectly treated as `sent = true`, the cart's step fields will be updated without an SMS being delivered and the step will be permanently skipped for that cart.

**Correct behavior after migration:** `{ blocked: true }` → `sent = false` → `results.skipped++` → `saved_carts` NOT updated → cart retried on next cron run.

### Risk 2 — `send_reason` fallback is wrong for all three steps: HIGH if omitted

The current `sendAndLog()` writes `send_reason` directly. After migration, `send-sms` fallback would write `message_type` values (`'abandoned_cart_reminder'`, `'abandoned_cart_urgency'`, `'abandoned_cart_discount'`) instead of the intended step identifiers (`'cart_abandoned_30min'`, `'cart_abandoned_6hr_urgency'`, `'cart_abandoned_24hr_discount'`). No dedup guard currently reads `send_reason` for this flow, so there is no double-send risk — the impact is analytics fidelity. Still: always pass `send_reason` explicitly.

### Risk 3 — Quiet hours behavior change: LOW (net improvement)

Currently: if the cron fires during quiet hours, the entire run exits early. After migration: `send-sms` checks quiet hours per individual send. A run that starts at 8:58 PM ET may succeed for a few carts before quiet hours begin and then block remaining carts. This is more precise behavior and causes no data loss — the blocked carts are retried on the next cron run.

### Risk 4 — Daily/weekly cap newly applied across flows: LOW (desired tightening)

Previously, a contact who received a coupon reminder or welcome series SMS earlier the same day could still receive an abandoned-cart SMS if the 6-hour frequency cap had elapsed. After migration, `send-sms` enforces the daily cap (max 1 marketing SMS per contact per UTC day). Such contacts will be blocked and retried on the next cron run. This is the desired behavior.

### Risk 5 — `sms_v_abandoned_cart` view is unaffected: NEGLIGIBLE

`sms_v_abandoned_cart` reads exclusively from `saved_carts` columns (`step_1_sent_at`, `step_2_sent_at`, `step_3_sent_at`, `status`, `purchased_at`, `abandoned_at`, etc.). It has no dependency on `sms_sends` or `sms_messages`. The migration does not touch `saved_carts` update logic — those updates happen in the caller after `sendAndLog()` returns `true`, and they will continue to happen after `sendViaSendSms()` returns `"sent"`. The funnel analytics view is completely unaffected.

### Risk 6 — Step 3 coupon created before the send call: NEGLIGIBLE

Step 3 creates the `promotions` row before calling `sendAndLog()`. After migration, the promo is still created before the `send-sms` call. If `send-sms` blocks or fails, the orphaned promotion row has no practical impact — it expires in 48 hours. This behavior is pre-existing (a Twilio failure already orphaned the row today).

### Risk 7 — `cost` is already written in the current code: NOTE

Unlike `coupon-upgrade`, `sms-abandoned-cart`'s `sendAndLog()` already writes `cost: 0.0079` to `sms_sends`. After migration, `send-sms` also writes `cost: 0.0079`. Behavioral parity is maintained.

### Risk 8 — Helper return type changes from `boolean` to string enum: LOW

`sendAndLog()` returns `boolean`. After migration, the new helper (`sendViaSendSms()`) should return `"sent" | "skipped" | "failed"` — the same pattern used in `sms-coupon-reminder` and `sms-welcome-series`. The `if (sent)` gates in the step blocks require updating: `if (sent)` → `if (result === "sent")`.

---

## 7. Recommended Fix

Single-step deployment. No changes to `send-sms` needed.

**File:** `supabase/functions/sms-abandoned-cart/index.ts`

**Remove:**
1. The 4 Twilio credential constants: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`
2. `sendAndLog()` helper entirely (~45 lines)
3. `passesFrequencyCap()` helper (~12 lines)
4. `isQuietHours()` function (~5 lines)
5. The quiet hours early-return at the top of `Deno.serve()` (3 lines)
6. The per-cart `passesFrequencyCap()` call (3 lines)

**Keep unchanged:** `generateShortCode()`, `generateCouponCode()`, `topItemName()`, `MIN_CART_VALUE_CENTS`, all cart loop logic (purchase suppression, expiry, consent check, repeat abandoner suppression, step eligibility windows, Step 3 coupon generation), all `saved_carts` update blocks.

**Add** a `sendViaSendSms()` helper (same pattern as `sms-coupon-reminder` and `sms-welcome-series`):

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
    console.warn("[sms-abandoned-cart] send-sms did not succeed:", JSON.stringify(data));
    return "failed";
  } catch (err: unknown) {
    console.error("[sms-abandoned-cart] send-sms call failed:",
      err instanceof Error ? err.message : String(err));
    return "failed";
  }
}
```

**Replace each `sendAndLog()` call** with `sendViaSendSms()`:

**Step 1 call site:**
```typescript
const result = await sendViaSendSms({
  to:                  cart.phone,
  body:                smsBody,
  message_type:        "abandoned_cart_reminder",
  intent:              "marketing",
  campaign:            "abandoned_cart",
  contact_id:          cart.contact_id,
  flow:                "abandoned_cart",
  send_reason:         "cart_abandoned_30min",
  short_code:          shortCode,
  redirect_url:        targetUrl,
  user_state_snapshot: snapshot,
});
const sent = result === "sent";
if (!sent) results.skipped++;
```

**Step 2 call site:**
```typescript
const result = await sendViaSendSms({
  to:                  cart.phone,
  body:                smsBody,
  message_type:        "abandoned_cart_urgency",
  intent:              "marketing",
  campaign:            "abandoned_cart",
  contact_id:          cart.contact_id,
  flow:                "abandoned_cart",
  send_reason:         "cart_abandoned_6hr_urgency",
  short_code:          shortCode,
  redirect_url:        targetUrl,
  user_state_snapshot: snapshot,
});
const sent = result === "sent";
if (!sent) results.skipped++;
```

**Step 3 call site:**
```typescript
const result = await sendViaSendSms({
  to:                  cart.phone,
  body:                smsBody,
  message_type:        "abandoned_cart_discount",
  intent:              "marketing",
  campaign:            "abandoned_cart",
  contact_id:          cart.contact_id,
  flow:                "abandoned_cart",
  send_reason:         "cart_abandoned_24hr_discount",
  short_code:          shortCode,
  redirect_url:        targetUrl,
  user_state_snapshot: { ...snapshot, coupon_code: couponCode, high_value: isHighValue },
});
const sent = result === "sent";
if (!sent) results.skipped++;
```

All three `if (sent)` blocks that update `saved_carts` remain unchanged — they still gate on `sent === true`.

Deploy:
```bash
echo y | npx supabase functions deploy sms-abandoned-cart --project-ref yxdzvzscufkvewecvagq
```

---

## 8. Verification Plan

`sms-abandoned-cart` is cron-triggered (runs on a schedule per `SETUP_ABANDONED_CART_CRON.sql`). Verification requires a cron run with carts in the eligible windows, or a manual function invocation.

### Pre-deploy: record baseline counts

```sql
SELECT
  flow,
  send_reason,
  COUNT(*) AS total_sends,
  MAX(created_at) AS most_recent_send
FROM sms_sends
WHERE flow = 'abandoned_cart'
GROUP BY flow, send_reason
ORDER BY send_reason;
```

Record:
- `cart_abandoned_30min` total as **S1**
- `cart_abandoned_6hr_urgency` total as **S2**
- `cart_abandoned_24hr_discount` total as **S3**

Also record the abandoned cart funnel view baseline:
```sql
SELECT step1_sends, step2_sends, step3_sends, total_recovered, recovery_rate_pct
FROM sms_v_abandoned_cart;
```

---

### After next cron run or manual trigger:

**V1 — most recent Step 1 send has correct fields:**
```sql
SELECT
  ss.flow, ss.send_reason, ss.campaign, ss.intent, ss.outcome, ss.cost,
  sm.message_type, sm.short_code, sm.redirect_url, sm.provider_message_sid, sm.status
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.send_reason = 'cart_abandoned_30min'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** `flow='abandoned_cart'`, `send_reason='cart_abandoned_30min'`, `campaign='abandoned_cart'`, `intent='marketing'`, `outcome='pending'`, `cost=0.0079`, `message_type='abandoned_cart_reminder'`, `short_code` non-null, `redirect_url='https://karrykraze.com/pages/catalog.html'`, `provider_message_sid` non-null, `status='sent'`

**V2 — most recent Step 2 send has correct fields (if any eligible carts):**
```sql
SELECT
  ss.flow, ss.send_reason, ss.campaign, ss.intent, ss.outcome, ss.cost,
  sm.message_type, sm.short_code, sm.redirect_url, sm.provider_message_sid, sm.status
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.send_reason = 'cart_abandoned_6hr_urgency'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** Same field set with `send_reason='cart_abandoned_6hr_urgency'`, `message_type='abandoned_cart_urgency'`

**V3 — most recent Step 3 send has correct fields (if any eligible carts):**
```sql
SELECT
  ss.flow, ss.send_reason, ss.campaign, ss.intent, ss.outcome, ss.cost,
  sm.message_type, sm.short_code, sm.redirect_url, sm.provider_message_sid, sm.status
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.send_reason = 'cart_abandoned_24hr_discount'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** Same field set with `send_reason='cart_abandoned_24hr_discount'`, `message_type='abandoned_cart_discount'`

**V4 — flow performance view shows correct flow name (no leakage):**
```sql
SELECT flow, total_sends, sent_date
FROM sms_v_flow_performance_dated
WHERE flow = 'abandoned_cart'
ORDER BY sent_date DESC LIMIT 4;
```
**Expected:** Rows appear with `flow='abandoned_cart'` exactly. No rows with `flow='abandoned_cart_reminder'`, `'abandoned_cart_urgency'`, or `'abandoned_cart_discount'` (which would indicate `message_type` leaked into `flow` because `flow` was not passed explicitly).

**V5 — sms_v_abandoned_cart funnel view is unchanged:**
```sql
SELECT step1_sends, step2_sends, step3_sends, total_recovered, recovery_rate_pct
FROM sms_v_abandoned_cart;
```
**Expected:** `step1_sends`, `step2_sends`, `step3_sends` ≥ baseline values (or same if no sends occurred). View reads `saved_carts` directly so this should always hold — confirms no regression in the `saved_carts` update path.

**V6 — No double-sends across any step:**
```sql
SELECT contact_id, send_reason, COUNT(*) AS send_count
FROM sms_sends
WHERE flow = 'abandoned_cart'
GROUP BY contact_id, send_reason
HAVING COUNT(*) > 1;
```
**Expected:** Zero rows. Any row here means a contact received the same step more than once, indicating `step_N_sent_at` dedup guards failed or `saved_carts` was updated on a blocked send.

**V7 — Regression: total send counts not lower than baseline:**
```sql
SELECT flow, send_reason, COUNT(*) AS total_sends
FROM sms_sends
WHERE flow = 'abandoned_cart'
GROUP BY flow, send_reason
ORDER BY send_reason;
```
**Expected:** `cart_abandoned_30min` ≥ S1, `cart_abandoned_6hr_urgency` ≥ S2, `cart_abandoned_24hr_discount` ≥ S3.

---

## 9. Definition of Done

All of the following must be true before `sms-abandoned-cart` is considered resolved for GAP-06:

- [ ] `sms-abandoned-cart` no longer imports or calls Twilio credentials directly — all Twilio calls route through `send-sms`
- [ ] `sendAndLog()`, `passesFrequencyCap()`, and `isQuietHours()` helper functions removed from the file
- [ ] `generateShortCode()`, `generateCouponCode()`, `topItemName()` remain unchanged
- [ ] All cart-loop business logic (purchase suppression, expiry, consent check, repeat abandoner suppression, step eligibility windows, Step 3 coupon generation) unchanged
- [ ] `saved_carts` update blocks still gated on `result === "sent"` — NOT on `"skipped"` or `"failed"`
- [ ] V1: most recent Step 1 send: `flow='abandoned_cart'`, `send_reason='cart_abandoned_30min'`, `cost=0.0079`, `provider_message_sid` non-null, `sms_message_id` non-null (or N/A if no eligible carts existed post-deploy)
- [ ] V2: most recent Step 2 send: correct fields (or N/A)
- [ ] V3: most recent Step 3 send: correct fields (or N/A)
- [ ] V4: `sms_v_flow_performance_dated` shows `flow='abandoned_cart'` rows; no `message_type` leakage into `flow`
- [ ] V5: `sms_v_abandoned_cart` step counts ≥ baseline
- [ ] V6: Zero contacts received the same step more than once (`sms_sends` dedup check)
- [ ] V7: Cumulative send counts per step ≥ pre-deploy baseline
- [ ] `001_smsKnownGaps.md` GAP-06 updated to resolved (0 remaining flows)
- [ ] `002_smsChangeLog.md` entry added for the `sms-abandoned-cart` deploy

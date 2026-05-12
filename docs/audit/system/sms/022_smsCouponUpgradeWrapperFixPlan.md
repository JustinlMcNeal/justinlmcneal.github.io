# SMS Coupon Upgrade Wrapper Fix Plan

**Date:** 2026-05-09  
**Status:** deployed and verified — 2026-05-09. V1: N/A — no post-deploy upgrade send occurred in the verification window; a fresh live coupon-upgrade transaction would further confirm end-to-end wrapper routing through `send-sms`. V2–V5: PASS — `cc.coupon_code = cu.upgrade_code = VIP-WHEGPF`, `sms_message_id` non-null, `vip_upgrade` cohort intact, `flow='upgrade'` in performance view, other cohorts unchanged. See `002_smsChangeLog.md` 2026-05-09 entry for full verification results.  
**Gap:** GAP-06 (`001_smsKnownGaps.md`) — `coupon-upgrade` calls Twilio directly, bypassing `send-sms` (resolved)  
**Scope:** `coupon-upgrade` only. `sms-abandoned-cart` is out of scope for this document.

---

## 1. Problem Summary

`coupon-upgrade` is a public HTTP endpoint triggered when a user submits their phone number on a coupon landing page to receive a personal VIP upgrade code. It generates a unique `VIP-XXXXXX` promotion code, upserts the contact into `customer_contacts`, inserts a `coupon_upgrades` row, and then sends the upgrade code via SMS by calling the Twilio REST API directly.

Because it bypasses `send-sms`:

- **`sms_messages` has no `sms_message_id` linkage to `sms_sends`** — the function currently writes both tables directly, but if either insert fails independently the rows may be orphaned or mislinked
- **Twilio delivery callbacks cannot update `delivered_at`** — the Twilio webhook (`sms-webhook`) updates `sms_messages` by `provider_message_sid`; this still works. However, having the send go through `send-sms` makes the architecture uniform and ensures all guardrails are applied consistently
- **`cost` is not written** to `sms_sends` — the direct insert omits `cost`, so upgrade sends show `NULL` cost in analytics. After migration, `send-sms` writes `cost: 0.0079` consistently
- **Not audited by a single entry point** — any future changes to Twilio credentials, `sms_messages` schema, or logging logic would need to be updated in `coupon-upgrade` separately from `send-sms`

Unlike the cron marketing flows (`sms-welcome-series`, `sms-coupon-reminder`), `coupon-upgrade` is a **consent-event send** — the user is actively opting in at the moment the SMS is triggered. This changes the cap behavior: `skip_caps: true` is appropriate (same as `sms-subscribe`).

---

## 2. Files / Tables Involved

**Edge functions:**
- `supabase/functions/coupon-upgrade/index.ts` — the function being migrated; contains a direct Twilio `fetch` call, `sms_messages` insert, and `sms_sends` insert that will all move to `send-sms`
- `supabase/functions/send-sms/index.ts` — already extended with `flow?`, `send_reason?`, `short_code?`, `redirect_url?`, `user_state_snapshot?`, `skip_caps?` (deployed 2026-05-09)

**Tables read by `coupon-upgrade`:**
- `promotions` — loads the base promotion row (upgrade config: `coupon_upgrade_enabled`, `coupon_upgrade_value`, `coupon_upgrade_prefix`, `coupon_upgrade_expiry_days`)
- `coupon_upgrades` — checks whether this phone has already been upgraded for this promo (idempotency guard)
- `sms_consent_logs` — IP-based rate limiting (3 per hour)
- `customer_contacts` — upsert: existing contact or new contact

**Tables written by `coupon-upgrade`:**
- `promotions` — insert: new personal upgrade promotion row (the `VIP-XXXXXX` promo) created before the SMS call
- `coupon_upgrades` — insert: records the issued upgrade code (`promo_id`, `phone`, `upgrade_code`, `upgrade_promo_id`)
- `customer_contacts` — upsert: `status='active'`, `sms_consent=true`, `coupon_code=upgradeCode`, `opted_in_at`, `last_sms_sent_at=now` (pre-set before send call)
- `sms_consent_logs` — insert: consent record
- `sms_messages` — **currently written directly by coupon-upgrade**; after migration, written by `send-sms`
- `sms_sends` — **currently written directly by coupon-upgrade**; after migration, written by `send-sms`

**Analytics views affected:**
- `sms_v_coupon_cohorts` — **critical dependency**. Filters `WHERE s.flow IN ('signup', 'coupon_escalation', 'upgrade')` and maps `WHEN s.flow = 'upgrade' THEN 'vip_upgrade'`. The `vip_upgrade` cohort exists only because `sms_sends.flow = 'upgrade'`. If this value is not written correctly after migration, upgrade sends disappear from the cohort view entirely.
- `sms_v_flow_performance_dated` — groups by `sms_sends.flow`. Upgrade sends appear as the `upgrade` flow row. Flow name must remain `'upgrade'`.
- `sms_v_click_to_purchase` — joins `sms_messages.short_code` to click events. `short_code` and `redirect_url` must be written to `sms_messages` correctly (via `send-sms`).
- `stripe-webhook` Method 1 attribution — looks up `sms_sends` via `flow = 'upgrade'` when the coupon code starts with `'VIP-'`. If `sms_sends.flow` is not `'upgrade'`, the attribution lookup fails and the upgrade order is not attributed.

---

## 3. Current Send Path

After all the pre-send setup (promo validation, code generation, contact upsert, consent log), `coupon-upgrade` sends directly:

1. **Composes `smsBody`** — includes `upgradeCode`, discount label, expiry, and a tracking URL using a locally generated `shortCode` (`karrykraze.com/r/?c=<shortCode>`)
2. **Calls Twilio REST directly** — `POST https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json` with credentials from env vars
3. **Inserts `sms_messages`** — with `phone`, `contact_id`, `message_body`, `message_type='coupon_delivery'`, `campaign='coupon_upgrade'`, `status='sent'|'failed'`, `provider_message_sid` (on success), `short_code`, `redirect_url='https://karrykraze.com/pages/catalog.html'`
4. **Inserts `sms_sends`** — inside `if (msgRow)` block — with `phone`, `contact_id`, `campaign='coupon_upgrade'`, `flow='upgrade'`, `send_reason='coupon_upgrade_enrollment'`, `intent='marketing'`, `outcome='pending'`, `sms_message_id=msgRow.id`, `user_state_snapshot: { promo_id, source: 'coupon_upgrade' }`. No `cost` field is written.
5. **Returns** `{ success: true, already_upgraded: false, coupon_code: upgradeCode, sms_sent: smsSent, message: ... }` — `sms_sent` is false if Twilio rejected

Note: `last_sms_sent_at` is written to `customer_contacts` as part of the **contact upsert** (step before the send), not by a dedicated post-send update. If the SMS send fails, `last_sms_sent_at` is still set.

No quiet hours check, no daily cap, no weekly cap, no frequency cap — none are present in the current implementation. This is correct behavior for a consent-event send.

---

## 4. Desired Send Path

After migration:

1. **All pre-send logic unchanged:** promo validation, code generation, `promotions` insert (personal upgrade promo), `coupon_upgrades` insert, contact upsert (including `last_sms_sent_at` pre-set), consent log insert.
2. **Compose `smsBody` unchanged.** `generateShortCode()` still called locally (the short code must be known before the `send-sms` call so it can be passed in the payload).
3. **Replace the direct Twilio `fetch` + `sms_messages` insert + `sms_sends` insert** with a single `fetch` to `${supabaseUrl}/functions/v1/send-sms`.
4. **Pass `skip_caps: true`** — this is a consent-event send (user just opted in). Quiet hours, daily cap, weekly cap, and frequency cap should not block it. This is the same rationale as `sms-subscribe`.
5. **`send-sms` will handle:** Twilio REST call, `sms_messages` insert (success and failure paths), `sms_sends` insert, and a second `last_sms_sent_at` update (harmless double-write since the upsert already set it).
6. **`{ blocked: true }` will never be returned** when `skip_caps: true` is set — `send-sms` skips all guardrails. The only non-success responses are Twilio errors or network failures.
7. **`sms_sent` in the return payload** should be `true` if `send-sms` returned `{ success: true }`, `false` otherwise. Response shape is unchanged.
8. **Remove** the 4 Twilio credential constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`).

`generateShortCode()`, `generateUpgradeCode()`, and `normalizePhone()` all remain in the file unchanged.

---

## 5. Required Data To Preserve

All of the following must be passed to `send-sms`:

| Field | Value | Where used |
|---|---|---|
| `to` | `phone` (E.164) | Twilio recipient |
| `body` | `smsBody` (composed locally) | Twilio message body |
| `message_type` | `"coupon_delivery"` | `sms_messages.message_type` |
| `intent` | `"marketing"` | `sms_sends.intent`; determines `last_sms_sent_at` update |
| `campaign` | `"coupon_upgrade"` | `sms_messages.campaign`, `sms_sends.campaign` |
| `contact_id` | `contactId` | `sms_messages.contact_id`, `sms_sends.contact_id`, `last_sms_sent_at` update |
| `flow` | **`"upgrade"`** | **CRITICAL** — `sms_v_coupon_cohorts` maps `flow='upgrade'` → `vip_upgrade` cohort; `stripe-webhook` uses this for Method 1 attribution. Falls back to `campaign='coupon_upgrade'` if omitted — which breaks both the cohort view and attribution. Must be passed explicitly. |
| `send_reason` | **`"coupon_upgrade_enrollment"`** | `sms_sends.send_reason`. `send-sms` fallback is `message_type='coupon_delivery'` — not this value. Must be passed explicitly. |
| `short_code` | `shortCode` (generated locally) | `sms_messages.short_code`; click tracking via `sms-redirect` |
| `redirect_url` | `"https://karrykraze.com/pages/catalog.html"` | `sms_messages.redirect_url`; click tracking target |
| `user_state_snapshot` | `{ promo_id, source: "coupon_upgrade" }` | `sms_sends.user_state_snapshot` (audit) |
| `skip_caps` | `true` | Bypass quiet hours / daily / weekly / frequency caps — user just consented |

---

## 6. Risks / Compatibility Concerns

### Risk 1 — `flow` must be `"upgrade"` exactly: HIGH if wrong

`sms_v_coupon_cohorts` has a `WHERE s.flow IN ('signup', 'coupon_escalation', 'upgrade')` filter. If `flow` is not `'upgrade'`, upgrade sends are excluded from the view entirely and the `vip_upgrade` cohort shows zero sends.

`stripe-webhook` Method 1 attribution uses `flow = 'upgrade'` as the `sms_sends` row lookup key for VIP orders. If `flow` is wrong, coupon attribution fails silently — the order is placed successfully but no `sms_sends` row transitions to `outcome='converted'`.

`send-sms` fallback for `flow`: `payload.flow ?? campaign ?? message_type`. If `flow` is not passed, it falls back to `campaign = 'coupon_upgrade'` — NOT `'upgrade'`. **Always pass `flow: 'upgrade'` explicitly.**

### Risk 2 — `send_reason` fallback is wrong: MEDIUM if omitted

`send-sms` fallback for `send_reason`: `payload.send_reason ?? message_type`. If omitted, `send_reason` would be written as `'coupon_delivery'` instead of `'coupon_upgrade_enrollment'`. No current dedup guard reads `send_reason` for this flow (unlike `sms-welcome-series`), so there is no double-send risk. The impact is limited to analytics queries that filter on `send_reason`. Still: pass it explicitly for fidelity.

### Risk 3 — `skip_caps: true` removes all guardrails: LOW (by design)

This is correct for a consent-event send. The user just submitted their phone — blocking due to quiet hours or daily cap would result in no SMS being sent and the user's coupon code silently not arriving. The current implementation has the same behavior (no caps at all). Using `skip_caps: true` makes this explicit.

### Risk 4 — `last_sms_sent_at` double-write: NEGLIGIBLE

The contact upsert sets `last_sms_sent_at: now.toISOString()` before the send call. After migration, `send-sms` will also update `last_sms_sent_at` after a successful Twilio call — two writes to the same field within milliseconds. Both values are the same effective timestamp. No impact.

The pre-set behavior (setting `last_sms_sent_at` even if the send fails) is pre-existing and is preserved after migration since the contact upsert code is unchanged.

### Risk 5 — `cost` column now populated: LOW (improvement)

The current `sms_sends` insert omits `cost`. After migration, `send-sms` writes `cost: 0.0079` on every successful send. This is a net improvement for analytics (upgrade sends previously showed `NULL` cost).

### Risk 6 — Personal upgrade promo created before send call: NEGLIGIBLE

The `promotions` insert (personal upgrade promo row) and the `coupon_upgrades` insert both happen before the `send-sms` call. If the send fails, both rows exist but the coupon code was never texted. This is the same pre-existing behavior — a Twilio failure already orphaned these rows before migration. The return payload already handles this case: `sms_sent: false` with the coupon code shown to the user as a fallback.

### Risk 7 — `sms_sends` currently written only if `sms_messages` insert succeeded: MINOR

Currently, `sms_sends` is inside `if (msgRow)` — it is only inserted when `sms_messages` was successfully inserted. After migration, `send-sms` handles both internally and will only write `sms_sends` on a successful Twilio send. Behavioral parity is preserved.

---

## 7. Recommended Fix

Single-step deployment. No changes to `send-sms` needed — all required optional parameters are already deployed.

**File:** `supabase/functions/coupon-upgrade/index.ts`

**Remove:**
1. The 4 Twilio credential constants: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`
2. The direct Twilio `fetch` block (~10 lines)
3. The `sms_messages` insert block (~14 lines)
4. The `sms_sends` insert block inside `if (msgRow)` (~12 lines)
5. The `const smsSent = twilioResp.ok;` line and `const twilioData = await twilioResp.json();` and `const twilioUrl = ...` and `const formData = ...` and the `if (!smsSent) console.error(...)` block

**Keep unchanged:** `generateShortCode()`, `generateUpgradeCode()`, `normalizePhone()`, all pre-send logic (promo validation, code generation, `promotions`/`coupon_upgrades`/`customer_contacts`/`sms_consent_logs` writes), the existing `already_upgraded` early-return, the IP rate limit check.

**Add** an inline send call replacing the removed Twilio block:

```typescript
// ── Send via send-sms wrapper ──────────────────────────────
const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceKey}`,
  },
  body: JSON.stringify({
    to:                  phone,
    body:                smsBody,
    message_type:        "coupon_delivery",
    intent:              "marketing",
    campaign:            "coupon_upgrade",
    contact_id:          contactId,
    flow:                "upgrade",
    send_reason:         "coupon_upgrade_enrollment",
    short_code:          shortCode,
    redirect_url:        "https://karrykraze.com/pages/catalog.html",
    user_state_snapshot: { promo_id, source: "coupon_upgrade" },
    skip_caps:           true,
  }),
});

let smsSent = false;
try {
  const smsData = await smsRes.json();
  smsSent = smsRes.ok && smsData.success === true;
  if (!smsSent) {
    console.error("[coupon-upgrade] send-sms did not succeed:", JSON.stringify(smsData));
  }
} catch (err: unknown) {
  console.error("[coupon-upgrade] send-sms response parse error:",
    err instanceof Error ? err.message : String(err));
}
```

The existing final `return json(...)` block at the bottom of the handler is unchanged — it still uses `smsSent` to decide the message string.

Deploy:
```bash
echo y | npx supabase functions deploy coupon-upgrade --project-ref yxdzvzscufkvewecvagq
```

---

## 8. Verification Plan

`coupon-upgrade` is HTTP-invoked (not cron). Verification requires a real or test form submission with a phone number that has not previously been upgraded for the test promotion.

### Pre-deploy: record baseline

```sql
SELECT
  flow,
  send_reason,
  COUNT(*) AS total_sends,
  MAX(created_at) AS most_recent_send
FROM sms_sends
WHERE flow = 'upgrade'
GROUP BY flow, send_reason;
```

Record baseline total as **U0**. Also record the current `vip_upgrade` cohort count:

```sql
SELECT cohort, total_coupons_issued, redeemed, sms_attributed_orders
FROM sms_v_coupon_cohorts
WHERE cohort = 'vip_upgrade';
```

### After deploy — trigger a test upgrade:

Submit the coupon upgrade form (or invoke the function directly with a valid `promo_id` and a unique test phone) to produce a fresh send.

**V1 — most recent upgrade send has correct fields:**
```sql
SELECT
  ss.flow, ss.send_reason, ss.campaign, ss.intent, ss.outcome, ss.cost,
  sm.message_type, sm.short_code, sm.redirect_url, sm.provider_message_sid, sm.status
FROM sms_sends ss
JOIN sms_messages sm ON sm.id = ss.sms_message_id
WHERE ss.flow = 'upgrade'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** `flow='upgrade'`, `send_reason='coupon_upgrade_enrollment'`, `campaign='coupon_upgrade'`, `intent='marketing'`, `outcome='pending'`, `cost=0.0079`, `message_type='coupon_delivery'`, `short_code` non-null, `redirect_url='https://karrykraze.com/pages/catalog.html'`, `provider_message_sid` non-null, `status='sent'`

**V2 — VIP attribution chain intact (sms_sends linked to correct flow):**
```sql
SELECT ss.flow, ss.send_reason, ss.outcome, ss.sms_message_id,
       cc.coupon_code, cu.upgrade_code
FROM sms_sends ss
JOIN customer_contacts cc ON cc.id = ss.contact_id
JOIN coupon_upgrades cu ON cu.phone = ss.phone
WHERE ss.flow = 'upgrade'
ORDER BY ss.created_at DESC LIMIT 1;
```
**Expected:** `flow='upgrade'`, `cc.coupon_code` matches `cu.upgrade_code`, `sms_message_id` non-null

**V3 — coupon_cohorts view shows vip_upgrade row with count ≥ U0 + 1:**
```sql
SELECT cohort, total_coupons_issued, redeemed, sms_attributed_orders
FROM sms_v_coupon_cohorts
WHERE cohort = 'vip_upgrade';
```
**Expected:** `total_coupons_issued` ≥ baseline + 1. If the `upgrade` flow is not written correctly, this count will not increase and the row may shift to the `initial_15pct` cohort or disappear.

**V4 — flow performance view includes upgrade flow:**
```sql
SELECT flow, total_sends, sent_date
FROM sms_v_flow_performance_dated
WHERE flow = 'upgrade'
ORDER BY sent_date DESC LIMIT 3;
```
**Expected:** At least one row with today's date and `flow='upgrade'`. No rows with `flow='coupon_upgrade'` or `flow='coupon_delivery'` (which would indicate the fallback fired instead of the explicit value).

**V5 — regression: other cohorts unchanged:**
```sql
SELECT cohort, total_coupons_issued
FROM sms_v_coupon_cohorts
WHERE cohort IN ('initial_15pct', 'escalation_20pct');
```
**Expected:** Same counts as pre-deploy baseline. Any change here indicates the upgrade send was attributed to the wrong cohort.

---

## 9. Definition of Done

All of the following must be true before `coupon-upgrade` is considered resolved for GAP-06:

- [ ] `coupon-upgrade` no longer imports or calls Twilio credentials directly — all Twilio calls route through `send-sms`
- [ ] Direct Twilio `fetch`, `sms_messages` insert, and `sms_sends` insert removed from `coupon-upgrade`
- [ ] `generateShortCode()`, `generateUpgradeCode()`, `normalizePhone()` remain unchanged
- [ ] All pre-send business logic (promo validation, code uniqueness, `promotions`/`coupon_upgrades`/`customer_contacts`/`sms_consent_logs` writes) unchanged
- [ ] V1: `sms_sends.flow='upgrade'`, `send_reason='coupon_upgrade_enrollment'`, `cost=0.0079`, `provider_message_sid` non-null, `sms_message_id` non-null
- [ ] V2: `cc.coupon_code` matches `cu.upgrade_code`; `sms_sends.sms_message_id` non-null
- [ ] V3: `sms_v_coupon_cohorts` `vip_upgrade` count ≥ baseline + 1
- [ ] V4: `sms_v_flow_performance_dated` shows `flow='upgrade'` row for today; no `flow='coupon_upgrade'` or `flow='coupon_delivery'` leakage
- [ ] V5: `initial_15pct` and `escalation_20pct` cohort counts unchanged
- [ ] `001_smsKnownGaps.md` GAP-06 updated from 2 remaining flows to 1 remaining (`sms-abandoned-cart`)
- [ ] `002_smsChangeLog.md` entry added for the `coupon-upgrade` deploy

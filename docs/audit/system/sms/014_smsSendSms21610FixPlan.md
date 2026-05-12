# 014 — send-sms: Synchronous 21610 Unsubscribe Fix Plan

**Date:** 2025-05-11  
**Status:** Planning — no code changes yet  
**Author:** Audit session  
**Related:** `013_sms21610BackfillAudit.md`, `supabase/functions/twilio-webhook/index.ts` (already fixed)

---

## 1. Problem Summary

When Twilio rejects a message **synchronously** with error code `21610`
("The message From/To pair violates a blacklist rule"), the response comes back
immediately in the Twilio REST API `fetch()` reply — before Twilio assigns a
`MessageSid`. Because there is no SID, Twilio never fires a status-callback
webhook to our `twilio-webhook` edge function.

As a result, `sms_messages` is written with `status='failed'` / `error_code='21610'`
/ `provider_message_sid=NULL`, but **`customer_contacts` is never touched**.
The contact remains `status='active'` / `sms_consent=true`, meaning:

- The fatigue monitor still counts them as "active".
- Future sends will pass the pre-send consent guard and hit Twilio again (repeatedly failing with 21610).
- The subscriber funnel never records an `unsubscribed` event.
- `sms_consent_logs` has no audit trail.

This is the architectural gap exposed by the historical backfill in `013_sms21610BackfillAudit.md` which corrected 4 affected contacts manually.

---

## 2. Files / Systems Involved

| File / Table | Role |
|---|---|
| `supabase/functions/send-sms/index.ts` | **Primary change target** — makes the Twilio REST API call; must detect 21610 and update contacts |
| `supabase/functions/twilio-webhook/index.ts` | Already fixed (async 21610); no further change needed |
| `customer_contacts` | `status`, `sms_consent`, `opted_out_at` must be updated |
| `sms_consent_logs` | Opt-out audit record must be inserted |
| `sms_messages` | Failure record already written correctly; no change needed |
| `sms_v_fatigue_monitor` | Dashboard view; will auto-reflect after fix |
| `sms_v_subscriber_funnel` | Dashboard view; will auto-reflect after fix |

---

## 3. Current Failure Path

All line numbers are approximate references to `send-sms/index.ts` at the time of
this audit.

```
send-sms called  →  parse payload
                 →  isQuietHours() guard
                 →  consent/status guard  (contact.status !== 'active' || !sms_consent → blocked)
                 →  6h frequency cap
                 →  daily cap (max 1 marketing/day)
                 →  weekly cap (max 4 marketing/week)
                 →  Twilio REST POST to Messages.json
                       Response: HTTP 400
                       Body: { "code": 21610, "message": "The message From/To pair violates a blacklist rule." }
                 →  if (!twilioResp.ok) {
                       console.error(...)
                       sb.from("sms_messages").insert({
                         status: "failed",
                         error_code: "21610",          // String(twilioData.code)
                         error_message: "The message From/To pair violates a blacklist rule.",
                         provider_message_sid: [absent → NULL],
                         sent_at:              [absent → NULL],
                       })
                       return json({ error: "SMS send failed" }, 502)
                    }
```

**What is MISSING:** No update to `customer_contacts`. No insert to `sms_consent_logs`.
The contact leaves this function still marked `active`/`sms_consent=true`.

Key detail: `twilioData.code` is an **integer** (`21610`) in the raw JSON response from
Twilio. The existing code converts it with `String(twilioData.code || twilioResp.status)`
when writing `error_code`. The comparison in the fix must account for this (see §6).

---

## 4. Desired Behavior After Fix

When Twilio returns `error_code 21610`:

1. `sms_messages` is still written with `status='failed'` / `error_code='21610'` (unchanged).
2. **`customer_contacts` is updated:**
   - `status = 'unsubscribed'`
   - `sms_consent = false`
   - `opted_out_at = <current timestamp>`
3. **`sms_consent_logs` gets a new row:**
   - `phone = to` (the E.164 number)
   - `consent_type = 'opt_out'`
   - `source = 'send_sms_21610'`
4. The 502 response is still returned to the caller (caller must handle gracefully).
5. On any **subsequent** call for the same contact, the pre-send consent guard
   (`status !== 'active' || !sms_consent`) blocks the message **before** hitting Twilio.

---

## 5. Risks / Compatibility

### 5.1 — `contact_id` may be null
Some callers omit `contact_id` in the payload. The fix must guard: if `contact_id`
is null, attempt the update by `phone` instead. If neither resolves, log a warning
and skip the update (already-bad data; don't crash the send path).

### 5.2 — Race with async webhook (unlikely but possible)
If, in some edge case, a 21610 rejection also triggers an async status callback
(e.g., Twilio later sends a failed callback with a SID for a re-queued message),
the `twilio-webhook` handler would run again. Both paths write to `sms_consent_logs`
with different `source` values. This is acceptable — the second upsert/insert is
idempotent in effect. No `UNIQUE` constraint exists on `sms_consent_logs` beyond
`phone + consent_type + created_at`.

### 5.3 — Must NOT apply to 30005/30006
These are carrier-level delivery failures (unreachable/invalid phone), not opt-outs.
They must remain `status='bounced'` as handled in `twilio-webhook`. The fix in
`send-sms` must be gated strictly to `error_code === 21610`.

### 5.4 — Already-unsubscribed contacts
If the contact was already `status='unsubscribed'` (e.g., corrected by backfill),
the pre-send consent guard blocks the send **before** reaching Twilio. Error 21610
should never appear for a contact that is already properly unsubscribed. No special
handling needed.

### 5.5 — `customer_contacts` `status` CHECK constraint
The `status` column has a CHECK constraint: `('active', 'unsubscribed', 'bounced')`.
Setting `'unsubscribed'` is valid.

---

## 6. Recommended Fix

**Location:** Inside the `if (!twilioResp.ok)` block in `send-sms/index.ts`, after
`console.error(...)` and **before** the `sms_messages` insert (so a DB error in the
contact update doesn't suppress the failure log).

**Pseudocode:**

```typescript
if (!twilioResp.ok) {
  console.error("[send-sms] Twilio error:", JSON.stringify(twilioData));

  // ── 21610: synchronous opt-out (blacklisted number) ─────────
  if (Number(twilioData.code) === 21610) {
    console.warn("[send-sms] 21610 detected — marking contact unsubscribed");

    // Prefer update-by-id; fall back to update-by-phone
    if (contact_id) {
      await sb.from("customer_contacts").update({
        status:       "unsubscribed",
        sms_consent:  false,
        opted_out_at: new Date().toISOString(),
      }).eq("id", contact_id);
    } else {
      await sb.from("customer_contacts").update({
        status:       "unsubscribed",
        sms_consent:  false,
        opted_out_at: new Date().toISOString(),
      }).eq("phone", to);
    }

    await sb.from("sms_consent_logs").insert({
      phone:        to,
      consent_type: "opt_out",
      source:       "send_sms_21610",
    });
  }
  // ────────────────────────────────────────────────────────────

  // Log the failed attempt (unchanged)
  await sb.from("sms_messages").insert({ ... });

  return json({ error: "SMS send failed", details: twilioData.message }, 502);
}
```

**Why `Number(twilioData.code) === 21610`:** Twilio returns `code` as an integer
in its JSON. Using `Number()` avoids a loose string/integer mismatch. No change to
the existing `String(twilioData.code || ...)` in the `error_code` field write.

**Minimal blast radius:** Only the `if (!twilioResp.ok)` failure branch is modified.
All success paths, blocking paths, and other error codes are completely untouched.

---

## 7. Verification Plan

> All steps assume a test environment or a known blacklisted number.
> Do NOT run against a real active subscriber.

### Step 1 — Set Up a Known 21610 Phone
Identify a phone that Twilio will reject with 21610 (e.g., a number that previously
opted out via Twilio STOP). Use `+17064019826` (already corrected in backfill) if
re-testing is safe, or use a dedicated test number.

### Step 2 — Prepare the Contact
Temporarily set the contact back to `status='active'`, `sms_consent=true`,
`opted_out_at=NULL` in the database so the pre-send guard passes and the message
reaches Twilio.

### Step 3 — Invoke `send-sms`
Call the deployed `send-sms` edge function with a valid payload for that contact.
Expected response: HTTP 502 `{ "error": "SMS send failed", "details": "..." }`.

### Step 4 — Verify `sms_messages`
```sql
SELECT status, error_code, error_message, provider_message_sid, sent_at
FROM   sms_messages
WHERE  phone = '+1XXXXXXXXXX'
ORDER  BY created_at DESC
LIMIT  1;
```
Expected: `status='failed'`, `error_code='21610'`, `provider_message_sid=NULL`, `sent_at=NULL`.

### Step 5 — Verify `customer_contacts`
```sql
SELECT status, sms_consent, opted_out_at
FROM   customer_contacts
WHERE  phone = '+1XXXXXXXXXX';
```
Expected: `status='unsubscribed'`, `sms_consent=false`, `opted_out_at` is populated.

### Step 6 — Verify `sms_consent_logs`
```sql
SELECT phone, consent_type, source, created_at
FROM   sms_consent_logs
WHERE  phone      = '+1XXXXXXXXXX'
  AND  source     = 'send_sms_21610'
ORDER  BY created_at DESC
LIMIT  1;
```
Expected: one new row.

### Step 7 — Verify Pre-Send Guard Now Blocks
Invoke `send-sms` again for the same contact. Expected response: HTTP 200
`{ "blocked": true, "reason": "no_consent", "message": "Contact is not opted in" }`.
The message must NOT reach Twilio.

### Step 8 — Verify Dashboard Views
```sql
SELECT * FROM sms_v_fatigue_monitor;
SELECT * FROM sms_v_subscriber_funnel;
```
Confirm `stopped` count includes the test number; `active` count is one less.

---

## 8. Definition of Done

- [ ] `send-sms/index.ts` modified: `if (Number(twilioData.code) === 21610)` block
      inserted inside `if (!twilioResp.ok)` before the `sms_messages` insert
- [ ] `customer_contacts` is updated on 21610: `status='unsubscribed'`, `sms_consent=false`, `opted_out_at` populated
- [ ] `sms_consent_logs` row inserted with `source='send_sms_21610'`
- [ ] All Step 4–8 verification queries pass
- [ ] Pre-send guard blocks the contact on the very next call (no second Twilio hit)
- [ ] 30005/30006 behavior is **unchanged** (still handled in `twilio-webhook` only)
- [ ] `send-sms` edge function deployed successfully via `--use-api`
- [ ] No regressions to any other SMS flow (welcome, coupon, review request, etc.)

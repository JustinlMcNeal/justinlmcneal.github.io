# SMS 21610 Backfill Audit

**Audit date:** 2026-05-12  
**Status:** Investigation complete — backfill NOT yet executed  
**Prerequisite:** `twilio-webhook` deployed with 21610 fix (2026-05-12 ✓)

---

## 1. Problem Summary

Prior to the 2026-05-12 webhook fix, Twilio error code 21610 ("attempted send to
unsubscribed recipient") was grouped with 30005 and 30006 in the delivery status handler.
All three codes set `customer_contacts.status = 'bounced'` and `sms_consent = false`.

This means any contact whose first (or only) opt-out signal was a 21610 delivery error
is currently sitting in the database as `status = 'bounced'` — counted in the dashboard
bounce metric, invisible to the unsubscribed and stopped metrics, and with no record
in `sms_consent_logs`.

The webhook fix handles all **future** 21610s correctly. This audit covers the
**historical** case: the known 2026-05-05 21610 failure event, and any other contacts
that may have been miscategorised before the fix was deployed.

The forward fix does **not** automatically correct existing rows.

---

## 2. What to Identify

### 2a. Candidate contacts

A historical 21610 contact is one that:

1. Has an `sms_messages` row with `error_code = '21610'`
2. The matching `customer_contacts` row has `status = 'bounced'`
3. `customer_contacts.opted_out_at` is `NULL`
4. No `sms_consent_logs` row exists for that phone with `consent_type = 'opt_out'`
   and `source IN ('twilio_21610', 'twilio_stop', 'twilio_21610_backfill')`

Condition 3 rules out contacts that have a legitimate opted_out_at from a separate
STOP-keyword event after the bounce was set.

Condition 4 rules out contacts that already have an audit trail (e.g. they later sent
STOP and the inbound handler fired correctly).

### 2b. The known 2026-05-05 event

A specific 21610 failure was observed on or around 2026-05-05. To confirm it maps to a
specific row, the preview query in Section 4 filters by `sent_at` around that date.
If the row is present and `status = 'bounced'` with `opted_out_at IS NULL`, it is a
confirmed backfill candidate.

---

## 3. Safe Backfill Criteria

A contact row is safe to backfill **only if all of the following are true:**

| # | Condition | Why |
|---|---|---|
| 1 | `sms_messages.error_code = '21610'` | Confirms Twilio reported an unsubscribe-triggered failure, not a generic delivery failure |
| 2 | `customer_contacts.status = 'bounced'` | Row was set by the old broken path; not already corrected |
| 3 | `customer_contacts.opted_out_at IS NULL` | No separate opt-out timestamp already recorded (would indicate STOP was also processed) |
| 4 | No `sms_consent_logs` row with `consent_type = 'opt_out'` and `source IN ('twilio_21610', 'twilio_stop', 'twilio_21610_backfill')` for that phone | No existing opt-out audit trail for this contact |
| 5 | `customer_contacts.sms_consent = false` | Should already be false from the original bounce update; if it is somehow `true`, investigate before touching |

If condition 5 fails (sms_consent is still true), do not include that row in the
automated backfill — investigate manually first.

---

## 4. Preview SQL

Run this to see all candidate contacts before touching anything:

```sql
-- Preview: contacts that may need 21610 backfill
SELECT
  cc.id           AS contact_id,
  cc.phone,
  cc.status,
  cc.sms_consent,
  cc.opted_out_at,
  sm.error_code,
  sm.error_message,
  sm.sent_at,
  sm.provider_message_sid
FROM public.customer_contacts cc
JOIN public.sms_messages sm
  ON sm.phone = cc.phone
 AND sm.error_code = '21610'
WHERE cc.status = 'bounced'
  AND cc.opted_out_at IS NULL
  AND cc.sms_consent = false
  AND NOT EXISTS (
    SELECT 1
    FROM public.sms_consent_logs scl
    WHERE scl.phone = cc.phone
      AND scl.consent_type = 'opt_out'
      AND scl.source IN ('twilio_21610', 'twilio_stop', 'twilio_21610_backfill')
  )
ORDER BY sm.sent_at;
```

To narrow to the known 2026-05-05 event only, add:

```sql
  AND sm.sent_at >= '2026-05-05T00:00:00Z'
  AND sm.sent_at <  '2026-05-06T00:00:00Z'
```

**Before running the backfill, confirm the preview returns only the expected rows.**
If more rows appear than expected, investigate each one individually.

---

## 5. Safe Backfill SQL

Run only after the preview in Section 4 confirms the correct rows.

Use the `sent_at` timestamp from `sms_messages` as `opted_out_at`. This is the closest
available approximation to when Twilio processed the opt-out. It may be slightly later
than the actual opt-out moment, but it is accurate enough for business purposes and avoids
using `now()` (which would falsely timestamp the opt-out to today).

### Step A — Update `customer_contacts`

```sql
UPDATE public.customer_contacts cc
SET
  status       = 'unsubscribed',
  sms_consent  = false,
  opted_out_at = sm.sent_at
FROM (
  SELECT DISTINCT ON (sm2.phone) sm2.phone, sm2.sent_at
  FROM public.sms_messages sm2
  WHERE sm2.error_code = '21610'
  ORDER BY sm2.phone, sm2.sent_at ASC  -- use earliest 21610 event per phone
) sm
WHERE cc.phone = sm.phone
  AND cc.status = 'bounced'
  AND cc.opted_out_at IS NULL
  AND cc.sms_consent = false
  AND NOT EXISTS (
    SELECT 1
    FROM public.sms_consent_logs scl
    WHERE scl.phone = cc.phone
      AND scl.consent_type = 'opt_out'
      AND scl.source IN ('twilio_21610', 'twilio_stop', 'twilio_21610_backfill')
  );
```

### Step B — Insert `sms_consent_logs` rows

```sql
INSERT INTO public.sms_consent_logs (phone, consent_type, consent_text, source, created_at)
SELECT DISTINCT ON (sm.phone)
  sm.phone,
  'opt_out',
  'Backfill: Twilio error 21610 recorded on ' || sm.sent_at::date::text || ' — contact previously miscategorised as bounced',
  'twilio_21610_backfill',
  sm.sent_at
FROM public.sms_messages sm
JOIN public.customer_contacts cc
  ON cc.phone = sm.phone
WHERE sm.error_code = '21610'
  AND cc.status = 'unsubscribed'          -- written by Step A
  AND cc.opted_out_at IS NOT NULL          -- written by Step A
  AND NOT EXISTS (
    SELECT 1
    FROM public.sms_consent_logs scl
    WHERE scl.phone = sm.phone
      AND scl.consent_type = 'opt_out'
      AND scl.source = 'twilio_21610_backfill'
  )
ORDER BY sm.phone, sm.sent_at ASC;
```

**Important:** Run Step A first. Step B checks that the contact row was already updated
(by reading back `status = 'unsubscribed'`) to avoid inserting audit rows for contacts
that were skipped by Step A's safety conditions.

---

## 6. Validation Queries

Run after both steps to confirm the backfill applied correctly.

### 6a. Confirm no candidate rows remain

```sql
-- Should return 0 rows after a successful backfill
SELECT cc.phone, cc.status, cc.opted_out_at
FROM public.customer_contacts cc
JOIN public.sms_messages sm
  ON sm.phone = cc.phone
 AND sm.error_code = '21610'
WHERE cc.status = 'bounced'
  AND cc.opted_out_at IS NULL;
```

### 6b. Confirm updated rows now have correct values

```sql
SELECT
  cc.phone,
  cc.status,
  cc.sms_consent,
  cc.opted_out_at,
  scl.source,
  scl.created_at AS consent_log_at
FROM public.customer_contacts cc
JOIN public.sms_consent_logs scl
  ON scl.phone = cc.phone
 AND scl.source = 'twilio_21610_backfill'
ORDER BY scl.created_at;
```

Expected: each row shows `status = 'unsubscribed'`, `sms_consent = false`,
`opted_out_at` is not null, `source = 'twilio_21610_backfill'`.

### 6c. Confirm dashboard views update

```sql
-- sms_v_subscriber_funnel — unsubscribed count should increase
SELECT unsubscribed, total_contacts
FROM public.sms_v_subscriber_funnel;

-- sms_v_fatigue_monitor — stopped should increase, bounced should decrease
SELECT stopped, bounced, stop_rate_pct
FROM public.sms_v_fatigue_monitor;
```

---

## 7. Risks

### Risk 1 — Misclassifying a true delivery failure as an unsubscribe

21610 is specific to opt-out — Twilio only returns it when the destination number is on an
opt-out registry. It is not a generic delivery failure code. However, there is a small
theoretical risk of a Twilio system error returning 21610 incorrectly.

**Mitigation:** The backfill is narrowed to rows where `opted_out_at IS NULL` and no
existing opt-out audit trail exists. A contact with any legitimate opt-out trail is
excluded. The `sms_consent = false` guard also ensures the contact's consent was already
revoked at the time of the bounce.

### Risk 2 — Multiple 21610 events for the same phone

If the same phone appears in `sms_messages` with 21610 on multiple dates (e.g., repeated
send attempts to the same opted-out number), the `DISTINCT ON … ORDER BY sent_at ASC`
clause in Step A and B uses the **earliest** 21610 event as the `opted_out_at` timestamp,
which is the most accurate approximation of when the opt-out occurred.

### Risk 3 — opted_out_at set to sent_at (slightly late)

`sent_at` is when our system sent the message, not when the underlying opt-out occurred.
The actual opt-out may predate `sent_at` by hours or days (e.g. if the subscriber texted
STOP directly to Twilio's short code and Twilio processed it silently). This means
`opted_out_at` will be slightly later than reality.

**Mitigation:** This is acceptable for business purposes. The alternative — using `now()`
— would be even less accurate. The `consent_text` in `sms_consent_logs` documents that
this is a backfill and includes the reference date.

### Risk 4 — Views not refreshed immediately

`sms_v_fatigue_monitor` and `sms_v_subscriber_funnel` are standard views (not
materialized), so they will reflect the update immediately after the transaction commits.
No refresh step is needed.

---

## 8. Definition of Done

- [ ] Preview query (Section 4) returns only the expected rows — no surprises.
- [ ] Step A updates all candidate `customer_contacts` rows to `status = 'unsubscribed'`,
      `opted_out_at` set to the earliest `sent_at` of a 21610 message for that phone.
- [ ] Step B inserts a `sms_consent_logs` row per phone with `source = 'twilio_21610_backfill'`.
- [ ] Validation query 6a returns 0 rows (no remaining unaddressed 21610 contacts).
- [ ] Validation query 6b shows all backfilled contacts with correct field values.
- [ ] `sms_v_subscriber_funnel.unsubscribed` increases by the backfill count.
- [ ] `sms_v_fatigue_monitor.stopped` increases by the backfill count.
- [ ] `sms_v_fatigue_monitor.bounced` decreases by the backfill count.
- [ ] Dashboard "Unsubscribed" count visibly reflects the change.
- [ ] No `sms_consent_logs` duplicate rows (source = 'twilio_21610_backfill' appears
      exactly once per phone).

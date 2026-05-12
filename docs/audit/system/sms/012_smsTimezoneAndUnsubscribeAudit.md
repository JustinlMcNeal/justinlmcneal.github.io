# SMS Timezone and Unsubscribe Audit

**Audit date:** 2026-05-12  
**Status:** Investigation complete — fixes NOT yet implemented  
**Issues covered:**
1. Report date / "yesterday" boundaries use UTC instead of America/New_York
2. Twilio 21610 error marks contact as `bounced` instead of `unsubscribed`, leaving dashboard unsubscribed count at 0

---

## 1. Problem Summary

### Issue A — Report timezone mismatch

The daily SMS report (`docs/reports/sms/daily/YYYY-MM-DD.md`) is labeled with a UTC date, not an Eastern Time (ET) date. When the script runs after midnight UTC but before midnight ET (a 4–5 hour window), the report filename and header will say "tomorrow" from ET's perspective — e.g., the file is named `2026-05-13.md` while the actual ET business date is still May 12.

More importantly, the "yesterday" date boundaries used to filter `sms_v_flow_performance_dated` are also computed in UTC and then passed through `toETDate()`. Because UTC midnight is 4–5 hours behind ET midnight, the resulting ET date is always the day before the intended "yesterday in ET". For a script run at 12:00 PM ET on May 12, the `sentDateYesterday` filter evaluates to `2026-05-10` instead of `2026-05-11` — a full day off.

### Issue B — Twilio 21610 not reflected in unsubscribed count

The Twilio error code 21610 means "Attempted to send to unsubscribed recipient." This fires when a contact is on Twilio's opt-out list but our database does not know it. When the delivery status webhook receives a 21610, it currently marks the contact as `status = 'bounced'` — the same bucket as unreachable numbers and landlines. It does NOT set `status = 'unsubscribed'`.

The admin dashboard and the report both count `unsubscribed` contacts by checking `status = 'unsubscribed'` in `customer_contacts`. A contact marked `bounced` via 21610 increments the bounce count, not the unsubscribed count. The dashboard shows `Unsubscribed: 0` while there is at least one genuinely opted-out subscriber.

---

## 2. Files / Systems Involved

| File / System | Role |
|---|---|
| `scripts/openclaw/run-sms-report.mjs` | Entry point; calls `getReportDate()` (UTC), `buildDateWindows()`, writes report file |
| `scripts/openclaw/fetch-sms-data.mjs` | `buildDateWindows()` (UTC arithmetic); `toETDate()` converter; `fetchSmsData()` filters flow view |
| `prompts/openclaw/sms-analyst-v1.md` | Prompt file; not responsible for the bug, but its Section 2 references ET quiet hours — an implicit expectation of ET alignment |
| `supabase/functions/twilio-webhook/index.ts` | Handles inbound STOP (sets `unsubscribed`) and delivery status callbacks (maps 21610 → `bounced`) |
| `supabase/migrations/20260413_sms_tables.sql` | Defines `customer_contacts.status CHECK ('active', 'unsubscribed', 'bounced')` |
| `supabase/migrations/20260414_sms_analytics_views.sql` | `sms_v_subscriber_funnel` counts `status = 'unsubscribed'`; `sms_v_fatigue_monitor` counts `stopped` and `bounced` |
| `js/admin/smsAnalytics/index.js` | Dashboard renders "Unsubscribed" from `sms_v_subscriber_funnel.unsubscribed`; "Stopped" from `sms_v_fatigue_monitor.stopped`; "Bounced" from `sms_v_fatigue_monitor.bounced` |

---

## 3. Timezone Audit

### Where `report_date` is calculated

**File:** `scripts/openclaw/run-sms-report.mjs`, function `getReportDate()` (line ~168)

```js
function getReportDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}
```

This returns the current UTC date. Between midnight UTC and midnight ET (00:00–04:00 UTC in summer / 00:00–05:00 UTC in winter), this returns tomorrow's ET date.

**Effect:** The report file is named and labeled with the wrong date for the 4–5 hour UTC-to-ET window. If the script is run at 01:00 UTC on May 13 (which is 21:00 ET May 12), the report is saved as `2026-05-13.md` and its header says `Report date: 2026-05-13`, but the business day in ET is still May 12.

---

### Where "yesterday" boundaries are calculated

**File:** `scripts/openclaw/fetch-sms-data.mjs`, function `buildDateWindows()` (lines ~53–74)

```js
export function buildDateWindows() {
  const now = new Date();

  const yesterdayStart = new Date(now);
  yesterdayStart.setUTCDate(now.getUTCDate() - 1);  // ← UTC arithmetic
  yesterdayStart.setUTCHours(0, 0, 0, 0);           // ← UTC midnight

  const yesterdayEnd = new Date(yesterdayStart);
  yesterdayEnd.setUTCHours(23, 59, 59, 999);        // ← UTC end-of-day

  const last7Start = new Date(now);
  last7Start.setUTCDate(now.getUTCDate() - 7);       // ← UTC arithmetic
  last7Start.setUTCHours(0, 0, 0, 0);
  ...
}
```

All arithmetic uses `setUTCDate`/`setUTCHours` — fully UTC. The resulting ISO strings represent UTC midnight ranges, not ET midnight ranges.

---

### The `toETDate` conversion bug

**File:** `scripts/openclaw/fetch-sms-data.mjs`, inside `fetchSmsData()` (lines ~170–183)

```js
const toETDate = (iso) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date(iso)); // returns YYYY-MM-DD
};

const sentDateYesterday = toETDate(yesterday.start);       // yesterday.start is UTC midnight
const sentDateLast7Start = toETDate(last7days.start);      // also UTC midnight
const sentDateToday = toETDate(last7days.end);             // = now (current wall clock time, roughly correct)
```

**The bug:** `yesterday.start` is UTC midnight of "the UTC day before today UTC". Converting a UTC midnight boundary to ET shifts it back 4–5 hours — into the late evening of the *previous ET calendar day*. The resulting `YYYY-MM-DD` string in ET is therefore one day earlier than intended.

**Concrete example — script run at 12:00 PM ET (16:00 UTC) on May 12, 2026:**

| Calculation | Value |
|---|---|
| `now` (UTC) | `2026-05-12T16:00:00.000Z` |
| `now.getUTCDate()` | 12 (May 12 in UTC) |
| `yesterdayStart` after `setUTCDate(11)` + `setUTCHours(0,0,0,0)` | `2026-05-11T00:00:00.000Z` |
| `toETDate("2026-05-11T00:00:00.000Z")` | `2026-05-10` (May 11 00:00 UTC = May 10 20:00 ET → ET date is May 10) |
| **Intended value** | `2026-05-11` (yesterday in ET) |
| **Off by** | 1 day |

Same error applies to `sentDateLast7Start`: UTC midnight 7 days ago → converts to ET date = 8 days ago in ET.

**`sentDateToday` is accidentally correct** because `last7days.end = now` is the current wall clock time (not a midnight boundary), so `toETDate(now)` gives the correct current ET date.

---

### Recommended fix for the timezone issue

Both bugs have the same root cause: "yesterday in ET" must be derived by starting from today's ET calendar date (not today's UTC date) and subtracting a day.

**Smallest safe fix:**

1. **`getReportDate()` in `run-sms-report.mjs`** — replace UTC `.toISOString().slice(0, 10)` with an ET-aware formatter:
   ```js
   function getReportDate() {
     return new Intl.DateTimeFormat('en-CA', {
       timeZone: 'America/New_York',
       year: 'numeric', month: '2-digit', day: '2-digit',
     }).format(new Date());
   }
   ```

2. **`buildDateWindows()` in `fetch-sms-data.mjs`** — compute the ET calendar date first, then compute "yesterday" and "7 days ago" by subtracting from that anchor, not from a UTC midnight boundary.

   The `toETDate` converter that already exists in `fetchSmsData()` should be lifted up into `buildDateWindows()` (or exposed as a shared export), and the date subtraction should be done by offsetting the current wall-clock time by N × 24 hours — not by UTC date math — before formatting in ET:
   ```js
   // Correct approach: subtract real elapsed time, then format in ET
   const MS_PER_DAY = 24 * 60 * 60 * 1000;
   const todayET    = toETDate(now);                        // "2026-05-12"
   const yesterdayET = toETDate(new Date(now - MS_PER_DAY)); // "2026-05-11" ✓
   const last7ET    = toETDate(new Date(now - 7 * MS_PER_DAY)); // "2026-05-05" ✓
   ```

   The UTC ISO boundaries (`yesterday.start`, `yesterday.end`, `last7days.start/end`) used in the payload metadata can continue to be UTC — only the `sentDate*` strings passed to the flow view filter need to be correct ET dates.

3. **No changes needed** to `prompts/openclaw/sms-analyst-v1.md` — the prompt is not responsible for date calculation.

---

## 4. Unsubscribe Audit

### How STOP / opt-out is supposed to flow

1. Subscriber texts STOP to the Twilio number.
2. Twilio fires an inbound message webhook to `supabase/functions/twilio-webhook`.
3. The webhook reads `params.Body.trim().toUpperCase()` and checks against `STOP_WORDS = { STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT }`.
4. If matched: queries `customer_contacts` by phone, sets `status = "unsubscribed"`, `sms_consent = false`, `opted_out_at = now()`, and inserts a row in `sms_consent_logs`.
5. Returns `<Response></Response>` (empty TwiML) — Twilio handles the auto-reply via its Advanced Opt-Out feature.

### The 21610 path (the broken path)

When **Twilio itself** already knows a number is opted out (e.g., subscriber texted STOP directly, Twilio's Advanced Opt-Out intercepted it before forwarding the webhook, or the number is on Twilio's global opt-out registry), an attempt to send to that number returns error code 21610.

The delivery status webhook path handles this in `twilio-webhook/index.ts` (lines ~140–166):

```ts
// 30005 = unknown destination, 30006 = landline, 21610 = unsubscribed
if (["30005", "30006", "21610"].includes(errorCode)) {
  const { data: msgRow } = await sb
    .from("sms_messages")
    .select("phone")
    .eq("provider_message_sid", messageSid)
    .maybeSingle();

  if (msgRow?.phone) {
    await sb
      .from("customer_contacts")
      .update({ status: "bounced", sms_consent: false })
      .eq("phone", msgRow.phone);
  }
}
```

**The bug:** 21610 is grouped with technical delivery failures (30005, 30006) and results in `status = 'bounced'`. The correct semantic for 21610 is `status = 'unsubscribed'` because the person actively opted out — Twilio simply processed it before our system knew about it.

### What the dashboard reads

| Dashboard stat | Source view | SQL condition |
|---|---|---|
| "Unsubscribed" (Subscriber Funnel section) | `sms_v_subscriber_funnel.unsubscribed` | `status = 'unsubscribed'` |
| "Stopped" (Fatigue section) | `sms_v_fatigue_monitor.stopped` | `status = 'unsubscribed'` |
| "Bounced" (Fatigue section) | `sms_v_fatigue_monitor.bounced` | `status = 'bounced'` |

A contact marked `bounced` via a 21610:
- **Does not** increment `unsubscribed` or `stopped` → those stay at 0
- **Does** increment `bounced` → looks like a delivery failure, not an opt-out
- Does not get an `opted_out_at` timestamp → `avg_days_to_stop` calculation is also corrupted
- Does not get a row in `sms_consent_logs` → no audit trail for the opt-out

### Twilio Advanced Opt-Out interaction

The webhook only catches STOP messages if Twilio forwards the inbound message. With **Advanced Opt-Out** enabled (which is the default for Twilio US A2P numbers), Twilio intercepts STOP automatically, sends its own reply, and may or may not forward the inbound message to the webhook depending on configuration. This means:

- **Path A (webhook fires):** STOP → inbound webhook → `status = 'unsubscribed'` ✓
- **Path B (webhook does not fire):** STOP → Twilio intercepts silently → no webhook → DB not updated → next send attempt → 21610 → webhook fires delivery status update → `status = 'bounced'` ✗

The current code does not handle Path B correctly.

---

## 5. Likely Root Causes

### Timezone

The `buildDateWindows()` function was written with UTC arithmetic and an after-the-fact ET conversion that does not account for the midnight offset. The `toETDate` call converts a UTC midnight boundary, not a current-time anchor. The off-by-one is present on every call regardless of time-of-day but is most visible when comparing a report labeled "2026-05-12" against flow data that filtered sends from "2026-05-10".

The `getReportDate()` function was written as a one-liner and uses `.toISOString()` which is always UTC. This was a simple oversight given the business operates in ET.

### 21610 / unsubscribed count

The 21610 error code was grouped with 30005 and 30006 in a single `if` block, all resulting in `status = 'bounced'`. The comment on line 148 of `twilio-webhook/index.ts` even identifies 21610 as "unsubscribed", but the code does not differentiate it from the other codes:

```ts
// 30005 = unknown destination, 30006 = landline, 21610 = unsubscribed
if (["30005", "30006", "21610"].includes(errorCode)) {
  ...
  update({ status: "bounced", ... })  // ← wrong for 21610
```

There is also no write to `sms_consent_logs` on the 21610 path, so there is no audit trail for silently-processed opt-outs.

---

## 6. Recommended Fix Path

### Fix A — Timezone (report date + yesterday filter)

**Scope:** `scripts/openclaw/` only. No Supabase changes. No deploys.

1. **`run-sms-report.mjs` → `getReportDate()`:** Replace `new Date().toISOString().slice(0, 10)` with `Intl.DateTimeFormat` using `timeZone: 'America/New_York'`.

2. **`fetch-sms-data.mjs` → `buildDateWindows()`:** Replace UTC `setUTCDate` / `setUTCHours` arithmetic with wall-clock subtraction followed by ET date formatting:
   - `yesterdayET = toETDate(new Date(now - 1 × MS_PER_DAY))`
   - `last7ET = toETDate(new Date(now - 7 × MS_PER_DAY))`
   - Keep the UTC ISO timestamps for `yesterday.start/end` and `last7days.start/end` (these are used in the report payload metadata and the `sms_v_click_to_purchase` filter — they can stay UTC).
   - The `toETDate` helper should be defined once at module level (it is currently defined inside `fetchSmsData`); moving it up is part of this fix.

3. Expose `toETDate` from `buildDateWindows` or make it a shared module-level function so it can be used both in `buildDateWindows` and `fetchSmsData`.

No database migrations, no edge function deploys, and no changes to the prompt are needed.

---

### Fix B — 21610 → `unsubscribed` (not `bounced`)

**Scope:** `supabase/functions/twilio-webhook/index.ts`. Requires an edge function deploy.

1. In the delivery status handler, **separate 21610 from 30005/30006**:

   ```ts
   // 21610 = recipient has unsubscribed from Twilio's registry
   if (errorCode === "21610") {
     if (msgRow?.phone) {
       await sb
         .from("customer_contacts")
         .update({
           status:       "unsubscribed",
           sms_consent:  false,
           opted_out_at: new Date().toISOString(),
         })
         .eq("phone", msgRow.phone);

       await sb.from("sms_consent_logs").insert({
         phone:        msgRow.phone,
         consent_type: "opt_out",
         consent_text: "Twilio error 21610: attempted send to unsubscribed recipient",
         source:       "twilio_21610",
       });
     }
   }
   // 30005 = unknown destination, 30006 = landline
   else if (["30005", "30006"].includes(errorCode)) {
     if (msgRow?.phone) {
       await sb
         .from("customer_contacts")
         .update({ status: "bounced", sms_consent: false })
         .eq("phone", msgRow.phone);
     }
   }
   ```

2. The `sms_messages` table update (setting `status = 'failed'`, `error_code`, `error_message`) should remain in place for all three codes — only the `customer_contacts` update changes.

3. **No migration needed** — `customer_contacts.status` CHECK constraint already allows `'unsubscribed'`. `sms_consent_logs.source` is a TEXT column with no constraint.

4. After deploying, any existing contacts currently stuck in `status = 'bounced'` due to a historical 21610 should be investigated manually. There is currently no automated backfill — that is a separate one-time cleanup task.

---

## 7. Verification Plan

### Timezone fix verification

1. Run `node --env-file=.env scripts/openclaw/run-sms-report.mjs` at two conditions:
   - During normal ET business hours (e.g., 10 AM ET)
   - Between 20:00–23:59 ET (equivalent to 00:00–03:59 UTC next day)
2. Confirm the report filename matches today's ET date in both cases (not UTC date).
3. Confirm the `yesterday_window` in the JSON payload references the correct ET date range.
4. From the Supabase dashboard or CLI, query `sms_v_flow_performance_dated` for `sent_date = CURRENT_DATE - 1` in ET and confirm the report's "yesterday" section reflects the same row count.

### Unsubscribe fix verification

1. In Supabase, manually update a test contact to `status = 'active'`, `sms_consent = true`.
2. Using a Twilio test credential or a real send to a test number that is opted out in Twilio's registry, trigger a send that returns 21610.
3. Verify the delivery status webhook fires and:
   - `customer_contacts.status` is now `'unsubscribed'` (not `'bounced'`)
   - `customer_contacts.opted_out_at` is set
   - A row exists in `sms_consent_logs` with `source = 'twilio_21610'`
4. Load the admin SMS analytics dashboard. Confirm "Unsubscribed" / "Stopped" counts increment. "Bounced" should not increment for this contact.
5. Confirm the daily report generated after this event reflects the correct unsubscribed count.

---

## 8. Definition of Done

### Timezone issue

- [ ] `getReportDate()` returns the current ET date (not UTC) at all times.
- [ ] `buildDateWindows()` produces `sentDateYesterday` and `sentDateLast7Start` that match the correct ET calendar day.
- [ ] A report generated at 01:00 UTC is named with the correct ET date.
- [ ] No changes to database schema, views, or edge functions.

### Unsubscribe issue

- [ ] A contact that triggers a 21610 is set to `status = 'unsubscribed'`, `opted_out_at = <timestamp>`, and has an `sms_consent_logs` entry with `source = 'twilio_21610'`.
- [ ] Dashboard "Unsubscribed" / "Stopped" counts reflect 21610-triggered opt-outs.
- [ ] "Bounced" count does not increment for 21610 contacts.
- [ ] `twilio-webhook` edge function is deployed.
- [ ] Manual review of any existing contacts stuck as `bounced` due to historical 21610 errors is documented (even if cleanup is deferred).

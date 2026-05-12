# SMS Event Type Fix Plan
**Gap reference:** GAP-03 in `docs/audit/system/sms/001_smsKnownGaps.md`  
**Status:** planning only — not yet implemented  
**Date:** 2026-05-09  

---

## 1. Problem Summary

When a contact clicks a tracked SMS link, `sms-redirect` inserts a row into `sms_events` with `event_type = 'sms_clicked'`. The admin analytics dashboard (`js/admin/smsAnalytics/index.js`) then fetches those rows and counts clicks by filtering on `event_type === 'click'`. Because `'sms_clicked' !== 'click'`, the filter never matches, and the dashboard always shows 0 clicks.

This is a pure string-value mismatch between the write path and the read path. It affects one file, two lines of JavaScript. All SQL analytics views already use `'sms_clicked'` and are correct.

---

## 2. Files / Queries Involved

| Layer | File | Role |
|---|---|---|
| Write — edge function | `supabase/functions/sms-redirect/index.ts` line 67 | Inserts `event_type: "sms_clicked"` into `sms_events` |
| Read — admin dashboard | `js/admin/smsAnalytics/index.js` lines 58–59 | Filters `r.event_type === "click"` — the broken side |
| SQL analytics views | `supabase/migrations/20260414_sms_analytics_views.sql` lines 47, 185, 242, 290, 293 | All use `event_type = 'sms_clicked'` — already correct |
| New companion view | `supabase/migrations/20260509_sms_flow_performance_dated.sql` line 46 | Uses `event_type = 'sms_clicked'` — already correct |
| Stripe webhook | `supabase/functions/stripe-webhook/index.ts` line 582 | Reads `eq("event_type", "sms_clicked")` — already correct |
| `sms_events` CHECK constraint | `supabase/migrations/20260414_sms_phase2.sql` line 61 | `CHECK (event_type IN ('sms_clicked', 'coupon_redeemed', 'order_attributed', 'link_visited'))` — `'click'` is not a valid value; the constraint enforces this already |

**Only `js/admin/smsAnalytics/index.js` uses the wrong value.**

---

## 3. Current Write Path

`supabase/functions/sms-redirect/index.ts`, lines 66–75:

```ts
sb.from("sms_events").insert({
  event_type:     "sms_clicked",   // ← value written
  phone:          msg.phone,
  sms_message_id: msg.id,
  sms_send_id:    send?.id || null,
  metadata: { ... },
}).then(...)
```

The value `"sms_clicked"` is correct and matches both the database CHECK constraint and every SQL view. **This side does not need to change.**

---

## 4. Current Read Path

`js/admin/smsAnalytics/index.js`, lines 54–59:

```js
// Fetch
sb.from("sms_events").select("event_type").gte("created_at", todayUTC),
sb.from("sms_events").select("event_type").gte("created_at", ydayUTC).lt("created_at", todayUTC),

// Filter (BROKEN)
const cT = (eToday.data || []).filter(r => r.event_type === "click").length;
const cY = (eYday.data || []).filter(r => r.event_type === "click").length;
```

The filter `=== "click"` will never match any row because no row in `sms_events` can have `event_type = 'click'` — the CHECK constraint prevents it.

---

## 5. Fix Options

### Option A — Fix the dashboard JS (read side) ✅ Recommended

Change `"click"` → `"sms_clicked"` on lines 58–59 of `js/admin/smsAnalytics/index.js`.

**Pros:** One file, two characters changed, zero database impact, no migration needed, immediately correct.  
**Cons:** None — the write side is correct and the CHECK constraint already enforces that `'click'` is invalid.

---

### Option B — Change the write side (`sms-redirect`)

Change `"sms_clicked"` → `"click"` in `sms-redirect/index.ts` and update the CHECK constraint and all 5 SQL view references.

**Pros:** None meaningful.  
**Cons:** Requires a database migration to update the CHECK constraint, re-applying 5 SQL views, and deploying a new edge function version. Much higher blast radius for the same outcome. Also breaks `stripe-webhook` which reads `sms_clicked`. **Do not do this.**

---

### Option C — Support both values temporarily

Add `|| r.event_type === 'sms_clicked'` to the dashboard filter while leaving the write side unchanged. Then clean up later.

**Pros:** Theoretically safe during a transition period.  
**Cons:** There is no transition needed — no rows with `event_type = 'click'` exist (the CHECK constraint blocks them). Temporary dual-value support adds complexity for no benefit.

---

## 6. Recommended Fix

**Option A only.** Change two string literals in `js/admin/smsAnalytics/index.js`:

```js
// Before
const cT = (eToday.data || []).filter(r => r.event_type === "click").length;
const cY = (eYday.data || []).filter(r => r.event_type === "click").length;

// After
const cT = (eToday.data || []).filter(r => r.event_type === "sms_clicked").length;
const cY = (eYday.data || []).filter(r => r.event_type === "sms_clicked").length;
```

No migration. No edge function deployment. No schema change. The write side, CHECK constraint, all SQL views, and `stripe-webhook` are all already correct.

---

## 7. Test Plan

1. **Before the fix:** Open the admin SMS analytics page. Confirm the click delta shows 0 (or a static/wrong number). Open the browser console and look for no errors — the issue is silent (returns 0, not an error).

2. **Apply the fix** to `js/admin/smsAnalytics/index.js` lines 58–59.

3. **Verify directly via Supabase:**
   ```sql
   SELECT event_type, COUNT(*) FROM sms_events GROUP BY event_type;
   ```
   Confirm `sms_clicked` rows exist and no `click` rows exist.

4. **Reload admin analytics page.** The click delta should now reflect the actual count from `sms_events` rows with `event_type = 'sms_clicked'`. If there are recent test clicks in the data, they should now appear.

5. **Run the V1 report** (`node --env-file=.env scripts/openclaw/run-sms-report.mjs`). The report script queries the SQL views (which already use `sms_clicked`) so it will not change — confirm no regression.

---

## 8. Definition of Done

- [ ] `js/admin/smsAnalytics/index.js` lines 58–59 use `"sms_clicked"` not `"click"`.
- [ ] Admin analytics page shows a non-zero click count on any day where `sms_events` rows with `event_type = 'sms_clicked'` exist.
- [ ] `SELECT event_type, COUNT(*) FROM sms_events GROUP BY event_type` confirms no `'click'` rows exist.
- [ ] No JS console errors introduced.
- [ ] V1 report runs without new warnings.
- [ ] GAP-03 in `001_smsKnownGaps.md` updated to `resolved`.
- [ ] Entry added to `002_smsChangeLog.md`.

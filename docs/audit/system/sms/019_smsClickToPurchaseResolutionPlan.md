# SMS Click-to-Purchase Resolution Plan

**Date:** 2026-05-09  
**Status:** implemented, deployed, and verified — 2026-05-09. All 4 fixes (A–D) applied and confirmed. Fix A: aggregator field name corrected (`hours_lag` → `hours_click_to_purchase`) in `fetch-sms-data.mjs`. Fix B: `sms_v_click_to_purchase` view updated via migration `20260509_sms_click_to_purchase_vip_label.sql` — VIP- orders now correctly labeled `direct_coupon`. Fix C: two stale unconditional warnings removed from `fetch-sms-data.mjs`, replaced with a contextual null-timing note. Fix D: stale data quality bullets removed from `prompts/openclaw/sms-analyst-v1.md`. End-to-end report confirmed: Section 5 shows the aggregated summary object; one contextual null-timing note (expected); no stale warnings. See `002_smsChangeLog.md` 2026-05-09 GAP-01 entry and `001_smsKnownGaps.md` GAP-01 for full details.  
**Gap:** GAP-01 from `001_smsKnownGaps.md` (resolved)  
**Scope:** `sms_v_click_to_purchase` reliability and report accuracy. No SMS flows are changed.

---

## 1. Current Status Summary

### What was known at gap creation (GAP-01 original diagnosis)

`sms_v_click_to_purchase` was returning zero rows. The root cause was suspected to be either no `orders_raw.sms_attributed = true` rows, or a phone format mismatch between `sms_events.phone` and what `stripe-webhook` looked for.

### What has changed since then

**GAP-02 — resolved 2026-05-08:** `sms-redirect` no longer writes `last_sms_sent_at` on click. Click events now write `customer_contacts.last_clicked_at` (new dedicated field) and leave the frequency-cap field untouched.

**GAP-03 — resolved 2026-05-09:** Admin analytics dashboard was fixed to filter on `event_type = 'sms_clicked'` instead of `'click'`.

**GAP-04 — resolved 2026-05-09:** VIP- coupon attribution repaired in `stripe-webhook`. All 5 SMS-attributed orders are now correctly flagged `sms_attributed = true` in `orders_raw`.

### Current state as of 2026-05-09 (from live diagnostic queries)

- **`sms_v_click_to_purchase` returns 5 rows** — not 0. The view is no longer empty.
- **All 5 rows have `sms_click_at = NULL`** → `hours_click_to_purchase = NULL` for all rows.
- **All 5 orders were attributed via coupon method** (Method 1 in `stripe-webhook`) — none via click-window (Method 2). Method 1 does not write `sms_click_at`.
- **There are 16 `sms_clicked` events** in `sms_events` — real clicks do exist.
- **104 out of 149 orders have no phone number** — those can never trigger Method 2.
- **The fetch-sms-data.mjs aggregator contains a field name bug** — it checks for `hours_lag` but the view column is `hours_click_to_purchase`. The aggregation branch never executes; raw per-order rows are passed to the analyst instead of the expected summary object.
- **The `attribution_method` label in the view is wrong for VIP- orders** — the CASE only checks `'SMS-%'`, so `VIP-WHEGPF` appears as `'click_attribution'` when it was actually attributed via coupon.
- **Two hardcoded warnings in `fetch-sms-data.mjs` are stale**: the "last_sms_sent_at on click" warning (GAP-02 resolved) and the "admin SMS dashboard event_type='click'" warning (GAP-03 resolved) both still fire on every report run.
- **The analyst prompt contains one stale data quality note** referencing `last_sms_sent_at` on click (no longer true).

---

## 2. Files / Tables / Views Involved

### Views

| File | View | Line |
|---|---|---|
| `supabase/migrations/20260414_sms_analytics_views.sql` | `sms_v_click_to_purchase` | 146 |

### Tables

| Table | Relevant fields | Role |
|---|---|---|
| `orders_raw` | `sms_attributed`, `sms_click_at`, `sms_send_id`, `phone_number`, `coupon_code_used`, `order_date` | Attribution source; view filter is `WHERE sms_attributed = true` |
| `sms_events` | `event_type`, `phone`, `sms_send_id`, `sms_message_id`, `created_at` | Click events land here as `event_type = 'sms_clicked'`; Method 2 searches this |
| `sms_sends` | `id`, `flow`, `campaign` | LEFT JOINed by view for `flow`/`campaign` columns |

### Edge functions

| File | Role |
|---|---|
| `supabase/functions/sms-redirect/index.ts` | On click: inserts `sms_events`, updates `customer_contacts.last_clicked_at`. **Does NOT write `orders_raw.sms_click_at`**. |
| `supabase/functions/stripe-webhook/index.ts` | On Stripe checkout: Method 1 (coupon), Method 2 (click-window). Writes `sms_attributed`, `sms_send_id`, `sms_click_at` to `orders_raw`. |

### Scripts and prompts

| File | Role |
|---|---|
| `scripts/openclaw/fetch-sms-data.mjs` | Queries view, aggregates rows via `aggregateClickToPurchase()`, emits warnings |
| `scripts/openclaw/run-sms-report.mjs` | Calls `normalizePayload()` which calls `aggregateClickToPurchase()` |
| `prompts/openclaw/sms-analyst-v1.md` | Instructs OpenClaw on known data quality issues; describes input format |

---

## 3. Current Data Path

### When a subscriber clicks a tracked SMS link

1. Browser hits `GET https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/sms-redirect/{short_code}`.
2. `sms-redirect` looks up `sms_messages` by `short_code` → gets `id`, `phone`, `redirect_url`.
3. Looks up `sms_sends` by `sms_message_id = msg.id` → gets `send.id` (or null if not found).
4. Inserts `sms_events` row: `event_type='sms_clicked'`, `phone=msg.phone` (E.164 as stored in `sms_messages`), `sms_message_id`, `sms_send_id` (or null), `metadata.clicked_at`.
5. Updates `customer_contacts.last_clicked_at` (not `last_sms_sent_at`).
6. Returns `302` redirect to `redirect_url`.
7. **`orders_raw.sms_click_at` is NOT written here** — clicks are only logged to `sms_events`.

### When a Stripe checkout completes

1. `stripe-webhook` fires `checkout.session.completed`.
2. Extracts `phone_number` from Stripe session metadata (absent if customer did not provide a phone).
3. **Method 1 — Coupon match:** If `coupon_code_used` starts with `"SMS-"` or `"VIP-"`, `smsAttributed = true`. Looks up `customer_contacts.coupon_code = coupon_code_used`, then `sms_sends` by `contact_id + flow`. Sets `smsSendId`. **Does NOT set `smsClickAt`** — it remains null.
4. **Method 2 — Click-window match (only if Method 1 didn't fire):** If `phone_number` is non-null, normalizes to E.164 (`+1XXXXXXXXXX` for 10-digit, `+1XXXXXXXXXXX` for 11-digit starting with 1). Searches `sms_events` for `event_type='sms_clicked'` AND `phone=e164Phone` AND `created_at >= 48h ago`. If found: `smsAttributed = true`, `smsSendId = clickEvent.sms_send_id`, `smsClickAt = clickEvent.created_at`.
5. Writes `orders_raw.sms_attributed`, `orders_raw.sms_send_id`, `orders_raw.sms_click_at`.

### View query

```sql
-- sms_v_click_to_purchase (20260414_sms_analytics_views.sql:146)
SELECT
  o.id AS order_id,
  o.phone_number,
  o.coupon_code_used,
  o.total_paid_cents / 100.0 AS order_total,
  (o.total_paid_cents - COALESCE(o.order_cost_total_cents, 0)) / 100.0 AS order_profit,
  o.sms_click_at,
  o.order_date,
  ROUND(EXTRACT(EPOCH FROM (o.order_date - o.sms_click_at)) / 3600, 1) AS hours_click_to_purchase,
  CASE
    WHEN o.coupon_code_used LIKE 'SMS-%' THEN 'direct_coupon'
    ELSE 'click_attribution'
  END AS attribution_method,
  s.flow,
  s.campaign
FROM orders_raw o
LEFT JOIN sms_sends s ON s.id = o.sms_send_id
WHERE o.sms_attributed = true
ORDER BY o.order_date DESC;
```

### Report script aggregation

`fetch-sms-data.mjs:aggregateClickToPurchase()` receives the per-order rows and is supposed to produce: `{ total_attributed_orders, avg_hours_to_purchase, within_24h_pct, within_48h_pct, by_flow, by_attribution_method }`. It checks for `'hours_lag' in rows[0]` to decide whether aggregation is needed. The view column is `hours_click_to_purchase`, not `hours_lag` — so the check returns false and the raw per-order rows are returned unprocessed.

---

## 4. Why Reporting Still Appears Broken or Empty

There are four distinct problems, each with a different cause:

### Problem 1 — `hours_click_to_purchase` is always NULL (data sparsity, not a system bug)

`hours_click_to_purchase` is calculated as `order_date - sms_click_at`. `sms_click_at` is only written by Method 2 (click-window) attribution. Method 2 requires all three of:
- Customer provides a US phone number at Stripe checkout
- That phone, normalized to E.164, matches a phone in `sms_events` (i.e. the contact is an SMS subscriber who clicked a tracked link)
- The click occurred within 48 hours of the order

As of 2026-05-09: 104/149 orders have no phone. All 5 attributed orders were attributed via coupon (Method 1). Method 2 has never fired. **This is not a bug — it is expected behavior given actual purchasing patterns.** No code fix will change this retroactively.

### Problem 2 — Aggregation code never runs (code bug in `fetch-sms-data.mjs`)

`aggregateClickToPurchase()` checks `'hours_lag' in rows[0]`. The view column is `hours_click_to_purchase`. The field name mismatch means the aggregation branch is never entered. Result: the analyst receives a raw array of per-order row objects instead of the expected `{ total_attributed_orders, avg_hours_to_purchase, ... }` object. The analyst prompt describes a specific field structure that never materializes.

**This is a code bug.** It does not affect whether rows exist, but it means the summary statistics (avg time to purchase, within-48h pct, by-flow breakdown) are never computed and presented to the analyst.

### Problem 3 — `attribution_method` label wrong for VIP- orders (view bug)

The CASE expression only checks `LIKE 'SMS-%'`. VIP- orders (`VIP-WHEGPF`) receive label `'click_attribution'` even though they were attributed via coupon. The label will mislead the analyst into thinking click-window attribution occurred for that order.

**This is a view data quality bug.** Fix is a one-line change to include `VIP-%` in the CASE.

### Problem 4 — Two stale hardcoded warnings pollute report (stale code in `fetch-sms-data.mjs`)

`fetch-sms-data.mjs` always emits:
- `"Known audit gap: sms-redirect updates last_sms_sent_at on click instead of a dedicated click field."` — **stale: GAP-02 resolved 2026-05-08**
- `"Known audit gap: admin SMS dashboard checks event_type='click' but actual click events use event_type='sms_clicked'."` — **stale: GAP-03 resolved 2026-05-09**

Both warnings appear on every report run and are now false. The analyst prompt also contains the `last_sms_sent_at` note listed under "Known data quality issues." **These are stale references, not current bugs.**

---

## 5. What Should Be Fixed vs What Should Be Reframed

### Actual bugs to fix

| # | What | Where | Type |
|---|---|---|---|
| **Fix A** | `hours_lag` → `hours_click_to_purchase` (field name mismatch in aggregator) | `scripts/openclaw/fetch-sms-data.mjs`, function `aggregateClickToPurchase()` | Code bug |
| **Fix B** | `attribution_method` CASE: add `VIP-%` as `direct_coupon` | `sms_v_click_to_purchase` view, new migration | View bug |
| **Fix C** | Remove 2 stale hardcoded warnings | `scripts/openclaw/fetch-sms-data.mjs` | Stale code |
| **Fix D** | Remove/update stale `last_sms_sent_at` and `event_type='click'` notes | `prompts/openclaw/sms-analyst-v1.md` | Stale prompt |

### Expected behavior to reframe (not bugs)

| Situation | Why it's not a bug | What to do |
|---|---|---|
| `sms_click_at = NULL` for all rows | All current attributions are coupon-based (Method 1 never sets `sms_click_at`). Correct by design. | Add note to analyst prompt: `avg_hours_to_purchase = null` means click-window attribution has not yet occurred — not a system failure. |
| `hours_click_to_purchase = NULL` | Derived from `sms_click_at`; will remain null until Method 2 fires. | Same note as above. |
| View returns 0 rows in 7-day window | The 3 April orders fall outside the 7-day window; only May 9 orders are recent. Volume is low. | Report script already falls back to all-available-data; add explicit note when fallback is used. |
| Method 2 never fires | 104/149 orders lack phone; the 45 with phones don't match a recent click from the same subscriber. | Normal sparsity for a small store. Will improve as SMS subscriber list grows and click tracking matures. |

---

## 6. Recommended Final Fix Path

**Four targeted changes, no schema additions, no flow changes.**

### Fix A — `fetch-sms-data.mjs`: correct field name in aggregator

**File:** `scripts/openclaw/fetch-sms-data.mjs`  
**Location:** `aggregateClickToPurchase()` function, approximately line 280

Change:
```javascript
const hasHoursLag = 'hours_lag' in rows[0];
```
To:
```javascript
const hasHoursLag = 'hours_click_to_purchase' in rows[0];
```

Also change every `r.hours_lag` reference inside the aggregator to `r.hours_click_to_purchase` (there are 2 occurrences in the `lags` mapping and `byFlowMap` loop).

After this fix, when `sms_v_click_to_purchase` returns rows, the aggregator will produce a proper summary object with `total_attributed_orders`, `avg_hours_to_purchase` (null until Method 2 fires), `within_24h_pct`, `within_48h_pct`, `by_flow`, and `by_attribution_method`.

### Fix B — view migration: extend `attribution_method` CASE to cover VIP-

**Deploy as:** `supabase/migrations/20260509_sms_click_to_purchase_vip_label.sql`

```sql
CREATE OR REPLACE VIEW sms_v_click_to_purchase AS
SELECT
  o.id AS order_id,
  o.phone_number,
  o.coupon_code_used,
  o.total_paid_cents / 100.0 AS order_total,
  (o.total_paid_cents - COALESCE(o.order_cost_total_cents, 0)) / 100.0 AS order_profit,
  o.sms_click_at,
  o.order_date,
  ROUND(EXTRACT(EPOCH FROM (o.order_date - o.sms_click_at)) / 3600, 1) AS hours_click_to_purchase,
  CASE
    WHEN o.coupon_code_used LIKE 'SMS-%' THEN 'direct_coupon'
    WHEN o.coupon_code_used LIKE 'VIP-%' THEN 'direct_coupon'
    ELSE 'click_attribution'
  END AS attribution_method,
  s.flow,
  s.campaign
FROM orders_raw o
LEFT JOIN sms_sends s ON s.id = o.sms_send_id
WHERE o.sms_attributed = true
ORDER BY o.order_date DESC;
```

After this fix, the VIP-WHEGPF order shows as `direct_coupon`, not `click_attribution`.

### Fix C — `fetch-sms-data.mjs`: remove 2 stale hardcoded warnings

**File:** `scripts/openclaw/fetch-sms-data.mjs`  
**Locations:** The two `warnings.push(...)` calls that are always emitted:

Remove the block (lines ~225–229):
```javascript
// Always flag the known audit gap for this view
warnings.push(
  'Known audit gap: sms-redirect updates last_sms_sent_at on click instead of a dedicated ' +
  'click field. Click timing in sms_v_click_to_purchase may not be fully reliable ' +
  '(see 003_smsAudit.md §9).'
);
```

Remove the block (lines ~248–252):
```javascript
// Always include the click delta audit gap warning
warnings.push(
  'Known audit gap: admin SMS dashboard checks event_type=\'click\' but actual click events ' +
  'use event_type=\'sms_clicked\'. Click counts in analytics views may be underreported ' +
  '(see 003_smsAudit.md §9).'
);
```

**Replace with** a single contextual note about CTP null timing (only emitted when rows exist but timing is null):
```javascript
// Note when click timing is null on all rows (Method 2 attribution not yet occurred)
if (ctpResult.rows.length > 0 && ctpResult.rows.every(r => r.sms_click_at === null)) {
  warnings.push(
    'sms_v_click_to_purchase: all attributed orders used coupon-based attribution (Method 1). ' +
    'hours_click_to_purchase is null for all rows — click-window attribution (Method 2) ' +
    'has not yet occurred. This is expected; timing data will appear when a subscriber ' +
    'clicks an SMS link and completes checkout with a matching phone number within 48 hours.'
  );
}
```

### Fix D — `prompts/openclaw/sms-analyst-v1.md`: remove/update stale notes

**File:** `prompts/openclaw/sms-analyst-v1.md`  
**Location:** "Known data quality issues" section

Remove these two bullet points (no longer true):
```
- The sms-redirect Edge Function updates last_sms_sent_at on click instead of a dedicated click timestamp field. This may affect frequency cap timing and make click-to-purchase timing less reliable.
- Several marketing automation functions (sms-coupon-reminder, sms-abandoned-cart, sms-welcome-series, coupon-upgrade) send Twilio messages directly instead of routing through the central send-sms wrapper that enforces daily and weekly caps. This means the frequency caps may not be fully enforced across all flows.
```

Remove or update this bullet point (still partially relevant but the premise is wrong):
```
- sms_v_click_to_purchase data quality may be affected by the click tracking field issue above.
```

**Replace all three with:**
```
- sms_v_click_to_purchase: hours_click_to_purchase will be null when all attributed orders used coupon-based attribution (Method 1 in stripe-webhook). This is expected. Click-window timing (Method 2) only fires when a subscriber clicks a tracked SMS link and then completes checkout providing the same phone number within 48 hours. Null timing means this pattern has not yet occurred — not a system failure.
```

---

## 7. Verification Plan

All 4 fixes are independently verifiable.

### V-A: Aggregator field name (Fix A)

After updating `fetch-sms-data.mjs`, run the report script in dry mode (or add a test call to `aggregateClickToPurchase`) with the 5 current rows from `sms_v_click_to_purchase` and confirm:
- Returns an object (not an array)
- `total_attributed_orders = 5`
- `avg_hours_to_purchase = null` (all rows have `hours_click_to_purchase = null`)
- `by_attribution_method` contains `[{ method: 'direct_coupon', order_count: 5 }]` (after Fix B also applied)

**SQL to get the test rows:**
```sql
SELECT order_id, order_date, sms_click_at, hours_click_to_purchase,
       attribution_method, flow, campaign
FROM sms_v_click_to_purchase
ORDER BY order_date DESC;
```
**Expected shape:** 5 rows, all `sms_click_at = null`, all `hours_click_to_purchase = null`, `attribution_method` correct per Fix B.

### V-B: View `attribution_method` label (Fix B)

After applying the migration:
```sql
SELECT order_id, coupon_code_used, attribution_method
FROM sms_v_click_to_purchase
WHERE coupon_code_used LIKE 'VIP-%';
```
**Expected:** `attribution_method = 'direct_coupon'` for the VIP-WHEGPF row.

```sql
SELECT DISTINCT attribution_method FROM sms_v_click_to_purchase;
```
**Expected:** Only `'direct_coupon'` (since no Method 2 attribution has fired yet). No `'click_attribution'` rows unless a genuine click-window order arrives.

### V-C: Stale warnings removed (Fix C)

Run the report script and inspect `data_quality_warnings` in the JSON payload:
- Must NOT contain: `"sms-redirect updates last_sms_sent_at on click"`
- Must NOT contain: `"admin SMS dashboard checks event_type='click'"`
- Must contain the new null-timing note if all CTP rows have `sms_click_at = null`

### V-D: Analyst prompt updated (Fix D)

Confirm the two removed bullet points are absent from `prompts/openclaw/sms-analyst-v1.md`. Run the next report; Section 5 (click-to-purchase) should not flag a system error for null timing but instead note that click-window attribution hasn't occurred yet.

### V-End-to-End: Full report run

Run `node --env-file=.env scripts/openclaw/run-sms-report.mjs` and confirm:
1. `sms_v_click_to_purchase: 5 rows` printed (or the count of rows in the 7-day window, possibly 2)
2. No stale warnings about `last_sms_sent_at` or `event_type='click'`
3. Section 5 of the report references `total_attributed_orders` from the aggregated object, not raw per-order fields
4. Section 5 notes that timing is not yet available (not that the system is broken)

---

## 8. Definition of Done

GAP-01 is resolved when all of the following are true:

- [ ] `sms_v_click_to_purchase` returns rows for any report window that includes at least one SMS-attributed order (currently 5 all-time)
- [ ] `aggregateClickToPurchase()` correctly aggregates per-order rows — `total_attributed_orders`, `by_attribution_method`, and (when available) timing metrics are populated in the payload
- [ ] `attribution_method` in the view correctly labels both `SMS-%` and `VIP-%` orders as `'direct_coupon'`
- [ ] No stale `last_sms_sent_at` or `event_type='click'` warnings appear in report output
- [ ] The analyst prompt accurately describes the current state: null timing is expected, not a failure
- [ ] Section 5 of a generated report does not declare click-to-purchase "unavailable" — it reports what is known (count, attribution method breakdown) and notes that timing will appear once click-window attribution fires
- [ ] `001_smsKnownGaps.md` GAP-01 status updated to resolved
- [ ] `002_smsChangeLog.md` entries added for Fixes A, B, C, D

### What "fully resolved" does NOT require

- `sms_click_at` being non-null for any row — this requires real-world Method 2 attribution events which depend on subscriber behavior
- `hours_click_to_purchase` having values — same dependency
- The view returning rows in every 7-day window — sparse volume means some windows will have 0 recent attributed orders; the fallback to all-available-data is acceptable

# Review Request SMS Investigation

**Date:** 2026-05-08  
**Trigger:** `sms_v_flow_performance` shows `review_request` flow with 37 total_sends and 0 delivered.  
**Scope:** Read-only codebase inspection. No production changes made.

---

## 1. Executive Summary

The "0 delivered" count in `sms_v_flow_performance` for the `review_request` flow is **not a delivery failure**. The messages were almost certainly transmitted to Twilio successfully. The problem is a **logging gap**: `send-review-request` sends SMS via its own private Twilio call and never inserts a row into the `sms_messages` table. Without an `sms_messages` row, there is no `provider_message_sid` stored in the database. When Twilio fires its delivery status callback, `twilio-webhook` looks up the message by `provider_message_sid` in `sms_messages`, finds nothing, and silently ignores the callback. The `sms_sends` rows exist (explaining the 37 sends), but `sms_message_id` is NULL on every one, so the LEFT JOIN in `sms_v_flow_performance` always resolves to NULL for `m.status`, yielding a delivered count of 0.

A separate but confirmed broken path: the `shippo-webhook` triggers review requests on delivery events by calling `send-review-request` with only `{ order_session_id }`. The function requires `product_id`, `phone`, and `email` as well — so every shippo-webhook-triggered review request silently returns HTTP 400 and no SMS is sent from that path.

---

## 2. Files Reviewed

| File | Why It Matters |
|---|---|
| `supabase/functions/send-review-request/index.ts` | Entry point for the flow; source of the logging gap |
| `supabase/functions/send-sms/index.ts` | The shared sender that correctly creates `sms_messages` rows; review request bypasses this |
| `supabase/functions/shippo-webhook/index.ts` | Secondary trigger for review requests on delivery events; broken payload |
| `supabase/functions/twilio-webhook/index.ts` | Delivery status callback handler; updates `sms_messages` by `provider_message_sid` |
| `supabase/migrations/20260413_sms_tables.sql` | Defines `sms_messages` schema and `message_type` CHECK constraint |
| `supabase/migrations/20260414_sms_phase2.sql` | Defines `sms_sends` schema; `sms_message_id` FK column |
| `supabase/migrations/20260414_sms_analytics_views.sql` | `sms_v_flow_performance` view; how "delivered" is counted |
| `supabase/migrations/20260416_create_review_requests.sql` | `review_requests` table schema; `sms_request` settings default |
| `js/admin/reviews/index.js` | Admin button trigger; sends `{ batch: true }` to the edge function |

---

## 3. Expected Flow

Based on the design in `docs/todo.md` and the edge function header comments:

1. Admin clicks "Send Review Requests" in the admin panel, or Shippo fires a `track_updated` DELIVERED webhook.
2. `send-review-request` is called.
3. The function fetches eligible orders from `orders_raw` and their line items from `line_items_raw`.
4. For each eligible order+product combination, it checks SMS consent in `customer_contacts`.
5. It generates a review JWT, builds a short link, and sends an SMS via Twilio.
6. It inserts a `review_requests` row (tracking the funnel).
7. It logs to `sms_sends` with `flow = 'review_request'` for analytics.
8. Twilio fires a status callback to `twilio-webhook` when the message is delivered.
9. `twilio-webhook` updates the `sms_messages` row to `status = 'delivered'`.
10. `sms_v_flow_performance` JOINs `sms_sends` to `sms_messages` and reports delivered count.

Step 7 partially happens. Steps 8–10 are broken because step 6 is missing an `sms_messages` insert.

---

## 4. Actual Implementation Findings

### 4.1 `send-review-request` calls Twilio directly — bypassing `send-sms`

`send-review-request/index.ts` defines its own private `sendSms()` helper:

```typescript
async function sendSms(phone: string, body: string): Promise<{ ok: boolean; sid?: string }> {
  // ... posts directly to Twilio REST API ...
  if (WEBHOOK_URL) form.set("StatusCallback", WEBHOOK_URL);
  // ...
  return { ok: resp.ok, sid: data.sid };
}
```

It does NOT call the shared `send-sms` edge function. The shared `send-sms` function is the only code that inserts into `sms_messages`. By bypassing it, no `sms_messages` row is ever created for any review request send.

### 4.2 `sms_sends` insert omits `sms_message_id`

After a successful Twilio call, `send-review-request` inserts to `sms_sends` without linking to any `sms_messages` row:

```typescript
await sb.from("sms_sends").insert({
  phone,
  campaign: "review_request",
  flow: "review_request",
  send_reason: `Review request for ${prodName}`,
  intent: "marketing",
  outcome: "pending",
  cost: 0.0079,
  // sms_message_id is omitted — defaults to NULL
});
```

The `sms_message_id` FK column in `sms_sends` is nullable (`UUID REFERENCES sms_messages(id) ON DELETE SET NULL`), so this insert succeeds. But NULL here means the analytics JOIN is permanently broken for these rows.

### 4.3 `shippo-webhook` → `triggerReviewRequest` sends a broken payload

`shippo-webhook/index.ts` fires review requests on delivery:

```typescript
async function triggerReviewRequest(sessionId: string) {
  // ...
  body: JSON.stringify({ order_session_id: sessionId }),
  // ^^^ ONLY order_session_id — no product_id, no phone, no email
}
```

`send-review-request` `handleSingle` requires all four fields:

```typescript
if (!order_session_id || !product_id || !phone || !email) {
  return json({ error: "Missing required fields: order_session_id, product_id, phone, email" }, 400);
}
```

`body.batch` is not present, so the batch path is not taken. The single path returns 400 on every invocation. `shippo-webhook` catches the thrown error and logs it, but the 400 is silently discarded. No SMS is sent via this path.

### 4.4 Admin panel sends `{ batch: true }` — this path works structurally

`js/admin/reviews/index.js` sends `{ batch: true }`:

```javascript
body: JSON.stringify({ batch: true }),
```

`handleBatch` in `send-review-request` does process this correctly — queries orders, finds eligible ones, calls `handleSingle` per product. The 37 `sms_sends` rows were created by this admin-triggered batch path. The Twilio calls were made. The logging gap is the only reason delivered = 0.

### 4.5 `review_settings.sms_request.enabled` default is `false`

The migration inserts:

```sql
'{"enabled": false, "delay_days": 7, "mto_delay_days": 14, "max_products_per_order": 3}'
```

`handleBatch` reads `settings.sms_request?.delay_days` and `mto_delay_days`, but does **not** check `enabled`. If the setting was intended to gate batch sends, it is not enforced. Not the cause of 0 delivered, but a design gap.

---

## 5. Logging and Analytics Path

| Table | Written by review_request? | Notes |
|---|---|---|
| `sms_messages` | **NO** | Never inserted. This is the root cause. |
| `sms_sends` | **YES** | Inserted on successful Twilio send. `sms_message_id = NULL`. |
| `review_requests` | **YES** | Inserted for each send attempt with `status = 'sent'` or `'failed'`. |
| Twilio webhook status update path | **Broken** | Webhook fires, looks up `sms_messages` by `provider_message_sid`. No row exists. Update is silently lost. |

`sms_v_flow_performance` computes `delivered` as:

```sql
SUM(CASE WHEN m.status = 'delivered' THEN 1
         WHEN m.status = 'sent'      THEN 1
         ELSE 0 END) AS delivered
```

Where `m` is `sms_messages` joined via `sms_message_id`. Since all review_request `sms_sends` rows have `sms_message_id = NULL`, the LEFT JOIN returns NULL for every row, and `CASE WHEN NULL = 'delivered'` evaluates to false. Result: `delivered = 0`.

---

## 6. Delivery Tracking Assessment

**"0 delivered" most likely means:**

| Hypothesis | Assessment |
|---|---|
| Real delivery failures (Twilio rejecting messages) | **Unlikely.** The SIDs were returned and logged to `review_requests` via `smsResult.sid`. Twilio assigns SIDs before delivery attempt. |
| Missing `sms_messages` rows | **Confirmed.** `send-review-request` never calls `sms_messages` insert. This is the direct cause. |
| Missing `provider_message_sid` linkage | **Confirmed.** No `sms_messages` row → no SID stored in DB → webhook can't correlate. |
| Analytics blind spot | **Confirmed as the reporting symptom.** The view correctly JOINs — the data it needs simply doesn't exist. |
| Broken webhook correlation | **Confirmed as the mechanism.** `twilio-webhook` updates `sms_messages` by `provider_message_sid`. No row = no update. |

The 37 total_sends in the view confirm Twilio was called 37 times. The `review_requests` table will show the actual Twilio SIDs (`short_code` values) for those sends. Whether carrier delivery succeeded is unknown — it is not persisted anywhere.

---

## 7. Schema / Constraint Risks

### 7.1 `sms_messages.message_type` CHECK constraint

**File:** `supabase/migrations/20260413_sms_tables.sql`

```sql
message_type TEXT NOT NULL
  CHECK (message_type IN ('coupon_delivery', 'reminder', 'campaign', 'transactional'))
```

`'review_request'` is **not** in this constraint. If a fix inserts into `sms_messages` with `message_type = 'review_request'`, the insert will fail with a constraint violation. The correct value for a review request SMS would be `'transactional'` or potentially `'campaign'`. A migration would be needed to add `'review_request'` if that granularity is wanted.

### 7.2 `shippo-webhook` payload missing required fields

`triggerReviewRequest(sessionId)` passes only `{ order_session_id: sessionId }`. `handleSingle` requires `product_id`, `phone`, and `email`. This is a guaranteed 400 on every shippo delivery event. Not confirmed in codebase whether this was ever tested.

### 7.3 `sms_sends.sms_message_id` is nullable — no DB-level enforcement

The schema permits NULL for `sms_message_id`. This means the logging gap cannot be caught at the database level. Any edge function that bypasses `send-sms` and manually calls Twilio will have this same blind spot.

### 7.4 `review_requests` table missing `short_code` column (migration vs. code)

**File:** `supabase/migrations/20260416_create_review_requests.sql`

The migration does NOT define a `short_code` column in `review_requests`. But `handleSingle` in `send-review-request` inserts `short_code: shortCode`. If this migration is in its final state, the insert would fail with an unknown column error. Either: (a) a later migration adds `short_code`, (b) the column was added manually in production, or (c) the insert is silently failing (Supabase returns an error which is caught and logged: `console.error("[send-review-request] review_requests insert failed:")`).

Not confirmed whether a migration adding `short_code` exists — only one migration file for this table was found.

---

## 8. Most Likely Root Cause

**`send-review-request` bypasses `send-sms` and therefore never creates an `sms_messages` row.**

All other flows (`signup`, `coupon_reminder`, `abandoned_cart`, `welcome_series`, `coupon_escalation`) route through `send-sms`, which handles both the Twilio call and the `sms_messages` insert atomically. `send-review-request` is the only flow that implemented its own private Twilio caller. Because it skips the `sms_messages` insert:

1. `sms_sends.sms_message_id` is always NULL for review requests.
2. The analytics view LEFT JOIN on `sms_messages` always produces NULL → delivered = 0.
3. Twilio's delivery callbacks land in `twilio-webhook`, which can find no matching `sms_messages` row → update is silently lost.
4. Delivery status is permanently untrackable for any review request send made by this code.

This is a pure logging architecture gap. The messages were likely sent to subscribers. The database just has no record of their delivery status.

---

## 9. Confidence Level

**High.**

The evidence chain is complete and code-confirmed:
- `send-review-request` source confirms no `sms_messages` insert.
- `sms_sends` insert source confirms `sms_message_id` is omitted.
- `sms_v_flow_performance` view SQL confirms `delivered` is computed entirely from the `sms_messages` JOIN.
- `twilio-webhook` source confirms it only matches by `provider_message_sid` in `sms_messages`.

The `shippo-webhook` broken payload is also code-confirmed by direct comparison of the payload sent vs. the validation block in `handleSingle`.

---

## 10. Recommended Fix Path

**Do not implement. Review and decide before taking action.**

1. **Fix `send-review-request` logging (highest priority).**  
   Replace the private `sendSms()` Twilio call with a call to the shared `send-sms` edge function, similar to how `shippo-webhook` calls `send-sms` for shipping notifications. This will automatically create the `sms_messages` row, register the `provider_message_sid`, and enable delivery tracking through `twilio-webhook`. Requires deciding the correct `message_type` value (see item 2).

2. **Add `'review_request'` to `sms_messages.message_type` CHECK constraint, or use `'transactional'`.**  
   If granularity is wanted, add a migration:  
   ```sql
   ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_message_type_check;
   ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_message_type_check
     CHECK (message_type IN ('coupon_delivery', 'reminder', 'campaign', 'transactional', 'review_request'));
   ```  
   Alternatively, use `message_type = 'transactional'` without touching the constraint.

3. **Fix `shippo-webhook → triggerReviewRequest` payload.**  
   The function needs to fetch the order's products, phone, and email from the DB before calling `send-review-request`, rather than passing only `order_session_id`. Alternatively, add a `{ lookup: true, order_session_id }` mode to `send-review-request` that does the product/contact lookup internally.

4. **Audit whether `review_requests.short_code` column exists in production.**  
   If the `short_code` column does not exist, every `review_requests` insert is silently failing. Check the `review_requests` table structure in the Supabase dashboard. If missing, add a migration:  
   ```sql
   ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS short_code TEXT;
   CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_short_code ON review_requests (short_code) WHERE short_code IS NOT NULL;
   ```

5. **Enforce `sms_request.enabled` flag in `handleBatch` (low priority).**  
   If the admin panel should respect the `enabled: false` default, add a check in `handleBatch` before processing orders. Currently there is no gate.

---

## 11. Evidence Snippets

### 11.1 `send-review-request`: `sms_sends` insert — no `sms_message_id`
**File:** `supabase/functions/send-review-request/index.ts` (lines ~232–241)
```typescript
if (smsResult.ok) {
  await sb.from("sms_sends").insert({
    phone,
    campaign: "review_request",
    flow: "review_request",
    send_reason: `Review request for ${prodName}`,
    intent: "marketing",
    outcome: "pending",
    cost: 0.0079,
    // sms_message_id intentionally absent — NULL in DB
  });
}
```

### 11.2 `sms_v_flow_performance`: delivered computed from `sms_messages` JOIN
**File:** `supabase/migrations/20260414_sms_analytics_views.sql` (lines ~14–18)
```sql
LEFT JOIN sms_messages m ON m.id = s.sms_message_id
-- ...
SUM(CASE WHEN m.status = 'delivered' THEN 1
         WHEN m.status = 'sent'      THEN 1
         ELSE 0 END) AS delivered
```
When `sms_message_id = NULL`, `m.id = NULL`, and `m.status` is NULL → `delivered` increments by 0.

### 11.3 `twilio-webhook`: looks up only by `provider_message_sid`
**File:** `supabase/functions/twilio-webhook/index.ts` (lines ~134–140)
```typescript
const { error: updErr } = await sb
  .from("sms_messages")
  .update(updates)
  .eq("provider_message_sid", messageSid);
```
No `sms_messages` row for review requests → `.eq("provider_message_sid", messageSid)` matches 0 rows → update is silent no-op.

### 11.4 `shippo-webhook`: broken payload to `send-review-request`
**File:** `supabase/functions/shippo-webhook/index.ts` (lines ~231–240)
```typescript
async function triggerReviewRequest(sessionId: string) {
  // ...
  body: JSON.stringify({ order_session_id: sessionId }),
  // Missing: product_id, phone, email
}
```
vs. `handleSingle` validation:
```typescript
if (!order_session_id || !product_id || !phone || !email) {
  return json({ error: "Missing required fields: order_session_id, product_id, phone, email" }, 400);
}
```

### 11.5 `sms_messages.message_type` constraint — `'review_request'` not included
**File:** `supabase/migrations/20260413_sms_tables.sql` (lines ~100–102)
```sql
message_type TEXT NOT NULL
  CHECK (message_type IN ('coupon_delivery', 'reminder', 'campaign', 'transactional'))
```
`'review_request'` is absent. Any insert with that value would fail.

### 11.6 `review_requests` migration — `short_code` column absent
**File:** `supabase/migrations/20260416_create_review_requests.sql`
```sql
CREATE TABLE IF NOT EXISTS review_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_session_id text NOT NULL,
  product_id      text NOT NULL,
  phone           text NOT NULL,
  token_hash      text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  clicked_at      timestamptz,
  reviewed_at     timestamptz,
  status          text NOT NULL DEFAULT 'sent' ...
  -- No short_code column
);
```
But `send-review-request` inserts `short_code: shortCode`. If this migration was applied without later alteration, those inserts fail silently.

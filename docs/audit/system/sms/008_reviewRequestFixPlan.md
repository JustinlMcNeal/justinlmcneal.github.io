# Review Request SMS Fix Plan

**Date:** 2026-05-08  
**Basis:** `docs/audit/system/sms/007_reviewRequestInvestigation.md`  
**Status:** Planning only. No production code changed.

---

## 1. Objective

Fix the `review_request` SMS flow so that:

1. Delivery status is tracked in `sms_messages` and visible via `sms_v_flow_performance`.
2. Twilio delivery callbacks correctly update delivery records.
3. The `shippo-webhook` can trigger review requests after a confirmed delivery event without returning HTTP 400.
4. The `review_requests` table insert does not silently fail due to a missing `short_code` column.

No new systems are introduced. This is a surgical repair of existing logging and payload gaps.

---

## 2. Confirmed Problems

From the investigation (confidence: High on all four):

| # | Problem | Impact |
|---|---|---|
| P1 | `send-review-request` calls Twilio directly via its own private helper instead of routing through `send-sms`. No `sms_messages` row is created. | `sms_v_flow_performance` shows `delivered = 0` for all 37 sends. Twilio delivery callbacks are permanently lost. |
| P2 | The `sms_sends` insert inside `send-review-request` omits `sms_message_id`. | Analytics view JOIN on `sms_messages` always resolves to NULL. Cannot be fixed retroactively for existing rows. |
| P3 | `shippo-webhook → triggerReviewRequest` sends `{ order_session_id }` only. `send-review-request` requires `product_id`, `phone`, and `email`. Returns HTTP 400 on every invocation. | Review requests are never triggered by shipping delivery events. Silently broken. |
| P4 | `review_requests` migration does not define `short_code` column, but `send-review-request` inserts it. | Every `review_requests` insert may be silently failing. Funnel tracking is blind. |

---

## 3. Recommended Fix Strategy

**Route `send-review-request` through `send-sms` for all Twilio calls.**

`send-sms` is the single correct place to send marketing and transactional SMS in this system. It handles:
- `sms_messages` insert with `provider_message_sid`
- `sms_sends` insert with correct `sms_message_id` FK
- Twilio REST call with `StatusCallback` set
- Frequency cap enforcement (which review requests should bypass via `skip_caps: true` or `intent: 'transactional'`)

The private `sendSms()` helper inside `send-review-request` should be removed. The function should instead call the internal `send-sms` edge function via `fetch`, the same pattern used by `shippo-webhook` for shipping notifications.

This is the minimal safe change. It:
- Does not touch `twilio-webhook` (already correct)
- Does not touch `sms_v_flow_performance` (already correct — it just needs data)
- Does not change the JWT generation, link building, or `review_requests` insert logic
- Repairs analytics immediately for all future sends

**Existing 37 rows cannot be retroactively fixed.** The `sms_sends` rows already in the DB have `sms_message_id = NULL`. Those historical delivered counts will remain 0. That is acceptable — the fix is forward-looking.

---

## 4. Required Code Changes

### 4.1 `supabase/functions/send-review-request/index.ts` — Primary fix

**Changes needed:**

1. **Remove the private `sendSms()` function** (lines ~69–88 in the current file). It is no longer needed.

2. **Replace the Twilio call + `sms_sends` insert block in `handleSingle`** with a single call to the internal `send-sms` edge function:

   ```typescript
   const smsRes = await fetch(
     `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`,
     {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
       },
       body: JSON.stringify({
         to: e164Phone,
         body: smsBody,
         message_type: "transactional",   // see §5 for decision
         intent: "transactional",         // bypasses marketing caps
         campaign: "review_request",
         contact_id: contact.id,
         skip_caps: false,                // transactional intent already bypasses caps
       }),
     }
   );
   const smsData = await smsRes.json();
   const smsSent = smsRes.ok && smsData.success;
   const smsSid  = smsData.message_sid ?? null;
   ```

   `send-sms` will handle the `sms_messages` insert, the `sms_sends` insert (with correct `sms_message_id`), and the Twilio call. The only remaining work in `handleSingle` is the `review_requests` insert.

3. **Remove the TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM / WEBHOOK_URL env var reads** at the top of the file — they are only used by the private `sendSms()` helper. After the fix, `send-review-request` no longer touches Twilio directly.

4. **Update the `review_requests` insert** to use `smsSent` and `smsSid` from the `send-sms` response:
   ```typescript
   status: smsSent ? "sent" : "failed",
   // short_code stays as-is (generated internally, used for the review link)
   ```

5. **Keep all other logic unchanged**: JWT generation, short code, link building, consent check, duplicate check, batch path.

### 4.2 `supabase/functions/send-sms/index.ts` — No changes required

`send-sms` already handles `intent: 'transactional'` correctly — it skips quiet hours and frequency caps for non-marketing intents. No modification needed.

### 4.3 `supabase/functions/shippo-webhook/index.ts` — Fix `triggerReviewRequest`

**Current broken code:**
```typescript
async function triggerReviewRequest(sessionId: string) {
  // ...
  body: JSON.stringify({ order_session_id: sessionId }),
}
```

**Fix options (choose one):**

**Option A (Recommended) — Add `batch: true` with a session filter:**  
Change `triggerReviewRequest` to call `send-review-request` in batch mode but constrained to the single session ID. This requires `handleBatch` to accept an optional `session_id` filter.

This is the cleanest architectural fit: `handleBatch` already does the product + contact lookup work that `triggerReviewRequest` would otherwise need to replicate.

Proposed change to `shippo-webhook`:
```typescript
body: JSON.stringify({ batch: true, session_id: sessionId }),
```

Proposed addition to `handleBatch` in `send-review-request`:
- Accept optional `session_id` string in the batch body.
- If present, filter the `orders_raw` query to that single session ID instead of the time-window query.

**Option B — Build the lookup inside `triggerReviewRequest`:**  
Query `orders_raw` and `line_items_raw` inside `shippo-webhook` and pass the full payload. This is more code in `shippo-webhook` and duplicates logic already in `handleBatch`. Not preferred.

**Recommended: Option A.** Minimal code delta. Reuses existing batch pipeline.

### 4.4 Migration files — `review_requests.short_code` column

Before writing any code, verify whether the column exists in production (see §6). If it does not exist:

**New migration file:** `supabase/migrations/20260508_review_requests_add_short_code.sql`

```sql
-- Add short_code column to review_requests table.
-- This column was referenced by send-review-request/index.ts but was not
-- included in the original 20260416_create_review_requests.sql migration.
ALTER TABLE review_requests
  ADD COLUMN IF NOT EXISTS short_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_short_code
  ON review_requests (short_code)
  WHERE short_code IS NOT NULL;
```

### 4.5 Analytics implications

No view changes needed. `sms_v_flow_performance` already correctly JOINs `sms_sends → sms_messages`. Once `send-sms` is called and `sms_message_id` is populated, the view will report correctly for all future sends. Historical rows remain stale (see §10).

---

## 5. Message Type Decision

### Option A: Use existing `'transactional'`

- No migration required.
- `sms_messages.message_type` CHECK constraint already includes `'transactional'`.
- Review requests are genuinely transactional — sent post-purchase, not bulk marketing.
- `send-sms` skips quiet hours and frequency caps for `intent: 'transactional'`, which is correct for review requests.
- Slight loss of granularity: `sms_messages` rows for review requests would be indistinguishable from shipping notifications at the row level. However, the `sms_sends.flow = 'review_request'` and `sms_sends.campaign = 'review_request'` fields — which `send-sms` preserves — provide full analytics granularity through the view.

### Option B: Add `'review_request'` to the constraint

- Requires a migration to drop and recreate the CHECK constraint on `sms_messages`.
- Provides per-row type granularity in `sms_messages`.
- Slightly higher risk: altering a constraint on a table that all SMS flows use.

### Recommendation: **Use `'transactional'` (Option A)**

The analytics differentiation needed for review requests is already provided by `sms_sends.flow` and `sms_sends.campaign`. Adding a new `message_type` value is unnecessary complexity for this fix. The migration risk is not worth the marginal benefit. This can always be added later if needed.

---

## 6. `review_requests.short_code` Check

### How to verify

Run this query in the Supabase SQL editor (safe, read-only):

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'review_requests'
ORDER BY ordinal_position;
```

Expected if column exists: a row with `column_name = 'short_code'`, `data_type = 'text'`.  
If absent: proceed with the migration in §4.4 before deploying any code changes.

### Secondary check — are `review_requests` rows actually being created?

```sql
SELECT COUNT(*), MIN(sent_at), MAX(sent_at)
FROM review_requests;
```

If this returns 0 rows despite 37 `sms_sends` rows with `flow = 'review_request'`, the insert is definitely failing (most likely due to the missing `short_code` column). If rows exist, the column was added outside migrations.

### What to do

| Scenario | Action |
|---|---|
| `short_code` column exists, rows exist | No migration needed. Proceed to code fix. |
| `short_code` column exists, rows = 0 | Investigate other insert errors. |
| `short_code` column missing, rows = 0 | Apply migration §4.4 first, before any code deploy. |
| `short_code` column missing, rows exist | Column was added manually. Apply migration anyway (uses `ADD COLUMN IF NOT EXISTS`). |

---

## 7. Shippo Trigger Fix

The safest fix is a two-part change:

**Part 1 — `supabase/functions/shippo-webhook/index.ts`**

Change `triggerReviewRequest` to pass `batch: true` with the session ID:

```typescript
async function triggerReviewRequest(sessionId: string) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-review-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ batch: true, session_id: sessionId }),
  });
  const result = await res.json();
  console.log(`[shippo-webhook] Review request for ${sessionId}:`, JSON.stringify(result));
}
```

**Part 2 — `supabase/functions/send-review-request/index.ts`**

In `handleBatch`, add an optional `session_id` parameter. If present, skip the time-window order query and instead query for just that one session:

```typescript
async function handleBatch(
  sb: ReturnType<typeof createClient>,
  reviewSecret: string,
  daysAgo?: number,
  sessionId?: string    // ← new optional param
): Promise<Response> {
  // ...
  let ordersQuery = sb
    .from("orders_raw")
    .select("stripe_checkout_session_id, email, first_name, phone_number, order_date");

  if (sessionId) {
    // Single-session mode: triggered by shippo-webhook on delivery
    ordersQuery = ordersQuery.eq("stripe_checkout_session_id", sessionId);
  } else {
    // Batch mode: time-window query for admin panel
    ordersQuery = ordersQuery
      .lte("order_date", cutoffNormal.toISOString().split("T")[0])
      .order("order_date", { ascending: false })
      .limit(100);
  }
  // ...
}
```

The `Deno.serve` dispatcher also needs to pass `body.session_id` to `handleBatch`:
```typescript
return await handleBatch(sb, reviewSecret, body.days_ago, body.session_id);
```

This approach is safe because:
- `handleBatch` already does the product + consent lookups that the shippo path was missing.
- `handleSingle` already deduplicates via the `review_requests` UNIQUE constraint — firing twice for the same order/product is harmless.
- No new code paths. The shippo trigger becomes a single-session batch call.

---

## 8. Order of Implementation

Perform in this exact order to minimize risk at each step:

1. **Verify `review_requests.short_code` column in production** (§6 SQL queries).  
   If missing, apply migration `20260508_review_requests_add_short_code.sql` before any code changes.

2. **Set `message_type = 'transactional'`** as the agreed value (no migration needed — Option A from §5).

3. **Update `send-review-request/index.ts`:**
   - Remove private `sendSms()` helper.
   - Remove top-level TWILIO_* env var reads.
   - Replace Twilio call + `sms_sends` insert block with `send-sms` fetch call.
   - Update `review_requests` insert to use the response from `send-sms`.
   - Add `session_id?: string` parameter to `handleBatch`.
   - Pass `body.session_id` from the dispatcher to `handleBatch`.
   - Deploy: `echo y | npx supabase functions deploy send-review-request --project-ref yxdzvzscufkvewecvagq`

4. **Test `send-review-request` alone** (see §9 test plan) before touching `shippo-webhook`.

5. **Update `shippo-webhook/index.ts`:**
   - Change `triggerReviewRequest` to send `{ batch: true, session_id: sessionId }`.
   - Deploy: `echo y | npx supabase functions deploy shippo-webhook --project-ref yxdzvzscufkvewecvagq`

6. **Validate end-to-end** via the test plan in §9.

---

## 9. Test Plan

### Test 1 — Verify `short_code` column (Pre-fix, read-only)

Run the column check query from §6 in the Supabase dashboard.  
**Pass:** `short_code` column present OR migration applied successfully.

### Test 2 — Single send via `handleSingle` directly (Post code deploy, step 3)

Using the Supabase dashboard → Edge Functions → `send-review-request` → Invoke:

```json
{
  "order_session_id": "<a real test order session ID>",
  "product_id": "<a real product_id from that order>",
  "phone": "<your own test phone number>",
  "email": "<test@example.com>",
  "first_name": "Test",
  "product_name": "Test Product"
}
```

**Expected:**
- HTTP 200 with `{ "success": true, "sent": true }`
- You receive the SMS on your test phone.
- A row appears in `sms_messages` with `status = 'sent'` and a non-null `provider_message_sid`.
- A row appears in `sms_sends` with `flow = 'review_request'` and a non-null `sms_message_id`.
- A row appears in `review_requests` with `status = 'sent'`.
- After ~30 seconds, `sms_messages.status` updates to `'delivered'` via the Twilio webhook.

**Verify with SQL:**
```sql
-- Check sms_messages
SELECT id, phone, message_type, status, provider_message_sid, sent_at, delivered_at
FROM sms_messages
WHERE campaign = 'review_request'
ORDER BY created_at DESC LIMIT 5;

-- Check sms_sends linkage
SELECT id, phone, flow, campaign, sms_message_id, created_at
FROM sms_sends
WHERE flow = 'review_request'
ORDER BY created_at DESC LIMIT 5;

-- Check review_requests
SELECT id, order_session_id, status, sent_at, short_code
FROM review_requests
ORDER BY sent_at DESC LIMIT 5;
```

**Pass criteria:**
- `sms_messages` row exists with non-null `provider_message_sid`.
- `sms_sends` row has non-null `sms_message_id` FK pointing to the `sms_messages` row.
- After Twilio callback: `sms_messages.status = 'delivered'` and `delivered_at` is set.

### Test 3 — Duplicate guard (post Test 2)

Invoke `handleSingle` again with the same `order_session_id` + `product_id` from Test 2.

**Expected:** HTTP 409 with `{ "skipped": true }`. No duplicate rows.

### Test 4 — Batch mode with one known eligible order (minimal blast radius)

Find one real order that is eligible (customer has SMS consent, no existing review request). Invoke:

```json
{ "batch": true, "days_ago": 999 }
```

Use `days_ago: 999` to cast a wide net, but do this when you know only 1–2 eligible orders exist, or after first running the eligibility check query:

```sql
SELECT o.stripe_checkout_session_id, o.email, o.phone_number
FROM orders_raw o
JOIN customer_contacts cc
  ON cc.phone LIKE '%' || RIGHT(REPLACE(o.phone_number, '+1', ''), 10) || '%'
  AND cc.status = 'active'
  AND cc.sms_consent = true
LEFT JOIN review_requests rr
  ON rr.order_session_id = o.stripe_checkout_session_id
WHERE rr.id IS NULL
  AND o.phone_number IS NOT NULL
LIMIT 5;
```

**Pass criteria:** Same as Test 2 for each result. No unintended bulk sends.

### Test 5 — `sms_v_flow_performance` shows delivered > 0 (Post Tests 2–4)

```sql
SELECT flow, campaign, total_sends, delivered, conversions
FROM sms_v_flow_performance
WHERE flow = 'review_request';
```

**Pass criteria:** `delivered > 0` for new rows. Historical rows will still show `delivered = 0` — that is expected and acceptable.

### Test 6 — `shippo-webhook` session-scoped batch (Post step 5 deploy)

Using the Supabase dashboard → Edge Functions → `send-review-request` → Invoke directly (to test the new batch path, not via a real shippo event):

```json
{ "batch": true, "session_id": "<a real session ID with an eligible order>" }
```

**Pass criteria:** Same as Test 2. Exactly one send per eligible product on that order.

---

## 10. Rollback / Safety Notes

- **`send-review-request` change is low blast-radius.** It only replaces how the Twilio call and logging happen. The external behavior (SMS delivered to customer) is unchanged.
- **No `sms_messages` schema changes are required** for this fix (we are using `message_type = 'transactional'`). No constraint migrations needed.
- **The `short_code` migration uses `ADD COLUMN IF NOT EXISTS`** — safe to run on a live table.
- **Shippo webhook change is independently deployable** after step 3 is confirmed. If it causes unexpected behavior, revert `shippo-webhook` without touching `send-review-request`.
- **Do not run the admin "Send Review Requests" button during testing** unless the eligibility query confirms only known test orders are eligible, to avoid sending bulk SMS to real customers.
- **Existing `sms_sends` rows** with `sms_message_id = NULL` will always show `delivered = 0`. Do not attempt to backfill them — Twilio SIDs are not stored anywhere in the DB for those sends.
- **`review_settings.sms_request.enabled = false`** is not enforced by the current code, so no feature flag protects against sends. Be deliberate about when you deploy and test.

---

## 11. Definition of Done

The fix is complete when all of the following are true:

- [ ] `review_requests.short_code` column confirmed present in production (or migration applied).
- [ ] `send-review-request` no longer contains a private `sendSms()` function.
- [ ] `send-review-request` calls `send-sms` instead of Twilio directly.
- [ ] A test send via `handleSingle` creates a row in `sms_messages` with a non-null `provider_message_sid`.
- [ ] A test send creates a `sms_sends` row with a non-null `sms_message_id`.
- [ ] After ~30 seconds, `sms_messages.status` updates to `'delivered'` via the Twilio callback.
- [ ] `sms_v_flow_performance` shows `delivered > 0` for new `review_request` rows.
- [ ] `shippo-webhook → triggerReviewRequest` no longer returns HTTP 400 when called with only a session ID.
- [ ] Duplicate sends are still blocked by the `review_requests` UNIQUE constraint.
- [ ] No unintended bulk SMS sends to real customers occurred during testing.

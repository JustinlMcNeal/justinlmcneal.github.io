# SMS Click Tracking Fix Plan

Spec date: 2026-05-08  
Status: Investigation / planning — no code changed  
Related gaps: GAP-01, GAP-02 from `001_smsKnownGaps.md`

---

## 1. Problem Summary

Two linked problems exist in the SMS click tracking path:

**Problem A — `sms_v_click_to_purchase` returns zero rows (GAP-01)**  
The click-to-purchase view filters on `orders_raw.sms_attributed = true`. If no orders carry that flag, the view returns no rows regardless of whether click events exist in `sms_events`. The admin dashboard click-timing section is always empty and the OpenClaw daily report always warns that this data is unavailable.

**Problem B — `sms-redirect` updates `last_sms_sent_at` on click (GAP-02)**  
When a subscriber clicks a tracked SMS link, `sms-redirect` updates `customer_contacts.last_sms_sent_at` to the click timestamp. That column is the frequency-cap field — the system checks it before sending to decide whether enough time has passed since the last SMS. A click resets this timer as if a message was just sent, which can suppress the next legitimate scheduled message.

These problems are linked: both stem from `sms-redirect` writing to the wrong field after a click. Fixing Problem B is a prerequisite to making click timestamps reliable enough to trust for Problem A diagnostics.

---

## 2. Files / Tables Involved

### Edge Functions

| File | Role |
|---|---|
| `supabase/functions/sms-redirect/index.ts` | Handles tracked link clicks. Inserts `sms_events` row (correct). Updates `customer_contacts.last_sms_sent_at` (incorrect). |
| `supabase/functions/stripe-webhook/index.ts` | Attribution on Stripe checkout complete. Searches `sms_events` for a click within 48h of the order. Sets `orders_raw.sms_attributed`, `sms_send_id`, and `sms_click_at`. |

### Tables

| Table | Relevant fields | Notes |
|---|---|---|
| `sms_events` | `event_type`, `phone`, `sms_message_id`, `sms_send_id`, `created_at`, `metadata` | Click events land here with `event_type = 'sms_clicked'` |
| `customer_contacts` | `last_sms_sent_at`, `phone` | `last_sms_sent_at` is the frequency-cap field. No dedicated click timestamp field exists yet. |
| `sms_messages` | `id`, `phone`, `short_code`, `redirect_url`, `contact_id` | Looked up by `short_code` in `sms-redirect`. `phone` field sourced to click event. |
| `sms_sends` | `id`, `sms_message_id`, `phone`, `flow`, `campaign`, `contact_id` | Linked to click events via `sms_send_id`. |
| `orders_raw` | `sms_attributed`, `sms_send_id`, `sms_click_at`, `phone_number` | Attribution fields set by `stripe-webhook`. `sms_click_at` is `NULL` unless Method 2 (click-window) attribution fires. |

### Views

| View | Relevant dependency |
|---|---|
| `sms_v_click_to_purchase` | `supabase/migrations/20260414_sms_analytics_views.sql` line 146. Filters `WHERE orders_raw.sms_attributed = true`. Joins `sms_sends` for flow/campaign. Uses `o.sms_click_at` for timing calculation. |

### Migrations

| File | What it creates |
|---|---|
| `supabase/migrations/20260414_sms_phase2.sql` | Creates `sms_events`, `sms_sends`. Adds `last_sms_sent_at` to `customer_contacts`. Adds `sms_attributed`, `sms_send_id`, `sms_click_at` to `orders_raw`. |
| `supabase/migrations/20260414_sms_analytics_views.sql` | Defines `sms_v_click_to_purchase` and the other 5 analytics views. |

---

## 3. Current Write Path

**When a subscriber clicks a tracked SMS link:**

1. Browser hits `GET /sms-redirect/{short_code}`.
2. `sms-redirect` looks up `sms_messages` by `short_code` → gets `id`, `phone`, `redirect_url`, `contact_id`.
3. Looks up `sms_sends` by `.eq("sms_message_id", msg.id).maybeSingle()` → gets `send?.id`.
4. **Inserts** `sms_events`:
   ```
   event_type:     "sms_clicked"
   phone:          msg.phone          ← from sms_messages, not normalized
   sms_message_id: msg.id
   sms_send_id:    send?.id || null   ← null if send lookup fails
   metadata:       { ip, user_agent, redirect_url, clicked_at }
   ```
5. **Updates** `customer_contacts` (WRONG):
   ```
   last_sms_sent_at = new Date().toISOString()  WHERE phone = msg.phone
   ```
6. Returns `302` to `redirect_url`.

**When a Stripe checkout completes:**

1. `stripe-webhook` fires `checkout.session.completed`.
2. Extracts `phone_number` from Stripe session (may be null/missing if customer didn't provide it).
3. **Method 1 — Coupon match:** If `coupon_code_used.startsWith("SMS-")`, sets `smsAttributed = true`. Looks up `sms_sends` by `contact_id` + `flow = 'signup'`. `smsClickAt` is NOT set by this path — remains `null`.
4. **Method 2 — Click-window match (48h):** Normalizes `phone_number` to E.164. Searches `sms_events` for `event_type = 'sms_clicked'` AND matching phone AND `created_at >= 48h ago`. If found: `smsAttributed = true`, `smsSendId = clickEvent.sms_send_id`, `smsClickAt = clickEvent.created_at`.
5. If `smsAttributed = true`, updates `orders_raw`:
   ```
   sms_attributed = true
   sms_send_id    = smsSendId   (may be null for coupon method)
   sms_click_at   = smsClickAt  (null for coupon method, timestamp for click-window method)
   ```

---

## 4. Expected Write Path

**When a subscriber clicks a tracked SMS link:**

1. `sms-redirect` should insert `sms_events` exactly as it does today (this part is correct).
2. `sms-redirect` should update `customer_contacts.last_clicked_at = new Date().toISOString()` — a dedicated timestamp that does not affect frequency cap logic.
3. `sms-redirect` should NOT write to `customer_contacts.last_sms_sent_at`.

**When a Stripe checkout completes:**

1. Same flow as today — coupon method and click-window method both intact.
2. For coupon method: `sms_click_at` should ideally be populated. The most accurate value would be the `created_at` of the most recent `sms_clicked` event for the contact's phone, looked up the same way Method 2 does, but independently of strict 48h window. This is an improvement — not required for the minimal fix.
3. For click-window method: already sets `sms_click_at` correctly from `sms_events.created_at`.

---

## 5. Why `sms_v_click_to_purchase` Returns Zero Rows

The view definition (`20260414_sms_analytics_views.sql` line 146):

```sql
SELECT ...
FROM orders_raw o
LEFT JOIN sms_sends s ON s.id = o.sms_send_id
WHERE o.sms_attributed = true
ORDER BY o.order_date DESC;
```

The view returns zero rows if and only if no `orders_raw` rows have `sms_attributed = true`.

There are at least three reasons this could be true:

**Reason 1 — No Stripe checkouts included a phone number.**  
`stripe-webhook` only attempts Method 2 attribution if it can extract and normalize a phone from the checkout session. If customers checkout without entering a phone, `phone_number` is null, E.164 normalization produces an empty string, and the click lookup is skipped. There is no fallback to look up the contact by email or session.

**Reason 2 — Phone format mismatch between `sms_events.phone` and the Stripe-normalized E.164.**  
`sms-redirect` stores `msg.phone` (from `sms_messages.phone`) in `sms_events.phone` without normalizing it. `stripe-webhook` normalizes the checkout phone to E.164 (`+1XXXXXXXXXX`) and matches with `.eq("phone", e164Phone)`. If `sms_messages.phone` was stored in a different format (e.g., `+1 (555) 555-5555`, or `5555555555`, or missing the country code), the `sms_events` row exists but the lookup returns no match.

**Reason 3 — `sms_sends` lookup in `sms-redirect` failing silently.**  
`sms-redirect` finds the send with `.eq("sms_message_id", msg.id).maybeSingle()`. If the send record doesn't link `sms_message_id` correctly (e.g., for the 5 flows that bypass the `send-sms` wrapper — GAP-06), `send` is null and `sms_send_id = null` is written to `sms_events`. This doesn't prevent the click event row from being written, but it does prevent `sms_sends.flow` from populating in the view. More importantly, if `stripe-webhook`'s Method 2 finds a click event with `sms_send_id = null`, it still sets `sms_attributed = true` but `smsSendId` remains null. In that case, the view would return the attributed row — it just wouldn't show a flow. So this alone doesn't cause zero rows, but it's a data quality issue.

**The most likely root cause** is Reason 1 or Reason 2 — either no checkouts included phone numbers, or the phone format stored in `sms_messages` doesn't match E.164. This must be verified by running diagnostic SQL (see §9) before implementing any fix.

---

## 6. `last_sms_sent_at` Misuse

`customer_contacts.last_sms_sent_at` was added in `20260414_sms_phase2.sql` as a frequency-cap field. Its intended use is: record when the last SMS was sent to this contact, so flow logic can check "has it been at least N hours since the last send?" before triggering the next message.

`sms-redirect` writes this field on every click:

```typescript
sb.from("customer_contacts")
  .update({ last_sms_sent_at: new Date().toISOString() })
  .eq("phone", msg.phone)
```

**Side effects of this misuse:**

1. **Frequency cap pollution.** A contact who receives a send at T=0 and clicks at T=2h now shows `last_sms_sent_at = T+2h`. Any flow that checks "has it been 24h since last send?" now sees only 22h elapsed, not 24h. This can delay or suppress the next legitimate scheduled message such as a `coupon_reminder` step 2 or `abandoned_cart` step 2.

2. **Click timing is not stored anywhere useful for analytics.** There is no `last_clicked_at` field. The click time is only in `sms_events.created_at` (correct) and now also overwriting `last_sms_sent_at` (wrong). The view `sms_v_click_to_purchase` correctly reads `o.sms_click_at` from `orders_raw` — it does not read `customer_contacts.last_sms_sent_at` — so this miswrite doesn't explain the zero-row problem, but it corrupts future frequency cap behavior.

3. **False suppression during active recovery flows.** A contact in an active abandoned-cart 3-step sequence who clicks step 1's link will reset the timer and could cause step 2 to be suppressed or delayed, reducing recovery effectiveness.

---

## 7. Fix Options

### Option A — Fix `sms-redirect` to write `last_clicked_at` instead of `last_sms_sent_at`

**What it does:**  
Add `last_clicked_at TIMESTAMPTZ` to `customer_contacts`. Change the `sms-redirect` contact update to write `last_clicked_at` instead of `last_sms_sent_at`.

**Pros:**  
- `last_sms_sent_at` is no longer corrupted by clicks.  
- Click timestamp is available on `customer_contacts` for future use (e.g., win-back targeting by last click recency).  
- Small, surgical change — one migration + one line changed in one edge function.

**Cons:**  
- Doesn't fix the zero-row problem in `sms_v_click_to_purchase` on its own.  
- Requires a new migration.

---

### Option B — Investigate and fix the phone format mismatch in `sms_events`

**What it does:**  
Normalize `msg.phone` to E.164 in `sms-redirect` before writing it to `sms_events.phone`. This ensures the phone in `sms_events` matches what `stripe-webhook` looks for.

**Pros:**  
- If Reason 2 is the cause of zero rows, this fix alone would unblock `sms_attributed` being set on future orders, which causes the view to start returning rows.  
- Also ensures consistent phone format in `sms_events` for all future queries.

**Cons:**  
- Doesn't help if Reason 1 (no phone at checkout) is the dominant cause.  
- Doesn't retroactively fix any existing `sms_events` rows with bad phone format.  
- Would need to be verified as the actual root cause first via diagnostic queries.

---

### Option C — Update `sms_v_click_to_purchase` to fall back to `sms_events` directly

**What it does:**  
Rewrite the view to join through `sms_events` instead of (or in addition to) relying solely on `orders_raw.sms_attributed`. For example, join `orders_raw` to `sms_events` via phone number and 48h window directly.

**Pros:**  
- Could produce rows even if `orders_raw.sms_attributed` is never set.

**Cons:**  
- Much more complex join with potential row explosion.  
- Does not fix the underlying attribution problem or the `last_sms_sent_at` bug.  
- Bypasses the attribution logic that `stripe-webhook` already implements correctly.  
- Creates a second source of truth for attribution.  
- **Not recommended** — treating the symptom, not the cause.

---

### Option D — Transitional diagnostic pass before any code change

**What it does:**  
Run the diagnostic SQL queries from §9 to confirm exactly why `sms_attributed = true` has zero matches before writing any code. This is not a fix — it's a prerequisite step.

**Required before any option above is implemented.**

---

## 8. Recommended Fix

**Phase 1 — Diagnose first (no code change)**  
Run the diagnostic queries in §9 to confirm:
- How many `sms_events` rows with `event_type = 'sms_clicked'` exist.
- How many `orders_raw` rows have `sms_attributed = true`.
- Whether phone format mismatch between `sms_events.phone` and E.164 is present.

**Phase 2 — Fix `sms-redirect` click field write (smallest safe change)**  
Apply a migration that adds `last_clicked_at TIMESTAMPTZ` to `customer_contacts`. Update `sms-redirect` to write `last_clicked_at` and stop writing `last_sms_sent_at` on click.

Rationale: This is safe, unambiguous, and a prerequisite for reliable click timing regardless of the zero-row root cause. It also stops the active frequency-cap corruption happening on every click today.

**Phase 3 — Fix phone format in `sms-redirect` (only if diagnostic confirms Reason 2)**  
If diagnostic shows `sms_events.phone` is not consistently E.164, normalize `msg.phone` to E.164 in `sms-redirect` before inserting to `sms_events`. This unblocks `stripe-webhook` click-window attribution for future orders.

**Phase 4 — Verify attribution fires on the next real checkout**  
After Phase 2 and 3 are applied, trigger a test click + checkout to confirm `sms_attributed = true` appears in `orders_raw` and the view starts returning rows.

**Do not change `sms_v_click_to_purchase`, `stripe-webhook`, or any other view/function** unless diagnostic confirms a specific bug in them. Both the view definition and the stripe-webhook attribution logic appear structurally correct.

---

## 9. Test Plan

### Step 1 — Diagnostic queries (run before any code change)

```sql
-- How many click events exist?
SELECT COUNT(*) FROM sms_events WHERE event_type = 'sms_clicked';

-- Sample phone formats in sms_events click rows
SELECT phone, created_at FROM sms_events
WHERE event_type = 'sms_clicked'
ORDER BY created_at DESC LIMIT 20;

-- Are any orders SMS-attributed?
SELECT COUNT(*) FROM orders_raw WHERE sms_attributed = true;

-- Sample attributed orders (if any)
SELECT id, sms_attributed, sms_send_id, sms_click_at, phone_number
FROM orders_raw WHERE sms_attributed = true LIMIT 10;

-- Check last_sms_sent_at distribution — high values may indicate click pollution
SELECT
  COUNT(*) AS total_contacts,
  COUNT(last_sms_sent_at) AS with_timestamp,
  MAX(last_sms_sent_at) AS most_recent
FROM customer_contacts;
```

### Step 2 — After Phase 2 migration (add `last_clicked_at`)

Verify the column exists:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'customer_contacts' AND column_name = 'last_clicked_at';
```

### Step 3 — After `sms-redirect` deployment

Click a real tracked SMS link. Then confirm:

```sql
-- Click event was inserted correctly
SELECT event_type, phone, sms_send_id, created_at
FROM sms_events
WHERE event_type = 'sms_clicked'
ORDER BY created_at DESC LIMIT 1;

-- last_clicked_at was updated, last_sms_sent_at was NOT changed
SELECT phone, last_sms_sent_at, last_clicked_at
FROM customer_contacts
WHERE phone = '<phone of clicker>';
```

Verify that `last_clicked_at` updates and `last_sms_sent_at` does NOT change on click.

### Step 4 — After a real SMS-attributed checkout (end-to-end)

Complete a test checkout after clicking a tracked SMS link within 48h. Then confirm:

```sql
-- Order was attributed
SELECT id, sms_attributed, sms_send_id, sms_click_at, phone_number
FROM orders_raw
WHERE sms_attributed = true
ORDER BY created_at DESC LIMIT 5;

-- View now returns rows
SELECT * FROM sms_v_click_to_purchase LIMIT 10;

-- Click to purchase time is reasonable
SELECT flow, hours_click_to_purchase, attribution_method
FROM sms_v_click_to_purchase
ORDER BY order_date DESC LIMIT 10;
```

### Step 5 — Confirm frequency cap is no longer broken

Confirm that `last_sms_sent_at` on a contact who has clicked but not received a new send still reflects the last send time, not the click time.

---

## 10. Definition of Done

GAP-01 and GAP-02 are resolved when all of the following are true:

**GAP-02 resolved:**
- [ ] `customer_contacts.last_clicked_at TIMESTAMPTZ` column exists in production.
- [ ] `sms-redirect` writes `last_clicked_at` on click, as confirmed by SQL check after a real click.
- [ ] `sms-redirect` no longer writes `last_sms_sent_at` on click, confirmed by SQL check.
- [ ] `last_sms_sent_at` for a contact who clicks (without a new send) does not change.

**GAP-01 resolved:**
- [ ] Diagnostic SQL confirms root cause of zero attributed orders (Reason 1, 2, or other).
- [ ] Root cause is fixed (phone format normalization or another confirmed fix).
- [ ] At least one `orders_raw` row has `sms_attributed = true` after the fix.
- [ ] `SELECT COUNT(*) FROM sms_v_click_to_purchase` returns a non-zero count.
- [ ] `hours_click_to_purchase` is non-null for at least one row in the view.
- [ ] Admin dashboard click-timing section shows data (not "No data yet").
- [ ] OpenClaw daily report no longer warns that click-to-purchase data is unavailable.

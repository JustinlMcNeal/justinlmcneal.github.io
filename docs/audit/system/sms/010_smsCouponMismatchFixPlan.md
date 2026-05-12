# SMS Coupon Mismatch Fix Plan

Spec date: 2026-05-08  
Status: Investigation / planning — no code changed  
Related gap: GAP-04 from `001_smsKnownGaps.md`

---

## 1. Problem Summary

`sms_v_coupon_cohorts` shows `attributed_orders > 0` (i.e., `sms_sends.outcome = 'converted'` rows exist) alongside `redeemed = 0` (i.e., no matched promotion has `usage_count >= usage_limit`). These two counts are computed via entirely different join paths and measure different things, so they can diverge silently.

The most likely root cause is that `coupon-upgrade` creates a new escalation promotion but does **not** update `customer_contacts.coupon_code` to the upgrade code. As a result:

- `sms_v_coupon_cohorts` joins `promotions` through `customer_contacts.coupon_code`, which still holds the original signup code.
- When the customer redeems the upgrade coupon at checkout, `stripe-webhook` increments the upgrade promotion's `usage_count` — but the view is looking at the original coupon, whose `usage_count` was never touched.
- Simultaneously, `stripe-webhook`'s Method 1 attribution tries to find the contact by `.eq("coupon_code", coupon_code_used)` — which fails because `cc.coupon_code` is the old code, not the upgrade code — leaving `sms_send_id = null` and preventing `sms_sends.outcome` from being set to `'converted'`.

The result is that escalation-coupon orders can be attributed in `orders_raw` (`sms_attributed = true`) without the view ever seeing them as attributed or redeemed.

---

## 2. Files / Tables Involved

### Edge Functions

| File | Role |
|---|---|
| `supabase/functions/coupon-upgrade/index.ts` | Creates escalation promotion and `coupon_upgrades` row. Updates `customer_contacts` for re-subscription but does NOT update `cc.coupon_code` to the upgrade code. |
| `supabase/functions/stripe-webhook/index.ts` | Method 1 attribution: looks up `customer_contacts` by `.eq("coupon_code", coupon_code_used)`. Increments `promotions.usage_count` for `coupon_code_used`. Sets `sms_sends.outcome = 'converted'` if `sms_send_id` is non-null. |
| `supabase/functions/sms-subscribe/index.ts` | Creates initial signup promotion and sets `cc.coupon_code` to the new code at subscribe time. |
| `supabase/functions/create-checkout-session/index.ts` | Validates `promotions` row at checkout time (checks `usage_count`, `usage_limit`, date window) but does not modify attribution state. |

### Tables

| Table | Relevant fields | Notes |
|---|---|---|
| `customer_contacts` | `id`, `phone`, `coupon_code` | `coupon_code` is the primary lookup key for Method 1 attribution in `stripe-webhook`. Set at subscribe time; NOT updated by `coupon-upgrade`. |
| `promotions` | `id`, `code`, `usage_count`, `usage_limit`, `type`, `value` | One row per coupon code. `usage_count` incremented by `stripe-webhook` on checkout. |
| `coupon_upgrades` | `promo_id`, `phone`, `upgrade_code`, `upgrade_promo_id` | Tracks which phone received which upgrade. Not read by the attribution or analytics paths. |
| `sms_sends` | `id`, `contact_id`, `flow`, `outcome`, `converted_at` | `outcome` is set to `'converted'` only when `stripe-webhook` finds a non-null `sms_send_id`. Read by `sms_v_coupon_cohorts` to compute `sms_attributed_orders`. |
| `orders_raw` | `sms_attributed`, `sms_send_id`, `sms_click_at`, `coupon_code_used` | Written by `stripe-webhook`. `sms_send_id` may be null if contact lookup fails. |

### Views

| View | Relevant dependency |
|---|---|
| `sms_v_coupon_cohorts` | `supabase/migrations/20260414_sms_analytics_views.sql` line 67. Joins `sms_sends → customer_contacts → promotions` via `cc.coupon_code`. `redeemed` = `SUM(CASE WHEN usage_count >= usage_limit THEN 1 ELSE 0 END)`. `sms_attributed_orders` = `SUM(CASE WHEN outcome = 'converted' THEN 1 ELSE 0 END)`. |

### Migrations

| File | What it creates |
|---|---|
| `supabase/migrations/20260413_sms_tables.sql` | Creates `customer_contacts` with `coupon_code TEXT` field. Comment: "code given at signup (matches promotions.code)". |
| `supabase/migrations/20260414_sms_analytics_views.sql` | Defines `sms_v_coupon_cohorts`. Join at line 85: `LEFT JOIN promotions p ON p.code = cc.coupon_code`. |

---

## 3. Current Attribution Path

When a Stripe checkout completes (`checkout.session.completed`):

1. `stripe-webhook` checks if `coupon_code_used.startsWith("SMS-")` → Method 1 triggers.
2. Looks up contact: `SELECT id FROM customer_contacts WHERE coupon_code = coupon_code_used`.
3. If found, looks up send: `SELECT id FROM sms_sends WHERE contact_id = contact.id AND flow = 'signup' ORDER BY created_at DESC LIMIT 1`.
4. If send found: `smsSendId = send.id`.
5. Updates `orders_raw`: `sms_attributed = true, sms_send_id = smsSendId` (smsSendId may be null if step 2 or 3 failed).
6. If `smsSendId != null`: updates `sms_sends.outcome = 'converted'`.
7. Increments `promotions.usage_count` for `coupon_code_used` (separate step, unconditional on smsSendId).

**Gap in step 2:** For upgrade coupons, `cc.coupon_code` still holds the original signup code. `coupon_code_used` is the upgrade code. The `.eq("coupon_code", coupon_code_used)` lookup returns null. Steps 3–6 are skipped. `smsSendId = null`. The attribution flag is set but no `sms_sends` row is updated, so the view's `sms_attributed_orders` counter never increments.

---

## 4. Current Redemption Path

How `redeemed` is computed in `sms_v_coupon_cohorts`:

```sql
SUM(CASE WHEN usage_count >= usage_limit THEN 1 ELSE 0 END) AS redeemed
```

This joins through:

```sql
FROM sms_sends s
JOIN customer_contacts cc ON cc.id = s.contact_id
LEFT JOIN promotions p ON p.code = cc.coupon_code
WHERE s.flow IN ('signup', 'coupon_escalation')
```

So `redeemed` reflects the state of the promotion currently linked to `cc.coupon_code` for each send. Since `coupon-upgrade` does not update `cc.coupon_code`, the joined promotion for any escalation-path customer is always the original signup coupon, whose `usage_count` was never incremented (the customer used the upgrade code, not the signup code).

**Gap:** `promotions.usage_count` was incremented for the upgrade code by `stripe-webhook`, but the view never reads that promotion. The upgrade code has no path into the view at all.

---

## 5. Why the Numbers Can Diverge

### Cause 1 — `coupon-upgrade` does not update `cc.coupon_code` (most likely root cause)

`supabase/functions/coupon-upgrade/index.ts` creates `promotions` row and `coupon_upgrades` row but does not set `cc.coupon_code = upgradeCode`. The attribution lookup in `stripe-webhook` searches by `cc.coupon_code`, which remains the old code. Both the view's `redeemed` counter and `sms_attributed_orders` counter fail to register the redemption.

### Cause 2 — `usage_limit = NULL` on a promotion row

The view's `CASE WHEN usage_count >= usage_limit` evaluates to `NULL` if `usage_limit IS NULL`. Postgres coerces `NULL` to the `ELSE 0` branch, so the coupon is never counted as redeemed regardless of `usage_count`. If any coupon row was inserted without explicitly setting `usage_limit`, it would never appear as redeemed in the view.

### Cause 3 — `usage_limit = 0` treated as unlimited but view counts it as immediately redeemed

`create-checkout-session` treats `usage_limit = 0` as unlimited (allows any `usage_count`). The view computes `0 >= 0 = TRUE` at creation time, so every send whose contact has a promotion with `usage_limit = 0` is counted as redeemed before any checkout occurs. This would inflate `redeemed` rather than suppress it, but still creates a mismatch.

### Cause 4 — `sms_ends` flow lookup uses `flow = 'signup'` only

Method 1 in `stripe-webhook` looks for `sms_sends WHERE contact_id = ? AND flow = 'signup'`. For coupon_escalation sends (flow = 'coupon_escalation'), the lookup retrieves the signup send, not the escalation send. This means the escalation send's `outcome` is never set to 'converted', and for the view's `coupon_escalation` cohort, `sms_attributed_orders` stays at 0 even when the escalation coupon was the code used.

### Cause 5 — Orders attributed via Method 2 (click-window) with no SMS coupon

If a customer clicks a link and buys without using a coupon, Method 2 attributes the order (`sms_attributed = true`, `sms_send_id` set from click event). The `sms_sends.outcome` gets set to 'converted'. But `cc.coupon_code` may never have been redeemed. The view would count this as `sms_attributed_orders = 1`, `redeemed = 0`. This is correct behavior — not a bug — but it is the expected structural mismatch when click-window attribution exists.

---

## 6. Diagnostic Queries

Run these before implementing any fix to confirm which cause(s) are active.

```sql
-- How many signup/escalation sends exist vs outcomes
SELECT flow, outcome, COUNT(*)
FROM sms_sends
WHERE flow IN ('signup', 'coupon_escalation')
GROUP BY flow, outcome
ORDER BY flow, outcome;

-- How many contacts have a coupon_code that does NOT match any promotions row
SELECT COUNT(*)
FROM customer_contacts cc
LEFT JOIN promotions p ON p.code = cc.coupon_code
WHERE cc.coupon_code IS NOT NULL AND p.id IS NULL;

-- How many upgrade promotions exist that are NOT referenced by any cc.coupon_code
SELECT p.code, p.usage_count, p.usage_limit
FROM coupon_upgrades cu
JOIN promotions p ON p.id = cu.upgrade_promo_id
LEFT JOIN customer_contacts cc ON cc.coupon_code = p.code
WHERE cc.id IS NULL
LIMIT 20;

-- Promotions with NULL or 0 usage_limit
SELECT code, usage_count, usage_limit
FROM promotions
WHERE code LIKE 'SMS-%'
  AND (usage_limit IS NULL OR usage_limit = 0)
LIMIT 20;

-- Orders attributed via SMS coupon but sms_send_id is null
SELECT id, coupon_code_used, sms_attributed, sms_send_id, sms_click_at
FROM orders_raw
WHERE sms_attributed = true
  AND coupon_code_used LIKE 'SMS-%'
  AND sms_send_id IS NULL
LIMIT 20;

-- Current view output — redeemed vs attributed
SELECT cohort, total_coupons_issued, redeemed, redemption_rate_pct,
       sms_attributed_orders, avg_order_value
FROM sms_v_coupon_cohorts;

-- Check if any attributed orders used an upgrade code (not in cc.coupon_code)
SELECT o.coupon_code_used, COUNT(*) AS order_count,
       COUNT(cc.id) AS contacts_with_that_code
FROM orders_raw o
LEFT JOIN customer_contacts cc ON cc.coupon_code = o.coupon_code_used
WHERE o.sms_attributed = true
  AND o.coupon_code_used LIKE 'SMS-%'
GROUP BY o.coupon_code_used
ORDER BY order_count DESC;
```

---

## 7. Fix Options

### Option A — Update `coupon-upgrade` to write `cc.coupon_code = upgradeCode`

**What it does:**  
After creating the upgrade promotion, `coupon-upgrade` updates `customer_contacts.coupon_code` to the upgrade code for that phone. Future `stripe-webhook` Method 1 lookups will find the contact by the upgrade code. The view's redemption join will follow the upgrade promotion, which does get incremented.

**Pros:**  
- Fixes both the attribution lookup and the view's redemption count in one change.  
- Minimal surface area — one additional field in one `customer_contacts` update that already exists in the function.  
- Consistent with the comment in the migration: `coupon_code` is "code given at signup (matches promotions.code)" — after an upgrade it should hold the active code, not the expired one.

**Cons:**  
- Does not retroactively fix historical attributed orders where `sms_send_id = null` due to the old lookup path.  
- If diagnostic confirms Cause 2 or 3 (NULL/0 usage_limit), a separate fix for those promotion rows is still needed.

---

### Option B — Add `coupon_upgrades` lookup to `stripe-webhook` Method 1

**What it does:**  
When Method 1 contact lookup returns null, fall back to `coupon_upgrades WHERE upgrade_code = coupon_code_used` to find the original contact, then proceed with the existing send lookup.

**Pros:**  
- Does not require changing the `coupon-upgrade` function.  
- Also handles any already-issued upgrade coupons retroactively for future checkouts.

**Cons:**  
- Changes `stripe-webhook`, which is a higher-risk function (processes payment events).  
- Two-hop lookup (coupon_upgrades → customer_contacts) adds latency to checkout webhook.  
- The view's redemption counter still doesn't see the upgrade promotion because the join is on `cc.coupon_code` (original code). So `redeemed` in the view remains 0 even after this fix.  
- Option B fixes the attribution path but not the redemption count. Option A fixes both.

---

### Option C — Rewrite `sms_v_coupon_cohorts` to join via `coupon_upgrades`

**What it does:**  
Modify the view to also look up promotions via `coupon_upgrades.upgrade_promo_id` for the `coupon_escalation` cohort.

**Pros:**  
- No changes to edge functions.

**Cons:**  
- Significantly more complex view that is harder to reason about.  
- Does not fix the attribution lookup in `stripe-webhook` — `sms_send_id` remains null and `sms_attributed_orders` stays wrong.  
- Treats the symptom without fixing the root cause.  
- **Not recommended.**

---

## 8. Recommended Fix

**Phase 1 — Diagnose first (no code change)**  
Run the queries in §6 to confirm:
- Whether upgrade coupons are the active cause (look for orders attributed with upgrade codes that have no matching `cc.coupon_code`).
- Whether NULL/0 `usage_limit` promotions exist.
- The current view output.

**Phase 2 — Fix `coupon-upgrade` to write `cc.coupon_code` (if Cause 1 confirmed)**  
In `supabase/functions/coupon-upgrade/index.ts`, add `coupon_code: upgradeCode` to the existing `customer_contacts.update()` call that already fires for active contacts. This is a one-field addition to a block that already exists.

Rationale: Smallest safe change. Fixes both the attribution lookup and the view's redemption count. Does not touch `stripe-webhook` or `sms_v_coupon_cohorts`. Does not require a migration.

**Phase 3 — Fix NULL/0 usage_limit promotions (if Cause 2/3 confirmed)**  
If diagnostic shows any `SMS-` promotions with `usage_limit IS NULL` or `usage_limit = 0`, update them to `usage_limit = 1` via a targeted SQL migration. Each SMS personal coupon is single-use by design.

**Do not touch `stripe-webhook`, `sms_v_coupon_cohorts`, or `orders_raw`** unless diagnostic confirms a specific bug requiring it.

---

## 9. Test Plan

### Step 1 — Diagnostic queries (before any code change)

Run all queries from §6. Document the results. Confirm which cause(s) are active.

### Step 2 — After Phase 2 (`coupon-upgrade` patched)

Trigger a test coupon upgrade via a test phone. Verify:

```sql
-- cc.coupon_code should now hold the upgrade code
SELECT phone, coupon_code FROM customer_contacts WHERE phone = '<test_phone>';

-- coupon_upgrades row should exist
SELECT * FROM coupon_upgrades WHERE phone = '<test_phone>' ORDER BY created_at DESC LIMIT 1;

-- both the original and upgrade promotions should exist
SELECT code, usage_count, usage_limit FROM promotions
WHERE code IN ('<original_code>', '<upgrade_code>');
```

### Step 3 — After a test checkout using the upgrade code

Complete a test checkout using the upgrade code. Then verify:

```sql
-- Order row: sms_attributed true, sms_send_id non-null
SELECT sms_attributed, sms_send_id, sms_click_at, coupon_code_used
FROM orders_raw ORDER BY created_at DESC LIMIT 1;

-- sms_sends row: outcome = 'converted'
SELECT flow, outcome, converted_at FROM sms_sends
WHERE id = '<sms_send_id from above>';

-- upgrade promotion: usage_count incremented
SELECT code, usage_count, usage_limit FROM promotions
WHERE code = '<upgrade_code>';

-- View: redeemed and sms_attributed_orders now > 0 for escalation cohort
SELECT cohort, redeemed, redemption_rate_pct, sms_attributed_orders
FROM sms_v_coupon_cohorts;
```

### Step 4 — Confirm original coupon untouched

After the checkout, verify the original signup promotion was NOT incremented (the customer used the upgrade, not the original):

```sql
SELECT code, usage_count FROM promotions WHERE code = '<original_signup_code>';
-- usage_count should still be 0
```

---

## 10. Definition of Done

GAP-04 is resolved when all of the following are true:

**Diagnosis:**
- [ ] Root cause(s) confirmed via diagnostic SQL from §6.

**If Cause 1 (upgrade code mismatch) is confirmed:**
- [ ] `coupon-upgrade` writes `coupon_code = upgradeCode` to `customer_contacts`.
- [ ] After a test upgrade + checkout: `orders_raw.sms_send_id` is non-null for the checkout order.
- [ ] After a test upgrade + checkout: `sms_sends.outcome = 'converted'` for the matched send row.
- [ ] After a test upgrade + checkout: `promotions.usage_count = 1` for the upgrade code.
- [ ] `sms_v_coupon_cohorts` `redeemed` and `sms_attributed_orders` both increment on the next report run that includes this order.

**If Cause 2/3 (NULL/0 usage_limit) is confirmed:**
- [ ] All SMS personal coupons have `usage_limit = 1`.
- [ ] `redeemed` count in `sms_v_coupon_cohorts` no longer includes unredeemed coupons.

**Overall:**
- [ ] `redemption_rate_pct` in `sms_v_coupon_cohorts` reflects actual checkout redemptions, not stale or incorrectly joined promotion data.
- [ ] OpenClaw daily report Section 6 no longer flags an attributed_orders/redeemed mismatch.
- [ ] `sms_attributed_orders` and `redeemed` counts are within 1–2 of each other for the escalation cohort (small divergence from click-window attributed orders is expected and acceptable — see Cause 5).

# SMS Coupon Backfill Plan

Spec date: 2026-05-08  
Status: Planning only — no data changed  
Related gap: GAP-04 from `001_smsKnownGaps.md`  
Related investigation: `010_smsCouponMismatchFixPlan.md`

---

## 1. Problem Summary

Three attributed initial-signup SMS coupon orders were processed before the `promotions.usage_count` increment logic was added to `supabase/functions/stripe-webhook/index.ts`. Stripe fires webhook events at checkout time and does not replay them when a function is redeployed. As a result, the increment block never ran for these three orders.

Each of the three promotion rows has:
- `usage_count = 0` — never incremented
- `usage_limit = 1` — correct single-use limit
- A corresponding `orders_raw` row with `sms_attributed = true` and a non-null `sms_send_id` — confirming the checkout actually occurred

Because `usage_count < usage_limit` on all three rows, the `sms_v_coupon_cohorts` view computes `redeemed = 0` for the entire `initial_15pct` cohort, making the redemption rate appear to be 0% even though these 3 customers purchased. This is a historical data gap — not an ongoing code defect for new orders.

---

## 2. Scope

This is a one-time historical data repair. It corrects 3 specific `promotions` rows whose counter was never incremented due to missing webhook logic at order time (April 18–20, 2026).

This backfill does NOT:
- Change any edge function code
- Affect any future orders (the increment now runs for all new checkouts)
- Modify `orders_raw`, `sms_sends`, `customer_contacts`, or any view
- Touch any promotion row beyond the 3 specific codes confirmed by diagnostic

---

## 3. Exact Rows to Repair

Identified by cross-joining `orders_raw` (sms_attributed + SMS- coupon) with `customer_contacts` (by coupon_code) and then to `promotions`:

| Promotion code | Order date | usage_count | usage_limit | Order session |
|---|---|---|---|---|
| `SMS-QCASZ3` | 2026-04-18 00:42 UTC | 0 | 1 | `cs_live_b12m3hg4f...` |
| `SMS-DBXXFF` | 2026-04-18 01:32 UTC | 0 | 1 | `cs_live_b1KF90iKX...` |
| `SMS-UDX32V` | 2026-04-20 03:29 UTC | 0 | 1 | `cs_live_b1VmLrC0S...` |

These are the only 3 rows returned by the full diagnostic cross-join. No other SMS- attributed promotion rows have `usage_count < usage_limit`.

---

## 4. Safe Backfill SQL

### Step 1 — Preview before touching anything

Run this first and confirm the output exactly matches the 3 rows above before proceeding:

```sql
SELECT
  p.code,
  p.usage_count,
  p.usage_limit,
  p.is_active,
  o.coupon_code_used,
  o.created_at AS order_date,
  o.sms_attributed
FROM orders_raw o
JOIN customer_contacts cc ON cc.coupon_code = o.coupon_code_used
JOIN promotions p ON p.code = cc.coupon_code
WHERE o.sms_attributed = true
  AND o.coupon_code_used LIKE 'SMS-%'
  AND p.usage_count = 0
  AND p.usage_limit = 1
ORDER BY o.created_at;
```

Expected: exactly 3 rows, codes `SMS-QCASZ3`, `SMS-DBXXFF`, `SMS-UDX32V`.

**Do not proceed if the preview returns anything other than these 3 rows.**

---

### Step 2 — Backfill update

Only run this after the preview in Step 1 confirms exactly the 3 expected rows:

```sql
UPDATE promotions
SET
  usage_count = 1,
  updated_at  = NOW()
WHERE code IN ('SMS-QCASZ3', 'SMS-DBXXFF', 'SMS-UDX32V')
  AND usage_count = 0
  AND usage_limit = 1;
```

**Why this is safe:**
- `WHERE usage_count = 0` — idempotent: if re-run after already applied, the condition will not match and no rows will be touched.
- `WHERE usage_limit = 1` — secondary guard: ensures we only affect single-use coupons.
- `IN ('SMS-QCASZ3', ...)` — hard-coded to the 3 specific codes confirmed by diagnostic, not a wildcard.
- Does not touch any other table.

---

## 5. Validation Queries

Run these immediately after the update to confirm the repair succeeded and nothing else changed.

### 5a — Confirm usage_count incremented on the 3 rows

```sql
SELECT code, usage_count, usage_limit, updated_at
FROM promotions
WHERE code IN ('SMS-QCASZ3', 'SMS-DBXXFF', 'SMS-UDX32V');
```

Expected: `usage_count = 1` for all 3, `usage_limit = 1`, `updated_at` ≈ NOW().

---

### 5b — Confirm sms_v_coupon_cohorts now shows redeemed > 0

```sql
SELECT cohort, total_coupons_issued, redeemed, redemption_rate_pct,
       sms_attributed_orders, avg_order_value
FROM sms_v_coupon_cohorts;
```

Expected before:
```
initial_15pct    | 46 | 0 | 0.00 | 3 | 33.28
escalation_20pct |  1 | 0 | 0.00 | 0 | NULL
```

Expected after:
```
initial_15pct    | 46 | 3 | 6.52 | 3 | 33.28
escalation_20pct |  1 | 0 | 0.00 | 0 | NULL
```

`redeemed` should be 3 (all 3 now have `usage_count >= usage_limit`).  
`redemption_rate_pct` should be `3/46 * 100 = 6.52`.  
`sms_attributed_orders` should remain 3 (unchanged).  
`escalation_20pct` row should be unchanged.

---

### 5c — Confirm no other promotion rows were unintentionally modified

```sql
SELECT COUNT(*) AS rows_with_usage_count_changed
FROM promotions
WHERE usage_count > 0
  AND code LIKE 'SMS-%'
  AND updated_at >= NOW() - INTERVAL '5 minutes';
```

Expected: exactly 3. If more than 3, investigate before accepting.

---

### 5d — Confirm orders_raw and sms_sends are untouched

```sql
SELECT sms_attributed, sms_send_id, coupon_code_used, updated_at
FROM orders_raw
WHERE coupon_code_used IN ('SMS-QCASZ3', 'SMS-DBXXFF', 'SMS-UDX32V');
```

Expected: `sms_attributed = true`, `sms_send_id` non-null, `updated_at` unchanged from before the backfill (these rows were not touched).

---

## 6. Risks

### Risk 1 — Backfill applied twice

**Mitigated.** The `WHERE usage_count = 0` guard makes the update idempotent. After the first run sets `usage_count = 1`, the condition no longer matches and a second run touches nothing.

### Risk 2 — Wrong promotion rows selected

**Mitigated.** The update targets specific hard-coded codes (`SMS-QCASZ3`, `SMS-DBXXFF`, `SMS-UDX32V`), not a pattern. The preview query in Step 1 must return exactly 3 rows before the update is allowed to run.

### Risk 3 — Customer re-uses a coupon that appears still available

**Not a risk for expired codes.** All 3 promotions have `end_date` in April 2026. `create-checkout-session` validates `end_date` at session creation; it will reject these codes as date-expired regardless of `usage_count`. Even if a customer somehow submitted the code: `usage_count = 1 >= usage_limit = 1` would cause the validation check `usageCount >= usageLimit` to return an error, blocking the checkout.

### Risk 4 — Affects Stripe or downstream payment state

**Not a risk.** The `promotions` table is internal to this application. Stripe does not read it. Changing `usage_count` has no effect on any Stripe object, charge, or ledger entry.

### Risk 5 — View output changes unexpectedly

**Expected and desired.** The view's `redeemed` column will go from 0 to 3 and `redemption_rate_pct` will change from `0.00` to `6.52`. This is the intended outcome. `sms_attributed_orders` and `avg_order_value` should not change.

---

## 7. Definition of Done

The backfill is complete when all of the following are true:

- [ ] Preview query (§4 Step 1) returned exactly 3 rows before the update was run.
- [ ] Update query (§4 Step 2) reported `3 rows affected`.
- [ ] Validation §5a: `usage_count = 1` for all 3 codes.
- [ ] Validation §5b: `redeemed = 3`, `redemption_rate_pct ≈ 6.52` for `initial_15pct` cohort.
- [ ] Validation §5c: exactly 3 `SMS-` promotions updated in the last 5 minutes.
- [ ] Validation §5d: `orders_raw` rows for these codes are unchanged.
- [ ] OpenClaw next daily report Section 6 no longer shows `redeemed = 0` for `initial_15pct`.

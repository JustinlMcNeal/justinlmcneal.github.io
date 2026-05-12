# SMS VIP Upgrade Attribution Fix Plan

**Date created:** 2026-05-08  
**Status:** planning — no code changes applied yet  
**Scope:** `coupon-upgrade` edge function, `stripe-webhook` edge function, `sms_v_coupon_cohorts` view  
**Risk level:** medium — `stripe-webhook` is the highest-sensitivity function in the codebase; view change requires migration

---

## 1. Background

When a customer signs up for SMS at a live event (via business card / QR code), they receive a 15% coupon with code prefix `SMS-`. If the customer then agrees to accept marketing messages, `coupon-upgrade` fires and generates a separate `VIP-XXXXXX` upgrade coupon worth 20%. This replaces the initial offer.

The VIP upgrade path has **three structural attribution gaps** discovered during the GAP-04 investigation in May 2026. None of these gaps have caused missed revenue — orders are still captured in Stripe and `orders_raw`. The problem is purely in the analytics layer: the system cannot confirm whether VIP coupon orders are attributable to SMS, and the `sms_v_coupon_cohorts` view has no visibility into VIP upgrade sends at all.

**These gaps will produce false zeros** in the analytics report the next time a VIP upgrade coupon is redeemed.

---

## 2. How `coupon-upgrade` Currently Works

**File:** `supabase/functions/coupon-upgrade/index.ts`

1. Validates input (phone, `base_promo_code`, consent fields)
2. Looks up `base_promo_code` in `promotions` to get `coupon_upgrade_prefix` (e.g. `"VIP"`) and `upgrade_value`
3. Checks `coupon_upgrades` for a duplicate — if one exists, re-sends without creating a new code
4. Generates `upgradeCode = "VIP-XXXXXX"` (6-char alphanumeric)
5. Inserts a new row into `promotions` (`code = upgradeCode`, `usage_limit = 1`, `usage_count = 0`)
6. Inserts a row into `coupon_upgrades` (`promo_id`, `phone`, `upgrade_code`, `upgrade_promo_id`)
7. Upserts `customer_contacts`:
   - **Existing contact path** (~line 212): `UPDATE customer_contacts SET status, sms_consent, opted_in_at, opted_out_at, last_sms_sent_at` — **does NOT include `coupon_code`**
   - **New contact path** (~line 228): `INSERT customer_contacts (..., coupon_code: upgradeCode, ...)` — correctly sets `coupon_code`
8. Logs `sms_consent_logs`
9. Sends via Twilio directly (NOT the `send-sms` wrapper)
10. Logs `sms_messages` with `campaign = "coupon_upgrade"`
11. Logs `sms_sends` with `flow = "upgrade"`, `outcome = "pending"`

---

## 3. The Three Gaps

### Gap A — `customer_contacts.coupon_code` not updated for existing contacts

**Location:** `coupon-upgrade/index.ts` — the `if (contact)` branch, `update()` call (~line 212)

**Problem:** The `update()` call sets `status`, `sms_consent`, `opted_in_at`, `opted_out_at`, `last_sms_sent_at` but omits `coupon_code: upgradeCode`. This means for any customer who signed up for SMS before the upgrade offer (the common case at live events), `customer_contacts.coupon_code` stays as the original `SMS-XXXXXX` code.

**Downstream consequence:**
- `sms_v_coupon_cohorts` joins `sms_sends → customer_contacts → promotions` via `cc.coupon_code`. The view picks up the original `SMS-` code, not the `VIP-` upgrade code. The upgrade coupon's `usage_count` is never connected to the cohort row.
- If the customer redeems the `VIP-` code, `promotions.usage_count` increments for the `VIP-` promotion row, but the view still shows the `SMS-` promotion's `usage_count` for this send. Since the customer used the VIP code (not the SMS code), the SMS code's `usage_count` stays at 0 — `redeemed = 0` for this send.

**Only the new-contact path works correctly.** If a customer has no prior `customer_contacts` row, the insert correctly sets `coupon_code: upgradeCode` and the view will track the upgrade promo.

---

### Gap B — `sms_sends.flow = 'upgrade'` is excluded from `sms_v_coupon_cohorts`

**Location:** `supabase/migrations/20260414_sms_analytics_views.sql` line 86

**Problem:** The view filters `WHERE s.flow IN ('signup', 'coupon_escalation')`. The `upgrade` flow value is not in this list. Every VIP upgrade send is invisible to the view — it contributes no row to `coupon_data`, so there is no `VIP upgrade` cohort row in the report at all.

**Current view cohort mapping:**
```sql
CASE
  WHEN s.flow = 'coupon_escalation' THEN 'escalation_20pct'
  ELSE 'initial_15pct'
END AS cohort
```
No case handles `'upgrade'`. Even if Gap A were fixed, the `upgrade` sends would still be filtered out of the view.

**Downstream consequence:** Upgrade coupon performance (send count, redemption rate, attributed orders, AOV, ROI) is entirely absent from analytics. There is no `vip_upgrade` cohort row in the report.

---

### Gap C — `stripe-webhook` Method 1 attribution never fires for `VIP-` codes

**Location:** `supabase/functions/stripe-webhook/index.ts` lines 545, 638

**Problem:** Method 1 attribution (`coupon` method) triggers only when `coupon_code_used.startsWith("SMS-")`. The `VIP-` prefix does not match. Methods 1 and 2 converge at the `sms_sends` insert, but since Method 1 skips these orders entirely, `sms_send_id` is only set on `orders_raw` if Method 2 fires (48h click window).

**Current code lines 545, 638 (stripe-webhook/index.ts):**
```typescript
// Line 545
if (coupon_code_used && coupon_code_used.startsWith("SMS-")) {
// Line 638
if (coupon_code_used?.startsWith("SMS-")) {
```

**Downstream consequence:**
- `orders_raw.sms_send_id` is null for any VIP upgrade order where the customer did not click an SMS link within 48h
- `sms_sends.outcome` is never set to `"converted"` for the upgrade send
- `sms_v_coupon_cohorts.sms_attributed_orders` stays at 0 for all upgrade cohort rows (once that cohort is visible — see Gap B)

**Method 2 can partially save this:** If the customer clicked an SMS link within 48h of checkout, Method 2 will fire and set `sms_send_id`. However, Method 2 attributes to the most recent relevant `sms_send`, which may be the `signup` or `coupon_escalation` send rather than the `upgrade` send. This means the wrong `sms_sends` row gets `outcome = 'converted'`.

---

## 4. Proposed Fixes

### Fix 1 — Add `coupon_code` to the existing-contact `update()` in `coupon-upgrade`

**File:** `supabase/functions/coupon-upgrade/index.ts`  
**Change:** Add `coupon_code: upgradeCode` to the `update()` call in the `if (contact)` branch.

```typescript
// CURRENT (~line 212):
.update({
  status:           "active",
  sms_consent:      true,
  opted_in_at:      now.toISOString(),
  opted_out_at:     null,
  last_sms_sent_at: now.toISOString(),
})

// PROPOSED:
.update({
  status:           "active",
  sms_consent:      true,
  opted_in_at:      now.toISOString(),
  opted_out_at:     null,
  last_sms_sent_at: now.toISOString(),
  coupon_code:      upgradeCode,   // ← ADD THIS
})
```

**Impact:** After this change, `customer_contacts.coupon_code` for existing contacts will be updated to the `VIP-` code on upgrade. The view join `promotions p ON p.code = cc.coupon_code` will connect to the correct upgrade promotion row.

**Risk:** Low. This column is already set on the new-contact path. Only affects new upgrade events (no backfill needed for this change — VIP-ZBWZ85 was the only historical upgrade and it was not redeemed).

**Note on VIP-ZBWZ85 (existing data):** The one existing VIP upgrade (`VIP-ZBWZ85`, phone ending −9254) was issued to a contact whose `cc.coupon_code` still holds the original `SMS-` code. That specific row may need a one-time manual update if attribution matters for that send. Check at implementation time.

---

### Fix 2 — Add `upgrade` flow to `sms_v_coupon_cohorts` and add `vip_upgrade` cohort

**File:** `supabase/migrations/20260414_sms_analytics_views.sql` (recreate via new migration)  
**Migration approach:** New file, e.g. `20260513_sms_coupon_cohorts_add_upgrade.sql` — use `CREATE OR REPLACE VIEW`

**Change:** Update the `CASE` expression and the `WHERE` filter:

```sql
-- CURRENT WHERE clause (line 86):
WHERE s.flow IN ('signup', 'coupon_escalation')

-- PROPOSED:
WHERE s.flow IN ('signup', 'coupon_escalation', 'upgrade')
```

```sql
-- CURRENT CASE expression (lines 73-76):
CASE
  WHEN s.flow = 'coupon_escalation' THEN 'escalation_20pct'
  ELSE 'initial_15pct'
END AS cohort

-- PROPOSED:
CASE
  WHEN s.flow = 'coupon_escalation' THEN 'escalation_20pct'
  WHEN s.flow = 'upgrade'           THEN 'vip_upgrade'
  ELSE 'initial_15pct'
END AS cohort
```

**Impact:** The `sms_v_coupon_cohorts` view will now include a `vip_upgrade` cohort row showing send count, redemption rate, attributed orders, and ROI for all VIP upgrade sends. The daily report will surface this cohort automatically (Section 6 reads the view directly).

**Risk:** Low. `CREATE OR REPLACE VIEW` is non-destructive. Existing cohort rows (`initial_15pct`, `escalation_20pct`) are unchanged. The `vip_upgrade` cohort appears as a new row.

**Apply via:**
```bash
npx supabase db query --linked -f supabase/migrations/20260513_sms_coupon_cohorts_add_upgrade.sql
```
(Never use `db push` — use `db query --linked -f` per codebase convention.)

---

### Fix 3 — Add `VIP-` prefix support to `stripe-webhook` Method 1

**File:** `supabase/functions/stripe-webhook/index.ts`  
**Lines affected:** 545, 638 (and nearby ternary on 625, 651)

**⚠️ High-risk function — treat with extra care. Validate exact line content before editing.**

**Problem:** Method 1 currently ignores all `VIP-` codes. To attribute VIP upgrade orders, the `startsWith("SMS-")` guard must be broadened.

**Option A — Direct prefix extension (simplest, least surgery):**

```typescript
// Helper to add near top of file:
function isSmsIssuedCoupon(code: string | null | undefined): boolean {
  if (!code) return false;
  return code.startsWith("SMS-") || code.startsWith("VIP-");
}
```

Replace all three `startsWith("SMS-")` occurrences with `isSmsIssuedCoupon(coupon_code_used)`. This is the minimum change.

**Option B — `coupon_upgrades` bridge lookup (more robust, more surgery):**

After verifying `coupon_code_used.startsWith("VIP-")`, query `coupon_upgrades WHERE upgrade_code = coupon_code_used` to retrieve the originating `phone`. Then look up `sms_sends` by phone to get the `upgrade` flow send ID. This ensures the upgrade send row — not the original signup send row — gets `outcome = 'converted'`.

Option B is more accurate but adds a DB query to the critical Stripe webhook path. **Recommend Option A for the initial fix** and Option B as a follow-on if attribution accuracy for the upgrade send specifically becomes a reporting requirement.

**Risk:** High (highest-risk function). Changes to `stripe-webhook` must be deployed and tested against a real payment event or a known-safe test coupon. Review full function state before deploying.

**Deploy command (after changes):**
```bash
echo y | npx supabase functions deploy stripe-webhook --project-ref yxdzvzscufkvewecvagq
```

---

## 5. Implementation Order

Run the fixes in this order to minimize risk:

| Step | Fix | Risk | Reversible? | Prerequisite |
|------|-----|------|-------------|--------------|
| 1 | Fix `coupon-upgrade` existing-contact `update()` (add `coupon_code`) | Low | Yes — redeploy old version | None |
| 2 | Add `upgrade` flow + `vip_upgrade` cohort to view | Low | Yes — `CREATE OR REPLACE` again | None |
| 3 | Extend `stripe-webhook` Method 1 for VIP- prefix | Medium-High | Yes — redeploy old version | Steps 1 and 2 complete, test plan ready |

Steps 1 and 2 are independent and can be done in either order. Do not do Step 3 without first validating that the `coupon-upgrade` function correctly populates `cc.coupon_code` (Step 1).

---

## 6. Pre-Implementation Checks

Before writing any code, confirm these facts are still accurate:

```sql
-- 1. Confirm VIP-ZBWZ85 is the only existing upgrade code in coupon_upgrades
SELECT cu.upgrade_code, cu.phone, cc.coupon_code AS cc_current_code
FROM coupon_upgrades cu
LEFT JOIN customer_contacts cc ON cc.phone = cu.phone;

-- 2. Confirm VIP-ZBWZ85 promotion row state
SELECT code, usage_count, usage_limit FROM promotions WHERE code LIKE 'VIP-%';

-- 3. Confirm sms_sends row for the upgrade send
SELECT id, flow, outcome, contact_id FROM sms_sends WHERE flow = 'upgrade';

-- 4. Confirm current view filter (should show no vip_upgrade cohort)
SELECT cohort, total_coupons_issued, redeemed, sms_attributed_orders
FROM sms_v_coupon_cohorts
ORDER BY cohort;

-- 5. Confirm stripe-webhook startsWith guard (read source before editing)
-- Manual file read only — no SQL
```

---

## 7. Testing Plan

### After Fix 1 (coupon-upgrade `coupon_code` update):
- Create a test contact in `customer_contacts` with a known phone and `coupon_code = 'SMS-TEST01'`
- POST to `coupon-upgrade` with that phone and `base_promo_code = 'SMS-TEST01'`
- Verify `customer_contacts.coupon_code` changed from `SMS-TEST01` to the new `VIP-` code
- Verify `coupon_upgrades` row inserted
- Verify `promotions` row inserted with the new VIP code
- Verify `sms_sends` row inserted with `flow = 'upgrade'`
- Clean up test data

### After Fix 2 (view update):
```sql
-- Should return a row with cohort = 'vip_upgrade'
SELECT cohort, total_coupons_issued FROM sms_v_coupon_cohorts WHERE cohort = 'vip_upgrade';
```

### After Fix 3 (stripe-webhook):
- Use a Stripe test mode checkout with a `VIP-` coupon code
- Verify `orders_raw.sms_send_id` is non-null
- Verify `sms_sends.outcome = 'converted'` for the upgrade send
- Verify `promotions.usage_count = 1` for the VIP promo row

---

## 8. Files to Change Summary

| File | Change | New Migration? |
|------|--------|----------------|
| `supabase/functions/coupon-upgrade/index.ts` | Add `coupon_code: upgradeCode` to existing-contact `update()` | No |
| `supabase/migrations/20260513_sms_coupon_cohorts_add_upgrade.sql` | New file: `CREATE OR REPLACE VIEW sms_v_coupon_cohorts` with `upgrade` in filter and `vip_upgrade` cohort | Yes — new file, apply with `db query --linked -f` |
| `supabase/functions/stripe-webhook/index.ts` | Extend `startsWith("SMS-")` guards to also match `VIP-` (or add `isSmsIssuedCoupon` helper) | No |

---

## 9. Out of Scope for This Fix

- Changing how VIP upgrade codes are generated (prefix, length, format) — not related to attribution
- Adding a `vip_upgrade` section to the daily report template — view change alone makes the cohort visible; report reads the view automatically
- Backfilling `VIP-ZBWZ85` attribution — that send was issued before this fix; there is no matching order to attribute

---

## 10. Definition of Done

- [ ] `coupon-upgrade` deployed: verify existing contact `cc.coupon_code` updates to VIP code on test
- [ ] View migration applied: `SELECT cohort FROM sms_v_coupon_cohorts` shows `vip_upgrade` row
- [ ] `stripe-webhook` deployed: test VIP checkout sets `orders_raw.sms_send_id` non-null
- [ ] `sms_v_coupon_cohorts.redeemed` increments correctly after a VIP coupon order
- [ ] `001_smsKnownGaps.md` GAP-04 marked fully resolved
- [ ] `002_smsChangeLog.md` entry added for each deployed change

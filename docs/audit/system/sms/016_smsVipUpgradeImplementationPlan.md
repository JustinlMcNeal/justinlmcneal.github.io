# SMS VIP Upgrade — Implementation Plan

**Date:** 2026-05-08  
**Status:** complete — all three steps deployed and verified 2026-05-09  
**Source of truth:** `015_smsVipUpgradeFixPlan.md` (background/discovery), this file (implementation)  
**Pre-event deadline:** before next live event using the business card / QR upgrade flow

---

## 1. Current Confirmed Behavior

### What happens at a live event today

1. Customer scans QR code → lands on coupon landing page → enters phone → `send-sms` wrapper fires → receives `SMS-XXXXXX` (15%) code
2. Customer taps "upgrade" → `coupon-upgrade` fires:
   - Creates `promotions` row with `code = "VIP-XXXXXX"`, `usage_limit = 1`, `usage_count = 0`
   - Inserts `coupon_upgrades` row (`promo_id`, `phone`, `upgrade_code`, `upgrade_promo_id`)
   - **For existing contacts** (the common case — they just signed up via step 1): calls `customer_contacts.update()` with `status`, `sms_consent`, `opted_in_at`, `opted_out_at`, `last_sms_sent_at` — **`coupon_code` is NOT updated**; `cc.coupon_code` still holds `"SMS-XXXXXX"`
   - **For new contacts** (rare — no prior `cc` row): `customer_contacts.insert()` with `coupon_code: upgradeCode` — correctly sets VIP code
   - Logs `sms_sends` with `flow = "upgrade"`, `outcome = "pending"`
   - Logs `sms_messages` with `campaign = "coupon_upgrade"`
   - Sends via Twilio directly (not `send-sms` wrapper)
3. Customer shops and applies `VIP-XXXXXX` at checkout
4. Stripe fires `checkout.session.completed` → `stripe-webhook` processes the order

### Why attribution fails entirely for existing contacts (the common case)

**Four sequential failures in `stripe-webhook`:**

**Failure 1 — Method 1 trigger (line 545): VIP- codes never enter the attribution block.**
```typescript
// Line 545 — current code:
if (coupon_code_used && coupon_code_used.startsWith("SMS-")) {
```
`coupon_code_used` is `"VIP-XXXXXX"`. `startsWith("SMS-")` is false. The entire `if` block is skipped. `smsAttributed` stays `false`.

**Failure 2 — Method 2 fallback (lines 568–590): only fires if the customer clicked an SMS link within 48h.**
The click-window check runs since Method 1 did not set `smsAttributed = true`. If the customer did click a link before checkout, Method 2 fires — but it attributes to the most recent `sms_clicked` event, which is likely the original `signup` send, not the `upgrade` send. The wrong `sms_sends` row gets `outcome = 'converted'`.

If the customer did not click anything within 48h, Method 2 also silently fails. `sms_attributed = false`, `sms_send_id = null` in `orders_raw`.

**Failure 3 — Even if Method 1 were reached, the contact lookup (line 552) would return null.**
```typescript
// Line 552 — current code:
.eq("coupon_code", coupon_code_used)  // looking for cc.coupon_code = "VIP-XXXXXX"
```
Because `coupon-upgrade` didn't update `cc.coupon_code` for existing contacts, the contact row still holds `cc.coupon_code = "SMS-XXXXXX"`. No row matches `"VIP-XXXXXX"`. `contact` is null. `smsSendId` stays null.

**Failure 4 — Even if the contact were found, the send lookup (line 560) uses hardcoded `signup` flow.**
```typescript
// Line 560 — current code:
.eq("flow", "signup")
```
The upgrade send logged by `coupon-upgrade` uses `flow = "upgrade"`, not `"signup"`. This lookup would match the original 15% signup send, not the upgrade send. The wrong `sms_sends` row would get `outcome = 'converted'`.

### What is already correct (no change needed)

- **Promotion usage counting** (lines ~500–520): `shouldIncrementPromotionUsage` only excludes the `THANKS-` prefix. VIP- codes hit the increment path correctly. `promotions.usage_count` does increment on VIP orders. ✓  
- **`orders_raw` upsert**: The order itself is written correctly regardless of attribution. Revenue is captured. ✓  
- **New-contact path in `coupon-upgrade`**: `insert()` correctly sets `coupon_code: upgradeCode`. VIP upgrades for brand-new contacts (no prior CC row) would work if stripe-webhook were fixed. ✓

### Summary table

| Step | Broken? | Reason |
|------|---------|--------|
| `orders_raw` written | ✅ No | Prefix-independent |
| `promotions.usage_count` incremented | ✅ No | Prefix-independent |
| `orders_raw.sms_attributed = true` | ❌ Yes | Method 1 trigger rejects `VIP-` |
| `orders_raw.sms_send_id` set | ❌ Yes | Method 1 never fires; Method 2 may set wrong send or nothing |
| `sms_sends.outcome = 'converted'` | ❌ Yes | upgrade send never marked converted |
| `sms_events.coupon_redeemed` logged | ❌ Yes | Line 638 guard also checks `startsWith("SMS-")` |
| `sms_v_coupon_cohorts` shows `vip_upgrade` row | ❌ Yes | View filter excludes `flow = 'upgrade'` entirely |

---

## 2. Smallest Safe Pre-Event Fix

Three targeted changes. Nothing else.

### Change 1 — `coupon-upgrade`: add `coupon_code` to existing contact `update()`

**File:** `supabase/functions/coupon-upgrade/index.ts`  
**Lines:** ~212–219 (`if (contact)` branch, the `update()` call)  
**Risk:** Very low — one additional field in an existing update call. Already set on the new-contact insert path. No schema change.

**Before:**
```typescript
const { data: updated } = await sb
  .from("customer_contacts")
  .update({
    status:          "active",
    sms_consent:     true,
    opted_in_at:     now.toISOString(),
    opted_out_at:    null,
    last_sms_sent_at: now.toISOString(),
  })
  .eq("id", contact.id)
  .select("id")
  .single();
```

**After:**
```typescript
const { data: updated } = await sb
  .from("customer_contacts")
  .update({
    status:          "active",
    sms_consent:     true,
    opted_in_at:     now.toISOString(),
    opted_out_at:    null,
    last_sms_sent_at: now.toISOString(),
    coupon_code:     upgradeCode,       // ← ADD THIS
  })
  .eq("id", contact.id)
  .select("id")
  .single();
```

**Why this unblocks everything downstream:** After this change, `cc.coupon_code = "VIP-XXXXXX"` for existing contacts post-upgrade. The `stripe-webhook` contact lookup at line 552 (`eq("coupon_code", coupon_code_used)`) will find the correct row. The view's redemption join (`LEFT JOIN promotions p ON p.code = cc.coupon_code`) will connect to the correct VIP promotion row.

**Note — existing VIP-ZBWZ85 contact row:** The one existing upgrade issued to date uses phone ending −9254. That contact's `cc.coupon_code` is still the original `SMS-` code. This is a one-time orphan. If attribution matters for that phone, apply a one-time manual patch after this deploy:
```sql
UPDATE customer_contacts SET coupon_code = 'VIP-ZBWZ85'
WHERE phone = '<full phone>'
  AND coupon_code != 'VIP-ZBWZ85';
```
Run the pre-check in Section 6 to confirm the phone before touching it.

---

### Change 2 — `stripe-webhook`: 5 pinpoint edits to extend Method 1 to `VIP-` codes

**File:** `supabase/functions/stripe-webhook/index.ts`  
**Risk:** Medium (highest-risk function). All 5 edits are additive `||` extensions or flow variable additions — no deletion of existing behavior.

**Why `coupon_upgrades` bridge is NOT needed:** After Change 1, `cc.coupon_code` is the correct VIP code. The existing contact lookup at line 552 (`eq("coupon_code", coupon_code_used)`) works without modification. The bridge is not needed for attribution — it exists for audit only.

#### Edit 2a — Extend Method 1 trigger (line 545)

**Before (line 545):**
```typescript
      // Method 1: Direct attribution — coupon code starts with "SMS-"
      if (coupon_code_used && coupon_code_used.startsWith("SMS-")) {
```

**After:**
```typescript
      // Method 1: Direct attribution — coupon code starts with "SMS-" or "VIP-"
      if (coupon_code_used && (coupon_code_used.startsWith("SMS-") || coupon_code_used.startsWith("VIP-"))) {
```

#### Edit 2b — Make send-flow lookup dynamic (line 558–561)

The current send lookup hardcodes `flow = "signup"`. VIP upgrade sends use `flow = "upgrade"`. After Edit 2a, both SMS- and VIP- codes enter this block. The send lookup must find the right flow.

**Before (lines 556–563):**
```typescript
        if (contact) {
          const { data: send } = await supabaseAdmin
            .from("sms_sends")
            .select("id")
            .eq("contact_id", contact.id)
            .eq("flow", "signup")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (send) smsSendId = send.id;
        }
```

**After:**
```typescript
        if (contact) {
          const sendFlow = coupon_code_used.startsWith("VIP-") ? "upgrade" : "signup";
          const { data: send } = await supabaseAdmin
            .from("sms_sends")
            .select("id")
            .eq("contact_id", contact.id)
            .eq("flow", sendFlow)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (send) smsSendId = send.id;
        }
```

This ensures the `upgrade` flow send row receives `outcome = 'converted'`, not the original `signup` send.

#### Edit 2c — Fix attribution_method label in metadata (~line 624)

**Before:**
```typescript
            attribution_method: coupon_code_used?.startsWith("SMS-") ? "coupon" : "click_window",
```

**After:**
```typescript
            attribution_method: (coupon_code_used?.startsWith("SMS-") || coupon_code_used?.startsWith("VIP-")) ? "coupon" : "click_window",
```

#### Edit 2d — Fix `coupon_redeemed` event guard (~line 638)

**Before:**
```typescript
        // Log coupon redemption event if SMS coupon
        if (coupon_code_used?.startsWith("SMS-")) {
```

**After:**
```typescript
        // Log coupon redemption event if SMS or VIP coupon
        if (coupon_code_used?.startsWith("SMS-") || coupon_code_used?.startsWith("VIP-")) {
```

#### Edit 2e — Fix console.log ternary (~line 651)

**Before:**
```typescript
        console.log(`[stripe-webhook] SMS attribution: order ${kk_order_id} attributed to SMS (method: ${coupon_code_used?.startsWith("SMS-") ? "coupon" : "click_window"}, send: ${smsSendId})`);
```

**After:**
```typescript
        console.log(`[stripe-webhook] SMS attribution: order ${kk_order_id} attributed to SMS (method: ${(coupon_code_used?.startsWith("SMS-") || coupon_code_used?.startsWith("VIP-")) ? "coupon" : "click_window"}, send: ${smsSendId})`);
```

---

### Change 3 — View migration: add `vip_upgrade` cohort to `sms_v_coupon_cohorts`

**File:** new migration `supabase/migrations/20260513_sms_coupon_cohorts_add_upgrade.sql`  
**Risk:** Very low — `CREATE OR REPLACE VIEW` is non-destructive. Existing rows unchanged.

**Migration file content:**
```sql
-- 20260513_sms_coupon_cohorts_add_upgrade.sql
-- Extends sms_v_coupon_cohorts to include the 'upgrade' (VIP coupon) flow
-- as a new vip_upgrade cohort. Existing cohorts are unchanged.

CREATE OR REPLACE VIEW sms_v_coupon_cohorts AS
WITH coupon_data AS (
  SELECT
    CASE
      WHEN s.flow = 'coupon_escalation' THEN 'escalation_20pct'
      WHEN s.flow = 'upgrade'           THEN 'vip_upgrade'
      ELSE 'initial_15pct'
    END AS cohort,
    s.id AS send_id,
    s.phone,
    s.outcome,
    s.cost AS sms_cost,
    s.created_at AS send_at,
    p.code AS coupon_code,
    p.value AS coupon_value,
    p.usage_count,
    p.usage_limit
  FROM sms_sends s
  JOIN customer_contacts cc ON cc.id = s.contact_id
  LEFT JOIN promotions p ON p.code = cc.coupon_code
  WHERE s.flow IN ('signup', 'coupon_escalation', 'upgrade')
)
-- ... rest of view unchanged from 20260414_sms_analytics_views.sql
```

**Apply via (never use `db push`):**
```bash
npx supabase db query --linked -f supabase/migrations/20260513_sms_coupon_cohorts_add_upgrade.sql
```

> **Before writing this migration file:** Read the full current view definition from `supabase/migrations/20260414_sms_analytics_views.sql` lines 67–120 to get the complete SELECT so the replacement is exact. Only the `CASE` expression and `WHERE` clause change; everything else is copied verbatim.

---

## 3. Files That Will Change

| File | What changes | Why |
|------|-------------|-----|
| `supabase/functions/coupon-upgrade/index.ts` | Add `coupon_code: upgradeCode` to existing-contact `update()` | So `cc.coupon_code` reflects the VIP code; unlocks all downstream attribution |
| `supabase/functions/stripe-webhook/index.ts` | 5 surgical edits — extend Method 1 trigger + dynamic flow lookup + 3 label ternaries | VIP orders are attributed to the correct send; `sms_sends.outcome` marks the upgrade send converted |
| `supabase/migrations/20260513_sms_coupon_cohorts_add_upgrade.sql` | New file: `CREATE OR REPLACE VIEW sms_v_coupon_cohorts` with `upgrade` in filter + `vip_upgrade` CASE | VIP upgrade cohort becomes visible in analytics report |

**Files that do NOT need to change:**

- `stripe-webhook` promotion usage increment block — already prefix-agnostic ✓  
- `sms_v_flow_performance` / `sms_v_flow_performance_dated` — upgrade flow sends already appear here once logged ✓  
- `coupon-upgrade` Twilio send logic — no change needed  
- `coupon_upgrades` table schema — used as audit trail; no change needed  

---

## 4. Implementation Order

### Step 1 — Deploy `coupon-upgrade` (Change 1)

Deploy first. This is self-contained and has no dependencies on the other changes.

```bash
echo y | npx supabase functions deploy coupon-upgrade --project-ref yxdzvzscufkvewecvagq
```

Verify with the pre-implementation query in Section 6. Then run the test scenario in Section 5, Task B.

### Step 2 — Apply view migration (Change 3)

Apply second. The view only produces meaningful data after coupon-upgrade is writing `cc.coupon_code` correctly (Step 1), but the view change itself is safe to apply at any time.

```bash
npx supabase db query --linked -f supabase/migrations/20260513_sms_coupon_cohorts_add_upgrade.sql
```

Verify: `SELECT cohort, total_coupons_issued FROM sms_v_coupon_cohorts` should return a `vip_upgrade` row (possibly with 0 sends if no upgrades yet — the row only appears once an `upgrade` flow send exists in `sms_sends`).

### Step 3 — Deploy `stripe-webhook` (Change 2)

Deploy last. It depends on Step 1 being live (so `cc.coupon_code` is current when the next VIP order comes in). This is the highest-risk change. Read the file one more time before editing to confirm line numbers haven't drifted.

Before deploying, confirm:
- Step 1 is live and verified
- At least one test upgrade was performed and `cc.coupon_code` updated correctly

```bash
echo y | npx supabase functions deploy stripe-webhook --project-ref yxdzvzscufkvewecvagq
```

---

## 5. Test Plan

All tests should be done with a real phone and test Stripe session (not production payment). Use a test promo with known `promo_id`. Clean up after each test.

### Task A — Verify `coupon-upgrade` existing contact path (Step 1 only)

**Setup:** Ensure a `customer_contacts` row exists for your test phone with `coupon_code = 'SMS-TEST'`.

**Action:** POST to `coupon-upgrade` with the test phone and a valid `promo_id`.

**Expected results:**
- `customer_contacts.coupon_code` changes from `'SMS-TEST'` to the new `VIP-XXXXXX` code
- `coupon_upgrades` row inserted with `upgrade_code = 'VIP-XXXXXX'`
- `promotions` row inserted with `code = 'VIP-XXXXXX'`, `usage_count = 0`, `usage_limit = 1`
- `sms_sends` row inserted with `flow = 'upgrade'`, `outcome = 'pending'`
- SMS delivered to test phone

**Verification query:**
```sql
SELECT cc.coupon_code, cu.upgrade_code, p.usage_count, ss.flow, ss.outcome
FROM customer_contacts cc
JOIN coupon_upgrades cu ON cu.phone = cc.phone
JOIN promotions p ON p.code = cu.upgrade_code
JOIN sms_sends ss ON ss.contact_id = cc.id AND ss.flow = 'upgrade'
WHERE cc.phone = '<test_phone>';
```

Expected: `coupon_code = upgrade_code`, `usage_count = 0`, `flow = 'upgrade'`, `outcome = 'pending'`.

---

### Task B — Verify view shows `vip_upgrade` cohort (Step 2 only)

After Step 2 migration and at least one upgrade send exists:

```sql
SELECT cohort, total_coupons_issued, redeemed, sms_attributed_orders
FROM sms_v_coupon_cohorts
ORDER BY cohort;
```

Expected: row with `cohort = 'vip_upgrade'` appears. `total_coupons_issued` = number of `upgrade` flow sends. `redeemed` may be 0 until an order is placed.

---

### Task C — Full VIP checkout flow (Steps 1 + 2 + 3 all live)

This test validates the complete path end-to-end. Requires all three steps deployed.

**Setup:**
- Fresh test phone not in `customer_contacts`
- Test Stripe checkout with a real product (use test mode or a real small-value item)

**Step C-1: Initial 15% signup**
- POST to the coupon landing (`send-sms` via signup flow)
- Confirm `customer_contacts` row created with `coupon_code = 'SMS-XXXXXX'`
- Confirm `sms_sends` row with `flow = 'signup'`, `outcome = 'pending'`

**Step C-2: Upgrade to VIP**
- POST to `coupon-upgrade` with same phone + promo_id
- Confirm `cc.coupon_code` updated to `'VIP-XXXXXX'` (not SMS- anymore)
- Confirm `sms_sends` row with `flow = 'upgrade'`, `outcome = 'pending'`
- Confirm `coupon_upgrades` row exists

**Step C-3: Checkout with VIP code**
- Complete Stripe checkout applying the `VIP-XXXXXX` code
- `coupon_code_used` in Stripe metadata must be set to `'VIP-XXXXXX'`
- Wait for webhook to fire

**Expected results in database after webhook:**

```sql
-- orders_raw: attributed to SMS, upgrade send linked
SELECT sms_attributed, sms_send_id, coupon_code_used
FROM orders_raw
WHERE coupon_code_used = 'VIP-XXXXXX';
-- Expected: sms_attributed=true, sms_send_id=<upgrade send id>, coupon_code_used='VIP-XXXXXX'

-- sms_sends: upgrade send marked converted
SELECT flow, outcome, converted_at
FROM sms_sends
WHERE flow = 'upgrade'
  AND contact_id = (SELECT id FROM customer_contacts WHERE phone = '<test_phone>');
-- Expected: flow='upgrade', outcome='converted', converted_at non-null

-- promotions: usage_count incremented
SELECT code, usage_count, usage_limit
FROM promotions
WHERE code = 'VIP-XXXXXX';
-- Expected: usage_count=1, usage_limit=1

-- sms_events: coupon_redeemed event logged
SELECT event_type, metadata
FROM sms_events
WHERE metadata->>'coupon_code' = 'VIP-XXXXXX';
-- Expected: one 'order_attributed' event + one 'coupon_redeemed' event

-- sms_v_coupon_cohorts: vip_upgrade cohort shows redeemed=1
SELECT cohort, total_coupons_issued, redeemed, sms_attributed_orders
FROM sms_v_coupon_cohorts
WHERE cohort = 'vip_upgrade';
-- Expected: redeemed=1, sms_attributed_orders=1
```

---

### Task D — Verify initial_15pct path still works (regression check)

After all steps: run the same checkout test using an `SMS-XXXXXX` coupon (not VIP). Confirm:
- `sms_sends` with `flow = 'signup'` gets `outcome = 'converted'` (not `flow = 'upgrade'`)
- `initial_15pct` cohort row in `sms_v_coupon_cohorts` behaves as before

---

## 6. Pre-Implementation Checks

Run before starting. Confirm the data matches these expectations before writing a single line of code.

```sql
-- 1. Current state of the only existing VIP upgrade
SELECT cu.upgrade_code, cu.phone, cc.coupon_code AS cc_current_code,
       p.usage_count, p.usage_limit
FROM coupon_upgrades cu
LEFT JOIN customer_contacts cc ON cc.phone = cu.phone
LEFT JOIN promotions p ON p.code = cu.upgrade_code;
-- Expected: cc_current_code = SMS-XXXXXX (confirms Gap A is still open), usage_count=0

-- 2. Current sms_v_coupon_cohorts — no vip_upgrade row yet
SELECT cohort, total_coupons_issued, redeemed, sms_attributed_orders
FROM sms_v_coupon_cohorts
ORDER BY cohort;
-- Expected: only initial_15pct and escalation_20pct; no vip_upgrade row

-- 3. Confirm upgrade send exists and is still pending
SELECT id, flow, outcome, contact_id, created_at
FROM sms_sends
WHERE flow = 'upgrade';
-- Expected: 1 row, outcome='pending'

-- 4. Confirm stripe-webhook Method 1 guard line has not been modified yet
-- (Manual file read — check index.ts line 545 reads: startsWith("SMS-") only)
```

---

## 7. Definition of Done

All of the following must be true before the next live event:

- [x] `coupon-upgrade` deployed: test confirms existing contact `cc.coupon_code` updates from `SMS-` to `VIP-` code after upgrade POST — verified 2026-05-09 (Task A: `codes_match=true` for VIP-WHEGPF)
- [x] View migration applied: `SELECT cohort FROM sms_v_coupon_cohorts` returns a `vip_upgrade` row — verified 2026-05-08 (Task B: `total_coupons_issued=2`)
- [x] `stripe-webhook` deployed: full checkout test (Task C) passes all 5 verification queries — verified 2026-05-09 (`sms_attributed=true`, `outcome=converted`, `usage_count=1`, both events logged, `vip_upgrade` cohort `redeemed=1` `sms_attributed_orders=1`)
- [x] `initial_15pct` regression check (Task D) still passes — verified 2026-05-09 (D1: 3 SMS- orders `flow=signup` `outcome=converted`; D2: `initial_15pct` cohort unchanged)
- [x] `001_smsKnownGaps.md` GAP-04 marked fully resolved — updated 2026-05-09
- [x] `002_smsChangeLog.md` entries added for `coupon-upgrade` deploy, migration apply, and `stripe-webhook` deploy — added 2026-05-09
- [x] VIP-ZBWZ85 historical orphan addressed — manual patch applied 2026-05-09: `UPDATE customer_contacts SET coupon_code = 'VIP-ZBWZ85' WHERE phone = '+14704350296'`. `cc.coupon_code` confirmed `VIP-ZBWZ85`; `promotions.usage_count = 0` (never redeemed, no revenue impact).

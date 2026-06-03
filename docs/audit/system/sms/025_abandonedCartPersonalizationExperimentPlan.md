# Abandoned Cart Personalization Experiment Plan

**Date:** 2026-05-25  
**Status:** **IMPLEMENTED** 2026-05-25 — copy deployed; **21-day observation window** ends ~2026-06-15  
**Source backlog:** `docs/reports/sms/experiments/2026-05-25.md` (Experiment 2)  
**Scope:** Copy-only experiment in `sms-abandoned-cart`. No timing, coupon, cron, cap, or send-automation changes.

---

## 1. Experiment Summary

**Hypothesis:** Personalizing abandoned-cart SMS copy — using cart item names more naturally and shifting Step 2 from urgency/scarcity to helpful reminder tone — may improve early-step engagement and overall cart recovery **without** changing send timing, coupon values, coupon creation logic, frequency caps, quiet hours, STOP copy, or tracking links.

**Why this experiment first (from OpenClaw backlog):** Low risk, single-file scope, strong existing funnel baseline (53.3% lifetime recovery rate), and clear rollback (revert three template strings).

**What we are NOT doing in this experiment:**
- Changing Step 1 / 2 / 3 delay windows (30 min / 6 hr / 24 hr)
- Changing coupon rules (15% off $40+ standard; $5 flat for carts $75+)
- Changing `MIN_CART_VALUE_CENTS` ($15)
- Changing cron schedule (`*/5 * * * *`)
- Adding new sends or automation
- Modifying `send-sms` guardrails

---

## 2. Current Flow Baseline

### Code source

| Item | Location |
|------|----------|
| Edge function | `supabase/functions/sms-abandoned-cart/index.ts` |
| Send wrapper | `supabase/functions/send-sms/index.ts` (quiet hours, caps, consent) |
| Funnel analytics view | `sms_v_abandoned_cart` (`supabase/migrations/20260414_abandoned_cart_analytics.sql`) |
| Cron | `supabase/SETUP_ABANDONED_CART_CRON.sql` — job `sms-abandoned-cart-check`, every **5 minutes** |

### Timing (unchanged in experiment)

| Step | Trigger | Guards |
|------|---------|--------|
| **Step 1** | `abandoned_step === 0` and cart idle **≥ 30 min** | Consent active, cart ≥ $15, abandon_count < 3, no purchase since update, not expired (< 3 days) |
| **Step 2** | `abandoned_step === 1`, idle **≥ 6 hr**, **≥ 6 hr** since last SMS | `step_2_sent_at` duplicate guard |
| **Step 3** | `abandoned_step === 2`, idle **≥ 24 hr**, **≥ 6 hr** since last SMS | `step_3_sent_at` duplicate guard; creates single-use promotion |

### Personalization already in code

`topItemName()` builds the item fragment from `saved_carts.cart_data`:

- 1 item → product name (e.g. `Rounded Heart Clasp`)
- 2+ items → `{first name} + {n-1} more`

All three steps already inject `${cartItems}` and Step 1/2 include `${cartValue}` where applicable.

### Current message copy (from code + latest live `sms_messages.message_body`)

**Step 1** — `message_type: abandoned_cart_reminder`, `send_reason: cart_abandoned_30min`

```
Karry Kraze: You left {cartItems} in your cart (${cartValue}). Complete your order: karrykraze.com/r/?c={shortCode}
Reply STOP to opt out
```

Live example (2026-05-22):

> Karry Kraze: You left Rounded Heart Clasp + 2 more in your cart ($18.97). Complete your order: karrykraze.com/r/?c=wcqufrxm  
> Reply STOP to opt out

**Step 2** — `message_type: abandoned_cart_urgency`, `send_reason: cart_abandoned_6hr_urgency`

```
Karry Kraze: Almost gone 👀 {cartItems} been selling fast. Don't miss out: karrykraze.com/r/?c={shortCode}
Reply STOP to opt out
```

Live example (2026-05-23):

> Karry Kraze: Almost gone 👀 Rounded Heart Clasp + 2 more been selling fast. Don't miss out: karrykraze.com/r/?c=vj7vwyym  
> Reply STOP to opt out

**Step 3** — `message_type: abandoned_cart_discount`, `send_reason: cart_abandoned_24hr_discount`

Standard cart (< $75):

```
Karry Kraze: We saved your cart! Use {couponCode} for 15% off orders $40+. Expires in 48hrs: karrykraze.com/r/?c={shortCode}
Reply STOP to opt out
```

High-value cart (≥ $75):

```
Karry Kraze: We saved your cart! Use {couponCode} for $5 off your order. Expires in 48hrs: karrykraze.com/r/?c={shortCode}
Reply STOP to opt out
```

Live example (2026-05-24, standard tier):

> Karry Kraze: We saved your cart! Use AC-7ND67A for 15% off orders $40+. Expires in 48hrs: karrykraze.com/r/?c=w6wxaaqr  
> Reply STOP to opt out

### Coupon behavior (unchanged in experiment)

| Cart value | Prefix | Offer | Min order | Expiry | Usage |
|------------|--------|-------|-----------|--------|-------|
| $15 – $74.99 | `AC-` | 15% off | $40 | 48 hr | 1×, inserted into `promotions` at Step 3 only |
| ≥ $75 | `ACV-` | $5 flat off | $0 | 48 hr | 1× |

### Tracking / send-sms payload (unchanged in experiment)

- Tracking URL pattern: `karrykraze.com/r/?c={shortCode}` (short code generated per send)
- Redirect: `https://karrykraze.com/pages/catalog.html`
- `flow`: `abandoned_cart`
- `campaign`: `abandoned_cart`
- `intent`: `marketing`
- Guardrails enforced in `send-sms`: quiet hours (9 PM–9 AM ET), 6 hr gap, daily cap (1/day), weekly cap (4/week), consent

### Current recovery metrics

**`sms_v_abandoned_cart` (lifetime aggregate, snapshot 2026-05-25):**

| Metric | Value |
|--------|-------|
| Total carts | 29 |
| Active / purchased / expired | 4 / 8 / 17 |
| Step 1 / 2 / 3 sends | 15 / 15 / 15 |
| **Recovery rate** | **53.3%** (8 purchased ÷ 15 with Step 1) |
| Recovered value | $254.77 |
| Avg hours to purchase | 48.5 |
| Converted at Step 1 | 0 |
| Converted at Step 2 | 0 |
| Converted at Step 3 | 1 |
| Serial abandoners suppressed (≥ 3) | 0 active |

**`sms_v_flow_performance` (lifetime, flow = `abandoned_cart`):**

| Metric | Value |
|--------|-------|
| Total sends | 54 |
| Delivered | 54 |
| Unique clicks | 2 |
| Attributed conversions (7d-style view) | 0 |
| SMS cost | $0.43 |
| Last send | 2026-05-24 |

**OpenClaw optimization note (2026-05-25):** Conversions in recent 7-day flow performance are flat (0), but lifetime cart recovery remains strong at 53.3%. Step-level attribution suggests recoveries cluster late (Step 3); improving Step 1/2 relevance is the experiment target.

---

## 3. Proposed Copy Changes

**Rules:** Edit `smsBody` template strings only in `sms-abandoned-cart/index.ts`. Keep STOP line, tracking URL variable, coupon logic, and `${cartItems}` / `${cartValue}` / `${couponCode}` / `${offerText}` interpolation unchanged.

### Step 1 — less generic, natural item reference

**Current:**

```text
Karry Kraze: You left ${cartItems} in your cart ($${cartValue}). Complete your order: ${trackingUrl}
Reply STOP to opt out
```

**Proposed:**

```text
Karry Kraze: Still thinking about ${cartItems}? Your cart ($${cartValue}) is saved — finish checkout: ${trackingUrl}
Reply STOP to opt out
```

*Rationale:* Conversational tone; keeps item name and value; removes imperative “Complete your order.”

### Step 2 — helpful reminder, less pressure

**Current:**

```text
Karry Kraze: Almost gone 👀 ${cartItems} been selling fast. Don't miss out: ${trackingUrl}
Reply STOP to opt out
```

**Proposed:**

```text
Karry Kraze: Quick reminder — ${cartItems} ($${cartValue}) is still in your cart if you want to finish checkout: ${trackingUrl}
Reply STOP to opt out
```

*Rationale:* Removes unverified scarcity (“selling fast”) and fixes awkward grammar; adds cart value for context; supportive tone vs. FOMO.

### Step 3 — clear discount, light personalization

**Standard cart — current:**

```text
Karry Kraze: We saved your cart! ${offerText}. Expires in 48hrs: ${trackingUrl}
Reply STOP to opt out
```

**Standard cart — proposed:**

```text
Karry Kraze: Still want ${cartItems}? ${offerText} — expires in 48hrs: ${trackingUrl}
Reply STOP to opt out
```

**High-value cart — proposed (same structure, `${offerText}` unchanged):**

```text
Karry Kraze: Still want ${cartItems}? ${offerText} — expires in 48hrs: ${trackingUrl}
Reply STOP to opt out
```

*Rationale:* `${offerText}` stays exactly as today (`Use AC-XXXX for 15% off orders $40+` or `Use ACV-XXXX for $5 off your order`); only framing copy changes.

### Explicitly NOT changing

- Timing thresholds (30 min / 6 hr / 24 hr)
- Coupon `%`, `$` amount, min order, prefix, expiry, insert logic
- `MIN_CART_VALUE_CENTS`, serial abandoner rule, purchase suppression
- STOP copy (`Reply STOP to opt out`)
- Tracking link format and `redirect_url`
- `send-sms` payload fields except `body` text

---

## 4. Risk Review

| Risk | Level | Notes |
|------|-------|-------|
| **Compliance** | Low | STOP line preserved; no new marketing claims; no new send types. Step 2 removes potentially misleading scarcity language (risk reduction). |
| **Fatigue** | Low | Same 3-step cadence; no extra messages. May reduce STOPs if tone is less pushy. |
| **Coupon budget** | None | Coupon creation logic untouched; same number of Step 3 coupons. |
| **Deliverability** | Low | Similar segment length; no new URLs or domains. |
| **Duplicate send** | Low | Step 2/3 `step_*_sent_at` guards unchanged; cron unchanged. |
| **Rollback** | Low | Three string reversions in one file; no migration. |
| **Analytics continuity** | Medium | `message_type` / `send_reason` unchanged — funnel views remain comparable; only body text differs post-deploy. |
| **False urgency removal** | Low (positive) | Step 2 no longer claims “selling fast” without inventory proof. |

**System context:** Overall SMS stop rate reported at 8.1% (2026-05-25 optimization report). This experiment does not increase send volume but should be monitored for stop-rate impact on abandoned-cart recipients.

---

## 5. Success Metrics

All metrics measured against **pre-experiment baseline** (values in §2) over a **minimum 21-day observation window** (backlog suggested 3 weeks).

| Metric | Source | Baseline | Success direction |
|--------|--------|----------|-----------------|
| **Abandoned cart recovery rate** | `sms_v_abandoned_cart.recovery_rate_pct` | 53.3% | Increase (primary) |
| **Step 1 conversions** | `converted_at_step1` | 0 | Increase |
| **Step 2 conversions** | `converted_at_step2` | 0 | Increase |
| **Step 3 conversions** | `converted_at_step3` | 1 | Maintain or increase |
| **Unique clicks (flow)** | `sms_v_flow_performance.unique_clicks` / dated view | 2 lifetime | Increase |
| **STOP rate (abandoned-cart cohort)** | `sms_v_fatigue_monitor` + flow filter | Monitor vs 8.1% system | Flat or decrease |
| **Revenue recovered** | `recovered_value_cents` | $254.77 | Increase |
| **Profit recovered** | Recovered value − incremental SMS cost | Positive | Increase |
| **Time to purchase** | `avg_hours_to_purchase` | 48.5 hr | Stable or decrease |

**Secondary checks:**
- Step 1/2/3 send counts remain aligned (no drop from cap blocks beyond normal)
- No increase in `failed` / `skipped` outcomes from `send-sms`

**Failure criteria (trigger rollback review):**
- Recovery rate drops > 10 pp vs baseline over 21 days
- STOP rate among abandoned-cart recipients rises materially
- Deliverability errors spike on abandoned-cart `message_type`s

---

## 6. Implementation Scope

### Files to change (after human approval)

| File | Change |
|------|--------|
| `supabase/functions/sms-abandoned-cart/index.ts` | Update three `smsBody` template strings (Step 1, 2, 3) only |

### Files NOT to change

- `supabase/functions/send-sms/index.ts`
- `supabase/SETUP_ABANDONED_CART_CRON.sql`
- Coupon / promotion migrations
- `cart-sync`, `cartStore.js`, frontend cart code
- Any other SMS edge functions

### Post-implementation docs (optional)

- Entry in `docs/audit/system/sms/002_smsChangeLog.md` after deploy
- Brief note in next OpenClaw daily report once results exist

### Deploy (when approved — not now)

```bash
npx supabase functions deploy sms-abandoned-cart --project-ref yxdzvzscufkvewecvagq
```

No edge function deploy until human approval checklist is complete.

---

## 7. Verification Plan

### Before deploy (code review)

- [ ] Diff shows **only** `smsBody` string changes in `sms-abandoned-cart/index.ts`
- [ ] STOP line identical on all three steps: `Reply STOP to opt out`
- [ ] `${trackingUrl}` still `karrykraze.com/r/?c=${shortCode}` pattern
- [ ] `${offerText}` / coupon generation block untouched
- [ ] `sendViaSendSms()` calls unchanged except `body` argument
- [ ] `flow`, `send_reason`, `message_type`, `campaign`, `intent`, `redirect_url` unchanged per step

### After deploy (first eligible cart cycle)

- [ ] Next Step 1 send: `sms_messages.message_type = abandoned_cart_reminder`, body matches proposed Step 1 wording
- [ ] Next Step 2 send: `message_type = abandoned_cart_urgency`, body matches proposed Step 2 wording
- [ ] Next Step 3 send: `message_type = abandoned_cart_discount`, body matches proposed Step 3 wording; coupon still created in `promotions`
- [ ] `sms_sends.flow = 'abandoned_cart'` for all three steps
- [ ] `sms_sends.send_reason` still `cart_abandoned_30min` / `cart_abandoned_6hr_urgency` / `cart_abandoned_24hr_discount`
- [ ] No duplicate Step 2/3 for same cart (`step_2_sent_at` / `step_3_sent_at` guards)
- [ ] `saved_carts.abandoned_step` advances 0→1→2→3 only after successful send

**Sample SQL (read-only verification):**

```sql
SELECT s.send_reason, s.flow, m.message_type, m.message_body, s.created_at
FROM sms_sends s
JOIN sms_messages m ON m.id = s.sms_message_id
WHERE s.flow = 'abandoned_cart'
ORDER BY s.created_at DESC
LIMIT 6;
```

```sql
SELECT * FROM sms_v_abandoned_cart;
```

---

## 8. Rollback Plan

1. Revert the three `smsBody` strings in `supabase/functions/sms-abandoned-cart/index.ts` to baseline copy (documented in §2).
2. Redeploy: `npx supabase functions deploy sms-abandoned-cart --project-ref yxdzvzscufkvewecvagq`
3. Confirm next send uses original copy via `sms_messages.message_body` query above.
4. No database rollback required — copy-only change; existing coupons and cart state unaffected.
5. Log rollback in `002_smsChangeLog.md` with date and reason (e.g. recovery rate decline).

**Time to rollback:** < 10 minutes (edit + deploy).

---

## 9. Human Approval Checklist

**Approved and implemented:** 2026-05-25  
**Observation window:** 21 days (through ~2026-06-15). Compare metrics in §5 against §2 baseline; rollback per §8 if failure criteria met.

| Item | Status |
|------|--------|
| Copy approved (all 3 steps reviewed) | ✅ Approved 2026-05-25 |
| Discount budget unchanged (15% / $5 rules confirmed) | ✅ Approved 2026-05-25 |
| STOP copy preserved | ✅ Approved 2026-05-25 |
| Caps preserved (via `send-sms`, no bypass) | ✅ Approved 2026-05-25 |
| Quiet hours preserved (via `send-sms`) | ✅ Approved 2026-05-25 |
| No send automation added | ✅ Approved 2026-05-25 |
| Rollback ready (baseline copy documented in §2) | ✅ Approved 2026-05-25 |
| **Experiment authorized to implement** | ✅ **Implemented 2026-05-25** |

**Deploy:** `sms-abandoned-cart` only (copy-only diff in `index.ts`).

---

## Appendix: Related documents

- Experiment backlog: `docs/reports/sms/experiments/2026-05-25.md`
- Wrapper migration baseline: `docs/audit/system/sms/024_smsAbandonedCartWrapperFixPlan.md`
- OpenClaw optimization context: `docs/reports/sms/optimization/2026-05-25.md`

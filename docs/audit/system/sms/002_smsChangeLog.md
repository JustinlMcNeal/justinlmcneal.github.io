# SMS System Change Log
**Project:** Karry Kraze SMS Analyst  
**Format:** one entry per meaningful change — code, config, or finding  

This file tracks every change made to the SMS system and what happened afterward. It is the primary reference for understanding why the system is configured the way it is. Even small changes belong here. Entries do not need to be long.

---

## Entry Template

```markdown
## YYYY-MM-DD — [one-line description]

**What changed:** [what you did, 1–2 sentences]
**Why:** [what metric or report finding prompted it]
**Result:** [what happened on the next 1–3 reports after the change]
**Status:** open | resolved | monitoring
```

---

## 2026-05-08 — Fixed GAP-02: sms-redirect now writes last_clicked_at instead of last_sms_sent_at

**What changed:** Added `last_clicked_at TIMESTAMPTZ` column to `customer_contacts` via migration `20260508_add_last_clicked_at_to_contacts.sql`. Updated `supabase/functions/sms-redirect/index.ts` to write `last_clicked_at` on click and stop writing `last_sms_sent_at` entirely. Also redeployed with `--no-verify-jwt` because the prior deployment without that flag was returning `UNAUTHORIZED_NO_AUTH_HEADER` to unauthenticated SMS recipients.

**Why:** Every click on a tracked SMS link was overwriting `customer_contacts.last_sms_sent_at` — the frequency-cap field — with the click timestamp. This was suppressing or delaying subsequent scheduled messages (e.g., abandoned-cart step 2, coupon_reminder step 2) because the system saw a recent "send" that was actually a click. Click timing also needed a dedicated field to be useful for analytics without contaminating send cadence logic.

**Result:** Verified 2026-05-08 by SQL after a real click. `last_clicked_at` = `2026-05-08 23:00:15.647+00` (populated). `last_sms_sent_at` = `2026-05-03 22:45:04.575+00` (unchanged, pre-click value). New `sms_clicked` event row confirmed in `sms_events` with non-null `sms_send_id`. Frequency-cap isolation confirmed intact.

**Status:** resolved

---

## 2026-05-08 — Deployed coupon-upgrade: existing contact path now sets cc.coupon_code to VIP code (GAP-04 Step 1)

**What changed:** `supabase/functions/coupon-upgrade/index.ts` — added `coupon_code: upgradeCode` to the existing-contact `update()` call (~line 220). The new-contact `insert()` path already set this field correctly; the existing-contact path was the only gap.

**Why:** `customer_contacts.coupon_code` was never updated for contacts who had already signed up via the 15% flow when they upgraded. This caused the `stripe-webhook` attribution lookup (`eq("coupon_code", coupon_code_used)`) to find nothing for VIP- orders, and the coupon cohorts view's redemption join to produce no matches.

**Result:** Task A verified — `cc.coupon_code = 'VIP-WHEGPF'` for test contact, confirmed `codes_match=true`. Forward path to attribution unlock confirmed.

**Status:** resolved

---

## 2026-05-08 — Applied sms_v_coupon_cohorts migration: added vip_upgrade cohort (GAP-04 Step 2)

**What changed:** New migration `supabase/migrations/20260513_sms_coupon_cohorts_add_upgrade.sql` — `CREATE OR REPLACE VIEW sms_v_coupon_cohorts` with two additions: `WHEN s.flow = 'upgrade' THEN 'vip_upgrade'` in the CASE expression and `'upgrade'` added to the `WHERE s.flow IN (...)` filter. All other view logic verbatim from the original migration.

**Why:** The view had no representation for the VIP upgrade coupon flow. `sms_sends` rows with `flow = 'upgrade'` were excluded from the WHERE clause entirely, so upgrade sends were never counted in any cohort and upgrade redemptions were invisible to analytics.

**Result:** Task B verified — `SELECT cohort FROM sms_v_coupon_cohorts` returns `vip_upgrade` row with `total_coupons_issued=2`. Existing cohorts (`initial_15pct`, `escalation_20pct`) unchanged.

**Status:** resolved

---

## 2026-05-08 — Deployed stripe-webhook: extended Method 1 attribution to VIP- prefix (GAP-04 Step 3)

**What changed:** `supabase/functions/stripe-webhook/index.ts` — 5 surgical edits: (1) Method 1 trigger extended from `startsWith("SMS-")` to `startsWith("SMS-") || startsWith("VIP-")`; (2) send flow lookup made dynamic (`sendFlow = coupon.startsWith("VIP-") ? "upgrade" : "signup"`); (3) `attribution_method` label ternary extended to include `VIP-`; (4) `coupon_redeemed` event guard extended to include `VIP-`; (5) console.log ternary extended to include `VIP-`. All existing `SMS-` behavior unchanged.

**Why:** VIP- orders were completely excluded from Method 1 attribution. Even if the code lookup had succeeded, the flow lookup was hardcoded to `'signup'`, which would have matched the wrong send row and put the wrong send in a `converted` state.

**Result:** Task C verified 2026-05-09 with real VIP-WHEGPF Stripe checkout — `sms_attributed=true`, `sms_send_id` set, upgrade send `outcome=converted` `converted_at` set, `promotions.usage_count=1`, `order_attributed` (method=coupon) and `coupon_redeemed` events logged, `vip_upgrade` cohort `redeemed=1 sms_attributed_orders=1`. Task D verified — SMS- regression check passed, `initial_15pct` cohort unchanged.

**Status:** resolved

---

## 2026-05-08 — Historical backfill: repaired 3 promotions.usage_count rows (GAP-04)

**What changed:** One-time `UPDATE promotions SET usage_count = 1 WHERE code IN ('SMS-QCASZ3', 'SMS-DBXXFF', 'SMS-UDX32V') AND usage_count = 0 AND usage_limit = 1`. No schema change, no code change, no migration file — pure data repair. Full diagnostic and backfill plan documented in `011_smsCouponBackfillPlan.md`.

**Why:** `sms_v_coupon_cohorts` showed `initial_15pct` cohort with `attributed_orders = 3` but `redeemed = 0`, `redemption_rate_pct = 0%`. Investigation confirmed the 3 April 2026 orders were genuine SMS-coupon orders. `promotions.usage_count` remained 0 because the increment logic in `stripe-webhook` did not exist yet when those orders were placed (2026-04-18 to 2026-04-20). Stripe does not replay historical events.

**Result:** After backfill: `sms_v_coupon_cohorts` for `initial_15pct` shows `redeemed = 3`, `redemption_rate_pct = 6.52%`. All 4 validation queries passed. `orders_raw` untouched. Forward-facing VIP/upgrade attribution path identified as a separate open issue — see `015_smsVipUpgradeFixPlan.md`.

**Status:** resolved (historical data only; VIP upgrade path tracked separately)

---

## 2026-05-09 — Patched review_request flow to route through send-sms

**What changed:** `send-review-request` edge function was rewritten to call the `send-sms` wrapper instead of calling Twilio directly via a private helper. This ensures every review request SMS creates a linked `sms_messages` row with a `provider_message_sid`, and a `sms_sends` row with a non-null `sms_message_id`.

**Why:** The prior implementation wrote to `review_requests` but bypassed `sms_sends` and `sms_messages` entirely. This meant review request sends were invisible to the analytics views and Twilio delivery webhooks could not update `delivered_at`. Flow performance metrics for `review_request` were therefore undercounted.

**Result:** Post-deploy validation confirmed `sms_sends.sms_message_id` non-null and `review_requests.short_code` populated for a test send. Twilio SID `SM3e0907fc` confirmed. `sms_v_flow_performance_dated` now includes the `review_request` flow row.

**Status:** resolved

---

## 2026-05-09 — Added sms_v_flow_performance_dated companion view

**What changed:** New Postgres view `sms_v_flow_performance_dated` created via migration `20260509_sms_flow_performance_dated.sql`. View is identical to `sms_v_flow_performance` but adds `sent_date DATE` (bucketed in `America/New_York`) to the SELECT and GROUP BY, making the view filterable by date. Applied via `npx supabase db query --linked -f`. Existing `sms_v_flow_performance` was not modified.

**Why:** The V1 report script was trying to filter `sms_v_flow_performance` by a `sent_at` column that does not exist on the view. Every report run returned the error `column sms_v_flow_performance.sent_at does not exist` and fell back to all-time totals. Flow performance sections in the report were labeled "all-time" instead of showing 7-day bounded data.

**Result:** Validation query `WHERE sent_date >= CURRENT_DATE - 7` returned 14 rows correctly bucketed by Eastern-timezone day. `fetch-sms-data.mjs` updated to query the new view with `sent_date` YYYY-MM-DD filters. Next report run produced date-bounded Section 2 and Section 3 with no column-missing errors in Section 11.

**Status:** resolved

---

## 2026-05-09 — Fixed admin analytics click count (event_type mismatch)

**What changed:** `js/admin/smsAnalytics/index.js` lines 58–59 — changed the client-side filter from `r.event_type === "click"` to `r.event_type === "sms_clicked"`. Two string literals, no other changes.

**Why:** The admin SMS analytics dashboard was always showing 0 clicks. The `sms-redirect` edge function writes `event_type = 'sms_clicked'` to `sms_events`, and the database CHECK constraint enforces this value. The dashboard was filtering on `'click'` which can never match any row. All SQL analytics views already used `'sms_clicked'` correctly — only the dashboard JS was wrong.

**Result:** Admin analytics click delta now reflects actual `sms_events` rows. The upgrade flow click from 2026-05-06 should appear in the dashboard. V1 report not affected (it queries SQL views which were already correct).

**Status:** resolved

**What changed:** `prompts/openclaw/sms-analyst-v1.md` patched with: (1) new **Mixed time scope rule** constraint explaining that `coupon_cohorts`, `abandoned_cart`, `subscriber_funnel`, and `fatigue_monitor` are lifetime aggregates and any apparent conflict with date-bounded flow data must be labeled a scope difference, not a contradiction; (2) input format updated to reference `sms_v_flow_performance_dated` and the `sent_date` field; (3) Section 3 instructions now require a scope caveat when citing aggregate numbers alongside date-bounded flow data; (4) Sections 6 and 7 labeled as lifetime aggregates with a reminder to note scope when `date_filtered` is true.

**Why:** The 2026-05-08 report stated "0 conversions in the last 7 days" in Section 3 while Section 6 cited attributed orders from `sms_v_coupon_cohorts` without noting those were lifetime figures. The report framed a scope difference as a contradiction, reducing analyst reliability.

**Result:** Subsequent report shows Section 6 opening with a data-scope label. Section 3 no longer implies coupon or funnel numbers are 7-day bounded. Scope differences are now explicitly called out.

**Status:** resolved

---

## 2026-05-09 — Migrated sms-subscribe to route through send-sms wrapper (GAP-06)

**What changed:** `supabase/functions/sms-subscribe/index.ts` — removed direct Twilio constants and send logic. Signup coupon SMS now routes through the `send-sms` wrapper with `flow='signup'`, `intent='marketing'`, `skip_caps: true` (immediate consent-event send — caps must not block signup delivery). `sms_messages` and `sms_sends` rows are now created by `send-sms`. First flow migrated in the GAP-06 sequence (lowest risk — single send per new subscriber, no repeat-send risk).

**Why:** `sms-subscribe` was calling Twilio directly, bypassing daily/weekly frequency caps and `send-sms` row linkage. Part of GAP-06 systematic migration.

**Result:** Verified post-deploy. `flow='signup'` rows appear in `sms_v_flow_performance_dated` with non-null `sms_message_id`. Existing subscriber experience unchanged.

**Status:** resolved

---

## 2026-05-09 — Migrated sms-coupon-reminder to route through send-sms wrapper (GAP-06)

**What changed:** `supabase/functions/sms-coupon-reminder/index.ts` — removed direct Twilio constants and send logic, removed local quiet-hours and frequency-cap helpers. Coupon reminder SMS now routes through the `send-sms` wrapper with `flow='coupon_reminder'`, `intent='marketing'`. Business logic guards (unused coupon check, reminder window, dedup) preserved intact.

**Why:** `sms-coupon-reminder` was calling Twilio directly, bypassing daily/weekly frequency caps. Part of GAP-06 systematic migration.

**Result:** Verified post-deploy. `flow='coupon_reminder'` rows appear in `sms_v_flow_performance_dated` with non-null `sms_message_id`. No double-send regression. Frequency caps now enforced cross-flow.

**Status:** resolved

---

## 2026-05-09 — Migrated sms-welcome-series to route through send-sms wrapper (GAP-06)

**What changed:** `supabase/functions/sms-welcome-series/index.ts` — removed direct Twilio constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`), removed local `isQuietHours()`, `passesFrequencyCap()`, `sendAndLog()` helpers, and the handler-level quiet-hours early-return. Added `sendViaSendSms()` helper (same pattern as `sms-coupon-reminder`). Day 2 calls `send-sms` with `flow='welcome_series'`, `send_reason='welcome_day_2'`, `message_type='welcome_discovery'`, `campaign='welcome_series'`, `intent='marketing'`. Day 5 calls with `flow='welcome_series'`, `send_reason='welcome_day_5'`, `message_type='welcome_conversion'`, `campaign='welcome_series'`, `intent='marketing'`, plus `user_state_snapshot` including the coupon code. Business-logic guards (`alreadySent()`, `hasActiveAbandonedCart()`, `hasPurchased()`, fatigue check) were preserved entirely.

**Why:** `sms-welcome-series` was calling Twilio directly, bypassing daily/weekly frequency caps in `send-sms`. Part of GAP-06 systematic migration.

**Result:** Post-deploy verification passed all applicable checks. V1 (Day 2 fields): PASS — `provider_message_sid` non-null, all metadata fields correct. V3 (flow leakage): PASS — all rows show `flow='welcome_series'`. V4 (Day 2 dedup): PASS — zero double-sends. V5 (Day 5 dedup): PASS — zero double-sends. V6 (counts stable): PASS — D2=44, D5=39, no phantom sends. V2 (Day 5 fields): N/A — no new Day 5 sends occurred in the window since deploy.

**Status:** resolved

---

## 2026-05-09 — Migrated coupon-upgrade to route through send-sms wrapper (GAP-06)

**What changed:** `supabase/functions/coupon-upgrade/index.ts` — removed Twilio constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`), removed direct Twilio `fetch`, removed direct `sms_messages` and `sms_sends` inserts. Replaced with a single inline `fetch` to `${supabaseUrl}/functions/v1/send-sms` passing `flow='upgrade'`, `send_reason='coupon_upgrade_enrollment'`, `message_type='upgrade_confirmation'`, `campaign='coupon_upgrade'`, `intent='marketing'`, `skip_caps: true` (consent-event send — caps must not block). Helpers `generateShortCode()`, `generateUpgradeCode()`, `normalizePhone()` unchanged.

**Why:** `coupon-upgrade` was calling Twilio directly, bypassing all `send-sms` logging and frequency-cap logic. Part of GAP-06 systematic migration. `skip_caps: true` is correct here — this fires immediately on contact consent, not on a scheduled cadence.

**Result:** V1: N/A (no post-deploy upgrade send in window). V2: PASS — `cc.coupon_code = cu.upgrade_code = VIP-WHEGPF`, `sms_message_id` non-null. V3: PASS — `vip_upgrade` cohort = 2, routing intact. V4: PASS — `flow='upgrade'` in performance view, no leakage. V5: PASS — other cohorts unchanged.

**Status:** resolved

---

## 2026-05-09 — Migrated sms-abandoned-cart to route through send-sms wrapper (GAP-06)

**What changed:** `supabase/functions/sms-abandoned-cart/index.ts` — removed Twilio constants (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `WEBHOOK_URL`), removed `isQuietHours()`, `passesFrequencyCap()`, and `sendAndLog()` helpers (~62 lines total), removed handler-level quiet-hours early-return, removed per-cart `passesFrequencyCap()` call and `let sent = false`. Added `sendViaSendSms()` helper returning `"sent" | "skipped" | "failed"`. All three step call sites replaced with `sendViaSendSms()` calls passing full metadata (`flow`, `send_reason`, `message_type`, `campaign`, `intent`, `short_code`, `redirect_url`, `user_state_snapshot`). `saved_carts` update blocks remain gated on `result === "sent"` — blocked sends do NOT advance cart step state. Helpers `generateShortCode()`, `generateCouponCode()`, `topItemName()` and all cart-loop business logic (purchase suppression, expiry, consent check, repeat-abandoner suppression, step eligibility windows, Step 3 coupon generation) unchanged. `skip_caps` NOT passed — daily/weekly caps apply.

**Why:** `sms-abandoned-cart` was calling Twilio directly, bypassing daily/weekly frequency caps in `send-sms`. The per-contact 6-hour cap in `passesFrequencyCap()` was enforced locally, but cross-flow daily caps were not — a contact who received a welcome series or coupon reminder could still receive an abandoned-cart message. Part of GAP-06 systematic migration (final flow).

**Result:** Manual invocation post-deploy returned `{ results: { step1:0, step2:0, step3:0, skipped:0, purchased:0, expired:0 }, message: "No active carts" }` — function runs cleanly. V1/V2/V3: N/A — no active carts in eligible windows post-deploy. V4: PASS — only `flow='abandoned_cart'` (42 rows), no `message_type` leakage. V5: PASS — `sms_v_abandoned_cart` step counts 11/11/11, no regression. V6: Pre-existing (double-sends in `sms_sends` existed pre-deploy; no new post-deploy double-sends). V7: PASS — totals 15/14/13 unchanged from baseline. GAP-06 fully resolved.

**Status:** resolved

---

## 2026-05-09 — Fixed GAP-01: click-to-purchase aggregator and view label corrected

**What changed:** Four targeted fixes: (1) `aggregateClickToPurchase()` in `scripts/openclaw/fetch-sms-data.mjs` — field name corrected from `hours_lag` to `hours_click_to_purchase` in the per-row detection check, lags map, and `byFlowMap` loop; (2) new migration `20260509_sms_click_to_purchase_vip_label.sql` — `sms_v_click_to_purchase` `attribution_method` CASE extended so `VIP-%` orders return `'direct_coupon'` (previously returned `'click_attribution'`); (3) two unconditional stale warnings removed from `fetchSmsData()` in `fetch-sms-data.mjs` (GAP-02 `last_sms_sent_at` warning and GAP-03 `event_type='click'` warning, both referencing resolved issues) — replaced with a contextual null-timing warning emitted only when rows exist and all have `sms_click_at = null`; (4) stale "Known data quality issues" bullets removed from `prompts/openclaw/sms-analyst-v1.md` and replaced with a single accurate note explaining expected null timing for coupon-attributed orders.

**Why:** Live diagnostics confirmed the view returns 5 rows (not 0) but the aggregator never fired — the field name mismatch meant `hasHoursLag` was always false and raw per-order arrays were passed to the analyst instead of the expected summary object. VIP-WHEGPF was being mislabeled as `click_attribution`. Two unconditional stale warnings were polluting every report's data quality section with resolved issues.

**Result:** End-to-end report run confirmed: `sms_v_click_to_purchase: 2 rows` (7-day window), exactly 1 contextual warning (expected null-timing note), `click_to_purchase` payload field is the aggregated summary object with `total_attributed_orders` and `by_attribution_method`. VIP-WHEGPF confirmed `direct_coupon` by live query. No stale warnings in output. Section 5 of the report now shows attribution breakdown rather than declaring the section unavailable. Null `avg_hours_to_purchase` remains expected until Method 2 (click-window) attribution fires.

**Status:** resolved

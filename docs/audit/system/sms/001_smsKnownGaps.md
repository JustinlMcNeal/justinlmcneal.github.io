# SMS Known Gaps
**Project:** Karry Kraze SMS Analyst  
**Last updated:** 2026-05-10  

This file is the single source of truth for known data-quality and system gaps in the Karry Kraze SMS reporting and automation system. Each entry explains what the gap is, why it matters, and where things stand. When a gap is resolved, update the status and note the resolution — do not delete the entry.

---

## Gap Format

```
### [ID] — [short title]
**Issue:** what is wrong or missing
**Impact:** which of these is affected — daily report | analytics accuracy | compliance | profitability
**Current understanding:** what we know about the root cause
**Action needed:** what the fix looks like
**Status:** open | monitoring | resolved
```

---

### GAP-01 — sms_v_click_to_purchase returns zero rows

**Issue:** The `sms_v_click_to_purchase` view returns zero rows on every report run. The click-to-purchase section of the daily analyst report is always unavailable.

**Impact:** daily report (Section 5/9 always flag this), analytics accuracy (no click-lag or conversion-path data)

**Current understanding (updated 2026-05-09):**

**Root cause confirmed.** After GAP-04 VIP attribution was repaired, the view returned 5 rows (not 0). The reporting failure had three code-level causes, all fixed 2026-05-09:

1. **Aggregator field name mismatch** — `aggregateClickToPurchase()` in `fetch-sms-data.mjs` checked for `'hours_lag' in rows[0]` but the view column is `hours_click_to_purchase`. The check always returned false; the function fell through and returned raw per-order rows instead of the expected `{ total_attributed_orders, avg_hours_to_purchase, ... }` summary object.

2. **VIP- label bug in view** — The `attribution_method` CASE only matched `LIKE 'SMS-%'`. VIP-prefix coupon orders were labeled `'click_attribution'`, misleading the analyst.

3. **Two unconditional stale warnings** — `fetch-sms-data.mjs` emitted hardcoded warnings referencing GAP-02 (`last_sms_sent_at` — resolved 2026-05-08) and GAP-03 (`event_type='click'` — resolved 2026-05-09) on every report run regardless of actual system state.

**Why `hours_click_to_purchase` is still null for all rows:** All 5 attributed orders used coupon-based attribution (Method 1 in `stripe-webhook`). Method 1 does not write `sms_click_at` — only Method 2 (click-window, 48-hour match) does. 104 of 149 orders have no phone recorded in Stripe. Null timing is expected and is not a system failure.

**Action needed:** Completed. See `017_smsClickToPurchaseResolutionPlan.md` for full diagnosis.

**Status:** resolved — four targeted fixes applied 2026-05-09: (1) aggregator field name corrected (`hours_lag` → `hours_click_to_purchase`) in `scripts/openclaw/fetch-sms-data.mjs`; (2) view updated via migration `20260509_sms_click_to_purchase_vip_label.sql` — `VIP-%` orders now correctly labeled `direct_coupon`; (3) two stale unconditional warnings removed from `fetch-sms-data.mjs`, replaced with a contextual null-timing note emitted only when rows exist and all have `sms_click_at = null`; (4) stale data quality bullets removed from `prompts/openclaw/sms-analyst-v1.md` and replaced with an accurate description of null-timing expectations. Report now receives the aggregated summary object and Section 5 no longer declares click-to-purchase unavailable. Null `hours_click_to_purchase` remains expected until Method 2 attribution fires.

---

### GAP-02 — sms-redirect updates last_sms_sent_at on click instead of a dedicated click timestamp

**Issue:** The `sms-redirect` edge function updates `customer_contacts.last_sms_sent_at` when a contact clicks a tracked link, instead of writing a dedicated click timestamp to a separate field. This causes two problems: (1) a click resets the frequency-cap timer, potentially suppressing the next legitimate scheduled message; (2) click timing in `sms_v_click_to_purchase` and related views is not a reliable indicator of when a click actually occurred.

**Impact:** analytics accuracy (click-to-purchase timing unreliable), compliance (frequency cap timing distorted by clicks)

**Current understanding:** This is a design issue in `sms-redirect`. The field being written is the wrong field for clicks. A dedicated `last_clicked_at` field or a proper `sms_events` write was the intended design but was not implemented.

**Action needed:** Add a `last_clicked_at` column to `customer_contacts` (or ensure the `sms_events` insert in `sms-redirect` is writing correctly) and stop touching `last_sms_sent_at` on click. Frequency caps should not be affected by clicks — only by sends.

**Status:** resolved — `supabase/functions/sms-redirect/index.ts` updated to write `last_clicked_at` instead of `last_sms_sent_at` on click. Column added via migration `20260508_add_last_clicked_at_to_contacts.sql`. Deployed 2026-05-08 with `--no-verify-jwt` to allow unauthenticated clicks. Verified 2026-05-08 by SQL: after a real click, `last_clicked_at` updated to the click timestamp and `last_sms_sent_at` remained unchanged at its prior send value — confirming frequency-cap isolation is intact.

---

### GAP-03 — Admin analytics uses event_type='click' but actual events use 'sms_clicked'

**Issue:** The admin SMS analytics dashboard queries `sms_events` filtering on `event_type = 'click'`. Actual click events written to `sms_events` use `event_type = 'sms_clicked'`. This mismatch means the admin panel shows 0 clicks even when events exist, and click metrics across all analytics views that join on this column may be underreported.

**Impact:** daily report (click metrics in Section 2/3), analytics accuracy (all views using sms_events for clicks)

**Current understanding:** The discrepancy is between the value used at write time (`sms_clicked`) and the value used at read time (`click`). One of these needs to change — the simplest fix is to update the admin dashboard filter to match the actual event_type written at insert.

**Action needed:** Confirm the exact `event_type` value written to `sms_events` by `sms-redirect`. Update the admin analytics query to match. Or standardize on one value and update both sides in a single migration.

**Status:** resolved — `js/admin/smsAnalytics/index.js` lines 58–59 updated to filter on `"sms_clicked"` (2026-05-09). Write side, CHECK constraint, and all SQL views were already correct and untouched.

---

### GAP-04 — Coupon cohort mismatch: attributed_orders > 0 with 0 redemptions

**Issue:** `sms_v_coupon_cohorts` can show `attributed_orders > 0` alongside `redeemed = 0` and `redemption_rate_pct = 0%`. This means the system is associating orders with a coupon cohort via one mechanism (e.g. `orders_raw.sms_send_id`) while the redemption counter (`promotions.usage_count`) is not incrementing. The two counts measure different things using different linkage paths.

**Impact:** analytics accuracy (attributed revenue cannot be confirmed), daily report (Section 6 flags this every run), profitability (actual discount cost unknown)

**Current understanding (updated 2026-05-08):**

**Historical mismatch — REPAIRED.** Full diagnostics confirmed that the 3 initial_15pct attributed orders (placed 2026-04-18 to 2026-04-20) had `promotions.usage_count = 0` because the increment logic in `stripe-webhook` did not exist at order time. These are historical orphans — Stripe does not replay events. A one-time backfill was applied on 2026-05-08 setting `usage_count = 1` on codes `SMS-QCASZ3`, `SMS-DBXXFF`, `SMS-UDX32V`. The view now shows `redeemed = 3`, `redemption_rate_pct = 6.52%` for `initial_15pct`. This sub-issue is resolved.

**Forward-facing VIP/upgrade path — OPEN.** A second structural issue exists in the `coupon-upgrade` flow used at live events (business card / QR code → 15% signup → optional upgrade to 20%). The upgraded coupon uses a `VIP-` prefix. `stripe-webhook`'s Method 1 attribution only triggers on `coupon_code_used.startsWith("SMS-")` — it will never fire for `VIP-` codes. Additionally, `coupon-upgrade` does not update `customer_contacts.coupon_code` to the upgrade code for existing contacts, so the attribution lookup and the view's redemption join both fail. This is being actively planned in `015_smsVipUpgradeFixPlan.md`.

**Action needed:** Completed. See `016_smsVipUpgradeImplementationPlan.md` for full implementation details and verification results.

**Status:** resolved — all 3 implementation steps deployed and verified 2026-05-09. VIP-WHEGPF end-to-end test confirmed: `sms_attributed=true`, upgrade send `outcome=converted`, `promotions.usage_count=1`, both `order_attributed` and `coupon_redeemed` events logged, `vip_upgrade` cohort shows `redeemed=1 sms_attributed_orders=1`. SMS- regression check passed (D1/D2). VIP-ZBWZ85 historical orphan patched manually.

---

### GAP-05 — delivered_at not always populated for review_request and other flows

**Issue:** `sms_messages.delivered_at` is set by the `twilio-webhook` edge function when Twilio sends a delivery status callback. Short codes and some carrier routes do not reliably send delivery receipts. For review request sends and other transactional messages using short codes, `delivered_at` may remain NULL indefinitely even for successfully delivered messages.

**Impact:** analytics accuracy (`delivered` counts in `sms_v_flow_performance_dated` may be understated for transactional flows), daily report (delivery rate figures for review_request may be unreliable)

**Current understanding:** This is partly a Twilio/carrier limitation and partly a data model expectation mismatch. The view counts `status = 'delivered' OR status = 'sent'` as delivered — so `sent` rows do contribute to the delivered count. However, messages that never receive a callback will remain as `status = 'sent'` rather than advancing to `'delivered'`, which is technically correct but may undercount actual delivery for reporting purposes.

**Action needed:** No code change required. Add a note to the analyst prompt (V2) clarifying that `delivered` in the view includes `status = 'sent'` rows and that NULL `delivered_at` does not necessarily mean undelivered. Monitor whether `delivered_at` eventually populates for known-delivered test messages.

**Status:** monitoring

---

### GAP-06 — Five SMS flows still call Twilio directly, bypassing send-sms wrapper

**Issue:** The following edge functions call the Twilio API directly instead of routing through the `send-sms` wrapper:
- `sms-abandoned-cart`
- `sms-coupon-reminder`
- `sms-welcome-series`
- `sms-subscribe`
- `coupon-upgrade`

The `send-sms` wrapper is the only place where the daily send cap (1 per contact per UTC day) and weekly cap (4 per contact per 7 days) are enforced. Flows that bypass it are not subject to those caps.

**Impact:** compliance (frequency caps may not be enforced for 5 of 6 marketing flows), analytics accuracy (sends from bypassing flows may lack consistent `sms_sends` row linkage)

**Current understanding:** These flows were built before `send-sms` existed or before its wrapper pattern was established. The `send-review-request` function was the first to be migrated to the wrapper pattern (2026-05-09). The remaining 5 flows need the same migration, one at a time.

**Action needed:** Migrate each flow to call `send-sms` instead of Twilio directly. Do one flow at a time with a test send after each. Priority order (lowest risk first): `sms-subscribe` → `sms-coupon-reminder` → `sms-welcome-series` → `coupon-upgrade` → `sms-abandoned-cart`.

**Status:** resolved — all 5 direct-Twilio flows migrated to `send-sms` wrapper. `sms-subscribe` (2026-05-09), `sms-coupon-reminder` (2026-05-09), `sms-welcome-series` (2026-05-09), `coupon-upgrade` (2026-05-09), `sms-abandoned-cart` (2026-05-09). Daily and weekly frequency caps now enforced uniformly across all 6 marketing flows. GAP-06 is fully resolved.

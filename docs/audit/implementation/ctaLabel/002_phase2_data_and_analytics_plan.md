# Phase 2 CTA Label — Data & Analytics Plan

**Doc ID:** 002  
**Created:** 2026-05-17  
**Status:** Planning only — no implementation  
**Phase:** 2B (data needs) / 2C (analytics writes) / Phase 3 (advanced tracking)  
**Depends on:** `000_phase2_cta_label_audit.md`, `001_phase2_implementation_plan.md`

---

## 1. Overview

The CTA label feature touches four data layers:

| Layer | Phase 2B | Phase 2C | Phase 3 |
|---|---|---|---|
| Label generation | ✅ Client-side only | — | — |
| Discount codes | ✅ Create standing codes | — | Per-order codes |
| Print event tracking | ⬜ No-op stub | ✅ DB write | — |
| QR scan tracking | ⬜ None | ⬜ None | ✅ Redirect counter |
| Review submitted | Already tracked | — | — |
| Coupon redeemed | Already tracked | — | — |
| Per-order coupon | ⬜ None | ⬜ None | ✅ If needed |

---

## 2. Phase 2B Data Requirements

### 2.1 Discount Codes (required before Phase 2B ships)

These are generic reusable codes. They live in the existing `coupons` table — no migration needed.

| Code | Type | Value | Applicable to | Notes |
|---|---|---|---|---|
| `THANKYOU15` | Percent discount | 15% | KK orders (review CTA label) | Check + create if absent |
| `DIRECT15` | Percent discount | 15% | eBay→website channel CTA | Check + create if absent |

**Action before implementing Phase 2B:**
1. Log in to admin coupon panel (or query `coupons` table in Supabase)
2. Verify both codes exist, are active, and have no per-customer redemption tracking that could conflict
3. If absent, insert via admin panel or SQL

**Verification query:**
```sql
SELECT code, discount_type, discount_value, is_active, expires_at
FROM coupons
WHERE code IN ('THANKYOU15', 'DIRECT15');
```

### 2.2 Row Data Already Available

No new queries needed for Phase 2B. The `getRowExtras` callback receives the full `v_order_summary_plus` row. The following fields are used:

| Field | Use |
|---|---|
| `r.kk_order_id` | QR URL construction, label heading |
| `r.stripe_checkout_session_id` | Button `data-print-cta` attr; passed to `printLabel` |
| `r.first_name` | "Thanks, [Name]!" personalization on KK labels |
| `getOrderSource(r)` | Determines label type |

No `fetchOrderDetails` call is needed for Phase 2B row-level printing.

---

## 3. Phase 2C Analytics — Minimal DB Addition

### 3.1 Recommended: Add columns to `fulfillment_shipments`

**New columns:**

```sql
ALTER TABLE fulfillment_shipments
  ADD COLUMN IF NOT EXISTS label_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS label_type TEXT;

-- label_type values: 'review_cta' | 'channel_cta' | null
-- label_printed_at: timestamp of most recent print action
```

**Migration file:** `supabase/migrations/<timestamp>_add_cta_label_tracking.sql`

This is a non-breaking additive migration. The new columns default to NULL on existing rows.

### 3.2 `trackLabelPrint` Implementation (Phase 2C)

In `labelPrint.js`:
```js
export async function trackLabelPrint(sessionId, labelType) {
  // Upsert into fulfillment_shipments
  // Uses the Supabase client — IMPORT from api.js or pass in as param
  // NOTE: labelPrint.js should NOT create its own Supabase client
  // PREFERRED: Accept a `track` callback from the caller (index.js passes api.upsertLabelPrint)
  // OR: Export trackLabelPrint as a no-op and call from index.js after printLabel resolves
}
```

**Architecture decision for Phase 2C:**

To avoid `labelPrint.js` importing from `api.js` (which would increase coupling), the calling code in `index.js` should handle the DB write:

```js
// in index.js event handler:
try {
  await printLabel(row);
  await trackLabelPrint(row.stripe_checkout_session_id, determineLabelType(source));
} catch (err) { … }
```

This keeps `labelPrint.js` purely about label generation/printing with no Supabase dependency.

**API function to add in `api.js` (Phase 2C):**
```js
export async function upsertLabelPrint(sessionId, labelType) {
  const { error } = await supabase
    .from("fulfillment_shipments")
    .upsert(
      {
        stripe_checkout_session_id: sessionId,
        label_printed_at: new Date().toISOString(),
        label_type: labelType,
      },
      { onConflict: "stripe_checkout_session_id", ignoreDuplicates: false }
    );
  if (error) throw error;
}
```

---

## 4. Recommended Analytics Events

### 4.1 Phase 2C (Minimal — DB only)

| Event | Where recorded | Table/column | Notes |
|---|---|---|---|
| Label printed | `index.js` → `api.upsertLabelPrint` | `fulfillment_shipments.label_printed_at` | Timestamp of last print |
| Label type | Same | `fulfillment_shipments.label_type` | `review_cta` or `channel_cta` |

**What this enables:**
- "How many CTA labels have been printed?" (COUNT where `label_printed_at IS NOT NULL`)
- "What mix of review vs channel labels?" (GROUP BY `label_type`)
- "Which orders have printed labels vs not?" (filter on `label_printed_at IS NULL`)

### 4.2 Phase 3 (Advanced — QR scan tracking)

**Option A: Redirect route in r/ directory**

The workspace already has a redirect mechanism at `/r/` (found in directory listing). A tracking redirect could be:

```
QR → https://karrykraze.com/r/?cta=review&oid=<kk_order_id>
     → redirect to leave-review.html?oid=<kk_order_id>
     → record scan in Supabase (edge function or simple log)
```

**Option B: Edge function redirect counter**

```
QR → https://karrykraze.com/r/cta?type=review&oid=<kk_order_id>
     → Edge function: log scan event + redirect
```

**Option C: UTM-only (no scan counter)**

```
QR → https://karrykraze.com/pages/leave-review.html?oid=<id>&utm_source=label&utm_medium=print&utm_campaign=review_cta
```

No server-side tracking but visible in analytics tools (Google Analytics, Meta Pixel, etc.)

**Recommendation for Phase 3:** Start with Option C (UTM-only). Zero infrastructure. Add Option B counting later if the scan rate matters.

### 4.3 Review Submitted (Already Tracked)

When a customer scans the QR and submits a review, the review is stored in the `reviews` table with:
- `reviewer_email` — customer email
- `order_session_id` — stripe session or kk_order_id
- `created_at` — submission timestamp

The admin `review_count` column in `v_order_summary_plus` already counts reviews per order. No new tracking needed.

### 4.4 Coupon Redeemed (Already Tracked)

The existing coupon system tracks redemptions. When `THANKYOU15` or `DIRECT15` is used at checkout, the redemption is recorded. No new infrastructure needed.

---

## 5. QR URL Patterns (by Phase)

| Phase | KK Label QR Target | eBay Label QR Target |
|---|---|---|
| 2B | `https://karrykraze.com/pages/leave-review.html?oid=<kk_order_id>` | `https://karrykraze.com` |
| 2C | Same + `&utm_source=cta_label&utm_medium=print&utm_campaign=review` | `https://karrykraze.com?utm_source=cta_label&utm_medium=print&utm_campaign=ebay_convert` |
| 3 | `/r/?cta=review&oid=<kk_order_id>` (scan counter) | `/r/?cta=channel` (scan counter) |

---

## 6. What Can Be Deferred to Phase 3

| Item | Reason to defer |
|---|---|
| QR scan counter / redirect route | Requires new edge function or redirect page; UTMs sufficient for Phase 2 |
| Per-order coupon code generation | Requires coupon table migration + edge fn; generic code is adequate |
| Label print count (admin dashboard widget) | Build after 2+ weeks of data |
| Amazon-specific CTA content | Amazon API not integrated; Amazon TOS more restrictive |
| Workspace Labels tab (preview) | Phase 3 UX improvement; row button is sufficient for Phase 2 |
| Print analytics by product/category | Phase 3 — requires line items in print event |
| Review conversion rate by label type | Phase 3 — combine `label_printed_at` + `review_count` |

---

## 7. Data Privacy Notes

- `kk_order_id` embedded in QR URL: **Low risk.** The order ID is not secret — it's shown to customers on their order confirmation page. Scanning the QR and submitting a review still requires the customer to enter their email.
- No PII in QR URL: confirmed. Only `kk_order_id` is in the URL.
- eBay/Amazon orders: QR points to homepage only. No order data in URL.
- GDPR/CCPA: No new personal data is collected in Phase 2B. Print timestamp (Phase 2C) is administrative data, not PII.

---

## 8. Supabase Migration File (Phase 2C Reference)

When ready, create:

**`supabase/migrations/<timestamp>_add_cta_label_tracking.sql`**

```sql
-- Phase 2C: Track CTA label print events per shipment
ALTER TABLE fulfillment_shipments
  ADD COLUMN IF NOT EXISTS label_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS label_type TEXT;

COMMENT ON COLUMN fulfillment_shipments.label_printed_at IS 'Timestamp of most recent CTA label print action by admin';
COMMENT ON COLUMN fulfillment_shipments.label_type IS 'review_cta (KK orders) | channel_cta (eBay/Amazon)';
```

**Do not run this migration in Phase 2B.**

---

## 9. Open Data Questions

| # | Question | Notes |
|---|---|---|
| D1 | Do `coupons` table rows require a `min_order_cents` or expiry? | Check before creating THANKYOU15 / DIRECT15 |
| D2 | Is there a `coupon_redemptions` table or tracking? | Confirm if generic codes get abused easily |
| D3 | Does `v_order_summary_plus` include `label_printed_at` after Phase 2C migration? | May need view refresh |
| D4 | Does the `/r/` directory already have redirect infrastructure? | Found in workspace dir listing — inspect before Phase 3 |

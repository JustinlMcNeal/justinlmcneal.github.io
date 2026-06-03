# CTA Label Feature — Phase 2 Completion Checkpoint

**Date:** 2026-05-17  
**Status:** Phase 2 complete. Browser-tested. Analytics deployed and verified.

---

## Feature Summary

Admin-printable CTA insert labels for KK website and eBay orders.  
Labels are 3.5" × 2" printed from the line items orders admin page.  
Each label contains a QR code and a discount code prompt.

- **KK website orders** → review CTA label: QR links to `/pages/leave-review.html` pre-filled with `kk_order_id`. Discount code: `THANKYOU15`.
- **eBay orders** → channel CTA label: QR links to `karrykraze.com` homepage with UTM attribution. Discount code: `DIRECT15`.
- **Amazon / unknown orders** → no CTA button shown.
- **KK orders without `kk_order_id`** → no CTA button shown.

Every print is logged to `cta_label_prints` for analytics.

---

## Final Implemented Files

| File | Role |
|------|------|
| `js/admin/lineItemsOrders/index.js` | Main entry: auth guard, CTA button injection, print wiring, tracking call |
| `js/admin/lineItemsOrders/labelPrint.js` | QR generation, label HTML build, print window management |
| `js/admin/lineItemsOrders/api.js` | `trackCtaLabelPrint()` — inserts to `cta_label_prints`; also `trackLabelPrint()` deprecated no-op stub |
| `js/admin/lineItemsOrders/renderTable.js` | `getRowExtras` seam: desktop action content + mobile action block injection; mobile click guard |
| `js/admin/lineItemsOrders/dom.js` | `getOrderSource(row)` — determines `'kk' | 'ebay' | 'amazon' | 'unknown'` |
| `supabase/migrations/20260517_cta_label_prints.sql` | Analytics event table, indexes, RLS policies |

---

## Final Database Table

### `public.cta_label_prints`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `session_id` | `text NOT NULL` | `stripe_checkout_session_id` (or `ebay_api_` prefix) |
| `kk_order_id` | `text NULL` | Null for eBay orders |
| `order_source` | `text NOT NULL` | CHECK: `'kk' \| 'ebay' \| 'amazon' \| 'unknown'` |
| `label_type` | `text NOT NULL` | CHECK: `'review_cta' \| 'channel_cta'` |
| `printed_at` | `timestamptz NOT NULL` | `DEFAULT now()` |
| `printed_by` | `text NULL` | Reserved for future admin identity; null in Phase 2 |
| `metadata` | `jsonb NOT NULL` | `DEFAULT '{}'::jsonb`. Phase 2C: `{ "qr_target": "<url>" }` |

### Indexes

| Index | Purpose |
|-------|---------|
| `idx_cta_label_prints_session_id` | "How many prints for this order?" |
| `idx_cta_label_prints_kk_order_id` (partial, `WHERE NOT NULL`) | Join to reviews in Phase 2D+ |
| `idx_cta_label_prints_printed_at DESC` | Time-series: "prints this week?" |
| `idx_cta_label_prints_label_type` | "Review CTA vs. channel CTA counts" |
| `idx_cta_label_prints_order_source` | "KK vs. eBay print volume" |

---

## Final RLS Policy Summary

| Policy | Role | Operation |
|--------|------|-----------|
| `cta_label_prints_authenticated_insert` | `authenticated` | INSERT only |
| `cta_label_prints_service_role_all` | `service_role` | ALL |

No `anon` INSERT policy. Unauthenticated visitors cannot write rows.  
The admin page now has a `requireAdminSession()` guard, so the Supabase client runs as `authenticated` for all logged-in admins.

---

## CTA Behavior by Order Source

### KK (`order_source = 'kk'`)
- Button shown **only if** `kk_order_id` is present.
- Label type: `review_cta`.
- Headline: "Thanks, [first_name]!" or "Thanks for ordering!"
- CTA copy: "Scan to leave a quick review and get 15% off your next order."
- Discount code: `THANKYOU15`
- QR target: see below.
- Analytics: inserts row with `order_source='kk'`, `label_type='review_cta'`, `kk_order_id` populated.

### eBay (`order_source = 'ebay'`)
- Button always shown.
- Label type: `channel_cta`.
- Headline: "Like your order?"
- CTA copy: "Order direct at KarryKraze.com — Scan for 15% off your first website order."
- Discount code: `DIRECT15`
- QR target: see below.
- Analytics: inserts row with `order_source='ebay'`, `label_type='channel_cta'`, `kk_order_id` null.

### Amazon (`order_source = 'amazon'`)
- No button shown. Deferred to Phase 2G.

### Unknown (`order_source = 'unknown'`)
- No button shown.

---

## Final QR Target Formats

### KK review CTA
```
https://karrykraze.com/pages/leave-review.html?oid=<encodeURIComponent(kk_order_id)>&utm_source=packing_label&utm_medium=qr&utm_campaign=review_cta
```
`leave-review.html` reads `?oid=` to pre-fill the order ID field (same pattern as `my-orders` and the `verify-order` edge function).

### eBay channel CTA
```
https://karrykraze.com/?utm_source=packing_label&utm_medium=qr&utm_campaign=ebay_direct_cta
```

---

## Final Analytics Tracking Behavior

- `trackCtaLabelPrint()` is called from `wireCta()` in `index.js` via `onPrinted` callback.
- The print window opens **before** QR generation and before tracking — print is never blocked by analytics.
- `trackCtaLabelPrint()` never throws. Returns `{ ok: true }` or `{ ok: false, error }`.
- If tracking fails: `setStatus("CTA label opened, but print tracking failed.")` — non-blocking.
- `metadata.qr_target` stores the full QR URL for Phase 2D correlation (scan event join).
- The deprecated `trackLabelPrint()` stub in `labelPrint.js` remains as a no-op for compatibility; safe to remove in a future cleanup.

---

## Manual Tests Passed

- [x] Unauthenticated visitor redirected to `/pages/admin/index.html`
- [x] Authenticated admin loads orders normally
- [x] KK order with `kk_order_id` → Print CTA button visible
- [x] KK order without `kk_order_id` → no button
- [x] Amazon order → no button
- [x] KK print: window opens, review CTA copy, correct QR target, row inserted in `cta_label_prints`
- [x] eBay print: window opens, channel CTA copy, correct QR target, row inserted in `cta_label_prints`
- [x] Mobile card CTA click does not open workspace
- [x] `node --check js/admin/lineItemsOrders/*.js` → 15/15 pass

---

## Known Limitations

1. **QR scan tracking not implemented.** Phase 2 logs that a label was printed, but does not track whether the customer scanned the QR or visited the URL. This is Phase 2D.

2. **Coupon redemption attribution not implemented.** No connection yet between a printed label's `THANKYOU15`/`DIRECT15` code and actual coupon redemption or revenue. This is Phase 2E.

3. **Amazon CTA disabled.** `order_source = 'amazon'` returns `labelType = "none"`. Amazon orders are deferred until the Amazon order import and API flow is more finalized. This is Phase 2G.

4. **eBay CTA policy not reviewed.** The `channel_cta` approach (drive eBay buyers to direct website) should be reviewed against eBay seller policy before scaling.

5. **Migration applied directly via `pg` client.** The Supabase CLI `db push` cannot be used because the remote `schema_migrations` history table is out of sync with local migration files (60+ pre-existing migrations not tracked). The `20260517_cta_label_prints.sql` migration was applied via Node `pg` client using `SUPABASE_DB_PASSWORD`. This is consistent with the project's current migration pattern — see similar migrations applied earlier in the project's history.

6. **`cta_label_prints` not registered in `schema_migrations`.** The local migration file exists at `supabase/migrations/20260517_cta_label_prints.sql` but is not registered in the remote `schema_migrations` table (same as most other local migrations in this project).

7. **`printed_by` column is always null in Phase 2.** The column is reserved for future admin identity tracking (e.g. storing the admin's email or user ID). Not populated until Phase 2F or later.

---

## Recommended Future Phases

### Phase 2D — QR Scan Tracking
**Goal:** Know if the customer actually scanned the QR on a printed label.

**Possible path:**
- Replace direct QR targets with a tracking redirect URL (e.g. `/r?t=<token>` or an Edge Function endpoint).
- The redirect records a `cta_label_scans` event (join back to `cta_label_prints` via `session_id` or token).
- Redirect the customer to the final destination (`leave-review.html` or homepage).
- Enables print-to-scan conversion rate measurement.

**Key design question:** token-based (1:1 print → token) vs. shared-URL (all prints for same order share one URL).

---

### Phase 2E — Coupon Attribution
**Goal:** Connect a printed label's coupon to a revenue event.

**Possible path:**
- Track when `THANKYOU15` or `DIRECT15` is entered at checkout.
- Identify the `cta_label_prints` row for the same order.
- Record `coupon_shown_at`, `coupon_claimed_at`, `revenue_attributed_cents`.
- Enables ROI measurement for each label type.

---

### Phase 2F — Workspace Labels Tab
**Goal:** View and manage CTA label history inside the order workspace.

**Possible path:**
- Add a "Labels" tab to the order workspace modal (alongside Overview, Financials, Fulfillment, IDs).
- Show print history from `cta_label_prints` for the current order's `session_id`.
- Show QR target URL and print timestamp.
- "Reprint" button calls `printLabel()` again.
- Show analytics status: printed / not printed / scan confirmed (if Phase 2D active).

---

### Phase 2G — Amazon CTA Support
**Goal:** Show a CTA label button for Amazon orders.

**Possible path:**
- Enable `label_type = 'channel_cta'` for `order_source = 'amazon'` once Amazon order import/API flow is stable.
- Review copy and QR target for Amazon context (Amazon policy prohibits directing buyers off Amazon for repeat purchases — label copy must be carefully worded).
- May need a separate `amazon_cta` label type and dedicated coupon code.

---

## SQL Verification Query

```sql
SELECT
  session_id,
  kk_order_id,
  order_source,
  label_type,
  printed_at,
  metadata->>'qr_target' AS qr_target
FROM public.cta_label_prints
ORDER BY printed_at DESC
LIMIT 20;
```

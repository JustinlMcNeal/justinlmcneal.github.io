# Phase 5B — Amazon Fee Breakdown (Product Fees API)

**Prior:** [5A live profit column](040_live_profit_column.md)

Product Fees API (`getMyFeesEstimates`) for per-listing fee totals and a clickable breakdown tooltip. Updates profit column when SP-API data loads (falls back to 5A 15% referral until then).

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `amazon-estimate-listing-fees` edge function | Persistent `amazon_fee_estimates` table |
| Batch up to **20** listings per request | Full-catalog fee prefetch |
| Auto-fetch for visible Synced page rows | Push modal fee preview |
| Click fee cell → breakdown tooltip | Guaranteed Seller Central match |
| Profit column uses API fees when cached | Fee rate cards / category lookup |

---

## Part A — Edge function

**Function:** `amazon-estimate-listing-fees`

| Method | Auth |
|--------|------|
| `POST` | Admin JWT |

### Input

```json
{ "amazonListingIds": ["uuid", "uuid"] }
```

Max **20** IDs per request (Product Fees API batch limit).

### Behavior

1. Load rows from `v_amazon_listing_workspace` (`profit_calc_status = complete`)
2. Group by `seller_account_id` → resolve SP-API credentials
3. `POST /products/fees/v0/feesEstimate` with `IdType: SellerSKU` (or ASIN fallback)
4. `IsAmazonFulfilled` from `fulfillment_channel`
5. Parse `FeeDetailList` + `TotalFeesEstimate`
6. Compute `estProfit = price - kk_cogs - totalFees` when COGS known

### Response (per listing)

```json
{
  "amazonListingId": "uuid",
  "status": "success",
  "totalFees": 6.42,
  "currency": "USD",
  "feeDetails": [
    { "feeType": "ReferralFee", "label": "Referral", "amount": 4.50, "currency": "USD" },
    { "feeType": "FBAFees", "label": "FBA fulfillment", "amount": 1.92, "currency": "USD" }
  ],
  "estProfit": 8.07,
  "source": "product_fees_api"
}
```

### Errors

| Code | Meaning |
|------|---------|
| `batch_limit_exceeded` | >20 IDs |
| `amazon_not_connected` | No active token |
| `sp_api_fees_failed` | SP-API error (403 = missing Pricing role) |
| `listing_not_estimable` | Missing price/SKU |

---

## Part B — Shared utils

**File:** `supabase/functions/_shared/amazonFeesEstimateUtils.ts`

- `buildFeesEstimateBatchRequest`
- `callGetMyFeesEstimates`
- `parseFeesEstimateBatchResponse`
- `estimateListingFeesForAccount`

---

## Part C — Frontend

| File | Role |
|------|------|
| `js/admin/amazon/listingFees.js` | Cache, prefetch visible rows, tooltip |
| `js/admin/amazon/listingProfit.js` | API fees override 5A fallback; fee/profit markup |
| `js/admin/amazon/api.js` | `estimateAmazonListingFees()` |
| `css/pages/admin/amazon.css` | `.amazon-fee-tooltip` popover |

### UX flow

1. Synced tab renders with **15% fallback** fees (5A)
2. After render, prefetch Product Fees for visible page (≤20 per call, batched)
3. Table re-renders with **SP-API est.** totals + updated profit
4. Click fee cell → tooltip with line-item breakdown + total + est. profit

Cache clears on full listings refresh.

---

## SP-API requirements

- **Pricing** and/or **Product Listing** role on the SP-API app
- AWS SigV4 signing (same as sync/submit)
- Rate limits apply (~1 batch / 1–2 seconds per Amazon guidance)

---

## Security

- [x] No Amazon calls from browser
- [x] Admin JWT required
- [x] Read-only Product Fees API

---

## Deployment

```bash
supabase functions deploy amazon-estimate-listing-fees
```

Requires 5A migration (`20260802`) for `kk_cogs` / `profit_calc_status`.

---

## Known limitations

- Estimates not guaranteed (Amazon disclaimer)
- No DB cache — refetch on page refresh
- Export CSV still uses view-based 5A fees unless extended
- Tooltip only for successfully estimated rows

---

## Recommended next phase

**5C — KK vs Amazon price mismatch highlights**.

---

## Manual test checklist

1. Connected Amazon + mapped listing with unit cost → visible rows prefetch SP-API fees
2. Fee column switches from “15% fallback” to “SP-API est.”
3. Click fee cell → breakdown shows Referral / FBA lines
4. Profit updates to use API total fees
5. Missing Pricing role → prefetch fails silently; 5A fallback remains

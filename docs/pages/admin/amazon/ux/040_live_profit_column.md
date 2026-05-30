# Phase 5A — Live Profit Column

**Prior:** [4E bulk price/qty](039_bulk_patch_price_qty.md)

Estimated per-unit profit on the Synced listings table using **KK COGS** (from `products`) and a **15% referral fee estimate**. No new edge function — computed in `v_amazon_listing_workspace`.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `est_profit`, `est_amazon_fees`, `kk_cogs` on workspace view | Product Fees API (→ 5B) |
| Amazon Fee + Est. Profit columns (desktop + mobile) | FBA fulfillment fee accuracy |
| Profit sort (`profit_desc`) | Price mismatch highlights (→ 5C) |
| CSV export profit columns | Guaranteed Seller Central fee match |
| View-details toast includes est. profit | Activity audit |

---

## Part A — Database view

**Migration:** `20260802_amazon_listing_profit_view.sql`

Extends `v_amazon_listing_workspace` with:

| Column | Source |
|--------|--------|
| `kk_unit_cost` | `products.unit_cost` |
| `kk_weight_g` | `products.weight_g` |
| `kk_cogs` | `unit_cost` + supplier ship per unit (EUB/HK-UPS formula, qty 30) |
| `est_referral_fee_rate` | Fixed `0.15` (15%) |
| `est_referral_fee` | `price × 0.15` |
| `est_amazon_fees` | Same as referral in 5A |
| `est_profit` | `price - kk_cogs - est_amazon_fees` |
| `profit_calc_status` | `complete` \| `missing_cogs` \| `missing_price` \| `unmapped` |

### COGS formula

Matches `js/admin/pStorage/profitCalc.js` / eBay finance views:

- Bulk qty **30** for supplier ship allocation
- EUB if `weight_g × 30 ≤ 2000g`, else HK-UPS
- CNY→USD rate **0.1437**

### Status rules

| Status | UI |
|--------|-----|
| `complete` | Shows fee + profit |
| `missing_cogs` | `—` + hint “Set unit cost” |
| `missing_price` | `—` + hint “No Amazon price” |
| `unmapped` | `—` + hint “Unmapped” |

---

## Part B — Frontend

| File | Change |
|------|--------|
| `js/admin/amazon/listingProfit.js` | Formatting, sort value, column markup |
| `js/admin/amazon/renderListings.js` | Live fee + profit cells |
| `js/admin/amazon/listingsQuery.js` | `profit_desc` sort |
| `js/admin/amazon/listingsExport.js` | COGS, fees, profit CSV columns |
| `js/admin/amazon/api.js` | Extended `LISTINGS_COLUMNS` |
| `pages/admin/amazon.html` | Column header tooltips |

### Display notes

- Profit color: green (> $5), amber ($0–$5), red (≤ $0)
- FBA rows show **“referral only”** under fee (fulfillment excluded until 5B)
- All values labeled **Est.** in headers/tooltips

---

## Formula (complete rows)

```
kk_cogs = unit_cost + supplier_ship_per_unit
est_amazon_fees = amazon_price × 0.15
est_profit = amazon_price - kk_cogs - est_amazon_fees
```

---

## Deployment

```bash
supabase db push
```

No edge function deploy for 5A.

---

## Known limitations

- **15% flat referral** — real category rates vary (8–20%+)
- **FBA fulfillment fees** not included (understates fees, overstates profit on FBA)
- Requires mapped product with `unit_cost > 0`
- Estimates are not guaranteed (Amazon disclaimer applies)

---

## Recommended next phase

**5C — KK vs Amazon price mismatch highlights**.

---

## Manual test checklist

1. Mapped listing with `unit_cost` → fee + profit columns populate
2. Product without unit cost → “Set unit cost” hint
3. Sort by **Profit (high to low)** orders by `est_profit`
4. Export CSV includes COGS, fees, profit columns
5. FBA listing shows referral-only note under fee

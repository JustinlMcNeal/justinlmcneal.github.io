# Phase 5C — KK vs Amazon Price Mismatch Highlights

**Prior:** [5B Amazon fee breakdown](041_amazon_fee_breakdown.md)

Compare synced **Amazon listing price** to **KK catalog price** (`products.price`) on mapped rows. Surface mismatches in the Synced listings table, toolbar filter, count badge, and CSV export.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `price_compare_status`, `has_price_mismatch`, `price_delta`, `price_delta_pct` on workspace view | Auto-sync KK price to Amazon |
| Price column shows Amazon + KK + direction badge | Sale/promo price rules |
| Row highlight (amber = Amazon higher, sky = Amazon lower) | Inventory mismatch (→ 5D) |
| Toolbar filter `#amazonPriceCompareFilter` | Issue creation in `amazon_listing_issues` |
| Table badge `#amazonPriceMismatchCountLabel` | Bulk “fix all prices” action |

---

## Part A — Database view

**Migration:** `20260803_amazon_price_mismatch_view.sql`

Extends `v_amazon_listing_workspace` (replaces 5A view definition):

| Column | Meaning |
|--------|---------|
| `price_compare_status` | `match` \| `amazon_higher` \| `amazon_lower` \| `missing_amazon_price` \| `missing_kk_price` \| `unmapped` |
| `has_price_mismatch` | `true` when mapped, both prices > 0, and `ABS(amazon - kk) > 0.01` |
| `price_delta` | `amazon_price - kk_price` (rounded 2dp) |
| `price_delta_pct` | `(delta / kk_price) × 100` (rounded 1dp) |

### Match tolerance

**$0.01** — treats penny-level rounding as a match.

### Compare rules

| Condition | Status |
|-----------|--------|
| No KK mapping | `unmapped` |
| Amazon price null/≤ 0 | `missing_amazon_price` |
| KK price null/≤ 0 | `missing_kk_price` |
| `ABS(delta) ≤ 0.01` | `match` |
| Amazon > KK | `amazon_higher` |
| Amazon < KK | `amazon_lower` |

---

## Part B — Frontend

| File | Change |
|------|--------|
| `js/admin/amazon/listingPriceMismatch.js` | Formatting, row class, column markup, count helper |
| `js/admin/amazon/renderListings.js` | Price cell markup, row/card highlights, mismatch badge |
| `js/admin/amazon/listingsQuery.js` | `priceCompare` filter + `matchesPriceCompare` |
| `js/admin/amazon/listingsToolbar.js` | Wire `#amazonPriceCompareFilter` |
| `js/admin/amazon/liveListings.js` | Pass `priceMismatchCount` to table header |
| `js/admin/amazon/listingsExport.js` | KK price + compare columns; view-details line |
| `js/admin/amazon/api.js` | Extended `LISTINGS_COLUMNS` |
| `pages/admin/amazon.html` | Price compare filter + count badge |
| `css/pages/admin/amazon.css` | Row highlight styles |

### Price column (desktop + mobile)

- **Match:** Amazon price + green “Matches KK”
- **Mismatch:** Amazon price (colored) + KK price subline + badge (`Amazon higher` amber / `Amazon lower` sky) with delta $ and %
- **Missing data:** Amazon price only or “KK price N/A”

### Toolbar filter values

| Value | Shows |
|-------|-------|
| *(empty)* | All |
| `mismatch` | Any `has_price_mismatch` |
| `amazon_higher` | Amazon > KK |
| `amazon_lower` | Amazon < KK |
| `match` | Within tolerance |

---

## Deploy

```bash
supabase db push   # 20260803_amazon_price_mismatch_view.sql
```

No new edge function. Requires prior **5A** migration (`kk_price` on workspace view).

---

## Verification

1. Open Synced tab with mapped listings where KK and Amazon prices differ by > $0.01
2. Price column shows KK subline + direction badge; row has left border highlight
3. Table header shows `N price mismatch` badge when count > 0
4. Filter “Any Mismatch” / “Amazon Higher” / “Amazon Lower” / “Matches KK” works
5. Export CSV includes `KK Price`, `Price Compare Status`, `Price Delta`, `Has Price Mismatch`
6. View-details toast includes mismatch summary when applicable

---

## Next

**5E — Listing health / suppression issues**.

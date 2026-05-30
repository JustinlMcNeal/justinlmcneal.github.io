# Phase 5D — Inventory Mismatch Detection

**Prior:** [5C price mismatch highlights](042_price_mismatch_highlights.md)

Compare **KK warehouse stock** (`product_variants` aggregate) to **Amazon fulfillable quantity** on mapped **FBM** listings. FBA-managed rows show fulfillable qty only (not counted as mismatches — qty is not PATCHable from admin).

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `inventory_compare_status`, `has_inventory_mismatch`, `inventory_delta` on workspace view | Auto-sync qty to Amazon |
| Inventory column shows Amazon qty + KK stock + direction badge (FBM) | FBA vs KK warehouse reconciliation |
| Row highlight for FBM mismatches | Bulk “match all stock” (use existing `match_kk_stock` in bulk bar) |
| Toolbar filter `#amazonInventoryCompareFilter` | Reserved/inbound FBA columns (→ 5F) |
| Table badge `#amazonInventoryMismatchCountLabel` | Issue creation in `amazon_listing_issues` |

---

## Part A — Database view

**Migration:** `20260804_amazon_inventory_mismatch_view.sql`

Extends `v_amazon_listing_workspace`:

| Column | Meaning |
|--------|---------|
| `is_fba_managed` | FBA/AFN channel or FBA qty with no FBM qty |
| `amazon_fulfillable_qty` | `fba_fulfillable_quantity` when FBA, else `fbm_quantity` |
| `inventory_compare_status` | `match` \| `amazon_higher` \| `amazon_lower` \| `fba_managed` \| `missing_amazon_qty` \| `unmapped` |
| `has_inventory_mismatch` | FBM mapped row where `fbm_quantity <> kk_stock` |
| `inventory_delta` | `fbm_quantity - kk_stock` (FBM comparable rows only) |

### FBA detection

Matches `isFbaManagedListing` in `amazonListingPatchUtils.ts`:

- `fulfillment_channel` contains `AMAZON` or equals `AFN`
- OR `fba_fulfillable_quantity > 0` and `fbm_quantity <= 0`

### Compare rules (FBM only)

| Condition | Status |
|-----------|--------|
| No KK mapping | `unmapped` |
| FBA managed | `fba_managed` (informational) |
| `fbm_quantity` IS NULL | `missing_amazon_qty` |
| `fbm_quantity = kk_stock` | `match` |
| `fbm_quantity > kk_stock` | `amazon_higher` |
| `fbm_quantity < kk_stock` | `amazon_lower` |

Integer exact match — no tolerance (unlike price $0.01).

---

## Part B — Frontend

| File | Change |
|------|--------|
| `js/admin/amazon/listingInventoryMismatch.js` | Formatting, row class, column markup, count helper |
| `js/admin/amazon/renderListings.js` | Inventory cell markup, combined row/card highlights |
| `js/admin/amazon/listingsQuery.js` | `inventoryCompare` filter |
| `js/admin/amazon/listingsToolbar.js` | Wire `#amazonInventoryCompareFilter` |
| `js/admin/amazon/liveListings.js` | Pass `inventoryMismatchCount` to table header |
| `js/admin/amazon/listingsExport.js` | Stock compare columns; view-details line |
| `js/admin/amazon/api.js` | Extended `LISTINGS_COLUMNS` |
| `pages/admin/amazon.html` | Stock compare filter + count badge |
| `css/pages/admin/amazon.css` | Inventory row highlight styles (violet) |

### Inventory column (desktop + mobile)

- **FBA:** Amazon fulfillable count + “FBA fulfillable” subline
- **FBM match:** Amazon qty + green “matches KK” (amber “low” when ≤ 5)
- **FBM mismatch:** Amazon qty (colored) + KK subline + badge with unit delta
- **Missing Amazon qty:** primary fallback + “No Amazon qty”

### Toolbar filter values

| Value | Shows |
|-------|-------|
| *(empty)* | All |
| `mismatch` | Any `has_inventory_mismatch` (FBM only) |
| `amazon_higher` | Amazon qty > KK stock |
| `amazon_lower` | Amazon qty < KK stock |
| `match` | Exact FBM match |
| `fba_managed` | FBA informational rows |

### Fix path

Use existing bulk action **`match_kk_stock`** (4E) or row **Update Inventory** (4C) on FBM listings.

---

## Deploy

```bash
supabase db push   # 20260804_amazon_inventory_mismatch_view.sql
```

No new edge function. Requires **5C** migration chain (workspace view).

---

## Verification

1. Mapped FBM listing with `fbm_quantity <> kk_stock` shows mismatch badge and violet row highlight
2. FBA listing shows fulfillable qty without mismatch badge; filter “FBA Managed” finds it
3. Table header shows `N stock mismatch` when FBM mismatches exist
4. Filter “Any Mismatch” / direction filters work
5. Export CSV includes stock compare columns
6. View-details toast includes stock mismatch summary

---

## Next

**Phase 6** — UX polish (table settings, activity history, analytics). Fulfillment columns shipped in [`045_fba_fbm_inventory_columns.md`](045_fba_fbm_inventory_columns.md).

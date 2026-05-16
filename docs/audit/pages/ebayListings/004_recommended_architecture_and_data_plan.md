# 004 — eBay Listings Recommended Architecture and Data Plan

**Date:** 2026-05-12  
**Goal:** Evolve the page into an internal eBay listing workspace while reusing the existing vanilla/Tailwind/Supabase/Edge Function architecture.

---

## 1. Architecture principle

Do not turn the browser page into the analytics engine.

The current page already has a large `index.js` orchestration file. The next architecture should add a read-oriented data layer and split UI modules so the page can show decisions without adding brittle client-side joins.

Recommended model:

```text
products / variants / images
        +
eBay orders / line items / finance transactions
        +
eBay listing performance snapshots (future)
        ↓
Supabase views: listing workspace, sales aggregates, profit aggregates, issue flags
        ↓
js/admin/ebayListings/api.js
        ↓
workspace UI modules (table/cards/drawer/modals)
        ↓
existing ebay-manage-listing actions for writes
```

---

## 2. Suggested future frontend module structure

Current:

```text
js/admin/ebayListings/
  index.js         huge orchestrator
  utils.js
  editor.js
  images.js
  volPricing.js
```

Recommended incremental split:

```text
js/admin/ebayListings/
  index.js                 init + event wiring only
  api.js                   Supabase reads + edge calls
  state.js                 shared page state
  table.js                 table rendering + row events
  cards.js                 card rendering + card events
  filters.js               search/status/issue filters
  workspacePanel.js         right-side drawer/detail panel
  pushModal.js             existing push flow
  editModal.js             existing edit flow
  bulkActions.js           bulk price/qty/optimization later
  listingHealth.js          deterministic scoring + issue labels
  profitPreview.js          estimated fees/profit helpers
  salesHistory.js           detail panel sales/profit renderers
  promotionPanel.js         volume + future promoted listings UI
  editor.js                keep
  images.js                keep
  volPricing.js            keep
  utils.js                 keep pure helpers
```

This keeps vanilla JS, no build step, no React, no inline JS.

---

## 3. Suggested UI/workspace structure

### Recommended page sections

1. **Workspace Overview**
   - Total active/draft/not listed
   - Needs work count
   - Low margin count
   - Sold 30d / revenue 30d / profit 30d
   - Stale active count

2. **Main Listing Table/Cards**
   - Product
   - Status
   - KK price / eBay price
   - Estimated margin
   - Sold 30d / last sold
   - Listing score
   - Promo status
   - Issue badges
   - Primary action

3. **Right-side Detail Drawer**
   - Product/catalog details
   - Current eBay linkage
   - Sales history
   - Profit/fees
   - Listing issues
   - Optimization checklist
   - Action buttons: Edit, Revise Price, Promote, End

4. **Push/Edit Modals**
   - Keep existing flows, but add:
     - profit preview
     - quality checklist
     - price reference
     - required warning block before submit

5. **Import/Setup**
   - Keep panels but move into a `Setup / Import` tab or collapsed section.

---

## 4. Recommended Supabase views

## 4.1 `v_ebay_listing_workspace`

Purpose: single read model for the main page.

Suggested columns:

```sql
product_id
product_code
product_name
slug
is_active
category_id
category_name
kk_price_cents
unit_cost_cents
weight_g
catalog_image_url
primary_image_url

-- eBay local state
ebay_sku
ebay_offer_id
ebay_listing_id
ebay_status
ebay_category_id
ebay_price_cents
ebay_item_group_key
ebay_volume_promo_id
ebay_store_category

-- variant/image readiness
active_variant_count
active_variant_stock_total
catalog_image_count
has_primary_image
has_variant_images

-- sales history
ebay_sold_7d
ebay_sold_30d
ebay_sold_90d
ebay_last_sold_at
ebay_avg_sold_price_cents_90d
ebay_revenue_cents_90d

-- profit history
ebay_profit_cents_30d
ebay_profit_cents_90d
ebay_fees_cents_90d
ebay_ad_fees_cents_90d
finance_status_rollup

-- computed flags
listing_score
issue_flags jsonb
issue_count
stale_days
```

Data sources:

- `products`
- `product_gallery_images`
- `product_variants`
- `orders_raw`
- `line_items_raw`
- `ebay_finance_transactions`
- `v_ebay_order_profit`

Known hard part:

- Mapping eBay sold history to listing/SKU/product must be verified. If `line_items_raw.product_id` reliably stores `products.code`, use that first. If variant SKU/listing ID is missing, add it to order sync before trying to do per-variant analytics.

## 4.2 `v_ebay_product_sales_summary`

Purpose: isolate order/sales aggregation from the page workspace view.

Suggested windows:

- 7d
- 30d
- 90d
- lifetime

Suggested fields:

```sql
product_code
sold_qty_7d
sold_qty_30d
sold_qty_90d
last_sold_at
avg_sold_price_cents_90d
gross_revenue_cents_90d
order_count_90d
```

## 4.3 `v_ebay_product_profit_summary`

Purpose: use existing `v_ebay_order_profit` and line items to summarize product-level profit.

Suggested fields:

```sql
product_code
profit_cents_30d
profit_cents_90d
ebay_fee_cents_90d
ebay_ad_fee_cents_90d
label_cost_cents_90d
finance_complete_order_count
finance_estimated_order_count
finance_missing_order_count
```

## 4.4 Future `ebay_listing_performance_daily`

Needed for impressions/clicks/watchers/conversion.

Suggested table:

```sql
CREATE TABLE ebay_listing_performance_daily (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  product_code text,
  ebay_sku text,
  date date not null,
  impressions integer default 0,
  clicks integer default 0,
  quantity_sold integer default 0,
  watchers integer,
  ctr numeric,
  conversion_rate numeric,
  raw_payload jsonb,
  synced_at timestamptz default now(),
  unique (listing_id, date)
);
```

Unknown: exact eBay API source. Existing docs mention traffic reports, but no active integration was found.

---

## 5. Recommended edge function additions

### 5.1 `ebay-listing-workspace-data` (optional)

If Supabase views become complex or need privileged joins, add an edge function that returns the workspace data.

However, prefer Supabase view first because:

- the page already reads Supabase directly
- authenticated read policies can expose aggregate data
- avoids another server route unless necessary

### 5.2 `ebay-sync-listing-performance`

Purpose:

- scheduled sync of listing traffic/performance metrics
- writes `ebay_listing_performance_daily`

Inputs:

- active `products.ebay_listing_id`
- marketplace `EBAY_US`

Outputs:

- daily rows by listing ID

Risk:

- API availability/scopes/rate limits need confirmation.

### 5.3 `ebay-pricing-reference`

Purpose:

- fetch external comps/live price references later

Do **not** start here. Internal sold-price/profit reference is cheaper and more reliable.

### 5.4 Extend `ebay-manage-listing` only when needed

Keep write actions in `ebay-manage-listing`:

- listing CRUD
- volume discounts
- future promoted-listing campaign actions if they are direct eBay mutations

Do not overload it with read-heavy analytics. It is already large.

---

## 6. Recommended data fixes before advanced features

### 6.1 Verify order-to-product mapping

Before adding sold history, verify:

- `line_items_raw.product_id` equals `products.code` for eBay orders.
- Variant eBay SKUs are preserved somewhere.
- eBay line items include item/listing IDs in raw payload, or raw payload can be used.

If not, update `ebay-sync-orders` to persist:

```text
ebay_listing_id
ebay_item_id
ebay_sku
ebay_line_item_id
raw_line_item_payload
```

on `line_items_raw` or a dedicated eBay line-item mapping table.

### 6.2 Create listing dimension table if needed

If the product row remains too overloaded, add:

```sql
CREATE TABLE ebay_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id),
  product_code text,
  ebay_sku text,
  ebay_offer_id text,
  ebay_listing_id text,
  ebay_item_group_key text,
  status text,
  category_id text,
  price_cents integer,
  is_variant boolean default false,
  variant_option_name text,
  variant_option_value text,
  last_synced_at timestamptz,
  raw_item jsonb,
  raw_offer jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Do not introduce this table until product-level view limitations are proven. The current product-row approach is acceptable for Phase 1 workspace readouts.

---

## 7. Listing score architecture

Start deterministic and transparent.

Suggested scoring:

| Area | Points | Data source |
|---|---:|---|
| Active eBay linkage healthy | 15 | `products.ebay_*` |
| eBay price present and margin-safe | 20 | `products`, profit estimator |
| Category present | 10 | `products.ebay_category_id` |
| Image readiness | 15 | image fields/gallery/variant previews |
| Required specifics complete | 15 | eBay item + taxonomy aspects, or cached snapshot later |
| Sales/velocity healthy | 15 | sales summary view |
| Not stale | 10 | active age + last sold/performance |

Output:

```json
{
  "score": 72,
  "flags": ["low_image_count", "no_sales_30d", "margin_unknown"],
  "recommended_action": "Review price and add photos"
}
```

Implement first in JS (`listingHealth.js`) against `v_ebay_listing_workspace`. If stable, move into SQL view later.

---

## 8. Profit preview architecture

Add `profitPreview.js` with pure functions:

```js
estimateEbayFinalValueFee(priceCents, categoryId)
estimatePaymentFixedFee(priceCents)
estimateSupplierShipCents(weightG)
estimateLabelCostCents(weightOz, dimensions)
estimateProfit({ priceCents, productCostCents, labelCostCents, adRatePct })
```

Inputs:

- product `unit_cost`
- product `weight_g`
- modal price
- modal package weight/dimensions
- optional ad rate percent
- existing `ebay_price_cents`

Output:

- estimated fees
- estimated shipping
- estimated profit
- margin percent
- warning flags

Important: mark as estimate until real sale finance data arrives.

---

## 9. Promotion architecture

### Current support

- Volume discount item promotions only.

### Recommended next support

Phase 1:

- Show volume promo badge from `products.ebay_volume_promo_id`.
- Show historical ad fee totals from `v_ebay_order_profit` / finance summary.

Phase 2:

- Add `ebay_promotions` table for campaign metadata.
- Add Marketing API actions for Promoted Listings Standard only after confirming scope/API endpoint.

Suggested table:

```sql
CREATE TABLE ebay_listing_promotions (
  id uuid primary key default gen_random_uuid(),
  ebay_listing_id text,
  product_code text,
  promotion_type text,
  promotion_id text,
  campaign_id text,
  status text,
  ad_rate_pct numeric,
  start_at timestamptz,
  end_at timestamptz,
  raw_payload jsonb,
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

---

## 10. Reuse existing architecture

Reuse:

- `callEdge()` auth/session pattern.
- `requireAdmin()`.
- existing Tailwind-heavy page shell.
- `ebay-manage-listing` for eBay mutations.
- `ebay-taxonomy` for category/aspects.
- `ebay-ai-autofill` for suggestion-only optimization.
- `v_ebay_order_profit` as source for actual profit.
- Line Items order page profit display patterns for fee/status chips.

Avoid:

- Inline JS in future generated markup.
- More giant functions in `index.js`.
- Letting AI mutate live listings automatically.
- Building promoted-listing ad controls before profit/performance visibility exists.

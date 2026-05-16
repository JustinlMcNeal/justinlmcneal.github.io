# 003 — eBay Listings Feature Gap Analysis

**Date:** 2026-05-12  
**Target:** Turn eBay Listings from an operations console into the internal workspace for publishing, optimizing, pricing, promoting, and managing eBay listings.

---

## 1. Priority matrix

| Priority | Gap | Business value | Feasibility | Why |
|---:|---|---|---|---|
| P0 | Add listing workspace summary data view | Very high | High | Existing page already loads products; existing order/finance data can be joined. |
| P0 | Add profit/fee preview for publish/revise | Very high | Medium | Product cost + shipping assumptions already exist elsewhere; needs safe estimator view/helper. |
| P0 | Add sold history per product/listing/SKU | Very high | Medium | eBay orders are already synced; needs join/view and UI panel. |
| P1 | Add optimization score + issue flags | High | Medium | Most inputs already in page/eBay item data; can start with local deterministic checks. |
| P1 | Add price reference workflow | High | Medium | Internal KK price + historical sold price feasible; external comps need new eBay Browse/Marketplace Insights work. |
| P1 | Add performance/conversion metrics | High | Medium/Low | Existing docs mention Traffic Reports, but no active integration found. Needs backend first. |
| P2 | Promoted Listings Standard manager | High when sales volume grows | Medium/Low | Marketing API already used for volume discounts, but ad campaigns are separate data/actions. |
| P2 | Bulk optimization queue | Medium/High | Medium | Should come after scoring/gaps exist. |
| P3 | AI continuous optimizer | Medium | Medium | AI Auto-Fill exists, but automation should wait until deterministic scoring/data is stable. |

---

## 2. Listing optimization gaps

### What exists now

- AI Auto-Fill for title/description/item specifics in push/edit modals.
- eBay title maxlength enforced by input `maxlength=80`.
- Category search via `ebay-taxonomy` `suggest_category`.
- Item aspects via `get_aspects`, with required aspect validation.
- Image strip/gallery reorder, main image first.
- Description Visual/HTML/Preview mode and sanitizer.
- Variant-specific lead image override in edit modal.
- Best Offer, lot size, store category, package dimensions, policies, volume pricing.

### What is missing

| Gap | Current evidence | Needed |
|---|---|---|
| No listing quality score | No row/card field or view for quality | Add deterministic score: title length/keywords, required aspects, image count, price margin, stale age, stock, active status. |
| No completeness meter | Aspects are loaded only inside modal | Store or compute aspect completeness by category/listing. |
| No optimization queue | List only filters by status/search | Add `Needs Optimization`, `Low Margin`, `Missing Images`, `Missing Required Specifics`, `Stale Active`, `No Sales` filters. |
| No title keyword analysis | AI generates once, no scoring | Add title score rules: length 65-80, product type terms, color/style/material terms where known, avoid brand misuse. |
| No category confidence persistence | Category suggestion selection not persisted except category ID | Store category name/confidence/source or at least display chosen category metadata. |
| No image readiness checks | Image helper only builds/reorders URLs | Add checks: at least 3 images, first image present, variant lead images, no broken URLs, min count warning. |
| AI not grounded in selected category values enough | AI uses aspect names but not full allowed values | Pass current aspect values and product tags/category/gallery to AI; add review notes. |
| No bulk optimization | Bulk only price/qty | Add bulk AI prefill/quality queue only after deterministic score exists. |

### Recommended first optimization layer

Start with local deterministic checks, not AI:

- `listing_score` 0-100
- issue flags:
  - `missing_listing_id`
  - `missing_category`
  - `missing_ebay_price`
  - `price_below_kk_price`
  - `low_margin_estimate`
  - `low_image_count`
  - `missing_variant_images`
  - `missing_required_aspects` (requires eBay item/aspect fetch or local snapshot)
  - `stale_active_no_sales_30d`
  - `active_no_volume_or_promo`

---

## 3. Sales history gaps

### What exists now

- `ebay-sync-orders` syncs eBay orders into `orders_raw`, `line_items_raw`, and fulfillment rows.
- `line_items_raw.product_id` appears intended to map to product code via fuzzy matching.
- Product page does not query any of it.

### Missing on page

| Needed | Current support | Gap |
|---|---|---|
| Sold history by product | Likely possible via `line_items_raw.product_id = products.code` | No view/query wired. |
| Sold history by SKU/listing | Unclear | Need line item fields for eBay SKU/listing ID, or stable mapping. |
| eBay-only sold history | Possible via `orders_raw.stripe_checkout_session_id LIKE 'ebay_%'` | Not surfaced. |
| Last sold date | Possible from `orders_raw.created_at` / order date | Need view. |
| Average sold price | Possible from line/order amounts | Need line-level price normalization. |
| Quantity sold over time | Possible from `line_items_raw.quantity` | Need aggregation by product/SKU/listing. |
| Velocity signals | Derived | Need windows: 7d/30d/90d. |
| Ended vs sold outcome | Local `products.ebay_status` + sales history | Need view and UI. |

### High-value first sales widgets

For each product row/card:

- `sold_30d`
- `sold_90d`
- `last_sold_at`
- `avg_sold_price_cents_90d`
- `gross_ebay_revenue_90d`
- `net_profit_90d` if finance data available

This immediately turns the page from "what can I push?" into "what deserves attention?"

---

## 4. Promotion manager gaps

### What exists now

- Volume discount (`VOLUME_DISCOUNT`) item promotions via Marketing API.
- Product row stores `ebay_volume_promo_id`.
- Edit modal fetches existing promotion and allows tier update/delete.

### Missing

| Gap | Details |
|---|---|
| No Promoted Listings Standard | No ad campaign/ad rate UI or backend actions found. |
| No promo visibility in rows | Row/card does not show volume discount or ad state. |
| No promo performance | No ad fee spend, promoted sales, ROI, or conversion by listing. Finance data captures ad fees after sale, not impression/click campaign stats. |
| No eligibility model | No check whether listing is eligible for promoted listings/markdowns. |
| No bulk promo workflow | Cannot select active listings and apply volume discount/ad campaign. |
| No markdown/sale awareness | No eBay markdown manager or sale events found. |

### Practical priority

1. First show existing volume pricing state on row/card.
2. Use `v_ebay_order_profit.per_order_ad_fee_cents` to flag orders with promoted listing costs.
3. Only then build Promoted Listings Standard campaign manager.

Reason: promoted listing spend without profit/conversion visibility is dangerous.

---

## 5. Price reference gaps

### What exists now

- KK product price (`products.price`) displayed.
- eBay price (`products.ebay_price_cents`) displayed.
- Product cost and weight exist in product data elsewhere, but this page only loads `weight_g`, not `unit_cost` or supplier shipping assumptions.
- Historical eBay order/profit data exists elsewhere.

### Missing

| Price reference need | Current status |
|---|---|
| Internal KK price reference | Partially shown. No warning/ratio. |
| Cost floor | Not shown. Need `unit_cost`, CPI/supplier ship, label assumption, fee estimator. |
| Recent sold price | Not shown. Could be built from eBay order sync. |
| Current live price comparison | Not present. Needs eBay Browse/Marketplace Insights or Shopping/Finding alternative. |
| Under/overpricing guardrail | Not present. |
| Draft pricing suggestion | Not present. |
| Confidence indicator | Not present. |

### First safe pricing model

Before external comps, build an internal pricing panel:

- KK price
- current eBay price
- estimated eBay fees at price
- estimated shipping label / package cost assumption
- CPI cost basis
- estimated profit
- margin percent
- recent actual average sold price (internal eBay history)
- warning if eBay price is below margin threshold

External comps can come later.

---

## 6. Fees and profits gaps

### What exists now

Backend exists:

- `ebay_finance_transactions`
- `v_ebay_order_profit`
- ad fee handling via `NON_SALE_CHARGE`
- CPI cost basis in v3/v4 migrations
- Line Items order page uses eBay fee/profit concepts.

Page support today:

- None.

### Missing

| Need | Current state |
|---|---|
| Estimated eBay fees before publish | Missing. |
| Shipping cost assumptions | Package dimensions/weight are input, but no cost estimate. |
| Estimated profit before publish/revise | Missing. |
| Margin warnings | Missing. |
| Promoted listing cost impact | Historical ad fees exist after sale; no preview. |
| Price-to-profit preview | Missing. |
| Actual lifetime profit by listing | Possible with order/finance joins; missing. |

### Highest-value profit feature

Add a `profit preview` component inside Push/Edit modals and a row/card compact `margin` badge.

Suggested calculations:

- `price_cents`
- estimated final value fee percent + fixed fee (configurable initially)
- package/shipping assumption from `weight_g` / modal dimensions
- CPI product cost from same formula used in finance view
- optional ad rate percent slider
- estimated net profit and margin

Do not wait for perfect eBay fee APIs. A conservative estimate is better than blind pricing.

---

## 7. Conversions / performance gaps

### What exists now

- No active page integration.
- `docs/ebayAPI/ebayAnalytics_001.md` documents potential traffic report usage.

### Missing metrics

- impressions
- clicks
- click-through rate
- watchers
- sales conversion rate
- search ranking / listing health
- stale listing age
- views without sales
- price/title/photo issue correlation

### Backend needed

A new performance sync path is required, likely one of:

- eBay Sell Analytics / Traffic Report if accessible for listing IDs.
- Trading API `GetSellerList` / `GetMyeBaySelling` for watchers/view counts if available.
- Scheduled edge function: `ebay-sync-listing-performance`.
- Table: `ebay_listing_performance_daily`.
- View: `v_ebay_listing_workspace` or `v_ebay_listing_health`.

Until this data exists, the page can only infer performance from orders/sold history.

---

## 8. UX/UI gaps

### Current UI model

Current page is one long page with:

- header buttons
- stats
- search/filter
- product table/cards
- large push/edit modals
- bulk modal
- setup/import panels

This is workable, but it will not scale to an "ultimate workspace" without segmentation.

### Missing UX primitives

| UX need | Recommendation |
|---|---|
| Segmentation | Tabs: `Workspace`, `Needs Work`, `Active`, `Drafts`, `Sold/History`, `Promotions`, `Import/Setup`. |
| Row density | Add compact badges: score, margin, sold 30d, last sold, promo, issue count. |
| Side workspace | Replace giant modal-only experience with right-side drawer for selected product. |
| Bulk workflows | Queue-based selection: optimize, price update, promo apply, category review. |
| Validation warnings | Inline issue flags before create/save. |
| Sales/performance drilldown | Product detail panel: sales, profit, orders, fees, revisions. |
| Promotion visibility | Promo badge + campaign/ad-rate/volume discount status. |
| Mobile practicality | Keep cards for browse; use full-screen drawer for edit/publish. |

---

## 9. Highest-value next additions

### Phase 1 must focus on data visibility, not more eBay actions

The page already has enough actions. The missing business value is context.

Recommended next stack:

1. Create a read-only Supabase view: `v_ebay_listing_workspace`.
2. Join `products` to eBay order/finance aggregates.
3. Add row/card metrics and issue flags.
4. Add detail panel or expanded row with sales/profit/last sold.
5. Add price/profit preview in push/edit modal.

This gives immediate operational value without risking live eBay writes.

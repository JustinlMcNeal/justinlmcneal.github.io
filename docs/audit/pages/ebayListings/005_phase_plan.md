# 005 — eBay Listings Phase Plan

**Date:** 2026-05-12  
**Goal:** Incrementally evolve the current eBay Listings page into a high-value internal marketplace workspace without breaking existing listing operations.

---

## Phase 0 — Safety baseline / no behavior change

**Objective:** Cleanly prepare the page for adding read-only workspace data.

**User value:** Low direct value, but reduces risk before touching live eBay actions.

**Likely files affected:**

- `js/admin/ebayListings/index.js`
- new `js/admin/ebayListings/api.js`
- maybe `js/admin/ebayListings/table.js`
- maybe `js/admin/ebayListings/cards.js`

**Backend dependencies:** None.

**Work:**

- Extract Supabase read and `callEdge()` helpers to `api.js`.
- Replace inline `onclick`-generated actions with delegated event listeners using `data-action` / `data-code`.
- Keep DOM output visually identical.
- Do not change eBay API calls.

**Risk level:** Medium because the page is large and action-heavy, but changes can be made mechanically.

**Recommended order:** Do this only if Phase 1 implementation becomes hard inside the current `index.js`. Otherwise skip until after Phase 1.

---

## Phase 1 — Read-only listing workspace metrics (highest-value first)

**Objective:** Add sales/profit/status context to the main listings grid without changing any live eBay write behavior.

**User value:** Very high. This turns the page from "list/edit/end" into "what should I work on next?"

**Likely files affected:**

- new migration: `supabase/migrations/YYYYMMDD_ebay_listing_workspace_view.sql`
- `js/admin/ebayListings/index.js` or new `api.js`
- `pages/admin/ebay-listings.html` (small additions for filters/stats if needed)
- `css/pages/admin/ebay-listings.css` (new chips/badges if Tailwind is not enough)

**Backend dependencies:**

- `products`
- `product_gallery_images`
- `product_variants`
- `orders_raw`
- `line_items_raw`
- `v_ebay_order_profit`

**Work:**

1. Create `v_ebay_listing_workspace` read view.
2. Keep the current product query as fallback or replace it with the view if it includes all current fields.
3. Add row/card badges:
   - sold 30d
   - last sold
   - eBay profit 90d
   - estimated margin status
   - volume promo badge
   - issue count
4. Add filters:
   - Needs Work
   - Low Margin
   - Sold Recently
   - No Sales 30d
   - Has Promo
5. Add a read-only detail drawer or expandable panel with sales/profit summary.

**Risk level:** Low/Medium. Mostly read-only. Main risk is incorrect joins/product matching.

**Recommended order:** First implementation phase.

---

## Phase 2 — Profit and price preview in Push/Edit modals

**Objective:** Prevent bad eBay pricing decisions before publish/revise.

**User value:** Very high. Directly protects margin.

**Likely files affected:**

- `js/admin/ebayListings/index.js`
- new `js/admin/ebayListings/profitPreview.js`
- `pages/admin/ebay-listings.html`
- maybe `supabase/migrations/...` if cost fields need a view

**Backend dependencies:**

- product `unit_cost`, `weight_g`, possibly dimensions/packaging assumptions
- existing CPI formula from `v_ebay_order_profit` / pStorage profit calculation

**Work:**

1. Add estimated eBay fee/profit panel to push modal.
2. Add same panel to edit modal.
3. Recalculate on price, quantity, weight/dimension, and optional ad rate input changes.
4. Warn when:
   - price below KK price
   - estimated profit below threshold
   - margin below threshold
   - missing cost data
5. Do not block publish initially; show warnings only.

**Risk level:** Medium. Estimates must be clearly labeled and conservative.

**Recommended order:** After Phase 1 so actual sales/profit context can sit next to estimates.

---

## Phase 3 — Listing optimization score and queue

**Objective:** Make weak listings obvious and actionable.

**User value:** High. Helps prioritize revisions and improves sell-through.

**Likely files affected:**

- new `js/admin/ebayListings/listingHealth.js`
- `js/admin/ebayListings/index.js` or `table.js` / `cards.js`
- `pages/admin/ebay-listings.html`
- optional migration if moving score into SQL later

**Backend dependencies:**

- `v_ebay_listing_workspace`
- optional eBay item snapshots if needed

**Work:**

1. Add deterministic `listing_score` and `issue_flags` in JS or SQL.
2. Flags:
   - missing category
   - low image count
   - missing eBay price
   - low margin
   - active but no sales 30d
   - ended but historically profitable
   - draft stalled
   - active listing with no volume promo
3. Add `Needs Optimization` tab/filter.
4. Add issue checklist in detail drawer.
5. Add "Open Edit" from issue panel.

**Risk level:** Low/Medium. Read-heavy; risk is noisy scoring.

**Recommended order:** After Phase 1/2 because scoring needs metrics and profit data.

---

## Phase 4 — Sales history drilldown

**Objective:** Give each listing/product a clear sales timeline.

**User value:** High. Helps decide restock/relist/price/promote actions.

**Likely files affected:**

- new Supabase view: `v_ebay_product_sales_history`
- `js/admin/ebayListings/salesHistory.js`
- detail drawer UI

**Backend dependencies:**

- eBay orders in `orders_raw`
- eBay line items in `line_items_raw`
- reliable product/SKU/listing mapping

**Work:**

1. Add detail drawer tab: `Sales`.
2. Show last 10 eBay orders for selected product.
3. Show sold qty by 7d/30d/90d/lifetime.
4. Show average sold price and last sold date.
5. Add ended-vs-sold note for ended listings.

**Risk level:** Medium. Depends on line-item mapping correctness.

**Recommended order:** Can run in parallel with Phase 3 if the sales summary view is already done.

---

## Phase 5 — Internal price reference and guardrails

**Objective:** Recommend safer listing prices from internal data before external comps.

**User value:** High.

**Likely files affected:**

- `js/admin/ebayListings/profitPreview.js`
- new `js/admin/ebayListings/priceReference.js`
- detail drawer / modal UI

**Backend dependencies:**

- `v_ebay_listing_workspace`
- sales/profit summaries

**Work:**

1. Show:
   - KK price
   - current eBay price
   - avg sold price 90d
   - max/min sold price 90d
   - profit at current price
   - suggested safe price range
2. Add underpricing/overpricing warnings.
3. Add "apply suggested price" into edit modal, but require manual Save.

**Risk level:** Medium. Bad suggestions can cost money; keep transparent.

**Recommended order:** After Phase 2 and Phase 4.

---

## Phase 6 — eBay performance/conversion sync

**Objective:** Add true listing health signals: impressions, clicks, watchers, conversion.

**User value:** High, but only if data source is confirmed.

**Likely files affected:**

- new edge function: `supabase/functions/ebay-sync-listing-performance/index.ts`
- new migration: `ebay_listing_performance_daily`
- `supabase/SETUP_..._CRON.sql`
- `js/admin/ebayListings/performancePanel.js`

**Backend dependencies:**

- Confirm eBay API endpoint/scopes/rate limits for listing traffic metrics.
- Existing active listing IDs from `products.ebay_listing_id`.

**Work:**

1. Confirm API source with a small manual test.
2. Create table and sync function.
3. Store daily metrics by listing ID.
4. Add performance chips:
   - impressions
   - clicks
   - CTR
   - sold
   - conversion
   - watchers if available
5. Add recommendations:
   - high impressions / low clicks → title/photo issue
   - high clicks / no sales → price/description issue
   - no impressions → category/SEO/promo issue

**Risk level:** Medium/High due to API uncertainty.

**Recommended order:** After internal sales/profit features.

---

## Phase 7 — Promotion manager

**Objective:** Manage eBay promotion strategy from this workspace.

**User value:** Medium/High, but risky without performance/profit context.

**Likely files affected:**

- `supabase/functions/ebay-manage-listing/index.ts` or new dedicated marketing edge function
- new `js/admin/ebayListings/promotionPanel.js`
- new table/view for promotion metadata

**Backend dependencies:**

- eBay Marketing API scopes and endpoints
- performance/profit data from earlier phases

**Work:**

1. Surface existing volume discounts in rows/detail.
2. Add bulk volume pricing apply/update.
3. Add Promoted Listings Standard only after confirming API access.
4. Show ad fee impact from actual finance transactions.
5. Add ROI warnings.

**Risk level:** High if built before profit/performance visibility.

**Recommended order:** After Phase 6.

---

## Phase 8 — External comps / competitor price tracking

**Objective:** Add external market price reference.

**User value:** Medium/High.

**Likely files affected:**

- new edge function: `ebay-price-reference` or `ebay-sync-price-comps`
- new table: `ebay_price_comps`
- `js/admin/ebayListings/priceReference.js`

**Backend dependencies:**

- eBay Browse API / Marketplace Insights / other permitted source.
- Search query construction from product name/category/aspects.

**Work:**

1. Start manual/on-demand comp lookup, not scheduled.
2. Show recent comparable active listings and sold comps if available.
3. Add confidence score and exclusions.
4. Never auto-price without review.

**Risk level:** Medium/High due to data quality and API constraints.

**Recommended order:** Last. Internal sold/profit data should come first.

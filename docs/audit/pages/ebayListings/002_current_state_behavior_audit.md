# 002 — eBay Listings Current State Behavior Audit

**Date:** 2026-05-12  
**Scope:** Behavior of the current `pages/admin/ebay-listings.html` implementation. No code changes.

---

## 1. Blunt current-state summary

The page today is a listing management console, not a decision workspace.

It is strong at:

- showing catalog products and their local eBay status
- creating Inventory API items/offers/listings
- revising active listings
- ending listings
- handling basic variants
- using Taxonomy API for categories/aspects
- using AI to draft title/description/aspects
- volume-discount setup
- importing/linking existing Inventory API items

It is weak or missing at:

- listing performance analytics
- sold history per product/listing
- fee/profit preview before publish/revise
- estimated margins
- promoted listing campaign management beyond volume discounts
- stale listing/conversion health
- price reference/comps
- optimization queue/workspace structure

---

## 2. What the page shows today

### Stats row

Current metrics:

- Total Products
- Active on eBay
- Draft
- Not Listed

Source: local `allProducts` array loaded from `products`.

Limitations:

- Counts products, not listings/offers/variant SKUs.
- No revenue, sold quantity, profit, conversion, watchers, impressions, or stale age metrics.
- Variant listings count as one product row, even though they may represent multiple eBay inventory items/offers.

### Table/card product list

Visible data:

- product image
- product name with deep link to Products admin search
- product code / eBay link if `ebay_listing_id` exists
- KK price
- eBay price from `products.ebay_price_cents`
- status chip from `products.ebay_status`
- row actions based on status

Search/filter:

- Search matches `name`, `code`, `ebay_sku`.
- Status filter supports `active`, `draft`, `ended`, `not_listed`.
- No category, margin, stock, stale, variant, promotion, or issue filters.

View modes:

- Table view for desktop default.
- Card view for mobile default.

---

## 3. Current workflows

## 3.1 Push new listing / re-list ended listing

Entry:

- Table/card `Push` for `not_listed`.
- Table/card `Re-list` for `ended`.
- `Resume Push` for draft with no offer ID.

Frontend path:

- `openPush(code)` seeds modal from `products` row.
- Builds image strip from catalog image, primary image, hover image, gallery images.
- Detects variant listing when active `product_variants.length > 1`.
- Initializes Quill description editor.
- Loads policy cache from eBay Account API through `get_policies`.

Push Step 1 — Create item(s):

- Single product: `create_item` once.
- Variant product: creates one inventory item per checked variant SKU.
- Variant SKU format: `BASE-{first 6 alphanumeric chars of option_value}`.
- Required item specifics validated before create.
- Images are sent to eBay; variant lead image gets priority.
- Product row gets `ebay_sku` and `ebay_status='draft'` in backend.

Push Step 2 — Create offer / group + offer:

- Single product: `create_offer`.
- Variant product with multiple checked SKUs: `create_item_group`, then `create_group_offer`.
- Stores category/price on product row.
- For groups, base product row gets `ebay_item_group_key`; offers are created per variant SKU.

Push Step 3 — Publish:

- Single: `publish` on offer ID.
- Group: `publish_group` on inventory item group key.
- Product row gets `ebay_listing_id`, `ebay_status='active'`, category/price.
- If volume pricing is enabled, page calls `create_volume_discount` after publish.

Limitations:

- No fee/profit preview before publish.
- No automatic warning if eBay price is below margin-safe threshold.
- No stale/duplicate listing check beyond SKU collision and existing offer handling.
- No listing quality score before publish.
- No sale velocity or historical sold price reference in modal.
- Variant local DB state is only stored on base product row; variant offer/listing details are reconstructed from eBay as needed.

---

## 3.2 Edit active/draft listing

Entry:

- `Edit` button for `active` and `draft` statuses.

Frontend path:

- `openEdit(code)` determines if `ebay_item_group_key` exists.
- For group listing: calls `get_item_group`, then `get_offers` and `get_item` for first variant.
- For single listing: calls `get_item` and `get_offers` by SKU.
- Prefills title, description, condition, quantity, images, price, policies, best offer, store category, volume pricing, aspects.

Save behavior:

- Single listing:
  - `update_item`
  - `update_offer` if offer ID exists
- Group listing:
  - `update_item_group`
  - loops variant SKUs and calls `get_item`
  - calls `update_item` per variant SKU
  - calls `get_offers` per variant SKU
  - calls `update_offer` per variant offer
- Local DB update:
  - only `products.ebay_store_category` is directly updated by page after save.
  - price/category updates happen inside `ebay-manage-listing`.
- Volume pricing:
  - `update_volume_discount`, `create_volume_discount`, or `delete_volume_discount` based on current UI state.

Limitations:

- No "what changed" diff before saving.
- No revision history.
- No daily revise-count awareness (eBay has revision limits; old docs mention this, page does not surface it).
- No profit impact preview for price changes.
- No traffic/sales context to explain whether a revise is worth doing.
- No promotion performance context.

---

## 3.3 End listing

Entry:

- `End` button on active rows/cards.

Behavior:

- Confirms via browser `confirm()`.
- If `ebay_item_group_key` exists, calls `withdraw_group`.
- Otherwise calls `withdraw` with offer ID.
- Backend updates `products.ebay_status='ended'`.

Limitations:

- No reason capture.
- No prompt to relist later, archive, discount first, or review performance before ending.
- No sold-vs-unsold outcome analysis.

---

## 3.4 Bulk update price / quantity

Entry:

- Checkbox selection appears only for rows considered listed (`active` or `draft`).
- Bulk bar supports `Update Price` and `Update Qty`.

Behavior:

- Opens small modal.
- Calls `ebay-manage-listing` `bulk_update` with selected SKUs/offers.
- If bulk price succeeds, page also updates `products.ebay_price_cents` locally.

Limitations / likely bug risk:

- For quantity-only bulk update, the `bulk_update` edge function creates requests with `shipToLocationAvailability.quantity`, but only includes `offers` when `priceCents` exists. This may not fully update offer quantity depending on eBay endpoint behavior. Needs real verification before relying on it.
- No profit/margin guardrails for bulk price cuts.
- No variant-specific bulk UI; table selection is product-level.
- No preview of selected listing health/performance.

---

## 3.5 Setup panel

Entry:

- Header `Setup` button.

Behavior:

- Calls `get_policies` and displays fulfillment/return/payment policies.
- `Create/Verify Location` calls `setup_location`, which reads `site_settings.ship_from_address` and creates eBay inventory location.

Limitations:

- Basic operational setup only.
- No OAuth/token status here; that lives in Settings page.
- No scope health check or Marketing API scope warning.

---

## 3.6 Import existing eBay listings

Entry:

- Header `Import Existing` button.

Behavior:

- `Scan eBay Inventory` calls `ebay-migrate-listings` `scan`.
- `Auto-Link All` calls `auto_link`.
- Results table shows eBay SKU, title, quantity, matched KK code.

Backend behavior:

- Scans eBay Inventory API inventory items.
- Loads `products(code,name)`.
- Uses `matchProduct()` from `_shared/ebayUtils.ts` for exact/substring/token-overlap matching.
- Links local product rows by setting eBay SKU/offer/listing/category/price/status fields.

Limitations:

- Despite file comment saying legacy Seller Hub migration, current code scans Inventory API inventory items. It does not call `bulk_migrate_listing` or Trading API `GetMyeBaySelling`.
- No manual link UI is present, even though backend has a `link` action.
- No confidence score display for fuzzy match.
- No duplicate-candidate handling.
- No category/price/image discrepancy review before linking.

---

## 4. Current listing optimization support

Existing:

- AI Auto-Fill for push and edit.
- Title maxlength 80.
- Category search via Taxonomy API suggestions.
- Required aspect fetching and validation.
- Optional aspects displayed up to 15.
- Image reorder and gallery add.
- Description Visual/HTML/Preview modes.
- HTML sanitizer strips dangerous tags and event attributes.
- Best Offer, lot size, package weight/dimensions, business policies, store category, and volume pricing.

Missing:

- No persistent listing quality score.
- No item specifics completeness percent.
- No title keyword scoring.
- No category confidence persisted after selection.
- No image compliance checks (count, aspect ratio, background, duplicate, watermarks, minimum size).
- No price competitiveness check.
- No stale listing detection.
- No bulk optimization queue.
- No issue flags at row/card level.

---

## 5. Current sales / profit / performance support

### Sales history

Current page: none.

Existing backend data elsewhere:

- `ebay-sync-orders` writes eBay orders to `orders_raw` and `line_items_raw`.
- It uses fuzzy product matching and order/line item data.
- No query/view is used here to show sales by product/listing/SKU.

### Fees / profit

Current page: none.

Existing backend data elsewhere:

- `ebay-sync-finances` writes `ebay_finance_transactions`.
- `v_ebay_order_profit` computes eBay seller earnings, fees, ad fees, product cost, label cost, and net profit.
- Line Items order workspace already uses this kind of data.
- eBay Listings page does not query it.

### Conversion / performance

Current page: none.

Docs exist:

- `docs/ebayAPI/ebayAnalytics_001.md` describes listing traffic report ideas.

No active page data source found for:

- impressions
- clicks
- click-through rate
- watchers
- conversion rate
- sold-through rate
- traffic trend

### Promotion management

Current page supports volume pricing promotions only:

- create/update/delete `VOLUME_DISCOUNT` item promotions.
- stores `products.ebay_volume_promo_id`.

Current page does not support:

- Promoted Listings Standard ad campaigns.
- ad rate management.
- promotion eligibility.
- promotion performance.
- markdown sale events.
- campaign grouping.

---

## 6. Dead / legacy / mismatch notes

### 6.1 Import/migration naming mismatch

`ebay-migrate-listings` file comment says it discovers existing Seller Hub legacy listings and imports them into Inventory API. Actual code only scans Inventory API inventory items and links them to products. It does not perform Seller Hub bulk migration.

Impact: The UI label `Import Existing eBay Listings` is broadly true, but the backend is narrower than the comment/docs imply.

### 6.2 Inline JS mismatch with project preference

`renderTable()` and `renderCards()` generate inline `onclick` attributes and attach handlers to `window`. This works, but conflicts with the stated no-inline-JS preference.

Impact: Not currently broken, but should be cleaned up during a future UI refactor, not during audit.

### 6.3 Source of truth is split but mostly manageable

Catalog product identity lives in `products`. Live listing details live in eBay and are fetched on modal open. Local `products.ebay_*` columns store pointers/status, not full listing snapshots.

This is acceptable for operations, but insufficient for analytics because there is no local listing dimension table or snapshot history.

### 6.4 AI Auto-Fill is useful but not a quality system

AI fills fields on demand, but the page does not persist AI confidence, review notes, original vs changed values, or an optimization score.

### 6.5 Fees/profit data exists but is disconnected

The strongest backend opportunity is already present: `ebay_finance_transactions` and `v_ebay_order_profit`. The Listings page simply does not load or summarize it.

---

## 7. Current reality vs UI promise

The page title says "Manage eBay inventory from one place." That is mostly accurate for listing CRUD.

It is **not yet** accurate for:

- managing listing profitability
- deciding what to promote
- deciding what to revise
- understanding which listings sell
- understanding which listings get traffic but do not convert
- planning pricing from comps/history
- managing eBay as a sales channel end-to-end

The next step should not be another modal field. It should be a data-backed workspace layer on top of the existing listing operations.

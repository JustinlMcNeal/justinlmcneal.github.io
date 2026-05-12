# 000 — Sizes System Audit

**Project:** Karry Kraze product size / variant readiness audit  
**Date:** 2026-05-09  
**Scope:** Audit only. No implementation changes.  
**Goal:** Identify current product, cart, checkout, saved cart, order, fulfillment, admin, SMS, and analytics assumptions before adding apparel sizes.

---

## Audit Findings Summary

The codebase is **not starting from zero**. It already has a partial variant system:

- `product_variants` exists and is used by product pages, catalog/home cards, checkout stock display, checkout session creation, `stripe-webhook` stock decrement/refund, admin product editing, order detail images, inventory summaries, and analytics.
- Live schema audit found **61 products**, **171 active variant rows**, and **all current variant rows use `option_name = 'Color'`**.
- Every product currently has at least one active variant row: **0 products without variants**, **28 with one variant**, **33 with multiple variants**.
- Current checkout/order flow carries a flat `variant` text value through cart → Stripe metadata → `line_items_raw.variant`.
- The frontend product page already sends `variant_id` from `js/product/cart.js`, but `js/shared/cartStore.js` does **not persist it**. This is the biggest gap for scalable variant support.
- Current variant identity is mostly `{ product UUID or SKU } + variant option text`, not a durable `variant_id`.
- Current admin UI hardcodes variants as **Color** (`option_name: 'Color'`, “Color name” placeholder). This is incompatible with apparel sizes without refactoring the admin editor.
- Current schema can support **one option dimension per variant row** (`option_name`, `option_value`) but cannot safely model **sellable combinations** such as `Size=S + Color=Black` without changing the variant model.
- Orders already store useful purchase snapshots (`product_name`, `variant`, `quantity`, unit prices, weight), but not `variant_id`, variant SKU, or structured selected options.
- Saved carts preserve `variant` text, but not `variant_id` or structured options.
- Abandoned cart SMS uses product names only in message copy; variants are stored in `cart_data` but not shown in SMS copy.

**Bottom line:** the correct next step is **not a loose `size` dropdown on products**. The project should evolve the existing `product_variants` table into the canonical purchasable-unit model and carry `variant_id` through cart, checkout, saved carts, orders, admin, and fulfillment.

---

## Current Database / Source of Truth

### `products`

Live schema columns relevant to sizing/variants:

- `id UUID` — internal product UUID
- `code TEXT UNIQUE` — current product SKU, e.g. `KK-####`
- `slug TEXT UNIQUE`
- `name TEXT`
- `category_id UUID`
- `price NUMERIC` — product-level price only
- `weight_g NUMERIC` — product-level weight only
- `unit_cost NUMERIC` — product-level cost only
- `shipping_status TEXT` — product-level shipping status (`mto` or null per project rule)
- `catalog_image_url`, `catalog_hover_url`, `primary_image_url`
- `is_active BOOLEAN`
- eBay fields: `ebay_sku`, `ebay_offer_id`, `ebay_listing_id`, `ebay_status`, `ebay_category_id`, `ebay_price_cents`, `ebay_item_group_key`, `ebay_volume_promo_id`, `ebay_store_category`

Current assumption: product-level `price`, `weight_g`, `unit_cost`, and `shipping_status` apply to every variant.

### `product_variants`

Live schema columns:

- `id UUID PRIMARY KEY`
- `product_id UUID NOT NULL`
- `option_name TEXT NOT NULL`
- `option_value TEXT NOT NULL`
- `option_name_key TEXT`
- `option_value_key TEXT`
- `stock INTEGER NOT NULL DEFAULT 0`
- `preview_image_url TEXT`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- timestamps

Indexes / constraints:

- `product_variants_unique_per_product` on `(product_id, option_name_key, option_value_key)`
- `idx_variants_product_id`
- `idx_variants_active` on `(product_id, is_active)`

Current live data:

- `option_name = 'Color'` for all 171 rows.
- No variant-level SKU.
- No variant-level title/display name separate from `option_value`.
- No variant-level price override.
- No variant-level weight or unit-cost override.
- No structured options JSON.
- Stock is variant-level and is already used.

### `product_gallery_images`

Live schema includes:

- `product_id UUID NOT NULL`
- `variant_id UUID NULL`
- `url TEXT`
- `position INTEGER`
- `is_active BOOLEAN`

Current code mostly uses product-level gallery (`js/product/api.js:fetchGallery(productId)` selects by `product_id` only). Variant-specific gallery support exists in schema but is not fully used by frontend/admin. Variant image currently comes from `product_variants.preview_image_url`.

### `line_items_raw`

Live schema columns relevant to variants:

- `id UUID`
- `stripe_checkout_session_id TEXT`
- `stripe_line_item_id TEXT`
- `product_id TEXT` — current SKU/code, not product UUID
- `product_name TEXT`
- `variant TEXT` — flat variant display string
- `quantity INTEGER`
- `item_weight_g INTEGER`
- `unit_price_cents INTEGER`
- `post_discount_unit_price_cents INTEGER`
- `order_date TIMESTAMPTZ`

Current assumption: order item variant identity is a string snapshot, not a foreign key.

### `orders_raw`

Order header table. Relevant fields:

- `stripe_checkout_session_id TEXT UNIQUE`
- `kk_order_id TEXT`
- contact/shipping fields
- subtotal/tax/shipping/total fields
- `total_items`, `total_weight_g`
- SMS attribution fields
- refund fields

No variant details live at order header level; all variant detail is in `line_items_raw`.

### `saved_carts`

Created in `supabase/migrations/20260414_saved_carts.sql`, hardened by `20260414_saved_carts_hardening.sql`.

Relevant columns:

- `cart_data JSONB NOT NULL DEFAULT '[]'`
- `cart_value_cents`
- `item_count`
- `cart_hash`
- `status`
- abandoned-cart step timestamps

Current `cart_data` shape is produced by `supabase/functions/cart-sync/index.ts` and includes:

```json
{
  "id": "product-or-line-id",
  "product_id": "SKU",
  "name": "Product name",
  "price": 12.34,
  "variant": "Color text",
  "qty": 1,
  "image": "url",
  "slug": "product-slug"
}
```

No `variant_id` is stored.

### `stock_ledger`

Live schema:

- `variant_id UUID NOT NULL`
- `product_id UUID NOT NULL`
- `change INTEGER`
- `reason TEXT`
- `reference_id TEXT`
- `stock_before`, `stock_after`

This confirms inventory is already variant-centric internally, but order and cart identity are not yet consistently variant-id-centric.

---

## Product / Catalog Layer

### Product fetch contract

`js/shared/productContract.js` exports `PRODUCT_SELECT` with product-level fields only:

- `id`, `code`, `slug`, `name`, `category_id`
- `price`, `weight_g`, `unit_cost`, `shipping_status`
- product-level image URLs
- `is_active`, timestamps

Variant fields are fetched separately.

### Product page data loading

Files:

- `js/product/api.js`
- `js/product/index.js`
- `js/product/render.js`
- `js/product/cart.js`

Functions:

- `fetchProductBySlug(slug)` / `fetchProductByCode(code)` — fetch product by `PRODUCT_SELECT`.
- `fetchVariants(productId)` — selects `id, product_id, option_value, stock, preview_image_url, sort_order` from `product_variants`.
- `renderVariantSwatches(container, variants, onSelect)` — renders current variants as visual color swatches using `parseColorValue(option_value)`.
- `shippingText(shipping_status, variant)` — uses product-level `shipping_status`, then variant-level `stock <= 0` for backorder copy.
- `stockBadgeHtml(variant, shipping_status)` — variant stock UI.
- `buildCartPayload(els, product, tags, selectedVariant)` — creates add-to-cart payload.

Current product page behavior:

- If no variants: hides the variant section.
- If variants exist: renders them as swatches and auto-selects the first option.
- Selected variant changes image, stock badge, and shipping text.
- Add-to-cart payload includes `variant_id`, but this is not preserved by `cartStore`.

Current assumptions:

- Variant options are visual colors.
- `option_value` can be parsed as a color by `parseColorValue()`.
- One selected option = one purchasable variant.
- No required “choose size” interaction; first variant auto-selects.
- Price does not change by variant.
- Product `shipping_status` applies to all variants.

Size impact:

- Apparel sizes should not render as color swatches.
- For sizes, auto-selecting first variant can cause wrong orders if customer does not intentionally choose a size.
- Product page needs option-type-aware controls: button group/dropdown for `Size`, swatches for `Color`, and eventually combination selection.

### Catalog and home cards

Files:

- `js/home/api.js`
- `js/shared/components/productCardHome.js`
- `js/catalog/index.js`
- `js/home/renderGrid.js`
- `js/home/shopTheLook.js`

Functions / patterns:

- `fetchVariantsForProducts(productIds)` loads `product_variants` for card display.
- `renderHomeCard(product, variants, opts)` prioritizes variants where `option_name` is `color`, uses `parseColorValue()`, and renders swatches.
- Quick-add in `js/catalog/index.js:handleQuickAdd(btn)` redirects if `data-has-variants="true"`; otherwise adds directly.

Important quick-add caveat:

- For quick-add, if no variants are present, code defaults `variantName = "Standard"`.
- If one variant is present, the code may add the first variant directly depending on card `data-has-variants` logic.
- The quick-add payload can use `id: variantId` instead of product UUID in some cases. This conflicts with `cartStore`'s comment that `id` is product UUID.

Size impact:

- Products with size options must redirect to the product page unless a default size is intentionally selected (not recommended).
- Quick add should be disabled or converted to “Choose Options” for any product with required size selection.

---

## Frontend Cart Layer

### Local cart store

File: `js/shared/cartStore.js`

Storage key: `kk_cart_v1`

Key functions:

- `loadCart()` / `saveCart()`
- `normVariant(v)`
- `lineKey(id, variant)` → `${id}::${variant}`
- `findLineIndex(id, variant)`
- `addToCart(payload)`
- `removeItem(id, variant)`
- `setQty(id, variant, qty)`
- `syncCartToServer()`

Current local cart item shape:

```js
{
  id,              // expected product UUID, but catalog quick-add may pass variant id
  product_id,      // SKU/code
  product_uuid,    // product UUID if provided
  name,
  price,
  image,
  variant,         // display string
  qty,
  category_id,
  category_ids,
  tag_ids,
  tags,
  slug,
  source
}
```

Critical gap:

- `addToCart(payload)` does **not preserve `payload.variant_id`**, even though `buildCartPayload()` sends it.
- Line identity is `id + variant text`, not `variant_id`.
- If a variant option is renamed in admin, older cart lines may no longer match stock lookup or webhook decrement logic.
- If two future variants share the same displayed size text under different colors (`Small / Black`, `Small / Pink`), `id + variant` is insufficient unless `variant` becomes a compound label. This is fragile.

### Cart drawer / shared cart UI

Files:

- `js/shared/cart/cartDrawer.js`
- `js/shared/cart/cartUI.js`
- `js/shared/cart/cartControls.js`
- `js/shared/cart/cartTotals.js`

Audit result:

- Cart totals use `item.price * qty` and are variant-agnostic.
- Cart controls generally pass `id` and `variant` to `setQty()` / `removeItem()`.
- Promotions scope checks (`js/shared/promotions/promoScope.js`) use `product_id`, `id`, `sku`, `slug`, category IDs, and tag IDs. No variant-level promotion scope exists.

Size impact:

- Cart display can show a variant string today, but should eventually show structured selected options (`Size: M`, `Color: Black`) rather than a single raw string.
- Variant-level pricing later requires cart totals to trust server-authoritative variant price, not only product price.

---

## Checkout and Stripe

### Checkout page

Files:

- `js/checkout/index.js`
- `js/checkout/renderItems.js`
- `js/checkout/summary.js`

Key behavior:

- `handleCheckout()` maps local cart to checkout items with `product_id`, `name`, `variant`, `price`, `discounted_price`, `qty`, and `image`.
- It does **not pass `variant_id`** to `create-checkout-session`.
- `renderCheckoutItems()` fetches `product_variants` by cart `item.id` and maps stock with key `${product_id}::${option_value}`.
- `updateSummary()` detects backorders using `item.id + item.variant`.

Current assumption:

- `item.id` is product UUID and `item.variant` is the option text.
- Server can recover the correct variant from `product_variants.option_value`.

Risk:

- This breaks for size+color combinations or renamed options.
- Catalog quick-add can pass a non-product UUID as `id`, which makes checkout stock lookup unreliable.

### `create-checkout-session`

File: `supabase/functions/create-checkout-session/index.ts`

Key behavior:

- Receives `items` from frontend.
- Product lookup is by SKU/code (`product_id` or `id`) against `products.code`.
- Builds `productUuidMap`, `priceMap`, and `weightMap` from `products`.
- Stock check queries `product_variants` by product UUID and compares `option_value` to `it.variant` lowercased.
- Checkout is not blocked for out-of-stock; it adds `kk_back_order: "true"` metadata when applicable.
- Stripe product metadata includes:
  - `kk_product_id` — SKU/code
  - `kk_variant` — flat display string
  - `kk_order_id`
  - `kk_unit_price_cents`
  - `kk_post_discount_unit_price_cents`
  - `kk_item_weight_g`
  - optional `kk_back_order`

Current assumptions:

- Product price is authoritative for all variants.
- Product weight is authoritative for all variants.
- Variant can be recovered by product UUID + option text.
- Only one `kk_variant` string is needed.

Size impact:

- For robust apparel support, Stripe metadata should include `kk_variant_id`, `kk_variant_sku`, and a selected-options snapshot.
- Server should look up price/weight/stock by `variant_id` when present and only use SKU+variant text as legacy fallback.

---

## Orders / Webhook / Fulfillment

### `stripe-webhook`

File: `supabase/functions/stripe-webhook/index.ts`

Relevant behavior:

- Extracts `kk_product_id` and `kk_variant` from Stripe product metadata.
- Creates `line_items_raw` rows with `product_id`, `product_name`, `variant`, `quantity`, prices, and weight.
- Upserts `orders_raw` first, then `line_items_raw`.
- Creates/ensures a `fulfillment_shipments` row.
- Decrements stock after order creation:
  - Finds product UUID from SKU map.
  - Queries `product_variants` by `product_id` and `option_value = variantName` when present.
  - Updates `product_variants.stock`.
  - Inserts `stock_ledger` row.
- On full refunds, increments stock using `line_items_raw.product_id + line_items_raw.variant`.

Current assumptions:

- The `variant` string in `line_items_raw` can locate the original variant row.
- If no variant string is present, “first active” variant is used for stock adjustment.
- Variant identity is not stored as a durable FK on order line items.

Size impact:

- If a customer buys `Size M / Black`, a single `variant` string must encode that combination or the webhook cannot find the right row.
- If option labels change after purchase, refund stock restoration may restore to the wrong row or fail.
- `line_items_raw` needs a nullable `variant_id` plus immutable snapshots.

### Fulfillment and shipping

Files:

- `js/admin/lineItemsOrders/api.js`
- `js/admin/lineItemsOrders/index.js`
- `js/admin/lineItemsRaw/api.js`
- `js/admin/lineItemsRaw/renderTable.js`
- `supabase/functions/shippo-create-label/index.ts`

Current behavior:

- Admin order detail (`fetchOrderDetails()`) fetches line items from `v_order_lines`.
- Product images are enriched by product code; variant images are mapped by `product code | variant text`.
- Order detail display shows `Variant: ${li.variant}`.
- `lineItemsRaw` admin table searches and displays `variant`.
- Shippo label creation uses order address and total order weight; it does not need variant selection except for staff picking/packing.

Size impact:

- Staff can currently see one `variant` string. This is acceptable for single-dimension variants but weak for size+color combinations.
- Packing view should explicitly show selected options and SKU/variant SKU, not just raw text.

---

## Admin Product Management

Files:

- `js/admin/products/api.js`
- `js/admin/products/modalRows.js`
- `js/admin/products/modalEditor.js`
- `js/admin/products/renderTable.js`

Current behavior:

- `fetchProductFull(productId)` loads product, variants, gallery, tags.
- `replaceVariants(productId, variants)` deletes all existing variants and inserts new rows.
- Insert rows set `option_name: "Color"` unconditionally.
- `modalRows.addVariantRow()` renders “Color name”, stock, and preview image.
- `collectVariants()` returns `{ option_value, stock, preview_image_url, sort_order }`.
- `modalEditor.save()` persists product, variants, gallery, tags, and sections.
- Admin product table uses `_totalStock` from inventory summary and does not show size/color details inline.

Current assumptions:

- Every variant is a color.
- Variant editing is destructive replacement, not stable row editing.
- No variant SKU, price override, weight override, or structured option editor.
- Deleting/reinserting variants can change `product_variants.id`, which is a problem once `variant_id` becomes cart/order identity.

Size impact:

- Admin must stop hardcoding `option_name = 'Color'`.
- Admin must preserve existing variant IDs where possible once carts/orders use `variant_id`.
- For apparel, admin needs an explicit way to create size variants (`S`, `M`, `L`, `XL`) and later combinations (`Black / S`, `Black / M`).

---

## Saved Carts and Abandoned Cart SMS

Files:

- `js/shared/cartStore.js`
- `supabase/functions/cart-sync/index.ts`
- `supabase/functions/sms-abandoned-cart/index.ts`
- `supabase/functions/stripe-webhook/index.ts`

Current behavior:

- Cart sync sends local cart to `cart-sync` after cart changes for SMS subscribers.
- `cart-sync` hashes cart as `id:variant:qty`, sorted.
- `cart-sync` sanitizes and stores only `id`, `product_id`, `name`, `price`, `variant`, `qty`, `image`, `slug`.
- Abandoned-cart SMS `topItemName()` uses only the first cart item `name` and item count.
- `stripe-webhook` marks active saved carts purchased by phone after checkout.

Current assumptions:

- `variant` text is enough for cart identity/hash.
- SMS copy does not need variant details.
- Saved cart restore logic was not found as a first-class customer restore path; current SMS redirect goes to catalog/product URLs, not a server-side cart restore endpoint.

Size impact:

- Saved carts should store `variant_id` and selected options snapshot.
- Cart hash should use `variant_id` where present.
- Abandoned cart SMS can remain product-name-only, but internal cart details should be variant-aware for analytics and future restore.

---

## Marketing / Analytics / Reviews

### Meta Pixel

Files:

- `js/product/index.js`
- `js/checkout/index.js`

Current behavior:

- `AddToCart` uses `content_ids: [payload.product_id]` (SKU) and does not include variant.
- `InitiateCheckout` uses cart value and item count only.

Size impact:

- Variant-level analytics are not currently tracked in Meta events.

### Reviews and order lookup

Files:

- `supabase/functions/verify-order/index.ts`
- `supabase/functions/verify-review-token/index.ts`
- `js/reviews/index.js`
- `js/reviews/leave.js`
- `js/my-orders/index.js`
- `js/success/index.js`

Current behavior:

- Order verification returns `product_id`, `product_name`, `variant`, `quantity`.
- Review UI displays `variant` when present.
- Existing reviews appear keyed by `product_id`; variant-specific review tracking is not evident.

Size impact:

- For apparel fit/size reviews, variant/size may need better display, but review identity probably remains product-level unless variant-specific review analytics are desired later.

### Item analytics

Files:

- `js/admin/itemStats/api.js`
- `js/admin/itemStats/index.js`
- `js/admin/itemStats/renderTable.js`

Current behavior:

- Queries `line_items_raw` fields including `variant`.
- Aggregates by flat `variant` string.
- Displays variant breakdown.

Size impact:

- Current analytics can break down by one label but cannot distinguish structured combinations unless the label is compound.
- Long term, analytics should group by `variant_id`, `variant_sku`, and selected option values.

---

## Places That Assume Product = Purchasable Unit or Variant = Text

### Strong assumptions

1. `js/shared/cartStore.js`
   - Cart line key is `id + variant`.
   - Does not persist `variant_id`.

2. `js/checkout/index.js`
   - Checkout payload omits `variant_id`.
   - Sends only `variant` string.

3. `supabase/functions/create-checkout-session/index.ts`
   - Authoritative price and weight come from product SKU.
   - Stock check matches by `option_value` text.
   - Stripe metadata stores only `kk_variant`, not `kk_variant_id`.

4. `supabase/functions/stripe-webhook/index.ts`
   - Order line item stores `variant` text only.
   - Stock decrement/refund matches product UUID + `option_value` text.

5. `supabase/functions/cart-sync/index.ts`
   - Saved cart hash uses `id:variant:qty`.
   - Saved cart JSON omits `variant_id`.

6. `js/admin/products/api.js`
   - `replaceVariants()` hardcodes `option_name: "Color"`.
   - Deletes and reinserts all variants on save.

7. `js/admin/products/modalRows.js`
   - Variant UI says “Color name”.
   - No option type selector.

8. `js/product/render.js`
   - Variant renderer is swatch/color-specific.
   - Uses `parseColorValue()` for every variant.

### Softer assumptions

1. `js/shared/promotions/promoScope.js`
   - Promo scope supports all/product/category/tag, not variants.

2. `js/admin/itemStats/index.js`
   - Variant analytics group by text label.

3. `js/admin/lineItemsOrders/api.js`
   - Variant image enrichment maps by `product code | variant text`.

4. `js/success/index.js`, `js/my-orders/index.js`, reviews pages
   - Display one `variant` string.

5. `supabase/functions/sms-abandoned-cart/index.ts`
   - SMS message copy ignores selected variant details.

---

## Risks, Blockers, and Technical Unknowns

### Risks

1. **Variant ID is not carried end-to-end.** This is the biggest architecture risk. The system already has `product_variants.id`, but cart/saved-cart/Stripe/order identity still depends on mutable text.

2. **Admin variant replacement is destructive.** Once `variant_id` is used in carts/orders, deleting/reinserting variants on every save can break active carts and pending checkout flows.

3. **Single-option model is not enough for size + color.** Current schema can represent `Size = M` or `Color = Black`, but not a sellable combination with unique stock unless the combination is squeezed into one text field.

4. **Product-level pricing and weight are currently authoritative.** Variant-level price/weight/cost support requires server-side checkout/webhook changes, not just frontend UI.

5. **Catalog quick-add has inconsistent `id` semantics.** Some quick-add paths can pass `id` as a variant ID or a product ID depending on product/variant count.

6. **Old carts exist in `kk_cart_v1` and saved carts.** Implementation must support legacy cart items that only have `id`, `product_id`, and `variant`.

7. **External marketplace mappings are not fully variant-safe.** eBay code references variant SKUs, Amazon import extracts variant names, and order imports store variant text; these should not block size rollout but must be considered later.

### Blockers before implementation

- Choose canonical variant identity and cart key strategy.
- Decide whether to retrofit `product_variants` as the sellable-unit table or add a new table. Recommendation is in `001_sizes_architecture_recommendation.md`.
- Decide minimum admin UI for size-only products versus future color+size products.
- Decide if initial size rollout will create one variant per size with `option_name='Size'`, or immediately add structured `option_values` JSONB.

### Questions / Unknowns

1. Should hoodie sizes be made-to-order or stock-tracked by size immediately?
2. Will apparel sizes share the same price and weight across sizes at launch?
3. Does the business need separate SKU labels per size now (for packing, suppliers, or eBay), or can variant SKU be nullable initially?
4. Should product page auto-select a default size or force explicit size selection? Recommendation: force explicit selection for size products.
5. Should customer-facing order pages show `Size: M` and `Color: Black` as separate fields, or is a combined label acceptable for V1?
6. Are there active saved carts with variant rows that could be invalidated by option renames? Implementation should assume yes.
7. Are existing color variants intended as true sellable variants, or were they originally intended as display swatches only? Current checkout/stock logic treats them as sellable variants.
8. Are external marketplace variant SKUs expected to match internal variant SKUs later?

---

## Audit Conclusion

The repo already has a variant foundation, but it is **color-only and text-keyed**. Adding sizes cleanly should mean stabilizing and extending the existing variant model, not adding a loose `size` field to cart items or products. The next design should make `product_variants.id` the canonical purchasable-unit identifier while keeping legacy `variant` text as a display/order-history snapshot.

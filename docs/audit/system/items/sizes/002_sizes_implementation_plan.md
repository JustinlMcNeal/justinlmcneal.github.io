# 002 — Sizes Implementation Plan

**Project:** Karry Kraze product size / variant rollout  
**Date:** 2026-05-09  
**Scope:** Planning only. Do not implement until approved.

---

## Suggested Build Order

1. **Schema foundation:** add durable variant identity/snapshot fields without breaking existing rows.
2. **Read model compatibility:** update frontend/backend to read both old and new variant shapes.
3. **Cart identity:** persist `variant_id` and use it as the cart line key when available.
4. **Checkout handoff:** pass `variant_id` and selected option snapshots to `create-checkout-session`.
5. **Webhook/order storage:** store `variant_id` and snapshots on `line_items_raw`; use `variant_id` for stock decrement/refund when present.
6. **Product page UI:** replace color-only swatches with option-aware controls; require explicit size selection for size products.
7. **Admin product editor:** stop hardcoding `Color`; support `Size`; preserve variant rows instead of delete/reinsert.
8. **Saved carts / abandoned cart:** store `variant_id` and structured selected options in `saved_carts.cart_data`; keep legacy fallback.
9. **Fulfillment/admin visibility:** show size/variant SKU clearly in order detail, raw line items, and packing contexts.
10. **Testing and rollout:** migrate one apparel/hoodie product first; verify full purchase/refund/saved-cart flow; then expand.

---

## Phase 0 — Pre-Implementation Safety Checks

Before editing production logic:

- Confirm there are no active uncommitted production changes unrelated to sizes.
- Export a sample of current `product_variants`, `saved_carts`, `line_items_raw`, and `orders_raw` for rollback/debug reference.
- Pick one pilot product category: apparel/hoodies.
- Decide launch behavior:
  - size-only hoodie first, or
  - size + color combo immediately.
- Decide if variant SKU is required at launch.
- Decide if sizes share product price/weight at launch.

Recommended pilot assumption:

- Use size-only variants first (`S`, `M`, `L`, `XL`, etc.).
- Same product price and weight across sizes initially.
- Add variant SKU column now but allow null.
- Force customer size selection.

---

## Phase 1 — Schema Changes

Create a migration that extends existing tables without breaking old data.

### `product_variants`

Recommended additions:

```sql
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS option_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS price_override_cents INTEGER,
  ADD COLUMN IF NOT EXISTS weight_g_override INTEGER,
  ADD COLUMN IF NOT EXISTS unit_cost_override_cents INTEGER,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
```

Recommended indexes:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_unique
  ON product_variants (sku)
  WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_variants_option_values_gin
  ON product_variants USING gin (option_values);
```

Backfill:

```sql
UPDATE product_variants
SET
  title = COALESCE(NULLIF(title, ''), option_value),
  option_values = CASE
    WHEN option_values = '{}'::jsonb THEN jsonb_build_object(option_name, option_value)
    ELSE option_values
  END
WHERE true;
```

Default variant rule:

- For products with exactly one active variant, set `is_default = true`.
- For products with multiple variants, leave false unless admin chooses one.

### `line_items_raw`

Recommended additions:

```sql
ALTER TABLE line_items_raw
  ADD COLUMN IF NOT EXISTS variant_id UUID,
  ADD COLUMN IF NOT EXISTS variant_sku TEXT,
  ADD COLUMN IF NOT EXISTS variant_title TEXT,
  ADD COLUMN IF NOT EXISTS selected_options JSONB;

CREATE INDEX IF NOT EXISTS idx_line_items_raw_variant_id
  ON line_items_raw (variant_id);
```

Do not make `variant_id` required. Legacy website orders, eBay orders, Amazon imports, and generic carrier imports may not have internal variant UUIDs.

### Optional view updates

Update or create views used by admin to expose new fields:

- `v_order_lines` should include `variant_id`, `variant_sku`, `variant_title`, `selected_options` when columns exist.
- Keep existing `variant` field for compatibility.

Do this only after confirming current view definitions.

---

## Phase 2 — Shared Variant Utilities

Add a small shared module rather than duplicating parsing logic:

Suggested file:

- `js/shared/variantUtils.js`

Recommended functions:

- `normalizeVariantLabel(value)` — current trim behavior.
- `formatSelectedOptions(optionValues)` — `{ Size: 'M', Color: 'Black' }` → `Color: Black · Size: M`.
- `variantDisplayName(variant)` — prefer `variant.title`, fallback `variant.option_value`, fallback formatted `option_values`.
- `cartLineKey(item)` — prefer `variant_id`, fallback current `id::variant`.
- `isOptionTypeColor(name)` / `isOptionTypeSize(name)` for UI rendering.

Backend equivalent can be simple local helpers in edge functions.

---

## Phase 3 — Cart Changes

### `js/product/cart.js`

Current `buildCartPayload()` already includes `variant_id`. Extend it to include:

- `variant_id`
- `variant_sku`
- `variant_title`
- `selected_options`
- effective `price` if variant-level override is supported
- effective image from variant

For size-only variants, `selected_options` should be `{ Size: 'M' }`.

### `js/shared/cartStore.js`

Required changes:

- Persist `variant_id` from payload.
- Persist `variant_sku`, `variant_title`, and `selected_options`.
- Change line key logic:
  - If item/payload has `variant_id`, use `variant:${variant_id}`.
  - Else use legacy `${id}::${variant}`.
- Update `findLineIndex()`, `removeItem()`, and `setQty()` to accept either `variant_id` or legacy variant text without breaking current UI.
- Keep existing `variant` display string for old UI until all display components are updated.

Backward compatibility:

- Existing localStorage carts under `kk_cart_v1` must continue loading.
- Do not change storage key until legacy migration is intentionally designed.

### `js/shared/cart/cartUI.js`, `cartDrawer.js`, `cartControls.js`

Update displays to use `variant_title` / `selected_options` when present, fallback to `variant`.

---

## Phase 4 — Product Page UI Changes

Files:

- `js/product/api.js`
- `js/product/render.js`
- `js/product/index.js`
- `page_inserts/product/details.html` / product insert files if option UI markup needs updating

### `fetchVariants(productId)`

Select new fields:

- `id`
- `product_id`
- `sku`
- `title`
- `option_name`
- `option_value`
- `option_values`
- `stock`
- `preview_image_url`
- `price_override_cents`
- `weight_g_override`
- `unit_cost_override_cents`
- `is_default`
- `sort_order`
- `is_active`

### Replace color-only swatch rendering

Current function:

- `renderVariantSwatches(container, variants, onSelect)`

Recommended approach:

- Keep it for `Color` variants.
- Add `renderVariantOptions(container, variants, onSelect)` that can render:
  - size buttons/dropdown for `Size`
  - swatches for `Color`
  - generic buttons for `Other`

For V1 size-only products:

- If product's variant option type is `Size`, render size buttons.
- Do **not** auto-select the first size unless `is_default` is intentionally true and product does not require selection.
- Disable add-to-cart until a size is selected.
- Show “Choose a size” validation message if add-to-cart is clicked without size.

### Image, stock, shipping

- Continue to use variant `preview_image_url` when present.
- Continue to use variant stock for low-stock/backorder text.
- If variant-level weight/price exists later, product page should display effective price.

---

## Phase 5 — Catalog / Home Quick Add Changes

Files:

- `js/home/api.js`
- `js/shared/components/productCardHome.js`
- `js/catalog/index.js`
- `js/home/shopTheLook.js`

Required changes:

- Include new variant fields in `fetchVariantsForProducts()`.
- Change card display:
  - color products: still show swatches.
  - size products: show size labels or “Sizes S–XL”.
  - multi-option products: show compact option summary.
- Change quick-add rules:
  - If product has required size selection: button = “Choose Options” and route to product page.
  - If product has exactly one default variant: quick-add may add that variant using `variant_id`.
  - Do not pass `id: variantId`; `id` should remain product UUID. Pass `variant_id` separately.

This phase should fix the current quick-add `id` ambiguity.

---

## Phase 6 — Checkout Changes

### Frontend checkout

Files:

- `js/checkout/index.js`
- `js/checkout/renderItems.js`
- `js/checkout/summary.js`

Required changes:

- Include in `items` sent to `create-checkout-session`:
  - `product_uuid`
  - `product_id` (SKU/code)
  - `variant_id`
  - `variant_sku`
  - `variant_title`
  - `selected_options`
  - legacy `variant`
- Stock display should prefer `variant_id` lookup when present.
- Backorder calculation should prefer `variant_id`.
- Display selected options clearly.

### `create-checkout-session`

Required changes:

- Accept `variant_id`.
- For each item:
  1. If `variant_id` is present, query `product_variants` joined/paired with `products` and use that as authoritative.
  2. Else fallback to current SKU + `variant` text behavior.
- Effective unit price:
  - `product_variants.price_override_cents` if not null.
  - else `products.price`.
- Effective weight:
  - `product_variants.weight_g_override` if not null.
  - else `products.weight_g`.
- Effective variant display:
  - `variant_title` / `title`
  - else `option_value`
  - else legacy `variant`
- Stripe metadata additions:
  - `kk_variant_id`
  - `kk_variant_sku`
  - `kk_variant_title`
  - `kk_selected_options` (JSON string, size-limited)
- Keep existing `kk_variant` metadata for compatibility.

Anti-tamper note:

- Do not trust client-sent variant price/weight. Use server-side lookup by `variant_id`.

---

## Phase 7 — Webhook / Order Storage Changes

File:

- `supabase/functions/stripe-webhook/index.ts`

Required changes:

- Extract new Stripe metadata:
  - `kk_variant_id`
  - `kk_variant_sku`
  - `kk_variant_title`
  - `kk_selected_options`
- Insert/upsert new fields into `line_items_raw`.
- Continue populating legacy `variant` text.
- Stock decrement:
  - Prefer `variant_id` lookup.
  - Fallback to SKU + variant text for old sessions/imports.
- Stock refund restoration:
  - Prefer `line_items_raw.variant_id`.
  - Fallback to SKU + variant text.
- `stock_ledger.variant_id` should always receive actual variant UUID when found.

Compatibility requirement:

- Old Stripe sessions with only `kk_variant` must still process.
- Imported eBay/Amazon/generic orders with no internal variant ID must still insert.

---

## Phase 8 — Saved Carts and Abandoned Cart Changes

### `supabase/functions/cart-sync/index.ts`

Required changes:

- Sanitize and store:
  - `product_uuid`
  - `variant_id`
  - `variant_sku`
  - `variant_title`
  - `selected_options`
  - legacy `variant`
- Cart hash:
  - Prefer `variant_id`.
  - Fallback to `id + variant`.

### `supabase/functions/sms-abandoned-cart/index.ts`

No major SMS copy change required.

Optional improvement:

- `topItemName()` can remain product-name-only to avoid awkward SMS copy.
- `user_state_snapshot` should preserve item count/cart value; variant detail is already in `saved_carts.cart_data` if needed for later analytics.

### `stripe-webhook`

Purchased-cart marking remains phone/status based. No change needed for variant support.

---

## Phase 9 — Admin Product Editor Changes

Files:

- `js/admin/products/api.js`
- `js/admin/products/modalRows.js`
- `js/admin/products/modalEditor.js`
- `js/admin/products/renderTable.js`

Required changes:

### Stop hardcoding `Color`

`replaceVariants()` currently inserts `option_name: "Color"` for every variant. Replace with collected option type.

### Preserve variant IDs

Current `replaceVariants()` deletes all variants and reinserts them. Once `variant_id` is persisted in carts/orders, this is unsafe.

Recommended replacement:

- Collect rows with existing `id` when editing.
- Upsert existing rows by `id`.
- Insert new rows.
- Soft-disable removed rows (`is_active=false`) instead of deleting, or delete only if no active cart/order references are possible.

### Add variant fields

Minimum for size launch:

- option type (`Color`, `Size`, `Other`)
- option value (`M`, `L`, `Black`, etc.)
- title/display label
- stock
- preview image
- optional SKU
- default flag

Later:

- price override
- weight override
- unit cost override
- structured `option_values` editor / matrix builder

---

## Phase 10 — Fulfillment and Admin Order Display

Files:

- `js/admin/lineItemsOrders/api.js`
- `js/admin/lineItemsOrders/index.js`
- `js/admin/lineItemsRaw/api.js`
- `js/admin/lineItemsRaw/renderTable.js`
- `js/admin/itemStats/index.js`
- `js/admin/itemStats/renderTable.js`

Required changes:

- Include new fields in order line queries/views:
  - `variant_id`
  - `variant_sku`
  - `variant_title`
  - `selected_options`
- Display selected options in order detail.
- Display variant SKU when present.
- Use `variant_id` or `variant_sku` for variant image lookup when possible; fallback to `product code | variant text`.
- Item stats should group by `variant_id` when available and label by `variant_title` / selected options.
- Raw line item table should continue showing legacy `variant` but add better size/variant info once columns exist.

---

## Phase 11 — Customer Order / Review Display

Files:

- `js/success/index.js`
- `js/my-orders/index.js`
- `js/reviews/index.js`
- `js/reviews/leave.js`
- `supabase/functions/verify-order/index.ts`
- `supabase/functions/verify-review-token/index.ts`
- `supabase/functions/lookup-orders/index.ts`

Required changes:

- Return/display `variant_title` and `selected_options` when present.
- Fallback to `variant` text.
- Keep review identity product-level unless variant-specific reviews become a later requirement.

---

## Phase 12 — External Marketplace / Import Follow-Up

Not required for initial website size launch, but should be tracked.

Files/areas:

- `supabase/functions/ebay-manage-listing/index.ts`
- `supabase/functions/ebay-sync-orders/index.ts`
- `supabase/functions/ebay-webhook/index.ts`
- `js/admin/lineItemsOrders/amazonImport.js`
- `import-amazon-orders.mjs`
- `import-legacy-orders.mjs`

Current state:

- eBay code already references variant SKUs and item group keys in places.
- Amazon import extracts variant from product name.
- Imported orders store variant text but not internal `variant_id`.

Future work:

- Map external marketplace variant SKUs to internal `product_variants.sku`.
- Populate `line_items_raw.variant_id` when imports can resolve it.

---

## Backward Compatibility Strategy

### Old local carts

- Continue reading `kk_cart_v1` as-is.
- If cart item has no `variant_id`, use legacy key and legacy display.
- During render/checkout, attempt resolution by SKU + variant text.
- Do not hard-fail old carts unless product/variant is inactive and cannot be resolved.

### Old saved carts

- `saved_carts.cart_data` is JSONB and can hold mixed shapes.
- Abandoned cart flow should accept both old and new shapes.
- Cart hash function should support both.

### Old Stripe sessions

- Webhook should support old metadata (`kk_variant`) and new metadata (`kk_variant_id`).

### Old orders/imports

- `line_items_raw.variant_id` nullable.
- Admin displays should fallback to `variant`.

### Existing color products

- Backfill `option_values = { "Color": option_value }`.
- Existing behavior should remain unchanged.
- `renderVariantOptions()` should still render colors as swatches.

---

## Migration Approach

Recommended order:

1. Add nullable columns and backfill `option_values` / `title`.
2. Deploy read compatibility first; no behavior change yet.
3. Persist `variant_id` in new cart lines while old lines still work.
4. Pass `variant_id` to checkout; server still supports fallback.
5. Store `variant_id` in orders; admin still displays legacy variant.
6. Update admin to preserve variant IDs and support size type.
7. Add one test hoodie product with size variants.
8. Run full checkout/refund/saved-cart validation.
9. Expand to more apparel.

Avoid:

- Renaming `kk_cart_v1` storage key at first.
- Making `variant_id` NOT NULL on orders.
- Deleting/reinserting all variants once active carts may reference them.
- Blocking checkout purely due to low stock unless business decides to stop backorders.

---

## Known Risks

1. **Destructive admin variant save** must be fixed before relying on variant IDs long term.
2. **Catalog quick-add ID ambiguity** can cause stock lookups to use variant ID as product ID; fix before size launch.
3. **Variant option rename risk** remains until `variant_id` is end-to-end.
4. **Server anti-tamper pricing** must stay authoritative in `create-checkout-session`.
5. **Legacy carts and saved carts** may contain only `variant` text.
6. **External imports** may not resolve internal variant IDs immediately.
7. **Multi-option UI** should not be overbuilt if first launch is size-only, but schema should not prevent it.

---

## Minimum Viable Safe Size Launch

A safe first implementation can launch sizes if all are true:

- `product_variants` can represent size rows.
- Admin can create/edit size variants without hardcoding color.
- Product page renders size choices and requires explicit selection.
- Cart stores `variant_id` and selected size snapshot.
- Checkout sends `variant_id`.
- `create-checkout-session` validates variant by ID and writes Stripe metadata.
- `stripe-webhook` stores `variant_id` and decrements stock by ID.
- Order/admin/customer displays show selected size clearly.
- Old carts and non-sized products still work.

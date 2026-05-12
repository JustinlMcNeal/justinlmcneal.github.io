# 001 — Sizes Architecture Recommendation

**Project:** Karry Kraze product size / variant architecture  
**Date:** 2026-05-09  
**Scope:** Recommendation only. No implementation changes.

---

## Recommended Direction

Use a **full product + product variants architecture**, with `product_variants` representing the **actual purchasable unit**.

Do **not** add size as a loose dropdown on `products`, cart items, or checkout items. The audit shows the store already has a partial variant system, including `product_variants`, variant stock, variant images, stock ledger, checkout stock checks, and order-line `variant` snapshots. The correct path is to stabilize and extend that existing model.

### Core recommendation

- Keep `products` as the parent/catalog entity.
- Promote `product_variants.id` to the canonical purchasable-unit ID.
- Carry `variant_id` through:
  - product page add-to-cart
  - local cart (`kk_cart_v1`)
  - checkout payload
  - saved carts (`cart_data`)
  - Stripe metadata
  - webhook/order line items
  - fulfillment/admin displays
- Preserve text snapshots for human readability and historical safety:
  - `product_name`
  - `variant_title`
  - `variant` / selected option label
  - `selected_options`
  - `sku` / `variant_sku`
  - `unit_price_cents` at purchase time
- Keep non-sized products compatible through a default variant or legacy fallback.

---

## Why This Is Best for This Codebase

The current code already behaves like a product-variant system in several places:

- `js/product/api.js:fetchVariants()` loads `product_variants` for each product page.
- `js/product/render.js:renderVariantSwatches()` renders selectable variant options.
- `js/product/cart.js:buildCartPayload()` already includes `variant_id` in the add-to-cart payload.
- `js/shared/cartStore.js` merges cart lines by product ID + variant text.
- `js/checkout/renderItems.js` fetches variant stock for checkout display.
- `supabase/functions/create-checkout-session/index.ts` checks variant stock before Stripe checkout.
- `supabase/functions/stripe-webhook/index.ts` decrements/restores `product_variants.stock` and logs to `stock_ledger`.
- `line_items_raw.variant` already stores the selected option label as an order snapshot.
- Admin order views and item stats already display/aggregate `variant`.

The missing piece is **stable identity**. The system uses `variant` text instead of `variant_id` across critical boundaries. That is tolerable for color-only products but not safe for sizes and future size+color combinations.

---

## Architecture Options Considered

### Option A — Add `size` fields directly to products or cart items

Example:

- `products.sizes TEXT[]`
- cart item `{ product_id, size }`
- order line `size TEXT`

**Pros:**

- Fastest to implement.
- Minimal schema changes.

**Cons:**

- Duplicates the existing `product_variants` concept.
- Cannot cleanly support colors later.
- Cannot support inventory per size+color combination.
- Would require another migration when colors arrive.
- Keeps checkout/order/fulfillment identity text-based.

**Verdict:** Reject. This is a short-term patch that conflicts with existing architecture.

### Option B — Keep current `product_variants` exactly as-is, use `option_name='Size'`

Example rows:

- Hoodie → `option_name='Size'`, `option_value='S'`
- Hoodie → `option_name='Size'`, `option_value='M'`

**Pros:**

- Uses existing table.
- Works for size-only products.
- Fits existing unique index `(product_id, option_name_key, option_value_key)`.
- Lowest-risk first size rollout if no product has both size and color.

**Cons:**

- Still one option dimension per row.
- Cannot model `Color + Size` combinations without encoding both into `option_value`.
- Does not solve stable cart/order identity unless `variant_id` is propagated.
- Admin currently hardcodes `Color` and must change anyway.

**Verdict:** Acceptable as a **temporary compatibility mode**, but not enough as the target architecture.

### Option C — Add structured option group/value tables now

Potential tables:

- `product_option_groups`
- `product_option_values`
- `product_variant_option_values`

**Pros:**

- Most normalized.
- Best if admin needs automatic combination generation and option reuse.
- Cleanly supports arbitrary dimensions.

**Cons:**

- More schema and UI work.
- Current vanilla JS admin UI is simple and likely does not need full normalization yet.
- Most operational code only needs resolved purchasable variants, not normalized option catalogs.

**Verdict:** Defer. Useful later, but not required to add sizes safely if `product_variants` stores selected options in a structured snapshot.

### Option D — Evolve `product_variants` into full sellable variants

Recommended.

Each row in `product_variants` is one buyable item. It can represent:

- No options: `Default`
- One option: `Size = M`
- One option: `Color = Pink`
- Multiple options later: `Size = M, Color = Black`

Use existing columns for backward compatibility and add new columns for structured identity and future growth.

**Pros:**

- Builds on existing production concepts.
- Keeps one canonical purchasable-unit table.
- Supports sizes now and colors later.
- Supports inventory per variant now.
- Gives admin/fulfillment a stable `variant_id`.
- Does not require a full option-table build immediately.

**Cons:**

- Requires careful migration and fallback handling.
- Admin variant editor must stop destructive delete/reinsert once `variant_id` matters.
- Existing code paths must be updated end-to-end.

**Verdict:** Recommended target.

---

## Recommended Data Model

### `products` remains parent/catalog entity

Keep product-level fields for shared defaults:

- `id`
- `code` — parent SKU/base code
- `slug`
- `name`
- `category_id`
- `price` — default price
- `weight_g` — default weight
- `unit_cost` — default cost
- `shipping_status` — default shipping status
- product-level images
- active/catalog fields

### `product_variants` becomes canonical purchasable unit

Keep existing columns:

- `id`
- `product_id`
- `option_name`
- `option_value`
- `option_name_key`
- `option_value_key`
- `stock`
- `preview_image_url`
- `sort_order`
- `is_active`

Add recommended columns over time:

| Column | Type | Purpose |
|---|---|---|
| `sku` | `TEXT NULL` | Variant SKU for packing, eBay, supplier mapping. Unique when present. |
| `title` | `TEXT NULL` | Human display label, e.g. `Medium`, `Black / Medium`. |
| `option_values` | `JSONB NOT NULL DEFAULT '{}'` | Structured selected options, e.g. `{ "Size": "M" }`, later `{ "Color": "Black", "Size": "M" }`. |
| `price_override_cents` | `INTEGER NULL` | Optional variant price override. Null means use `products.price`. |
| `weight_g_override` | `INTEGER NULL` | Optional variant weight override. Null means use `products.weight_g`. |
| `unit_cost_override_cents` | `INTEGER NULL` | Optional variant cost override. Null means use `products.unit_cost`. |
| `is_default` | `BOOLEAN NOT NULL DEFAULT false` | Fallback/default variant for non-sized products. |
| `requires_selection` | `BOOLEAN NOT NULL DEFAULT false` or product-level flag | Prevent accidental auto-selection for size products. |

Notes:

- `option_name` / `option_value` should remain for compatibility but become a derived/simple display pair.
- For multi-option variants, `option_value` can be a display label such as `Black / M`, while `option_values` stores structure.
- `preview_image_url` remains useful as the variant image override.

### `line_items_raw` should remain an immutable order snapshot

Add nullable snapshot/identity fields:

| Column | Type | Purpose |
|---|---|---|
| `variant_id` | `UUID NULL` | FK-ish reference to `product_variants.id`; nullable for legacy/imported orders. |
| `variant_sku` | `TEXT NULL` | Snapshot of variant SKU at purchase time. |
| `variant_title` | `TEXT NULL` | Snapshot display label. |
| `selected_options` | `JSONB NULL` | Snapshot `{ "Size": "M", "Color": "Black" }`. |

Keep existing fields:

- `product_id` — currently SKU/code; keep for legacy and reporting.
- `product_name`
- `variant` — flat display string; keep for backward-compatible displays and imports.
- `unit_price_cents`, `post_discount_unit_price_cents`, `item_weight_g`

### Saved cart `cart_data` should become variant-aware JSON

Recommended new shape:

```json
{
  "id": "product_uuid",
  "product_uuid": "product_uuid",
  "product_id": "KK-0001",
  "variant_id": "variant_uuid",
  "variant_sku": "KK-0001-M",
  "name": "Karry Kraze Hoodie",
  "variant": "M",
  "variant_title": "Medium",
  "selected_options": { "Size": "M" },
  "price": 42.00,
  "qty": 1,
  "image": "url",
  "slug": "karry-kraze-hoodie"
}
```

Backward compatibility:

- Existing saved carts with no `variant_id` should still render and sync.
- Cart hash should prefer `variant_id`, fallback to `id + variant`.

### Local cart item should become variant-aware

Recommended shape:

```js
{
  id: product.id,                // product UUID, stable
  product_uuid: product.id,
  product_id: product.code,      // SKU/code for compatibility
  variant_id: selectedVariant.id,
  variant_sku: selectedVariant.sku || null,
  name: product.name,
  variant: "M",                 // legacy/display fallback
  variant_title: "Medium",
  selected_options: { Size: "M" },
  price: effectiveUnitPrice,
  image: variantImage || productImage,
  qty,
  category_id,
  category_ids,
  tag_ids,
  tags,
  slug,
  source
}
```

Cart line identity:

1. If `variant_id` exists: key by `variant_id`.
2. Else fallback: key by `id + variant` for old carts.

---

## How Non-Sized Products Stay Compatible

Recommended compatibility strategy:

1. Every product has at least one active `product_variants` row already. For simple products, treat the single row as the default variant.
2. If a product has exactly one variant and that variant is equivalent to default/standard/color-only, quick-add can continue.
3. If a product has a required option type such as `Size`, quick-add should say “Choose Options” and route to product detail.
4. Old cart items with no `variant_id` should still work by using the current SKU + `variant` text fallback.
5. Orders and imported external line items may keep `variant_id = NULL` but should retain text snapshots.

---

## Are Option Group / Option Value Tables Needed Now?

**Not required for the first size rollout.**

Reason:

- The current admin is a vanilla JS product modal, not a complex product configurator.
- The immediate need is sizes for apparel, likely one dimension at first.
- The operational system needs one resolved purchasable row per variant more than it needs normalized option catalogs.
- `product_variants.option_values JSONB` can cover sizes now and colors later without large upfront complexity.

When to add option tables later:

- When admin needs automatic matrix generation: all colors × all sizes.
- When option values need reusable display metadata, e.g. standardized size order, color hex/image, disabled values.
- When variant combinations need validation rules beyond one JSON object per variant.

Recommended future tables if needed:

- `product_option_groups(id, product_id, name, display_type, sort_order, is_required)`
- `product_option_values(id, group_id, value, label, swatch_color, sort_order, is_active)`
- `product_variant_option_values(variant_id, option_value_id)`

But defer until the simpler `product_variants.option_values` model becomes limiting.

---

## UI Recommendation

### Product page

Replace color-only swatches with option-aware rendering:

- `Color` → swatches using `parseColorValue()` and `preview_image_url`.
- `Size` → button group or dropdown (`S`, `M`, `L`, `XL`).
- One-dimensional products → select directly from active variants.
- Multi-dimensional products later → choose options, then resolve the matching variant row.

Size products should require explicit selection unless a clear business decision is made otherwise.

### Admin product editor

Short term:

- Rename “Variants” UI to “Options / Variants”.
- Add option type selector: `Color`, `Size`, `Other`.
- Stop hardcoding `option_name: 'Color'`.
- Preserve variant IDs on edit.
- Add optional variant SKU field.

Later:

- Add structured option matrix builder.
- Add variant-level price/weight/cost overrides.
- Add image gallery assignment per variant.

### Cart / checkout / fulfillment displays

Show structured labels:

- Current: `Pink`
- Size product: `Size: M`
- Future combo: `Color: Black · Size: M`

Packing/admin should show:

- Product name
- Parent SKU
- Variant SKU when present
- Selected options
- Quantity
- Variant image

---

## Rejected Alternatives

### Loose `size` on cart item only

Rejected because it would not solve inventory, checkout, saved carts, Stripe metadata, webhook stock decrement, admin visibility, or future color support.

### Separate `product_sizes` table only

Rejected because it would duplicate `product_variants` and still need a second model later for colors.

### Encode combinations in `option_value` only (`Black / M`)

Useful as a display fallback, but rejected as the primary model because parsing text is fragile and hard to query. Use `option_values JSONB` plus a display label instead.

### Full normalized option tables immediately

Deferred because it adds complexity before the codebase needs it. The current vanilla admin and existing `product_variants` table can evolve safely with fewer moving parts.

---

## Final Architecture Statement

The product purchased by a customer should be identified by `product_variants.id`, not by `products.id` alone and not by a mutable text `variant` label. `products` should describe the catalog item; `product_variants` should describe the buyable SKU/option combination. Cart, saved cart, Stripe, orders, fulfillment, and analytics should all preserve both:

1. durable identity (`variant_id`), and
2. immutable human-readable purchase snapshot (`variant_title`, `selected_options`, `variant_sku`, price/weight at purchase time).

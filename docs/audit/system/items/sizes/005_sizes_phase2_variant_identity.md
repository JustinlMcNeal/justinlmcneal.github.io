# Phase 2 — Variant Identity Path
**Status:** In Progress  
**Date:** 2026-05-09  
**Prereq:** Phase 1 complete (schema, backfill, read-compat, variantUtils.js)

---

## What Phase 2 is responsible for

Phase 2 wires `variant_id` as a durable identifier through the entire purchase
flow — from cart persistence through Stripe metadata to database order records
and stock ledger entries. This is a **data-integrity pass**, not a UI launch.

The goal is that every new order placed after this phase deploys will carry
authoritative variant identity at every stage, making it possible to:
- Reliably decrement stock by exact variant UUID
- Restore stock on refund without text-matching
- Query future orders by variant_id for analytics and fulfillment
- Support the phase 4 size UI without needing to retrofit identity

---

## Files changed in this phase

| File | Change |
|------|--------|
| `js/shared/cartStore.js` | Persist `variant_id`, `variant_sku`, `variant_title`, `selected_options`; update `findLineIndex`, `removeItem`, `setQty` to prefer `variant_id` |
| `js/shared/cart/cartUI.js` | Show `variant_title` if present; add `data-kk-variant-id` to qty/remove buttons |
| `js/shared/cart/cartControls.js` | Pass `variant_id` from button dataset to `setQty`/`removeItem` |
| `js/checkout/index.js` | Include `variant_id`, `variant_sku`, `variant_title`, `selected_options` in checkout payload |
| `js/checkout/renderItems.js` | Add `data-variant-id` to checkout item buttons; pass to `setQty`/`removeItem` |
| `supabase/functions/create-checkout-session/index.ts` | Accept and resolve `variant_id` per item; add enriched Stripe metadata fields; apply weight override from variant |
| `supabase/functions/stripe-webhook/index.ts` | Read new metadata fields; persist `variant_id`, `variant_sku`, `variant_title`, `selected_options` on `line_items_raw`; prefer `variant_id` for stock decrement + refund restore |
| `supabase/functions/cart-sync/index.ts` | Preserve `variant_id`, `variant_title`, `selected_options` in sanitized cart snapshot |

---

## Identity rules now being enforced

1. **`variant_id` is the preferred cart line identifier.** When a cart item
   carries `variant_id`, that UUID is used to find the line in `findLineIndex`
   before falling back to the legacy `${id}::${variant}` text key.

2. **Checkout payload always forwards `variant_id` when present.** No stripping
   at the checkout boundary.

3. **`create-checkout-session` resolves variant rows server-side.** When
   `variant_id` is present on a line item, the function queries
   `product_variants` by `id` to obtain authoritative `title`, `sku`,
   `option_values`, and any weight override. These are stored in Stripe product
   metadata, not trusted from the client.

4. **Stripe product metadata carries both legacy and new identity fields.**
   Old fields (`kk_product_id`, `kk_variant`) are kept. New fields
   (`kk_variant_id`, `kk_variant_sku`, `kk_variant_title`,
   `kk_selected_options`) are added alongside them.

5. **Webhook stores `variant_id` on `line_items_raw`** when available in Stripe
   metadata. The column is nullable — old sessions without `kk_variant_id`
   still work.

6. **Stock decrement prefers `variant_id`.** If the webhook line row has
   `variant_id`, the variant is looked up directly by `product_variants.id`.
   If not, the existing SKU + option_value text-match fallback runs unchanged.

7. **Refund re-increment prefers `variant_id`** from `line_items_raw`.
   Same lookup preference: direct UUID → text-match fallback.

---

## Phase 2 invariants

- `variant_id` is the preferred cart/order/checkout variant identifier.
- Legacy `variant` (text) remains supported as fallback for all flows.
- `line_items_raw.variant_id` must remain nullable; historical and
  marketplace-imported orders without it continue to work.
- Old carts without `variant_id` (currently in `kk_cart_v1` localStorage)
  must still load, display, and checkout correctly.
- Old Stripe sessions without `kk_variant_id` in metadata must still be
  processed by the webhook without error.
- Current storefront UX must not change materially in this pass:
  - No size selector UI
  - No required variant enforcement
  - No product page redesign
  - Color products continue to behave exactly as before

---

## Fallback rules for legacy data

| Scenario | Behavior |
|----------|----------|
| Cart item has no `variant_id` | `findLineIndex` uses legacy `id::variant` key |
| Cart item has `variant_id` but findLineIndex has no match by UUID | Falls through to `id::variant` key match |
| Checkout item has no `variant_id` | `create-checkout-session` skips variant lookup; uses existing SKU-based weight/price logic |
| Stripe metadata missing `kk_variant_id` | Webhook skips variant_id population; line row `variant_id` stays null |
| `line_items_raw.variant_id` is null on refund | Refund stock restore uses SKU + option_value text fallback |
| `variant_title` absent from cart item | Cart UI displays `item.variant` text as before |
| `selected_options` absent from cart item | Checkout payload sends `null`; no breakage |

---

## Intentionally deferred to later phases

- **Size selector UI** (Phase 4) — no button/selector component yet
- **Required size enforcement** (Phase 4) — products with sizes do not yet gate the add-to-cart
- **Admin variant size editor** (Phase 3) — admin can create size variants but no specialized size UI yet
- **Hoodie/apparel product page redesign** (Phase 4)
- **Size + color combination support** (Phase 5) — `option_values` JSONB is ready but not rendered
- **`price_override_cents` pricing path** — column exists in schema; checkout now reads it but pricing
  validation is not yet adjusted to use override prices for anti-tamper check (all current products
  use product-level pricing; override support is scaffolded for future use)
- **Full `cartLineKey` adoption** — `variantUtils.cartLineKey()` is staged but cartStore still uses
  its own internal `lineKey()` for the legacy path; the two are equivalent

---

## Notes on risky areas

### Admin delete/reinsert pattern
Admin variant editing currently deletes and reinserts variant rows, invalidating
`variant_id` UUIDs that may be in active carts. This is a known limitation
documented in Phase 1. Phase 3 will address the admin edit flow.

### Cart items from catalog quick-add
The catalog `index.js` quick-add passes `id: variants[0].id` but does not yet
surface `variant_id` as a distinct field on the payload. These items fall back
to the legacy identity path harmlessly.

### swipeToAdd.js
Does not send `variant_id` in its payload. Falls back to legacy `id::variant`
key. No regression. Will be addressed when size support is added to product cards.

### Price override
`product_variants.price_override_cents` is fetched in `create-checkout-session`
when `variant_id` is present. However, the anti-tamper subtotal check still
compares against the product-level `products.price`. If a variant with an
override is purchased, the subtotal check may reject valid discounted_price
values. Since no current products use price overrides, this is a deferred risk.
Phase 3 or 4 will reconcile the anti-tamper logic with variant-level pricing.

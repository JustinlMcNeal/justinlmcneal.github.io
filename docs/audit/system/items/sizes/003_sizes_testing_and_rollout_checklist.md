# 003 — Sizes Testing and Rollout Checklist

**Project:** Karry Kraze product size / variant rollout testing  
**Date:** 2026-05-09  
**Scope:** Test plan only. No implementation changes.

---

## Testing Principles

- Test variant-aware behavior end-to-end: product page → cart → saved cart → checkout → Stripe → webhook → order line → stock ledger → admin fulfillment.
- Test old carts and non-sized products explicitly; do not assume backward compatibility.
- Test both successful purchase and refund stock restoration.
- Test that size selection is visible to staff and customers at every relevant point.
- Test that no SMS send flow logic changes are needed for size support.

---

## Launch Readiness Checklist

### Schema readiness

- [ ] `product_variants` has durable fields needed for size rollout (`sku`, `title`, `option_values`, optional overrides) or an approved equivalent.
- [ ] `line_items_raw` can store nullable `variant_id` plus variant snapshot fields.
- [ ] Existing color variants are backfilled with structured option data.
- [ ] Existing products still have active variants after migration.
- [ ] Variant SKU uniqueness is enforced only when SKU is non-null.
- [ ] `variant_id` remains nullable in orders/imports for backward compatibility.

### Frontend readiness

- [ ] Product page renders color variants as swatches.
- [ ] Product page renders size variants as size buttons/dropdown, not color swatches.
- [ ] Size products require explicit size selection before add-to-cart.
- [ ] Add-to-cart payload includes `variant_id`.
- [ ] Cart persists `variant_id`, selected options, and legacy `variant` label.
- [ ] Cart line merge uses `variant_id` when available.
- [ ] Quantity controls update the correct variant line.
- [ ] Removing one size does not remove another size of the same product.
- [ ] Cart drawer and checkout page show size clearly.
- [ ] Non-sized/simple products can still be added.

### Checkout readiness

- [ ] Checkout payload includes `variant_id` and selected option snapshots.
- [ ] `create-checkout-session` resolves variant by `variant_id` when present.
- [ ] Server falls back to legacy SKU + variant text for old carts.
- [ ] Stripe metadata includes `kk_variant_id` and keeps existing `kk_variant`.
- [ ] Server-side price is authoritative; client price tampering is rejected or corrected.
- [ ] Backorder/stock display works for size variants.
- [ ] Free shipping, coupons, and auto promotions still calculate correctly.

### Order/webhook readiness

- [ ] `stripe-webhook` stores `variant_id` and selected option snapshot on `line_items_raw`.
- [ ] `line_items_raw.variant` remains populated for compatibility.
- [ ] Stock decrement uses `variant_id` when present.
- [ ] Full refund stock restoration uses `variant_id` when present.
- [ ] Legacy webhook sessions still process using `kk_variant` only.
- [ ] Imported/external orders with no internal variant ID still insert.

### Admin/fulfillment readiness

- [ ] Admin product editor supports `Size` option type.
- [ ] Admin no longer hardcodes all variants as `Color`.
- [ ] Admin preserves existing variant IDs on edit.
- [ ] Admin can set stock per size.
- [ ] Admin can see variant SKU/title/size in order details.
- [ ] Raw line items table shows size/variant clearly.
- [ ] Fulfillment picker/packing view shows product name, parent SKU, variant SKU, selected size, and quantity.
- [ ] Item stats can group by variant ID or display label without losing size data.

### Saved cart / SMS readiness

- [ ] `cart-sync` stores `variant_id` in `saved_carts.cart_data` for new carts.
- [ ] `cart-sync` still accepts old cart items without `variant_id`.
- [ ] Cart hash changes when size changes.
- [ ] Cart hash does not falsely merge two sizes of the same product.
- [ ] Abandoned cart SMS still sends product-name copy correctly.
- [ ] Abandoned cart sequence does not advance cart steps for blocked sends.
- [ ] Checkout marks active saved carts purchased as before.

---

## Detailed Test Cases

## A. Product Page Tests

### A1 — Existing color product still works

1. Open an existing product with multiple color variants.
2. Confirm color swatches render.
3. Select a color.
4. Confirm image/stock/shipping text update.
5. Add to cart.

Expected:

- Cart shows selected color.
- Cart line includes `variant_id` after implementation.
- No regression in image or stock display.

### A2 — New size-only hoodie requires size

1. Open hoodie product with variants `S`, `M`, `L`, `XL`.
2. Do not select a size.
3. Click Add to Cart.

Expected:

- Add is blocked.
- Customer sees “Choose a size” or equivalent.
- No cart item is added.

Then:

4. Select `M`.
5. Click Add to Cart.

Expected:

- Cart contains hoodie size `M`.
- Variant snapshot is visible.
- `variant_id` is stored.

### A3 — Same product, two sizes

1. Add hoodie `M` qty 1.
2. Add hoodie `L` qty 1.

Expected:

- Cart has two separate lines.
- Quantity controls are independent.
- Cart subtotal is correct.

### A4 — Same product, same size merge

1. Add hoodie `M` qty 1.
2. Add hoodie `M` qty 2.

Expected:

- Cart has one line for `M`.
- Quantity becomes 3.

### A5 — Out-of-stock/backorder size

1. Set one size stock to `0`.
2. Open product page.
3. Select that size.

Expected:

- UI shows backorder/2–4 week shipping copy.
- Checkout remains allowed if business policy is still backorderable.

---

## B. Cart and LocalStorage Tests

### B1 — New cart shape

Inspect `localStorage.kk_cart_v1` after adding a size item.

Expected fields:

- `id` = product UUID
- `product_uuid` = product UUID
- `product_id` = SKU/code
- `variant_id` = product variant UUID
- `variant` or `variant_title` = selected size label
- `selected_options.Size` = selected size
- `qty`
- `price`
- `image`
- `slug`

### B2 — Legacy cart compatibility

Manually seed an old-style cart item with only:

```json
{
  "id": "product_uuid",
  "product_id": "SKU",
  "name": "Product",
  "price": 10,
  "variant": "Pink",
  "qty": 1
}
```

Expected:

- Cart loads.
- Checkout renders.
- Checkout can still proceed using legacy fallback if product/variant resolves.

### B3 — Remove one size only

1. Add hoodie `M` and `L`.
2. Remove `M`.

Expected:

- `L` remains.
- Subtotal updates correctly.

### B4 — Quantity one size only

1. Add hoodie `M` and `L`.
2. Increase `M`.

Expected:

- `M` quantity changes only.
- `L` unchanged.

---

## C. Checkout Tests

### C1 — Checkout payload includes variant ID

During checkout invocation, confirm item payload contains:

- `product_id` SKU
- `product_uuid`
- `variant_id`
- `variant_title`
- `selected_options`
- legacy `variant`

Expected:

- `create-checkout-session` receives all fields.

### C2 — Server uses variant ID

Use a size product where two variants have different stock counts.

Expected:

- Server stock/backorder decision is based on selected `variant_id`.
- No reliance on text-only matching when `variant_id` exists.

### C3 — Price tamper resistance

Modify cart item price in localStorage before checkout.

Expected:

- Server uses product/variant authoritative price.
- If coupon totals mismatch, checkout is rejected with pricing mismatch.

### C4 — Coupon compatibility

Test:

- no coupon
- percentage coupon
- fixed coupon
- free shipping coupon
- auto promotion if active

Expected:

- Totals match current behavior.
- Variant fields do not break promo scope.

### C5 — Non-sized product checkout

Buy a legacy/simple product.

Expected:

- Checkout works.
- Variant snapshot uses existing/default behavior.
- No requirement to choose size.

---

## D. Stripe / Webhook / Order Tests

### D1 — Stripe metadata

After checkout session creation, inspect Stripe line item product metadata.

Expected:

- Existing fields still present:
  - `kk_product_id`
  - `kk_variant`
  - `kk_unit_price_cents`
  - `kk_post_discount_unit_price_cents`
  - `kk_item_weight_g`
- New fields present when applicable:
  - `kk_variant_id`
  - `kk_variant_sku`
  - `kk_variant_title`
  - `kk_selected_options`

### D2 — `line_items_raw` snapshot

After `checkout.session.completed`, query line items.

Expected:

- `product_id` SKU populated.
- `product_name` populated.
- `variant` populated with readable size label.
- `variant_id` populated for website order.
- `variant_sku` populated if configured.
- `variant_title` populated.
- `selected_options` contains size.
- unit price and paid unit price are correct.

### D3 — Stock decrement

Before checkout, record selected variant stock.

After webhook:

- selected variant stock decreases by quantity.
- no other size changes.
- `stock_ledger` row references correct `variant_id`.

### D4 — Full refund stock restoration

Issue full refund.

Expected:

- selected variant stock increases by quantity.
- `stock_ledger` refund row references same `variant_id`.
- no other size changes.

### D5 — Legacy metadata fallback

Simulate or verify old Stripe session with only `kk_variant` and no `kk_variant_id`.

Expected:

- Webhook still processes.
- Stock fallback by SKU + variant text still works when possible.

---

## E. Saved Cart and Abandoned Cart Tests

### E1 — New saved cart shape

For an SMS subscriber, add hoodie size `M`.

Expected `saved_carts.cart_data`:

- includes `variant_id`
- includes selected size snapshot
- includes legacy `variant`
- item count and value are correct

### E2 — Hash changes by size

1. Save cart with hoodie `M`.
2. Change to hoodie `L`.

Expected:

- `cart_hash` changes.
- `abandoned_step` resets to 0.
- step timestamps clear.

### E3 — Same size quantity changes hash

1. Save hoodie `M` qty 1.
2. Change to qty 2.

Expected:

- `cart_hash` changes.
- `item_count` updates.

### E4 — Legacy saved carts still process

Use an existing saved cart with no `variant_id`.

Expected:

- `sms-abandoned-cart` does not error.
- SMS copy still uses product names.
- Cart can still be marked purchased/expired.

### E5 — Abandoned cart SMS copy

Trigger step 1 for a size product cart.

Expected:

- SMS says product name and cart value.
- No malformed size/variant text.
- No code path requires variant ID.

---

## F. Admin Product Editor Tests

### F1 — Create size product

Create hoodie product with variants:

- `Size = S`, stock 2
- `Size = M`, stock 3
- `Size = L`, stock 1

Expected:

- Rows saved to `product_variants` with `option_name='Size'` or structured equivalent.
- `option_values` includes size.
- Product page renders size controls.

### F2 — Edit size stock without changing IDs

1. Record `product_variants.id` for each size.
2. Edit stock in admin.
3. Save.

Expected:

- Same variant IDs remain.
- Stock values change.
- No delete/reinsert churn.

### F3 — Add a new size

Add `XL` to hoodie.

Expected:

- Existing variant IDs remain.
- New variant gets a new ID.
- Product page includes `XL`.

### F4 — Disable/remove a size

Disable `S` or mark inactive.

Expected:

- Existing orders remain readable.
- Active storefront no longer offers `S`.
- Old carts with `S` are handled gracefully.

### F5 — Existing color products still editable

Open and save an existing color product.

Expected:

- Variants remain `Color`.
- Swatches still render.
- Existing IDs preserved.

---

## G. Fulfillment / Staff Visibility Tests

### G1 — Admin order detail

Open a hoodie order in admin orders.

Expected:

- Product name visible.
- Size visible.
- Variant SKU visible if configured.
- Quantity visible.
- Variant image visible if configured.

### G2 — Raw line items

Open raw line items table.

Expected:

- Search by product SKU works.
- Search by size/variant works.
- New variant fields do not break pagination.

### G3 — Shipping label creation

Create/buy a Shippo label for an order with sized product.

Expected:

- Label creation still uses order weight/address.
- No variant fields required by Shippo.
- Fulfillment staff can identify size before packing.

### G4 — Ship-ready CSV/export

If using `shipReadyCsv.js`, export orders.

Expected:

- Export still works.
- If item details are included, size/variant is visible or at least not lost.

---

## H. Customer Order / Review Tests

### H1 — Success page

After purchase, view success page.

Expected:

- Ordered item shows selected size.
- Quantity and paid price are correct.

### H2 — My Orders

Look up order in customer order history.

Expected:

- Size/variant appears under product name.

### H3 — Leave review

Verify an order for review.

Expected:

- Product item shows selected size/variant.
- Review submission still attaches to product-level `product_id` unless variant reviews are intentionally implemented.

---

## I. Analytics / Marketing Regression Tests

### I1 — Item stats

After a test order:

Expected:

- Item stats include the size/variant in breakdown.
- Revenue/units are correct.

### I2 — Meta Pixel

Trigger ViewContent, AddToCart, InitiateCheckout.

Expected:

- Existing events still fire.
- Product SKU in `content_ids` remains compatible.
- Optional future: variant ID can be added as custom metadata after core launch.

### I3 — SMS report / abandoned cart analytics

After a saved cart / purchase:

Expected:

- SMS abandoned cart views still aggregate counts.
- No flow depends on product variant fields.

---

## Rollout Phases

### Phase 1 — Hidden schema + compatibility

- Add nullable schema fields.
- Backfill structured data for existing variants.
- Deploy read compatibility.
- No visible storefront behavior change.

Rollback:

- New columns can remain unused.
- Old code still works.

### Phase 2 — Cart and checkout variant ID

- Persist `variant_id` in new cart items.
- Pass `variant_id` through checkout.
- Store `variant_id` in order lines.
- Keep fallbacks.

Rollback:

- Frontend can stop sending `variant_id`; backend falls back to old behavior.

### Phase 3 — Admin size support

- Add option type support.
- Preserve variant IDs.
- Create pilot hoodie with sizes.

Rollback:

- Mark pilot product inactive if needed.
- Existing products unaffected.

### Phase 4 — Pilot sale

- Place internal test order.
- Verify stock decrement/refund/admin visibility.
- Optionally allow one real hoodie product to go live.

Rollback:

- Disable hoodie product.
- Existing non-apparel products unaffected.

### Phase 5 — Broader apparel rollout

- Add remaining apparel size variants.
- Add process notes for fulfillment.
- Consider variant SKU conventions.

---

## Smoke Test Checklist

Run after every deployment in the size rollout:

- [ ] Existing product page loads.
- [ ] Existing color product add-to-cart works.
- [ ] Existing simple/non-sized quick-add works.
- [ ] New size product blocks add-to-cart until size selected.
- [ ] New size product adds selected size to cart.
- [ ] Cart drawer quantity controls work.
- [ ] Checkout page renders selected size.
- [ ] Checkout session creates successfully.
- [ ] Stripe test checkout completes.
- [ ] Webhook creates `orders_raw` and `line_items_raw`.
- [ ] Stock decrements only selected size.
- [ ] Admin order detail shows selected size.
- [ ] Success page shows selected size.
- [ ] Saved cart sync does not error.
- [ ] Abandoned cart cron/invocation does not error.

---

## Non-Sized Product Compatibility Checks

- [ ] Product with one default variant can still be purchased.
- [ ] Product with no explicit size UI does not require size selection.
- [ ] Product price/weight still come from `products` if no variant override.
- [ ] Existing cart line with empty `variant` still works.
- [ ] Existing order displays still show no variant or legacy variant text correctly.

---

## Old Cart Compatibility Checks

- [ ] Old `kk_cart_v1` item without `variant_id` loads.
- [ ] Old cart item can be removed.
- [ ] Old cart quantity can be changed.
- [ ] Old cart can proceed to checkout if product/variant fallback resolves.
- [ ] If fallback cannot resolve, user sees a clear “please re-add this item” message rather than a crash.

---

## Saved Cart and Abandoned Cart Validation Checks

- [ ] New cart data includes variant ID and selected options.
- [ ] Old cart data without variant ID still accepted by `cart-sync`.
- [ ] Changing size changes cart hash.
- [ ] Changing quantity changes cart hash.
- [ ] `sms-abandoned-cart` can process carts with mixed old/new shapes.
- [ ] Checkout still marks active saved cart as purchased by phone.

---

## Fulfillment Verification Checks

- [ ] Order detail clearly shows size.
- [ ] Staff can distinguish two sizes of same product in same order.
- [ ] Variant image is shown when available.
- [ ] Variant SKU appears when configured.
- [ ] Shippo label creation unaffected.
- [ ] Refund stock restoration returns stock to the correct size.

---

## Regression Risks to Watch

1. Cart line merge errors if `variant_id` and legacy `id+variant` logic conflict.
2. Quick-add adding a variant ID as `id` instead of product UUID.
3. Admin delete/reinsert changing variant IDs and breaking active carts.
4. Checkout pricing mismatch if frontend and server disagree on variant price overrides.
5. Stock decrement hitting first variant when no variant ID is present.
6. Saved cart hash not changing when selected size changes.
7. Order displays showing raw JSON instead of friendly size labels.
8. Existing color swatches breaking when option-aware renderer is introduced.
9. Imported eBay/Amazon orders lacking `variant_id` but still needing readable variant text.

---

## Final Go / No-Go Criteria

Go live with sized apparel only when:

- `variant_id` is persisted from product page through order line items.
- Size is visible to customer and staff.
- Stock decrement/refund works by variant ID.
- Existing products and old carts still work.
- Admin can edit size variants without deleting/recreating existing variant IDs.
- Pilot hoodie test order passes purchase, admin review, saved cart, and refund checks.

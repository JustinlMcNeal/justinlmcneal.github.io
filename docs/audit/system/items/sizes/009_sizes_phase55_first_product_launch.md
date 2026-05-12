# Phase 5.5 — First Size-Enabled Product Launch
**Status:** Complete  
**Date:** 2026-05-09  
**Prereq:** Phase 5 complete (pilot validation, verdict = Ready)

---

## Purpose

This phase covers the operational preparation for the first real live size-enabled
product launch. No new architecture is introduced. The system is already validated
and ready. This document gives you everything you need to create, validate, and
publish the first hoodie (or similar apparel item) with confidence.

---

## First product launch assumptions

- **Size-only product first.** The first pilot product has size variants only.
  No size+color combination is in scope.
- **Explicit size selection is required.** Customers must pick a size before
  add-to-cart. There is no default pre-selection or bypass.
- **Products without size are unaffected.** Charms, bags, jewelry, keychains,
  and other non-apparel products continue to work exactly as before. This launch
  does not touch them.
- **Color-only products are unaffected.** Existing color-swatch products
  continue to work exactly as before.
- **The pilot product is published separately.** The rollout is to one product
  first — not a bulk migration of all products.
- **A size chart is your responsibility.** The storefront does not yet have a
  built-in size guide UI. Include sizing info in the product description/details
  section.

---

## Recommended admin setup flow

### Step 1 — Create the product

In admin, open the product editor and fill in:

| Field | Recommendation |
|-------|---------------|
| **Name** | Human-readable, title-case. E.g. `Classic Pullover Hoodie` |
| **Code (SKU)** | Short, uppercase, product-level. E.g. `HOOD-CLASSIC-01` |
| **Category** | Select the appropriate apparel / headwear category |
| **Price** | Set the retail price |
| **Shipping status** | Leave blank (null) for in-stock apparel; set `mto` only if made-to-order |
| **Description/Details** | Include a sizing chart as a bullet list in the Sizing section |

### Step 2 — Add variant rows (one per size)

For each size, click "Add Variant" and configure the row as follows:

| Field | How to fill |
|-------|------------|
| **option_name dropdown** | Select **Size** |
| **Value input** | See naming conventions below |
| **Stock** | Enter actual stock quantity for this size |
| **Preview image** | Optional for Phase 5; upload a product image if you want a per-size image |
| **Variant ID** | Leave blank for new rows — DB generates UUID on save |

**Do not enable `is_default` yet.** The storefront requires explicit selection;
a default would be confusing and is not implemented in the admin UI yet.

**Recommended variant rows for a standard hoodie:**

| Row | option_name | Value (option_value) | Stock |
|-----|-------------|---------------------|-------|
| 1 | Size | S | your qty |
| 2 | Size | M | your qty |
| 3 | Size | L | your qty |
| 4 | Size | XL | your qty |
| 5 | Size | 2XL | your qty (if offered) |

### Step 3 — Set product images

- Upload a **catalog image** (the primary grid/card image).
- Upload a **primary image** (main product page image).
- Optionally add gallery images for additional views.
- Variant preview images (per-size) are optional for Phase 5.

### Step 4 — Mark active

Once all variants and images are added, check the **Active** toggle and save.
The product is now live on the storefront.

---

## Naming and SKU conventions

Keep it simple and consistent from the start.

### Product-level code (SKU)

Format: `{CATEGORY}-{STYLE}-{NUMBER}`

Examples:
- `HOOD-CLASSIC-01`
- `HOOD-CROP-01`  
- `TEE-BASIC-01`

Rules:
- Uppercase
- Hyphen-separated
- Sequential number (01, 02 …) within a style

### option_value (size label)

Use short industry-standard abbreviations:

| Size | option_value |
|------|-------------|
| Extra Small | `XS` |
| Small | `S` |
| Medium | `M` |
| Large | `L` |
| Extra Large | `XL` |
| 2X Large | `2XL` |
| 3X Large | `3XL` |

**Do not use** `Small`, `Medium`, `Large` — the pill buttons on the product page
are compact; short labels look better and are easier to scan.

**Do not mix formats** within a single product (e.g., `S`, `M`, `Large` is bad;
use `S`, `M`, `L`).

### variant_title

Leave blank unless you need a longer display name. The storefront uses
`variantDisplayName()` from `variantUtils.js`, which falls back to `option_value`
when `title` is null. `option_value = "M"` is perfectly readable in the cart,
order confirmation, and my-orders view.

Only set `title` if you need something like `"Men's Medium"` to distinguish from
a women's sizing variant in a future multi-dimension product. That is not needed
for Phase 5 pilots.

### Variant SKU (optional)

Leave blank for the first pilot. Variant SKUs are only useful if you need
per-size barcode scanning, warehouse pick lists, or marketplace sync. The
`variant_sku` field is nullable and the system works fully without it.

If you want to set them later, a simple format is:
`{PRODUCT-CODE}-{SIZE}` → e.g. `HOOD-CLASSIC-01-M`

---

## Pre-launch validation checklist

Work through this in order before publishing the product.

### Admin validation

- [ ] Product is saved and visible in admin product list
- [ ] All variants have option_name = "Size"
- [ ] All variants have the correct option_value (S / M / L / XL etc.)
- [ ] All variants have accurate stock quantities entered
- [ ] Product has a catalog image and at least one product page image
- [ ] Product is marked inactive while you finish setup

### Storefront validation (browse as customer before making active)

- [ ] Navigate to `/pages/product.html?slug={your-slug}`
- [ ] Variant section label reads **"Select Size"** (not "Select Color")
- [ ] Sizes render as **pill buttons** (not color swatches)
- [ ] No size is pre-selected on page load
- [ ] Click "Add to Cart" without selecting a size → see **"Please select a size."** error
- [ ] Select a size → error clears (or button becomes active)
- [ ] Select a size → Add to Cart → cart drawer opens showing the product with the correct size label
- [ ] Product does NOT appear to have gray color swatches on the home page grid
- [ ] Product card shows **"Sizes available"** text or **"Choose Options"** button

### End-to-end test order

Before going live, place one real test order through Stripe test mode (or a $0
coupon on the live environment):

- [ ] Select size "M" (or similar), add to cart, proceed to checkout
- [ ] Complete checkout
- [ ] In Supabase: check `line_items_raw` for the order
  - [ ] `variant` column shows "M" (or chosen size)
  - [ ] `variant_title` column shows "M" (may be null for first order — fine)
  - [ ] `variant_id` column is populated (UUID, not null)
  - [ ] `selected_options` column contains `{"Size": "M"}` or similar
- [ ] In Stripe Dashboard: open the checkout session product metadata
  - [ ] `kk_variant` = "M"
  - [ ] `kk_variant_id` = UUID
  - [ ] `kk_selected_options` = `{"Size":"M"}`
- [ ] Success page at `/pages/success.html?order={id}` shows size "M" in the order summary
- [ ] My-orders lookup at `/pages/my-orders.html` shows size "M" in the order detail

---

## Day-of-launch checklist

- [ ] Mark product active in admin
- [ ] Confirm product appears in catalog
- [ ] Confirm product appears on home page if featured
- [ ] Do a final quick storefront smoke-test (size pills visible, no swatches)
- [ ] Announce product if applicable

---

## Post-launch monitoring checklist (first 24–48 hours)

- [ ] Check Supabase `line_items_raw` for new orders: confirm `variant_id` is populated
- [ ] Check Supabase `product_variants` stock column: confirm stock is being decremented correctly per size
- [ ] Check `orders_raw` for new order entries
- [ ] If a customer reports "wrong size" in order, pull the `line_items_raw` row and confirm `selected_options` matches what they chose
- [ ] No error spikes in Supabase function logs (`stripe-webhook`, `create-checkout-session`)

---

## Rollback / disable checklist

If something goes wrong after launch and you need to pull the product quickly:

1. **In admin** → find the product → uncheck **Active** → save. The product disappears from catalog and product page immediately.
2. **Variants are preserved.** Turning off the product does not destroy variant rows. You can re-enable it.
3. **Active carts are not affected.** Customers who already added to cart before you deactivated will still see the item in cart and can proceed. Cart lines are local to the browser.
4. **Pending checkouts are safe.** `create-checkout-session` validates product existence but reads price from the Stripe product creation step — existing open sessions won't break.
5. **Do NOT delete the product** unless absolutely certain. Deletion is hard-delete and will permanently remove variant UUIDs that may be referenced in active carts or orders.
6. If a specific size needs to be removed but the product stays live: in admin, edit the product, delete the size row. `upsertVariants` will soft-disable it (`is_active = false`) rather than deleting it, preserving its UUID.

---

## Code changes in this phase

**None.** The system is fully ready. This phase is documentation and launch ops only.

---

## What remains deferred

| Item | Status |
|------|--------|
| Size+color combination products | Phase 6 |
| Catalog card size chips (S M L XL) | Merchandising enhancement |
| Product page size guide / chart UI | Content feature |
| Admin variant title input | Not needed for Phase 5 pilots |
| Admin `is_default` toggle | Not needed for size products (no auto-select) |
| Bulk variant SKU management | Phase 6+ |
| Marketplace (eBay etc.) size variant sync | Phase 6+ |

---

## Launch verdict

**Ready for first live size-enabled product launch.**

All system components (product page, cart, checkout, Stripe, webhook, order
storage, order display) have been implemented and validated across Phases 1–5.
This document provides the complete operational setup path. Follow the pre-launch
checklist, run one test order, then mark the product active.

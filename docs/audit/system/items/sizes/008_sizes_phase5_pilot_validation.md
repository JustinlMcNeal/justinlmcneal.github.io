# Phase 5 — Pilot Validation & Rollout Hardening
**Status:** Complete  
**Date:** 2026-05-09  
**Prereq:** Phase 4 complete (storefront size-selection UX)

---

## What Phase 5 is responsible for

Phase 5 validates the current size-only variant system end-to-end for a safe
pilot launch of the first size-enabled products (hoodies, apparel). This is a
**testing, hardening, and readiness pass** — not a new-architecture pass.

Goals:
1. Find and fix pilot-blocking issues in the current size-only flow.
2. Harden catalog card and quick-add behavior so size products are never
   accidentally added without explicit selection.
3. Fix visual bugs that arise from size variants being passed through code paths
   designed for color variants.
4. Improve order display to surface size selection in post-purchase views.
5. Confirm color and simple products are unaffected.
6. Produce a clear pilot-readiness verdict.

---

## Pilot scope

**In scope:**
- Size-only products (e.g., hoodies, apparel) with `option_name = "Size"` variants
- Customers browsing home page grid and catalog
- Product page size selection and add-to-cart
- Cart drawer, checkout, Stripe, webhook, order line items
- Success page and my-orders order display
- Admin create/edit of size variants

**Out of scope:**
- Size+color combination products
- Products without size (charms, bags, jewelry, etc.)
- Major catalog redesign

---

## End-to-End flow validation

### Product page — Phase 4 ✓
- `detectVariantMode` correctly identifies size products.
- Variants render as pill buttons, not color swatches.
- No auto-selection occurs.
- Add-to-cart is blocked with "Please select a size." if no size picked.
- Selected variant flows into `buildCartPayload` with `variant_id`, `variant_sku`,
  `variant_title`, `selected_options`.

### Cart store — Phase 2 ✓
- `variant_id` stored as durable cart line key.
- `variant_title` and `selected_options` persisted in `kk_cart_v1`.
- Existing color+simple cart behavior unaffected.

### Checkout payload — Phase 2 + Phase 4 ✓
- Checkout includes `variant_id`, `variant_sku`, `variant_title`, `selected_options`
  per line item.
- `create-checkout-session` resolves variant row server-side for authoritative data.

### Stripe metadata — Phase 2 ✓
- `kk_variant`, `kk_variant_id`, `kk_variant_title`, `kk_selected_options` set.

### Webhook + line_items_raw — Phase 2 ✓
- `line_items_raw.variant_id`, `line_items_raw.variant_title`,
  `line_items_raw.selected_options` stored.
- `line_items_raw.variant` carries legacy text (e.g., "M") for backward compat.

### Stock decrement — Phase 2 ✓
- Webhook prefers `variant_id` UUID for direct stock decrement.

### Admin management — Phase 3 ✓
- Size variants can be created via the `option_name = "Size"` dropdown.
- Variant UUIDs are preserved on edit via `upsertVariants`.
- Removed variants are soft-disabled, not deleted.

---

## Issues found and fixed in this phase

### Issue 1 — BLOCKING: Size variants rendered as gray color swatches on home cards

**File:** `js/shared/components/productCardHome.js`

**Root cause:** `pickVariants()` returned all variants when no color variants were
found. For a size-only product, this caused "S", "M", "L", "XL" to be passed to
`parseColorValue()`, which returned `#cccccc` (gray) for each, rendering four
identical gray squares in the product card. Visually broken and confusing.

**Fix:** Added `hasSizeOnlyVariants()` helper. `pickColorVariants()` now returns
`[]` for size-only products, suppressing color swatches. A "Sizes available" text
label is shown in the variants row instead. The quick-add button for size products
always sets `data-has-variants="true"` and shows "Choose Options" regardless of
variant count, ensuring even single-size products redirect to the product page.

---

### Issue 2 — MINOR: Catalog card shows "Select a color to add to cart" for size products

**File:** `js/catalog/renderCard.js`

**Root cause:** Fallback text when no color variants exist is "Select a color to
add to cart." A size-only hoodie has no color variants, so this text appears.
Misleading for size products.

**Fix:** Changed fallback to "See options to add to cart" — generic, works for
any option type.

---

### Issue 3 — MINOR: `swipeToAdd.js` single-variant size products could be blindly added

**File:** `js/shared/swipeToAdd.js`

**Root cause:** Swipe-to-add is disabled for products with `data-has-variants=
"true"` (more than 1 variant). But a size product with exactly 1 size variant
would have `hasVariants = false`, enabling swipe, and `addToCartQuick` would
silently add that size without explicit customer selection. Very rare edge case
(pilots typically have S/M/L/XL = 4 variants), but technically unsafe.

**Fix:** `addToCartQuick` now inspects the variant's `option_name`. If it is
size-typed, the function redirects to the product page instead of adding directly.
This aligns with Phase 4's "explicit selection required" invariant.

---

### Issue 4 — MINOR: Order display shows legacy `variant` field only

**Files:** `js/success/index.js`, `js/my-orders/index.js`,
`supabase/functions/lookup-orders/index.ts`

**Root cause:** All three queried only `line_items_raw.variant` (the legacy
`kk_variant` text). After Phase 2, `variant_title` is also stored and may be
more descriptive (e.g., "Medium" vs "M" if admin set a title). Customers saw
the correct value ("M") but not the richer `variant_title` when available.

**Fix:** Added `variant_title` to all three queries. Display logic prefers
`variant_title` over `variant` when available. Fully backward-compatible — old
orders without `variant_title` fall back to `variant` with no change in behavior.

---

## Pilot readiness criteria

The following conditions are required before the first size-enabled product
launches to customers:

| Criterion | Status |
|-----------|--------|
| Size products render pill-button selection on product page | ✓ Phase 4 |
| Add-to-cart blocked until size selected | ✓ Phase 4 |
| Selected size flows into cart with variant_id | ✓ Phase 2 |
| Checkout payload carries variant_id + variant_title | ✓ Phase 2 + 4 |
| Stripe metadata carries kk_variant_id | ✓ Phase 2 |
| Webhook stores variant_id + variant_title in line_items_raw | ✓ Phase 2 |
| Stock decrement uses variant_id UUID | ✓ Phase 2 |
| Admin can create size variants without destroying existing IDs | ✓ Phase 3 |
| Home card does NOT show size variants as gray color swatches | ✓ Phase 5 |
| Catalog card does NOT say "Select a color" for size products | ✓ Phase 5 |
| Single-size products do NOT bypass size selection via swipe | ✓ Phase 5 |
| Success page shows chosen size in order confirmation | ✓ Phase 5 |
| My-orders shows chosen size in order history | ✓ Phase 5 |
| Color-only products unaffected | ✓ confirmed |
| Simple/default products unaffected | ✓ confirmed |

---

## Pilot verdict

**Ready.**

All pilot-blocking issues have been fixed. The size-only purchase flow works
end-to-end. The first hoodie/apparel pilot product can be created and published.

**Recommended launch checklist:**
1. Create the hoodie product in admin.
2. Add size variants (S / M / L / XL) using the `Size` option_name dropdown.
3. Set stock per size.
4. Mark product active.
5. Test a full checkout on staging: select size → add to cart → checkout → confirm
   `line_items_raw.variant_title` shows correct size.
6. Confirm success page displays size.
7. Publish.

---

## Deferred to later phases

| Item | Reason deferred |
|------|-----------------|
| Size+color combination selection | Phase 6 — requires matrix variant model |
| Catalog card size indicator (e.g., "S M L XL" chips) | Merchandising enhancement |
| Size guide display on product page | Content feature, not needed for pilot |
| Bulk size inventory management in admin | Phase 6+ scope |
| Full size+color admin variant authoring | Phase 6+ scope |

---

## Files changed in this phase

| File | Change |
|------|--------|
| `docs/audit/system/items/sizes/008_sizes_phase5_pilot_validation.md` | This document |
| `js/shared/components/productCardHome.js` | Suppress size swatches; show "Sizes available"; force "Choose Options" for size products |
| `js/catalog/renderCard.js` | Change "Select a color to add to cart" → "See options to add to cart" |
| `js/shared/swipeToAdd.js` | Redirect size-typed single-variant products instead of blind add |
| `js/success/index.js` | Add `variant_title` to select; prefer for display |
| `js/my-orders/index.js` | Prefer `variant_title` over `variant` for display |
| `supabase/functions/lookup-orders/index.ts` | Add `variant_title` to line_items_raw select and response mapping |

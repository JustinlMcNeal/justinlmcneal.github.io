# Phase 4 — Storefront Size Selection UX
**Status:** Complete  
**Date:** 2026-05-09  
**Prereq:** Phase 3 complete (admin variant stability, upsertVariants, option_name authoring)

---

## What Phase 4 is responsible for

Phase 4 implements the customer-facing product-page buying UX for size-based
products. This is purely a **storefront rendering and selection pass** — no
schema changes, no webhook changes, no admin redesign.

Specifically:

1. Detect whether a product's variants are size-based, color-based, or absent.
2. Render size variants as pill-style buttons (not color swatches).
3. Require explicit customer selection before add-to-cart on size products.
4. Preserve all existing color product behavior identically.
5. Preserve all existing simple/default-variant (no variants) product behavior.
6. Ensure the cart payload includes `variant_title` and `selected_options` for
   complete Phase 2 identity pipeline alignment.

---

## Product type behavior summary

### Size products (`option_name === "Size"`)

- Variant section label updates to "Select Size".
- Variants render as pill-style text buttons (not color swatches).
- **No auto-selection.** Customer must explicitly tap a size.
- Add-to-cart is blocked with an inline validation message ("Please select a size.")
  if no size has been chosen.
- Once a size is selected, the selected variant flows through the existing Phase 2
  identity path (`variant_id`, `variant_sku`, `variant_title`, `selected_options`).
- Out-of-stock size variants are still rendered but visually dimmed (opacity 0.6)
  with backorder tooltip, matching the color variant behavior.

### Color products (`option_name === "Color"` / `"Colour"` / legacy empty)

- Render exactly as before using `renderVariantSwatches` (color swatches).
- First variant is auto-selected on page load (existing behavior preserved).
- No blocking validation — selection always exists via auto-select.
- Variant section label stays "Select Color".

### Simple / default-variant products (no variants)

- Variant section and divider are hidden (existing behavior preserved).
- Add-to-cart works immediately with no variant selection required.
- `selectedVariant` is null; cart payload has no variant fields.

---

## How explicit size selection is enforced

`variantMode` is set to `"size"` in the `initProductPage` closure when the
product's active variants are all size-typed. The add-to-cart `onclick` handler
checks:

```js
if (variantMode === "size" && !selectedVariant) {
  setActionMsg(els, "Please select a size.", true);
  return;
}
```

This is a simple, hard guard — no workarounds. The `selectedVariant` variable is
only set via the `onSelect` callback fired by `renderSizeButtons` when a customer
taps a size button.

---

## How option type is detected

`detectVariantMode(activeVariants)` in `index.js`:

1. If no active variants → `"simple"`.
2. If all active variants have `option_name === "size"` (case-insensitive) → `"size"`.
3. Otherwise (Color, empty, mixed, legacy) → `"color"`.

"Active" means `is_active !== false` — filters out Phase 3 soft-disabled rows.

---

## Files changed in this phase

| File | Change |
|------|--------|
| `docs/audit/system/items/sizes/007_sizes_phase4_storefront_selection.md` | This document |
| `pages/product.html` | Add `id="variantLabel"` to the "Select Color" label div so JS can update it |
| `js/product/render.js` | Add `renderSizeButtons(container, variants, onSelect)` export |
| `js/product/index.js` | Import `isOptionTypeSize`; add `detectVariantMode`; branch variant rendering by mode; enforce size validation on add-to-cart; update variantLabel text |
| `js/product/cart.js` | Add `variant_title` and `selected_options` to `buildCartPayload` return for complete Phase 2 payload alignment |

---

## Phase 4 invariants

- **Products without size must not be forced into a size flow.** The mode
  detection defaults to `"color"` for any non-size `option_name` including
  legacy rows where `option_name` is null/empty.

- **Size-based products must require explicit customer selection before
  add-to-cart.** There is no auto-select for size mode. The add button is
  blocked with a clear message until a size is chosen.

- **Color-only products remain fully compatible.** `renderVariantSwatches` is
  unchanged. Auto-select-first behavior is preserved. No blocking validation
  is added for color products.

- **Simple/default-variant products remain fully compatible.** Products with no
  variants show no variant section and add-to-cart works immediately.

- **This pass is for size-only product UX first, not size+color combinations.**
  Mixed-mode products (where variants include both Size and Color option_names)
  fall through to color rendering for now. The `detectVariantMode` function
  documents this decision with a comment.

- **Cart payload fields are additive only.** `variant_title` and
  `selected_options` are added to `buildCartPayload`; no existing fields are
  removed or renamed.

---

## Deferred to later phases

| Item | Reason deferred |
|------|-----------------|
| Size+Color combination selectors | Requires matrix variant model; out of scope for Phase 4 |
| Catalog card quick-add size selection | Full catalog UX redesign; out of scope |
| Admin size guide / size chart display | Merchandising enhancement; out of scope |
| Size selection persistence across page loads | Convenience feature; safe to defer |
| Full matrix UI (size × color grid) | Phase 5+ scope |
| Bulk size inventory management UI | Admin enhancement; Phase 5+ scope |

---

## Notes on the "Select Color" label

The product page HTML previously had a static "Select Color" string. Phase 4
adds `id="variantLabel"` to that element and updates it from JS based on
`variantMode`. This is backward-safe: existing products with color variants
continue to display "Select Color". Size products display "Select Size".
Products with no variants never show the section at all.

# Phase 3 — Admin Variant Stability
**Status:** In Progress  
**Date:** 2026-05-09  
**Prereq:** Phase 1 (schema foundation), Phase 2 (variant identity path)

---

## What Phase 3 is responsible for

Phase 3 fixes the admin product-editing side so that `variant_id` values remain
stable over the lifetime of a product. Now that `variant_id` flows through carts,
checkout sessions, Stripe metadata, and order line items (Phase 2), the old
destructive delete/reinsert save pattern in admin is unsafe.

This phase also unblocks size-variant creation by removing the hardcoded
`option_name: "Color"` assumption from the admin variant editor.

---

## Why destructive delete/reinsert is dangerous now

Before Phase 2, variant UUIDs were discarded after every save and re-created on
the next page load. Nobody depended on them persisting.

After Phase 2:
- Active carts store `variant_id` in `kk_cart_v1` localStorage.
- Checkout payloads forward `variant_id` to `create-checkout-session`.
- `line_items_raw.variant_id` links order history to the exact variant row.
- Stock decrement and refund restore prefer direct UUID lookup.

If admin deletes and reinserts variant rows, every active cart that was built
before the save becomes dangling — the `variant_id` it holds no longer exists
in the database. The next checkout would fall back to text-match, which is
fragile. The stock ledger link is permanently broken.

---

## Files changed in this phase

| File | Change |
|------|--------|
| `js/admin/products/api.js` | Replace `replaceVariants` with `upsertVariants` — update-in-place for existing rows, insert for new, soft-disable for removed |
| `js/admin/products/modalRows.js` | `addVariantRow` now stores `id` in hidden input and adds `option_name` dropdown (Color/Size/Other); `collectVariants` returns `id` and `option_name` |
| `js/admin/products/modalEditor.js` | Import and call `upsertVariants` instead of `replaceVariants` |

---

## How existing variant IDs are preserved

`upsertVariants(productId, variants)` works as follows:

1. Fetches current variant rows for the product (IDs only).
2. For each incoming variant row that carries a known `id`:
   - Issues an `UPDATE` on `product_variants WHERE id = :id`.
   - The UUID never changes.
3. For each incoming variant row with no `id` (newly added in admin):
   - Issues an `INSERT`. DB generates a fresh UUID.
4. For each existing ID **not** present in the incoming list (row was removed):
   - Issues `UPDATE SET is_active = false`. Row is soft-disabled, not deleted.

The duplicate-value check runs before any DB write.

---

## How new size variants can be created

The `addVariantRow` function now renders an `option_name` select dropdown with
three choices: `Color`, `Size`, `Other`. When a new variant row is added via
the "Add Variant" button, the admin can pick `Size` and enter a value like "M".
That variant saves with `option_name: "Size"` instead of the previously
hardcoded `"Color"`.

Existing variant rows loaded from the DB render their `option_name` as the
selected value in the dropdown (defaulting to `Color` for rows that pre-date
the migration).

---

## Phase 3 invariants

- **Existing `product_variants.id` values must be preserved on edit whenever
  the variant still exists.** An edit that keeps a variant logically present
  must not replace its UUID.
- **New variants get new IDs.** Admin-added rows without a stored `id` are
  inserted and receive a DB-generated UUID.
- **Removed variants are soft-disabled.** Setting `is_active = false` instead
  of `DELETE` keeps order history, stock ledger references, and any in-flight
  cart items valid.
- **Current color products must remain editable.** Existing rows with
  `option_name = "Color"` load and save correctly. The dropdown defaults to
  `Color`.
- **Products without size remain unaffected.** There is no forced size field;
  the dropdown simply offers `Size` as an option when needed.
- **This pass does not implement the full storefront size selector.** That is
  Phase 4.

---

## Intentionally deferred to later phases

- **Storefront size selector UI** (Phase 4)
- **Required size selection enforcement** (Phase 4)
- **Size + color combination variants** (Phase 5)
- **Variant matrix generator in admin** (Phase 5)
- **`price_override_cents` / `weight_g_override` editing in admin** (deferred)
- **`is_default` toggle in admin** (low priority; can be done any time)
- **Hard-delete path for clearly orphaned variants** — deferred; soft-disable
  is conservative and safe for now
- **Full admin variant UX redesign** — this pass is surgical

---

## Notes on risky areas

### hardDeleteProduct
`hardDeleteProduct` still uses `DELETE` on `product_variants`. This is
acceptable for a full product deletion — once the product is gone, its variants
are unreachable regardless. No change needed.

### Duplicate detection
The duplicate check now keys on `option_name + option_value` (e.g.,
`size::M` is distinct from `color::M`). This allows a product to have
`Color=Black` alongside `Size=M` if needed in future, without false positives.

### Legacy `replaceVariants` export
The old `replaceVariants` function is removed from exports. It is not called
anywhere except `modalEditor.js`, which is updated in this phase. Any external
caller (none found) would need to migrate to `upsertVariants`.

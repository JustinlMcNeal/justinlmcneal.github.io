# Removed Variant Reappears After Reopen — Bug Report
**Date:** 2026-05-10  
**Status:** Fixed

---

## Symptom

1. Open admin edit modal for a product that has a Color variant.
2. Click ✕ to remove the Color variant row.
3. Save — no error shown.
4. Reopen the modal — the Color variant is back.

---

## Root cause (two-sided loop)

### Side 1 — Fetch returns inactive variants

`fetchProductFull` in `js/admin/products/api.js` fetched ALL variants for the product:

```js
// BUG — no is_active filter
const { data: variants, error: vErr } = await sb()
    .from("product_variants")
    .select("*")
    .eq("product_id", productId)   // ← no .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("option_value", { ascending: true });
```

So a variant soft-disabled with `is_active = false` was fetched again on next open.

### Side 2 — Reactivation on next save

The inactive variant appeared in the admin modal (via the fetch bug above). Its ID was
stored in the hidden `data-v="variant-id"` input. `collectVariants` collected it (it has an
`option_value`). `upsertVariants` then ran:

```js
const incomingIds = new Set(variants.filter((v) => v.id && existingIds.has(v.id)).map((v) => v.id));
const toDisable = [...existingIds].filter((id) => !incomingIds.has(id));
```

The inactive variant's ID appeared in `incomingIds` (since it was in the payload), so it was
**NOT** in `toDisable`. Instead it was passed to the UPDATE branch:

```js
is_active: v.is_active !== false, // v has no is_active field → defaults true
```

This silently set `is_active = true` again, reversing the soft-disable.

The result was a circular loop:
```
remove row → save → soft-disable ✅
  → reopen → inactive variant loaded → shown in modal → collected by collectVariants
  → save again → variant re-activated ❌
```

---

## Files / functions involved

| File | Function | Role |
|---|---|---|
| `js/admin/products/api.js` | `fetchProductFull` | Fetched all variants including `is_active = false` |
| `js/admin/products/modalEditor.js` | `openEdit` | Passed all fetched variants to `addVariantRow` without filtering |
| `js/admin/products/modalRows.js` | `collectVariants` | Collects all DOM rows; has no awareness of `is_active` |
| `js/admin/products/api.js` | `upsertVariants` | Reactivated variants that re-appeared in the payload |

---

## Fix applied

### Fix 1 — `js/admin/products/api.js` — `fetchProductFull`

Add `.eq("is_active", true)` to the variant fetch so inactive variants are never
returned to the admin edit modal:

```js
const { data: variants, error: vErr } = await sb()
    .from("product_variants")
    .select("*")
    .eq("product_id", productId)
    .eq("is_active", true)      // only show active variants in admin edit modal
    .order("sort_order", { ascending: true })
    .order("option_value", { ascending: true });
```

### Fix 2 — `js/admin/products/modalEditor.js` — `openEdit`

Belt-and-suspenders: filter to active-only before rendering rows, even if the fetch
result ever includes inactive variants:

```js
(full.variants || []).filter((v) => v.is_active !== false).forEach((v) => addVariantRow(els.variantList, v));
```

No changes to `collectVariants`, `upsertVariants`, or the existing soft-disable logic.

---

## How to verify the fix

1. Open admin → edit the problem product.
2. Click ✕ on a variant row to remove it.
3. Save — should complete with no error.
4. Reopen the modal.
5. **Expected**: the removed variant does not appear.
6. In the Supabase SQL editor, confirm:
   ```sql
   select id, option_name, option_value, is_active
   from public.product_variants
   where product_id = '<your-product-id>'
   order by sort_order;
   ```
   The removed variant should be present with `is_active = false`.

---

## Constraints preserved

- Existing variant UUIDs are stable (no delete/reinsert).
- Soft-disable behavior is unchanged in `upsertVariants`.
- Color-only and size-only products continue working.
- No new features or architecture changes.

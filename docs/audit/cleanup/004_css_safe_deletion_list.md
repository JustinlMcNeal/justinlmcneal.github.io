# CSS Safe Deletion List

Audit date: 2026-05-17

Second-pass review of `003_css_usage_audit.md`.

## Very-Low-Risk CSS Delete Candidates

None.

No CSS file is recommended for deletion without browser verification.

## Files Downgraded From Safe To Keep

No files were downgraded from `Safe`, because the CSS usage audit did not mark any file safe-delete.

The following unlinked CSS files remain `Medium` risk and should be kept until visual/browser verification:

- `css/pages/admin/customers.css`
- `css/pages/admin/home.css`
- `css/pages/admin/lineItemsRaw.css`
- `css/pages/admin/pCalc.css`
- `css/pages/admin/pStorage.css`
- `css/pages/admin/products.css`
- `css/pages/admin/promotions.css`
- `css/pages/catalog.css`
- `css/pages/product.css`
- `css/theme/admin-ui.css`
- `css/pages/admin/admin.css`
- `css/pages/admin/lineItemsOrders.css`

## Browser Pages To Check Before Deletion

- `pages/admin/customers.html`
- `pages/admin/index.html`
- `pages/admin/lineItemsRaw.html`
- `pages/admin/pCalc.html`
- `pages/admin/pStorage.html`
- `pages/admin/products.html`
- `pages/admin/promotions.html`
- `pages/catalog.html`
- `pages/product.html`
- `pages/admin/lineItemsOrders.html`
## Broken References

None remaining after the focused `pages/admin/reset.html` fix.

Resolved:

- Removed missing `/css/components/navbar.css`.
- Replaced missing `/css/pages/admin.css` with dedicated `/css/pages/admin/reset.css`.

`css/pages/admin/reset.css` is now actively linked by `pages/admin/reset.html` and should be kept.
`css/pages/admin/admin.css` is no longer actively linked, but remains medium-risk until admin pages are browser-tested.

## Recommendation

Browser-test first. Do not delete CSS in the current cleanup pass.

Recommended deletion policy for a future pass:

1. For each medium-risk CSS file, temporarily disable only that one file in a local browser test or compare screenshots if it is not linked.
2. Delete one verified-unused CSS file per focused commit.
3. Keep shared theme, checkout, product, catalog, order, SMS, reviews, and active admin CSS unless there is visual proof it is unused.

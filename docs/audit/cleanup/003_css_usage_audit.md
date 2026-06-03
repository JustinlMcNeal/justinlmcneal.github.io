# CSS Usage Audit

Audit date: 2026-05-17

## Scope

Audit-only review of tracked CSS usage across:

- `css/**/*.css`
- active HTML pages under `pages/`, `pages/admin/`, root `index.html`, and tracked HTML inserts
- JS/CSS/docs references to CSS paths, filenames, `@import`, and `url(...)`

No CSS files were deleted. The only styling-related HTML change in the follow-up passes was scoped to `pages/admin/reset.html`.

Update: `pages/admin/reset.html` was fixed in focused follow-up passes to remove the missing `/css/components/navbar.css` link and replace the missing `/css/pages/admin.css` link with a dedicated existing-page stylesheet at `/css/pages/admin/reset.css`.

## Commands / Searches Used

- `Glob`: `css/**/*.css`
- `Glob`: `pages/**/*.html`
- `Glob`: `*.html`
- `rg`: stylesheet `<link>` references in HTML
- `rg`: `.css`, `@import`, and `url(...)` references in JS/CSS/HTML/MD
- Custom Node inventory script:
  - enumerated tracked CSS files
  - mapped active HTML `<link rel="stylesheet">` targets
  - checked whether referenced local CSS targets exist
  - checked CSS `@import` targets
  - checked CSS `url(...)` references
  - collected broad references by exact path, root-relative path, filename, and path variants
- Validation:
  - `git status --short`
  - `git diff --check`

Follow-up validation after `pages/admin/reset.html` fix:

- reran the custom Node inventory script
- confirmed `missingHtml: []`
- confirmed no CSS `@import` targets
- confirmed no CSS `url(...)` references

## Active CSS Files

### `css/theme/base.css`

- Size: 2,815 bytes
- Purpose: global base theme styles.
- HTML usage: linked by root `index.html` and nearly every active public/admin page.
- JS usage: listed in `sw.js` cache manifest.
- CSS imports: none.
- Docs references: incidental.
- Risk level: High
- Recommendation: Keep.

### `css/theme/components.css`

- Size: 3,561 bytes
- Purpose: shared component utilities/animations.
- HTML usage: linked by root `index.html` and nearly every active public/admin page.
- JS usage: listed in `sw.js` cache manifest.
- CSS imports: none.
- Docs references: `docs/todo.md` notes component animations and mobile catalog fixes.
- Risk level: High
- Recommendation: Keep.

### `css/pages/checkout.css`

- Size: 3,104 bytes
- Purpose: checkout-specific layout/styles.
- HTML usage: linked by `pages/checkout.html`.
- JS usage: none found.
- CSS imports: none.
- Docs references: `docs/todo.md`.
- Risk level: High
- Recommendation: Keep.

### `css/pages/public/smsSignup.css`

- Size: 1,271 bytes
- Purpose: SMS signup page shell/ticket styles.
- HTML usage: linked by `pages/sms-signup.html`.
- JS usage: none found.
- CSS imports: none.
- Risk level: High
- Recommendation: Keep.

### `css/pages/public/coupon.css`

- Size: 846 bytes
- Purpose: coupon landing page styles.
- HTML usage: linked by `pages/coupon.html`.
- JS usage: none found.
- CSS imports: none.
- Risk level: High
- Recommendation: Keep.

### `css/pages/admin/smsAnalytics.css`

- Size: 4,707 bytes
- Purpose: SMS analytics admin page styles.
- HTML usage: linked by `pages/admin/sms-analytics.html`.
- JS usage: none found.
- CSS imports: none.
- Risk level: High
- Recommendation: Keep.

### `css/pages/admin/social.css`

- Size: 19,230 bytes
- Purpose: social admin UI styles.
- HTML usage: linked by `pages/admin/social.html`.
- JS usage: none found.
- CSS imports: none.
- Docs references: `docs/pSocial/pSocial_001.md`.
- Risk level: High
- Recommendation: Keep.

### `css/pages/admin/ebay-listings.css`

- Size: 8,408 bytes
- Purpose: eBay listings admin page-specific styles.
- HTML usage: linked by `pages/admin/ebay-listings.html`.
- JS usage: none found.
- CSS imports: none.
- Docs references: eBay listings audit docs.
- Risk level: High
- Recommendation: Keep.

### `css/pages/admin/reset.css`

- Size: small reset-page stylesheet.
- Purpose: reset password admin page styles scoped to `pages/admin/reset.html`.
- HTML usage: linked by `pages/admin/reset.html`.
- JS usage: none found.
- CSS imports: none.
- Risk level: High
- Recommendation: Keep.

## Questionable CSS Files

These files are tracked but not linked by active HTML and not imported by JS/CSS.

### `css/pages/admin/customers.css`

- Size: 917 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Browser-test `pages/admin/customers.html` before considering deletion.

### `css/pages/admin/admin.css`

- Size: 4,994 bytes
- HTML usage: none found after `pages/admin/reset.html` moved to `/css/pages/admin/reset.css`.
- JS/CSS imports: none found.
- Other references: `css/pages/admin/pStorage.css` comment mentions inheriting admin CSS; audit docs mention historical broken-link fix.
- Risk level: Medium
- Recommendation: Keep for now. It may be retired shared admin CSS, but admin styling deletion needs browser verification.

### `css/pages/admin/home.css`

- Size: 689 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Browser-test `pages/admin/index.html` and related admin home pages before considering deletion.

### `css/pages/admin/lineItemsOrders.css`

- Size: 6,231 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references:
  - `docs/audit/pages/lineItemsOrder/ebayShippoCleanup/001_line_items_ebay_shippo_cleanup_audit.md`
  - `docs/audit/pages/lineItemsOrder/ebayShippoCleanup/005_line_items_cleanup_final_audit.md`
- Risk level: Medium
- Recommendation: Keep for now because order/admin pages are high-impact and docs still discuss this file.

### `css/pages/admin/lineItemsRaw.css`

- Size: 7,335 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Browser-test `pages/admin/lineItemsRaw.html` before considering deletion.

### `css/pages/admin/pCalc.css`

- Size: 3,887 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Browser-test `pages/admin/pCalc.html` before considering deletion.

### `css/pages/admin/pStorage.css`

- Size: 5,192 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Internal comment mentions modal styles inheriting admin CSS.
- Risk level: Medium
- Recommendation: Browser-test `pages/admin/pStorage.html` before considering deletion.

### `css/pages/admin/products.css`

- Size: 6,332 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Browser-test `pages/admin/products.html` before considering deletion.

### `css/pages/admin/promotions.css`

- Size: 8,545 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Browser-test `pages/admin/promotions.html` before considering deletion.

### `css/pages/catalog.css`

- Size: 3,668 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Browser-test `pages/catalog.html`, including mobile search/filter states, before considering deletion.

### `css/pages/product.css`

- Size: 6,544 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Browser-test `pages/product.html`, gallery, product details, cart controls, and responsive states before considering deletion.

### `css/theme/admin-ui.css`

- Size: 2,029 bytes
- HTML usage: none found.
- JS/CSS imports: none found.
- Docs references: none found.
- Risk level: Medium
- Recommendation: Keep until admin UI pages are visually tested; could be a retired shared admin style file.

## Duplicate / Overlapping CSS Files

No byte-identical duplicate CSS files were identified in this pass.

Potential overlap:

- `css/theme/base.css` and `css/theme/components.css` are intentionally shared and active.
- Several admin page CSS files may overlap with Tailwind-heavy admin pages and the shared theme, but that requires visual/browser verification.

## Docs-Only CSS References

Docs mention several CSS files as implementation history or plans:

- `css/pages/admin/ebay-listings.css`
- `css/pages/admin/lineItemsOrders.css`
- `css/pages/checkout.css`
- `css/theme/components.css`
- `css/pages/admin/social.css`

Docs-only references were not treated as proof of live usage, but they did raise risk for deletion when tied to active admin/product/order flows.

## Broken / Missing CSS References

None after the focused `pages/admin/reset.html` fix.

Resolved:

- Removed missing `/css/components/navbar.css` from `pages/admin/reset.html`.
- Replaced missing `/css/pages/admin.css` with dedicated `/css/pages/admin/reset.css`.

## Safe-Delete Candidates

No CSS file is marked `Safe` for immediate deletion in this audit.

Reason:

- The most likely unused files are tied to active public/admin pages, product/catalog/order flows, or admin styling.
- CSS deletion is visual/user-facing and should be browser-tested before removal.

## Medium-Risk Candidates

Potential delete-later candidates after browser verification:

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

Medium-risk keep/manual-review candidates:

- `css/pages/admin/lineItemsOrders.css`

## High-Risk Keep Files

- `css/theme/base.css`
- `css/theme/components.css`
- `css/pages/checkout.css`
- `css/pages/public/smsSignup.css`
- `css/pages/public/coupon.css`
- `css/pages/admin/smsAnalytics.css`
- `css/pages/admin/social.css`
- `css/pages/admin/ebay-listings.css`
- `css/pages/admin/reset.css`

## Active Page CSS Summary

Most active pages load:

- `/css/theme/base.css`
- `/css/theme/components.css`

Active page-specific CSS links:

- `pages/checkout.html` → `/css/pages/checkout.css`
- `pages/sms-signup.html` → `/css/pages/public/smsSignup.css`
- `pages/coupon.html` → `/css/pages/public/coupon.css`
- `pages/admin/sms-analytics.html` → `/css/pages/admin/smsAnalytics.css`
- `pages/admin/social.html` → `/css/pages/admin/social.css`
- `pages/admin/ebay-listings.html` → `/css/pages/admin/ebay-listings.css`
- `pages/admin/reset.html` → `/css/pages/admin/reset.css`

Pages with no linked page-specific CSS include catalog, product, reviews, success, leave-review, my-orders, and many admin pages. These appear to rely on Tailwind plus shared theme CSS.

## Follow-Up Recommendations

1. Browser-test each medium-risk file's likely owner page with and without the file before deleting.
2. Prefer deleting only one page-specific CSS file per commit after visual verification.
3. Do not delete global theme CSS or active page-specific CSS.
4. Keep order/product/checkout/SMS/reviews/admin CSS conservative unless there is browser evidence it is unused.

## Second-Pass Deletion Plan

No delete-now CSS files are recommended.

Candidate files for a future browser-tested deletion pass:

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

Required manual browser checks:

- `pages/admin/customers.html`
- `pages/admin/index.html`
- `pages/admin/lineItemsRaw.html`
- `pages/admin/pCalc.html`
- `pages/admin/pStorage.html`
- `pages/admin/products.html`
- `pages/admin/promotions.html`
- `pages/catalog.html`
- `pages/product.html`

## Latest Missing Reference Check

After the `pages/admin/reset.html` fix:

- `pages/admin/reset.html` no longer references `/css/components/navbar.css`.
- `pages/admin/reset.html` no longer references `/css/pages/admin.css`.
- `pages/admin/reset.html` no longer links `/css/pages/admin/admin.css`.
- `css/pages/admin/reset.css` exists and is active through `pages/admin/reset.html`.
- every local CSS file linked by active HTML exists.
- every CSS `@import` target exists; no `@import` entries were found.
- no CSS `url(...)` references were found in tracked CSS files.

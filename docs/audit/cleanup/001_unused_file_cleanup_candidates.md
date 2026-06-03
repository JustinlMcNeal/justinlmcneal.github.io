# Unused File Cleanup Candidates

Audit date: 2026-05-17

This is a conservative cleanup pass. Files marked safe below were checked for active HTML references, JS imports, CSS references, package/script usage, Supabase config/function references, and broad dynamic string references where applicable. Medium/high-risk items are intentionally left in place.

## Safe Delete Candidates

### File: `_patch_e3.mjs`

Reason it may be removable:
Temporary patch script for an eBay listings refactor pass.

Evidence:
- Direct reference search for `_patch_e3.mjs`, `_patch_e3`, `/ _patch_e3`, and file-name variants found only the file's own usage comment.
- No HTML script/link tags reference it.
- No JS imports reference it.
- No CSS references apply.
- No Supabase functions/configs/scripts reference it.
- Not part of `package.json` scripts.
- It modifies `js/admin/ebayListings/index.js` by string replacement and is not runtime website/admin code.

Risk level: Safe

Recommended action: Delete now

### File: `_patch_e3b.mjs`

Reason it may be removable:
Temporary fixed version of the eBay listings E-3 patch script.

Evidence:
- Direct reference search for `_patch_e3b.mjs` and `_patch_e3b` found only the file itself.
- No HTML script/link tags reference it.
- No JS imports reference it.
- No CSS references apply.
- No Supabase functions/configs/scripts reference it.
- Not part of `package.json` scripts.
- It is an ad hoc source rewrite helper and not runtime code.

Risk level: Safe

Recommended action: Delete now

### File: `_patch_full.mjs`

Reason it may be removable:
Temporary comprehensive eBay listings patch script. Documentation says it over-applied a refactor attempt and is historical evidence, not runtime code.

Evidence:
- Direct reference search found docs-only mentions in `docs/audit/pages/ebayListings/fileStructure/050_edit_listener_extraction_summary.md`.
- No HTML script/link tags reference it.
- No JS imports reference it.
- No CSS references apply.
- No Supabase functions/configs/scripts reference it.
- Not part of `package.json` scripts.
- It rewrites `js/admin/ebayListings/index.js` via string operations and should not be kept as active tooling.

Risk level: Safe

Recommended action: Delete now

### File: `js/admin/social/index.js.bak`

Reason it may be removable:
Backup copy of the old social admin entry file after the social admin refactor.

Evidence:
- Direct reference search for `index.js.bak`, `js/admin/social/index.js.bak`, and `/js/admin/social/index.js.bak` found no references.
- Active page `pages/admin/social.html` loads `/js/admin/social/index.js`, not the `.bak` file.
- No JS imports reference the `.bak` file.
- No CSS references apply.
- No Supabase functions/configs/scripts reference it.
- It is a backup artifact, not deployable runtime code.

Risk level: Safe

Recommended action: Delete now

### File: `cleanup-stale-shipments.mjs`

Reason it may be removable:
Completed one-time shipment cleanup script from the retired Pirate Ship / shipment cleanup period. It also contains a hardcoded privileged Supabase credential and should not remain in the repo.

Evidence:
- Direct reference search found docs-only mentions in `docs/shippo/shippo_001.md` and SMS build docs.
- `docs/shippo/shippo_001.md` marks the cleanup as done: the script marked stale orders delivered and skipped recent orders.
- No HTML script/link tags reference it.
- No JS imports reference it.
- No CSS references apply.
- No Supabase functions/configs/scripts reference it.
- Not part of `package.json` scripts.
- It is not runtime website/admin code.

Risk level: Safe

Recommended action: Delete now

Note: because this file contained a hardcoded service role credential, the corresponding key should be rotated if it was ever committed or shared.

## Medium-Risk Candidates

### File: `_migrate-categories.mjs`

Reason it may be removable:
One-time expense category migration script.

Evidence:
- Direct reference search found a Supabase migration comment in `supabase/migrations/20260221_align_expense_categories.sql` documenting that this script performed the data migration.
- No active HTML, JS imports, CSS, Supabase function, or package script references were found.

Risk level: Medium

Recommended action: Keep until manually verified

Rationale:
It may be historical migration evidence. Safer to keep until the migration docs are reviewed.

### File: `import-legacy-orders.mjs`

Reason it may be removable:
Legacy CSV import tooling for eBay orders.

Evidence:
- Referenced in docs as CSV import tooling and legacy order import support.
- No active HTML script tag or JS import references found.
- Related admin import functionality still exists in current admin modules, and docs mention CSV order import history.

Risk level: Medium

Recommended action: Keep until manually verified

### File: `import-legacy-reviews.mjs`

Reason it may be removable:
Legacy CSV import tooling for backfilled reviews.

Evidence:
- Referenced in `REVIEW-SYSTEM.md` as the legacy review import/backfill script.
- No active HTML script tag or JS import references found.

Risk level: Medium

Recommended action: Keep until manually verified

### File: `import-legacy-expenses.mjs`

Reason it may be removable:
Legacy expense import script.

Evidence:
- No active HTML script tag or JS import references found.
- Root-level usage comment indicates manual service-role execution.

Risk level: Medium

Recommended action: Keep until manually verified

### File: `import-amazon-orders.mjs`

Reason it may be removable:
Manual TSV import script for Amazon orders, while client-side/admin import logic also exists.

Evidence:
- Referenced in `docs/todo.md` and `docs/audit/system/items/sizes/002_sizes_implementation_plan.md`.
- `js/admin/lineItemsOrders/amazonImport.js` says it mirrors this script.
- No active HTML script tag or JS import references found.

Risk level: Medium

Recommended action: Keep until manually verified

### File: `js/reviews/index.js`

Reason it may be removable:
Appears to be an older centralized customer review flow. Current `pages/reviews.html` now uses `/js/pages/reviews/index.js`; `pages/leave-review.html` uses `/js/reviews/leave.js`.

Evidence:
- No active HTML page currently loads `/js/reviews/index.js`.
- Docs still reference it in `REVIEW-SYSTEM.md` and audit notes, but those appear partly outdated after the split into browse and leave flows.
- The file contains review/order/coupon behavior, which is high-impact if still used through a dynamic path or external deep link.

Risk level: Medium

Recommended action: Keep until manually verified

### Files: potentially unused page CSS

Candidates observed:
- `css/theme/admin-ui.css`
- `css/pages/admin/pStorage.css`
- `css/pages/product.css`
- `css/pages/admin/products.css`
- `css/pages/admin/admin.css`
- `css/pages/admin/pCalc.css`
- `css/pages/catalog.css`
- `css/pages/admin/lineItemsOrders.css`
- `css/pages/admin/customers.css`
- `css/pages/admin/promotions.css`
- `css/pages/admin/lineItemsRaw.css`

Reason they may be removable:
Some page CSS files did not appear in active HTML `<link>` tags during broad filename searches.

Evidence:
- Broad filename search found active links for theme CSS, `checkout.css`, `smsSignup.css`, `coupon.css`, `social.css`, `smsAnalytics.css`, and `ebay-listings.css`.
- Several page/admin CSS files had docs-only references or no active link hits.

Risk level: Medium

Recommended action: Keep until manually verified

Rationale:
Some may be loaded dynamically, recently planned, or intended to support active admin pages. CSS removal is user-facing and should be tested in-browser.

## High-Risk / Keep For Now

### Files: recently created compatibility wrappers

Files:
- `js/success/index.js`
- `js/sms-signup/index.js`
- `js/reviews/browse.js`

Reason they are not being deleted:
They were intentionally created to preserve old paths after recent modular refactors. Docs and older references still mention old paths.

Risk level: High

Recommended action: Keep for compatibility

### Files: review, SMS, coupon, checkout, product, shared, Supabase, and active admin modules

Reason they are not being deleted:
These areas directly affect live storefront, SMS consent, review rewards, payments, products, carts, and admin operations.

Risk level: High

Recommended action: Keep for now

## Docs-Only / Archive Candidates

Many audit docs are old or superseded, especially under:

- `docs/audit/pages/ebayListings/fileStructure/`
- `docs/audit/system/sms/`
- `docs/audit/pages/lineItemsOrder/`

Recommended action: Keep for now

Rationale:
They document migration decisions, production fixes, schema assumptions, and implementation history. This cleanup pass should not delete audit docs unless a future docs-specific archival pass identifies exact duplicates.

## Duplicate Assets

No image or asset files were marked safe to delete in this pass.

Reason:
Assets may be referenced by products, social previews, SEO metadata, or dynamic data and require a separate asset-to-database audit.

## Empty or Placeholder Files

No empty placeholder files were marked safe to delete in this pass.

# 003 — Refactor Phase Plan: eBay Listings Admin File Structure

Date: 2026-05-15

## Guiding rules

- Preserve eBay mutation behavior.
- Keep the page vanilla JS and ES modules.
- Keep the current page import path: HTML imports page-specific `index.js`.
- Do not redesign the UI.
- Do not change backend behavior.
- Do not remove stale-link, no-active-match, sold-out, variant image, pricing, or profit-preview protections.
- Prefer small extractions with immediate verification.
- Avoid circular imports.

## Phase 1 — API seam extraction

Objective:

- Establish a low-risk `api.js` seam for shared Edge Function and Supabase read helpers.

Files affected:

- `js/admin/ebayListings/index.js`
- `js/admin/ebayListings/api.js` (new)

Functions to move:

- `callEdge(...)`
- product list read query, as `fetchProducts()` or `fetchProductsWithWorkspaceMetrics()`
- `mergeWorkspaceMetrics(...)`

Risk level:

- Low, if only reads and the generic edge-call helper move.
- Medium if eBay mutation call payloads are changed. Do not change payloads.

Verification checklist:

- Syntax check modified JS.
- Confirm `index.js` imports from `api.js` without circular import.
- Confirm page still loads.
- Confirm products still load.
- Confirm workspace metric chips still render when the view is available.
- Confirm table/card render still work.
- Confirm existing eBay action handlers still call `ebay-manage-listing`, `ebay-taxonomy`, `ebay-ai-autofill`, and `ebay-migrate-listings` through the same request body shapes.

Rollback notes:

- Move `callEdge(...)` and read helpers back into `index.js`.
- Remove the `api.js` import.
- Delete `api.js` if unused.

## Phase 2 — Pure utility cleanup

Objective:

- Reduce mixed responsibility in `utils.js` without touching eBay workflows.

Files affected:

- `js/admin/ebayListings/utils.js`
- possibly `js/admin/ebayListings/formReaders.js` or keep in `utils.js` until later
- `index.js` imports only if functions move

Functions to move or classify:

- Keep pure helpers together:
  - `esc(...)`
  - `sanitizeForEbay(...)`
  - `isComplexHtml(...)`
  - `wrapDescription(...)`
  - `buildImageUrls(...)`
  - `variantSkuFromOption(...)`
- Optionally split DOM form readers later:
  - `buildPackageWeightAndSize(...)`
  - `getSelectedPolicies(...)`
  - `getBestOfferTerms(...)`

Risk level:

- Low if only documentation/import grouping changes.
- Medium if DOM form readers move because create/edit payloads rely on them.

Verification checklist:

- Syntax check.
- Push modal opens.
- Edit modal opens.
- Create/edit payload helpers still read the same DOM IDs.
- Best Offer validation still throws on invalid auto-accept/auto-decline combo.

Rollback notes:

- Restore imports to `utils.js`.
- Move any split helpers back.

## Phase 3 — Filters and view coordination

Objective:

- Extract filter predicate logic while keeping rendering orchestration in `index.js`.

Files affected:

- `index.js`
- `filters.js` (new)

Functions to move:

- pure product filtering logic from `applyFilters()`
- quick filter predicate logic
- optional DOM filter read helper

Risk level:

- Low-to-medium.
- Quick filters depend on `_ws.issue_flags`, `computeHealth(...)`, and current DOM select values.

Verification checklist:

- Search by product name/code/SKU.
- Status filters.
- Quick filters:
  - Has Issues
  - Low Score
  - Missing Basics
  - Draft Stalled
  - No Sales 30d
  - Has Promo
- Count label updates.
- Table/card view still render the filtered set.

Rollback notes:

- Inline the filter logic back into `applyFilters()`.

## Phase 4 — Rendering helpers, not actions

Objective:

- Extract stable table/card rendering helpers after action dependencies are explicit.

Files affected:

- `index.js`
- `table.js` (new)
- `cards.js` (new)
- maybe `renderHelpers.js` if shared chip/profit helpers need a home

Functions to move:

- `renderTable()`
- `renderCards()`
- maybe `wsChips(...)`
- maybe `rowEstProfitHtml(...)`
- maybe `epCls(...)`

Risk level:

- Medium.
- Templates currently embed global `onclick` calls and depend on stale action badges, profit preview logic, and health scoring.

Verification checklist:

- Empty state table and card views.
- Product images render.
- Product links render.
- Status, score, stale, workspace, and profit chips render.
- Bulk checkboxes still work in table view.
- Push/Edit/End/Publish/Discard/Re-list buttons still invoke same handlers.
- Sales history delegated buttons still open modal.

Rollback notes:

- Restore render functions in `index.js`.
- Remove render module imports.

## Phase 5 — Delegated action cleanup

Objective:

- Remove generated inline `onclick` strings gradually and replace with delegated event handlers.

Files affected:

- `index.js`
- possibly `actions.js`
- `table.js`/`cards.js` if already extracted

Functions/areas to move:

- Action template generation from `renderProductActions(...)`.
- Delegated click handler for list/card action buttons.
- Keep global functions temporarily if needed for compatibility during migration.

Risk level:

- Medium-to-high because every listing row/card action is involved.

Verification checklist:

- Push opens from not listed and ended/re-list states.
- Edit opens from active and draft states.
- End listing still calls `withdraw` or `withdraw_group` with same payloads.
- Publish draft still calls `publish` or `publish_group` with same payloads.
- Discard draft still calls `discard_draft` with same payloads.
- Stale relink still calls `reconcile_listing` with `relink: true`.
- Clear stale link still calls `clear_stale_listing_link`.

Rollback notes:

- Restore previous `onclick` templates and `window.*` handlers.

## Phase 6 — Bulk actions module

Objective:

- Isolate bulk selection and bulk update modal.

Files affected:

- `index.js`
- `bulkActions.js` (new)

Functions to move:

- `getSelectedItems()`
- `updateBulkBar()`
- `openBulkModal(...)`
- bulk checkbox/change/cancel/open/apply handlers

Risk level:

- Medium.
- Bulk price update includes local `products.ebay_price_cents` writes after edge success.

Verification checklist:

- Check-all selects visible listed rows.
- Bulk bar count updates.
- Cancel clears all selections.
- Bulk price calls `bulk_update` and then updates local product price cents.
- Bulk quantity calls `bulk_update` and does not incorrectly write price cents.
- Product reload occurs after success.

Rollback notes:

- Move handlers/functions back into `index.js`.

## Phase 7 — Setup and import panels

Objective:

- Extract lower-risk side panels after API seam exists.

Files affected:

- `index.js`
- `setupPanel.js` (new)
- `importPanel.js` (new)

Functions to move:

- setup panel toggle/policy render handler
- setup location handler
- migration panel toggle
- scan handler
- auto-link handler
- `renderMigrateResults(...)`

Risk level:

- Medium.
- Import/auto-link updates product linkage state, but its UI is isolated.

Verification checklist:

- Setup panel toggles.
- Policies load and render.
- Setup location still calls `setup_location` with location key `default`.
- Import panel toggles.
- Scan still calls `ebay-migrate-listings` action `scan`.
- Auto-link still calls `auto_link` and reloads products.

Rollback notes:

- Restore panel handlers to `index.js`.

## Phase 8 — Variant image/quantity helpers

Objective:

- Extract shared variant image UI and quantity helpers without changing payloads.

Files affected:

- `index.js`
- `variantImages.js` (new)
- `variantQuantities.js` (new)

Functions to move:

- `imageOptionLabel(...)`
- `renderVariantAssignedImages(...)`
- `getAssignedVariantImages(...)`
- `setAssignedVariantImages(...)`
- `renderVariantCandidatePicker(...)`
- `refreshVariantCandidateButtons(...)`
- `wireVariantImageSetControls(...)`
- `publishQuantityForProduct(...)`
- `activeVariantCount(...)`
- `isEffectiveGroupListing(...)`

Risk level:

- Medium-to-high.
- Must preserve variant image sets, first-image-as-main behavior, variant quantity controls, OOS handling, and group listing behavior.

Verification checklist:

- Push modal variant panel renders active variants.
- Variant checkboxes and quantities are read correctly.
- OOS variant messaging still appears.
- Variant image picker hides assigned images.
- Main image reorder/removal still works.
- Edit modal variant image/quantity controls render for group listings.
- Save sends same variant image and quantity payload shapes.

Rollback notes:

- Move helpers back into `index.js`.

## Phase 9 — Reconciliation module

Objective:

- Isolate stale-link, no-active-match, relink, clear-stale, and sold-out protections.

Files affected:

- `index.js`
- `listingReconcile.js` (new)

Functions to move:

- `isLinkedOnEbay(...)`
- `isStaleLinkCheck(...)`
- `isOutOfStockLinkCheck(...)`
- `isLinkWarningCheck(...)`
- `staleActionState(...)`
- `staleActionBadge(...)`
- `staleLinkLabel(...)`
- `staleLinkMessage(...)`
- `currentActiveListingId(...)`
- `reconcileEbayLink(...)`
- `auditListingLinks(...)`
- `renderEditLinkWarning(...)`
- possibly relink/clear-stale action handlers after delegated action cleanup

Risk level:

- High.
- This area intentionally protects against editing stale or ended eBay listings.

Verification checklist:

- Active linked products are audited after load.
- Stale local links show warning badges.
- No-active-match state shows expected labels/actions.
- Sold-out state shows Restock/Mark Ended actions.
- Edit modal re-checks link freshness before save.
- Save is blocked for stale links unless safely relinked/refreshed.
- Relink only proceeds when safe.
- Clear stale state only updates website record and does not create/edit/end on eBay.

Rollback notes:

- Restore all reconciliation helpers and handlers to `index.js`.

## Phase 10 — Push modal module

Objective:

- Move push listing workflow after dependencies are modular and verified.

Files affected:

- `index.js`
- `pushModal.js` (new)
- maybe `aspects.js` if aspect field logic is shared

Functions to move:

- `openPush(...)`
- `fetchAspects(...)`
- `buildAspectField(...)`
- `collectAspects()`
- `validateRequiredAspects()`
- push AI autofill
- push step 1/2/3 handlers
- push modal event wiring

Risk level:

- High.
- This is core create/list/publish behavior.

Verification checklist:

- Push modal opens with same defaults.
- Resume draft behavior still preloads prior item data.
- Single-item create item → create offer → publish works.
- Variant create items → create group/offer → publish works.
- Zero-quantity variants are still created but only publishable variants are included where currently expected.
- Variant images remain separate from general listing images.
- Best Offer stays hidden for group listings.
- Volume pricing after publish still works.
- Price reference/profit preview still update live.

Rollback notes:

- Restore push logic to `index.js`.

## Phase 11 — Edit modal module

Objective:

- Move edit/revise workflow last, after API/reconcile/variant modules are proven.

Files affected:

- `index.js`
- `editModal.js` (new)

Functions to move:

- `openEdit(...)`
- `buildEditAspectField(...)`
- `renderEditVariantImageControls(...)` if not already moved/split
- edit AI autofill
- edit save handler
- edit modal event wiring

Risk level:

- Highest.
- This is the most complex and protection-sensitive flow.

Verification checklist:

- Edit modal opens for single listings.
- Edit modal opens for group/variant listings.
- Stale-link and sold-out warnings still render.
- Group listing fields and quantity controls still behave.
- Item, offer, group, variant item, variant offer update calls keep same payload shapes.
- Best Offer remains disabled for group listings.
- Volume pricing fetch/update/create/delete still works.
- Store category local DB write still occurs.
- Save reloads products after success.

Rollback notes:

- Restore edit logic to `index.js`.

## Recommended next implementation prompt after this pass

If only the audit is completed, the next safe prompt should be:

> Implement Phase 1 only for `js/admin/ebayListings`: create `api.js`, move `callEdge(...)`, the products read query, and workspace metrics read/merge into it, update `index.js` imports/calls, do not change any eBay action payloads, then run syntax/import checks and document verification.

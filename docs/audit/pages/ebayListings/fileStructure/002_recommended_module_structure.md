# 002 — Recommended Module Structure: eBay Listings Admin

Date: 2026-05-15

## Target architecture

The target is a gradual ES-module architecture where `index.js` becomes the page entrypoint/orchestrator:

- imports feature modules
- initializes state
- wires top-level events
- coordinates module calls
- bootstraps admin nav/footer/guard/page load

It should not permanently own every render template, modal implementation, API call, and eBay action.

No bundler, React, TypeScript conversion, or page redesign is recommended.

## Proposed target layout

Recommended eventual layout:

```text
js/admin/ebayListings/
  index.js
  state.js
  api.js
  dom.js
  filters.js
  table.js
  cards.js
  actions.js
  pushModal.js
  editModal.js
  variantImages.js
  variantQuantities.js
  listingReconcile.js
  salesHistory.js
  listingHealth.js
  profitPreview.js
  priceReference.js
  bulkActions.js
  setupPanel.js
  importPanel.js
  editor.js
  images.js
  volPricing.js
  utils.js
```

This should be implemented in phases. Do not create all files up front.

## Module responsibilities

### `index.js`

Responsibility:

- Page entrypoint/orchestrator.
- Bootstrap admin nav/footer/auth guard.
- Create or import page state.
- Initialize modules.
- Coordinate refreshes after mutations.

Should export:

- Nothing, unless a later test harness requires explicit `init()` export.

Needs state:

- Current page state or imported state object.

Should not own:

- Full table/card templates.
- Full push/edit modal workflows.
- Raw Edge Function fetch implementation.
- Deep variant image/quantity UI.
- Reconciliation policy details.

### `state.js` — future only, not first

Responsibility:

- Central state container only if it reduces coupling.
- Preserve current mutable state names during migration.

Candidate state:

- `allProducts`
- `filteredProducts`
- `currentView`
- `currentProduct`
- `editProduct`
- `currentAspects`
- `editAspects`
- `pushImageUrls`
- `editImageUrls`
- `pushVariants`
- `isVariantListing`
- `editVariantImageOverrides`
- `editVariantQtyOverrides`
- `cachedPolicies`
- `bulkMode`
- `pageAdRatePct`
- `pushSalesMetrics`
- `editSalesMetrics`
- `editOfferLookupCache`
- `linkAuditRunId`

Should export:

- Prefer a single mutable object such as `state`, or small getter/setter functions.

Should not own:

- DOM reads/writes.
- Edge calls.
- eBay mutation payloads.

Caution:

- Do not create a fragile global state module until at least API and low-risk rendering boundaries are established.

### `api.js`

Responsibility:

- Edge Function calls.
- Supabase read helpers.
- Small API retry wrappers when they are independent of UI state.

Functions that should move here:

- `callEdge(...)`
- product list read query
- workspace metrics read/merge
- possibly `getItemForEdit(...)` after deciding how to pass cache/retry behavior
- possibly policy read helper
- possibly recent sales metrics if consolidated later from `priceReference.js`/`salesHistory.js`

State needed:

- Supabase client inside module.
- Hardcoded Supabase URL, or future import from config if standardized.

Should export:

- `callEdge(fnName, body)`
- `fetchProducts()` or `fetchProductsWithWorkspaceMetrics()`
- `mergeWorkspaceMetrics(products)` if still useful separately

Should not own:

- DOM status messages.
- Mutation behavior decisions.
- UI refreshes after API calls.

### `dom.js`

Responsibility:

- Safe DOM element access wrappers and maybe shared UI helpers.

Candidate functions:

- `byId(id)`
- `setText(id, value)`
- `show(id)` / `hide(id)`
- modal show/hide helpers only if generic

State needed:

- None.

Should export:

- Small DOM helpers.

Should not own:

- Feature-specific rendering.
- eBay action decisions.

### `filters.js`

Responsibility:

- Product filtering based on search/status/quick-filter controls.

Functions to move:

- Filter predicate logic from `applyFilters()`.
- Possibly a pure `filterProducts(products, controls)`.

State needed:

- Product array and current filter values passed in.
- `computeHealth(...)` for score filters.

Should export:

- `readFilterControls()`
- `filterProducts(products, filters)`

Should not own:

- Rendering.
- Updating stats.
- Edge calls.

### `table.js`

Responsibility:

- Product table rendering.

Functions to move:

- `renderTable()` after dependencies are passed in.
- Table-specific row template helpers.

State needed:

- Filtered products.
- Helper callbacks/renderers for action buttons, chips, and profit/health.

Should export:

- `renderTable({ products, helpers })`

Should not own:

- Product loading.
- eBay action implementations.
- Global state.

Caution:

- Before moving, replace inline `onclick` templates with delegated actions or pass action template helpers from `actions.js`.

### `cards.js`

Responsibility:

- Product card grid rendering.

Functions to move:

- `renderCards()` after dependencies are passed in.
- Card-specific template helpers.

State needed:

- Filtered products.
- Helper callbacks/renderers for action buttons, chips, and profit/health.

Should export:

- `renderCards({ products, helpers })`

Should not own:

- Product loading.
- eBay action implementations.
- Global state.

### `actions.js`

Responsibility:

- List-row/card eBay action coordination.

Functions to move eventually:

- `renderProductActions(...)` or action descriptor generation.
- `window.discardDraft(...)` replacement/delegated handler.
- `window.doWithdraw(...)` replacement/delegated handler.
- `window.doPublish(...)` replacement/delegated handler.

State needed:

- Product lookup.
- `callEdge(...)`.
- `loadProducts()` callback.
- `showStatus(...)` callback.
- group listing helpers.

Should export:

- `renderProductActions(...)` or `buildProductActions(...)`.
- `handleProductAction(action, code, payload)`.

Should not own:

- Push/edit modal internals.
- Reconciliation safety rules unless delegated from `listingReconcile.js`.

### `pushModal.js`

Responsibility:

- Push modal open/reset and create item/create offer/publish flow.

Functions to move:

- `openPush(...)`
- push category/aspect helpers, if not split separately
- push AI autofill handler
- push step handlers
- push preview/reference coordination

State needed:

- Current product.
- Push image URLs.
- Push variants.
- Variant listing flag.
- Current aspects.
- Quill instance.
- Sales metrics for price reference.
- Page ad rate.

Should export:

- `initPushModal(deps)`
- `openPush(code)`

Should not own:

- Product table/card rendering.
- Edit modal behavior.
- Global bootstrap.

Caution:

- High risk. Do after API and delegated action seams are stable.

### `editModal.js`

Responsibility:

- Edit modal open/fetch/pre-fill/save workflow.

Functions to move:

- `openEdit(...)`
- `buildEditAspectField(...)`
- edit AI autofill handler
- save handler
- edit preview/reference coordination

State needed:

- Edit product.
- Edit aspects.
- Edit image URLs.
- Variant overrides.
- Quill instance.
- Offer lookup cache.
- Reconciliation helpers.
- API helpers.

Should export:

- `initEditModal(deps)`
- `openEdit(code)`

Should not own:

- Push modal behavior.
- Product list render templates.
- Setup/import panels.

Caution:

- Highest-risk extraction because it combines reads, eBay mutations, stale-link protections, group listings, variants, volume pricing, and local DB writes.

### `variantImages.js`

Responsibility:

- Variant image assignment UI shared by push and edit.

Functions to move:

- `imageOptionLabel(...)`
- `renderVariantAssignedImages(...)`
- `getAssignedVariantImages(...)`
- `setAssignedVariantImages(...)`
- `renderVariantCandidatePicker(...)`
- `refreshVariantCandidateButtons(...)`
- `wireVariantImageSetControls(...)`

State needed:

- Candidate image URLs passed in.
- Optional callback to report assigned URLs.

Should export:

- Small DOM helpers for assigning/reordering variant image sets.

Should not own:

- eBay update calls.
- Product loading.
- Modal open/save decisions.

### `variantQuantities.js`

Responsibility:

- Variant quantity derivation and payload helpers.

Functions to move:

- `publishQuantityForProduct(...)`
- `activeVariantCount(...)`
- `isEffectiveGroupListing(...)`
- potentially `getCheckedVariants()` if UI dependency is passed cleanly.

State needed:

- Product variants passed in.
- DOM rows only for UI read helpers.

Should export:

- Quantity and group-listing helpers.

Should not own:

- eBay API calls.
- Rendering full modals.

### `listingReconcile.js`

Responsibility:

- Stale-link, no-active-match, sold-out, relink, and clear-stale protections.

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

State needed:

- Products to audit.
- `callEdge(...)`.
- `renderAll()` callback.
- `showStatus(...)` callback.
- Product lookup callback for relink/clear actions if those move too.

Should export:

- Pure state/label helpers.
- `reconcileEbayLink(...)`.
- Possibly `initListingReconcile(deps)`.

Should not own:

- Product list load query.
- Push/edit modal core flows.

Caution:

- Must preserve protections for stale links, no-active-match, sold-out, relink, and clear stale state. Extract only after tests/checklists are in place.

### `bulkActions.js`

Responsibility:

- Bulk selection and bulk update modal.

Functions to move:

- `getSelectedItems()`
- `updateBulkBar()`
- `openBulkModal(...)`
- bulk checkbox and apply event handlers

State needed:

- `bulkMode`.
- `callEdge(...)`.
- Supabase local price update helper.
- `loadProducts()` callback.

Should export:

- `initBulkActions(deps)`
- `updateBulkBar()` if render modules need it.

Should not own:

- Product table/card rendering beyond selection controls.

### `setupPanel.js`

Responsibility:

- Setup panel/policy display and inventory location setup.

Functions to move:

- Setup button handler.
- Setup location handler.
- Policy rendering for setup panel.

State needed:

- `callEdge(...)`.

Should export:

- `initSetupPanel({ callEdge })`.

Should not own:

- Modal policy dropdown population unless policy cache is intentionally centralized.

### `importPanel.js`

Responsibility:

- Import/migration panel scan and auto-link.

Functions to move:

- `renderMigrateResults(...)`
- migrate panel toggle handler
- scan handler
- auto-link handler

State needed:

- `callEdge(...)`.
- `loadProducts()` callback.

Should export:

- `initImportPanel(deps)`.

Should not own:

- Product list rendering except triggering refresh after auto-link.

### Existing modules to keep

#### `editor.js`

Keep responsibility:

- Quill toolbar and description mode helpers.

Possible future cleanup:

- Avoid shared global `descState` if push/edit modal modules each own their mode state.

#### `images.js`

Keep responsibility:

- General listing image strip/gallery helpers.

Should not absorb:

- Variant-specific image controls; those belong in `variantImages.js`.

#### `volPricing.js`

Keep responsibility:

- Volume pricing tier UI helpers.

Future note:

- Can remain DOM-specific because it owns a tiny, isolated UI region.

#### `profitPreview.js`

Keep responsibility:

- Estimation model and preview render.

Future note:

- If table/card estimated profit chips need a shared formatter, add a narrow export instead of duplicating logic.

#### `listingHealth.js`

Keep responsibility:

- Pure health scoring.

No change recommended.

#### `salesHistory.js`

Keep responsibility:

- Sales history modal.

Future note:

- Its Supabase read could later move into `api.js`, but this is not urgent because the feature is isolated and read-only.

#### `priceReference.js`

Keep responsibility:

- Price reference model and renderer.

Future note:

- Its `fetchSalesMetrics(...)` could later move into `api.js` if API reads are centralized, but this is not required in the first phase.

#### `utils.js`

Keep responsibility:

- Pure or tiny shared helpers.

Future cleanup:

- Consider separating pure helpers from DOM form readers:
  - pure: `esc`, `sanitizeForEbay`, `isComplexHtml`, `wrapDescription`, `buildImageUrls`, `variantSkuFromOption`
  - DOM form readers: `buildPackageWeightAndSize`, `getSelectedPolicies`, `getBestOfferTerms`

## Recommended dependency direction

Preferred one-way dependency direction:

```text
index.js
  -> feature modules
    -> api.js / utils.js / editor.js / images.js / volPricing.js / pure model modules
```

Avoid:

- Feature modules importing `index.js`.
- Render modules importing modal modules.
- API modules importing DOM modules.
- State module importing feature modules.
- Circular imports between actions, rendering, reconciliation, and modals.

## Migration strategy

Use adapter-style extraction:

- Move a small helper to a module.
- Import it into `index.js`.
- Keep call sites and behavior unchanged.
- Verify syntax/imports/page load.
- Only then move the next seam.

Do not split by line count alone. Split by stable responsibility boundaries.

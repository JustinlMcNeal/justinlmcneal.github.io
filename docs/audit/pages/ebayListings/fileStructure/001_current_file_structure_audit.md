# 001 — Current File Structure Audit: eBay Listings Admin

Date: 2026-05-15

## Scope inspected

Inspected:

- `pages/admin/ebay-listings.html`
- `css/pages/admin/ebay-listings.css`
- every current file in `js/admin/ebayListings/*.js`

Current `js/admin/ebayListings/` files:

| File | Lines | Current role |
|---|---:|---|
| `index.js` | 2,794 | Page entrypoint plus most implementation: state, data loading, rendering, filters, eBay actions, push/edit/bulk/setup/import workflows, reconciliation, event wiring, and global browser action functions. |
| `utils.js` | 100 | Shared helpers for escaping, eBay-safe HTML, image URL collection, package weight/dim payloads, policy/best-offer form reads, and variant SKU generation. Mixes pure helpers with DOM form readers. |
| `editor.js` | 106 | Quill toolbar config, shared description mode state, editor mount reset, visual/html/preview tab switching, and description HTML reads. |
| `images.js` | 74 | General listing image strip renderer and gallery picker helpers for push/edit modals. Uses DOM and mutates caller-owned image URL arrays. |
| `volPricing.js` | 67 | Volume pricing tier DOM helpers: add, read, and populate tier rows. |
| `profitPreview.js` | 347 | Mostly pure estimated profit model plus DOM renderer for push/edit preview panels. No Supabase or edge calls. |
| `listingHealth.js` | 193 | Pure deterministic listing health score/flag computation. No DOM or side effects. |
| `salesHistory.js` | 185 | Sales history modal feature: Supabase read, summary/table render, open/close modal. Already reasonably isolated. |
| `priceReference.js` | 247 | Internal price reference builder, Supabase recent-sales metric read, and panel renderer. Already reasonably isolated. |

## Page shell and load path

`pages/admin/ebay-listings.html` owns the full DOM shell for the eBay Listings admin page, including:

- header, filters, stats, table/card containers
- push modal
- edit modal
- bulk modal
- setup/policies panel
- migration/import panel
- sales history modal
- stylesheet import for `css/pages/admin/ebay-listings.css`
- module script import: `/js/admin/ebayListings/index.js?v=20260421c`
- shared PWA module import

There is no page-action inline JavaScript in the HTML body. There is a small Tailwind config script in the head, and the page correctly imports the page-specific ES module entrypoint.

## What remains inside `index.js`

`index.js` currently owns all of these responsibilities:

- Supabase client initialization and the hardcoded Supabase Edge Function base URL.
- Shared page state:
  - `allProducts`
  - `filteredProducts`
  - `currentView`
  - `currentProduct`
  - `currentAspects`
  - `pushQuill`
  - `editQuill`
  - `pushImageUrls`
  - `editImageUrls`
  - `editVariantImageOverrides`
  - `editVariantQtyOverrides`
  - `pushVariants`
  - `isVariantListing`
  - `editProduct`
  - `editAspects`
  - `cachedPolicies`
  - `bulkMode`
  - `searchTimeout`
  - `pushSalesMetrics`
  - `editSalesMetrics`
  - `pageAdRatePct`
  - `editOfferLookupCache`
  - `linkAuditRunId`
- Edge Function helper `callEdge(...)`.
- Product and workspace metric reads.
- Policy cache reads and dropdown population.
- Link reconciliation and stale/sold-out/no-active-match display/action logic.
- Table and card rendering.
- Search, status, quick filter, ad-rate filter, and view switching.
- Bulk selection and bulk update modal.
- Push modal open/reset logic and create item/create offer/publish handlers.
- Edit modal open/fetch/pre-fill logic and save handler.
- Variant listing support:
  - push variant panel
  - variant SKU generation usage
  - selected variant quantity reads
  - variant image set UI
  - edit variant image/quantity controls
- eBay action functions from list rows/cards:
  - publish draft
  - withdraw/end listing
  - discard draft
  - relink stale listing
  - clear stale local link
- AI autofill event handlers for push and edit modals.
- Setup panel and inventory location setup.
- Import/migration panel scan and auto-link actions.
- Profit preview/price reference coordination.
- Sales history delegated click wiring.
- Page bootstrap: admin nav, footer, guard, view sync, product load, policy prefetch.

## Rough complexity notes

`index.js` is too large for the intended architecture:

- 2,794 physical lines.
- About 45 `callEdge(...)` call sites.
- About 58 event listener registrations.
- About 9 `window.*` action bindings.
- About 20 generated `onclick="..."` action attributes inside render templates.
- Multiple high-risk responsibilities are interleaved: render templates, modal state, API calls, eBay mutations, reconciliation protections, and bootstrap logic.

This makes targeted changes risky because small behavior changes can accidentally affect unrelated flows.

## Major function groups inside `index.js`

### API/read helpers

- `callEdge(...)`
- `loadProducts()`
- `mergeWorkspaceMetrics(...)`
- `loadPoliciesCache()`
- `getItemForEdit(...)`
- `getOffersForEdit(...)`
- `fetchAspects(...)`
- `loadAndRenderPriceRef(...)` delegates to `fetchSalesMetrics(...)` from `priceReference.js`

### Reconciliation/stale-link protections

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
- `window.relinkEbayListing(...)`
- `window.clearStaleEbayLink(...)`
- `renderEditLinkWarning(...)`

These are behavior-sensitive and should not be extracted until tests/checklists exist around stale links, no active match, sold-out/restock, relink, and clear stale state flows.

### Product list rendering and filters

- `applyFilters()`
- `renderAll()`
- `setView(...)`
- `renderTable()`
- `renderCards()`
- `updateStats()`
- `wsChips(...)`
- `rowEstProfitHtml(...)`
- `renderProductActions(...)`

### Push modal

- `window.openPush(...)`
- `fetchAspects(...)`
- `buildAspectField(...)`
- `collectAspects()`
- `validateRequiredAspects()`
- push create item handler
- push create offer/group handler
- push publish handler
- push AI autofill handler
- push description/image/volume/lot/best-offer event wiring

### Edit modal

- `window.openEdit(...)`
- `buildEditAspectField(...)`
- `renderEditVariantImageControls(...)`
- edit save handler
- edit AI autofill handler
- edit relink/description/image/volume/lot/best-offer event wiring

### Variant support

- `imageOptionLabel(...)`
- `renderVariantAssignedImages(...)`
- `getAssignedVariantImages(...)`
- `setAssignedVariantImages(...)`
- `renderVariantCandidatePicker(...)`
- `refreshVariantCandidateButtons(...)`
- `wireVariantImageSetControls(...)`
- `renderVariantPanel(...)`
- `getCheckedVariants()`
- `publishQuantityForProduct(...)`
- `activeVariantCount(...)`
- `isEffectiveGroupListing(...)`
- `renderEditVariantImageControls(...)`

Variant extraction is medium-to-high risk because it crosses push modal, edit modal, image state, quantity state, group listing behavior, and eBay payload construction.

### Bulk/setup/import/bootstrap

- `getSelectedItems()`
- `updateBulkBar()`
- `openBulkModal(...)`
- bulk apply handler
- setup panel handlers
- migration panel handlers
- `renderMigrateResults(...)`
- `init()`

## Current import/export relationships

Current `index.js` imports:

- shared app modules:
  - `/js/shared/adminNav.js` → `initAdminNav`
  - `/js/shared/footer.js` → `initFooter`
  - `/js/shared/supabaseClient.js` → `getSupabaseClient`
  - `/js/shared/guard.js` → `requireAdmin`
- local eBay Listings modules:
  - `utils.js` → escaping, description/image/form/SKU helpers
  - `editor.js` → Quill config and description mode helpers
  - `images.js` → image strip/gallery helpers
  - `volPricing.js` → volume pricing tier helpers
  - `profitPreview.js` → estimate builder/renderer
  - `listingHealth.js` → health score computation
  - `salesHistory.js` → sales history modal open/close
  - `priceReference.js` → price reference builder/renderer and sales metrics fetcher

Current local module dependencies:

- `images.js` imports `utils.js`.
- `editor.js` imports `utils.js`.
- `salesHistory.js` imports `/js/shared/supabaseClient.js` and `utils.js`.
- `priceReference.js` imports `/js/shared/supabaseClient.js`.
- `profitPreview.js`, `listingHealth.js`, and `volPricing.js` have no local imports.

There are currently no local circular imports in `js/admin/ebayListings/`.

## Current DOM ownership patterns

DOM ownership is mixed:

- `pages/admin/ebay-listings.html` owns all static containers and modal markup.
- `index.js` owns most DOM mutation and event wiring.
- `images.js`, `editor.js`, `volPricing.js`, `salesHistory.js`, `priceReference.js`, and `profitPreview.js` each mutate specific DOM regions.
- Some helper modules are already feature-owned, but `index.js` still reaches into every area.

The current architecture is mostly "HTML shell + large page module + small helper modules." The target should be "HTML shell + page orchestrator + feature modules with narrow APIs."

## Inline JS and window-bound action problems

No page-specific inline script block exists in the HTML import path, but `index.js` still generates many row/card action buttons with inline `onclick` attributes and binds corresponding functions on `window`, including:

- `window.openPush`
- `window.openEdit`
- `window.discardDraft`
- `window.doWithdraw`
- `window.doPublish`
- `window.relinkEbayListing`
- `window.clearStaleEbayLink`

This works today, but it is a structural smell because render templates depend on global browser functions. It also makes future extraction harder. The safer long-term pattern is delegated click handling with `data-action` attributes, as already used for sales history.

Do not remove the globals in the first extraction because doing so would touch core listing actions and increase blast radius.

## Safe extraction candidates

Low risk:

- `callEdge(...)` into `api.js`.
- Product read query and workspace metrics read into `api.js`.
- Small pure format helpers if no DOM/state coupling exists.
- DOM query convenience wrappers into a future `dom.js`, but only if introduced gradually.

Medium risk:

- `applyFilters()` into `filters.js`, because it depends on DOM filter controls, `allProducts`, `filteredProducts`, `computeHealth`, and `renderAll()`.
- `renderTable()`/`renderCards()` into `table.js`/`cards.js`, because render templates currently include inline global action calls and depend on stale-link/profit/health helpers.
- Bulk modal into `bulkActions.js`, because it combines selection DOM, local Supabase price writes, and edge bulk update.

High risk:

- Push modal create/offer/publish flow.
- Edit modal fetch/pre-fill/save flow.
- Variant image/quantity controls.
- Reconciliation/stale-link protections.
- Any eBay mutation payload builders used by create/edit/end/relink flows.

These areas should be extracted only after the API and rendering seams are stable and verification is repeatable.

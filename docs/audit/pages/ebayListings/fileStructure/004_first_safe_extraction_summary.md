# 004 — First Safe Extraction Summary: API Helpers

Date: 2026-05-15

## Implemented extraction

A small Phase 1 extraction was implemented after the file structure audit and phase plan were documented.

New file:

- `js/admin/ebayListings/api.js`

Updated file:

- `js/admin/ebayListings/index.js`

## What moved

Moved from `index.js` to `api.js`:

- `callEdge(fnName, body)`
- product list Supabase read query, now exported as `fetchProducts()`
- workspace metrics Supabase read/merge helper, now exported as `mergeWorkspaceMetrics(products)`
- combined product + workspace read helper, exported as `fetchProductsWithWorkspaceMetrics()`

## What changed in `index.js`

`index.js` now imports:

- `callEdge`
- `fetchProductsWithWorkspaceMetrics`

from `./api.js`.

`loadProducts()` now calls `fetchProductsWithWorkspaceMetrics()` and then keeps the same orchestration behavior:

1. show status on read error
2. assign `allProducts`
3. apply filters
4. update stats
5. audit eBay links

The local `supabase` client remains in `index.js` because existing local product update writes still live there, especially:

- edit save store-category persistence
- bulk price local `ebay_price_cents` persistence

Those mutation-adjacent writes were intentionally not moved in this pass.

## Why this was safe

This was a low-risk extraction because:

- The Edge Function helper implementation was moved without changing request URLs, HTTP method, headers, body serialization, response parsing, or eBay failure logging.
- eBay action payloads at every call site stayed in `index.js` and were not rewritten.
- Product loading behavior stayed the same, except the Supabase read is called through `api.js`.
- Workspace metrics still degrade safely: if `v_ebay_listing_workspace` is unavailable, products are returned without `_ws` data and the page can still render.
- No push/edit modal workflow was split.
- No reconciliation, stale-link, sold-out, variant image, pricing, or profit-preview behavior was changed.
- No backend, migration, edge function, CSS, or HTML behavior was changed.

## Line-count impact

After extraction:

- `index.js`: 2,744 lines
- `api.js`: 74 lines

This is intentionally small. The purpose was to establish a safe module boundary, not to rapidly shrink `index.js`.

## Verification performed

Static checks:

- `node --check js/admin/ebayListings/api.js` passed.
- `node --check js/admin/ebayListings/index.js` passed.
- VS Code Problems check reported no errors for both modified JS files.
- Import check confirmed `index.js` imports from `./api.js` and no local `SUPABASE_URL`, local `function callEdge`, or local `mergeWorkspaceMetrics` remains in `index.js`.

Local browser smoke check through a temporary static server:

- Page title loaded as `Admin · eBay Listings`.
- Admin nav/footer rendered.
- Products loaded: 60 rows.
- Stats rendered: 60 total, 23 active, 2 draft, 34 not listed.
- Count label rendered: `60 items`.
- Table view rendered with 60 rows.
- Card render path produced 60 cards when toggled.
- Push modal opened from a product action and initialized Quill.
- Edit modal opened from a product action.

Verification limitations:

- Full edit modal data fetch and eBay action execution were not completed in the local browser smoke check because `callEdge(...)` correctly found no active Supabase auth session for Edge Function calls on the local static server and returned `Not authenticated — please refresh the page`.
- Therefore, live execution of create/edit/end/relink/publish Edge Function mutations was not performed in this pass.
- The mutation payload construction was not modified, and all existing eBay action call sites still call `callEdge(...)` with their existing body shapes.

## Behavior intentionally not changed

No changes were made to:

- eBay create item/create offer/publish flow
- eBay edit/revise/save flow
- single listing support
- variant listing support
- variant image sets
- variant quantity controls
- stale eBay link reconciliation decisions
- no-active-match handling
- sold-out/restock handling
- relink and clear stale state actions
- setup panel actions
- import/migration panel actions
- bulk update payloads
- workspace metrics UI
- profit preview
- price reference panel
- listing health scoring
- quick filters
- sales history modal
- Quill/editor behavior
- status/score/profit chips
- table/card templates
- page HTML import path

## Next recommended implementation

Next safe phase:

- Extract pure filter predicate logic into `filters.js`, or
- Extract only delegated action preparation for sales-history-style action handling, without changing action behavior.

Recommended next prompt:

> Implement Phase 3 only for `js/admin/ebayListings`: create `filters.js`, move only pure product filtering logic out of `applyFilters()`, keep DOM reads and rendering orchestration in `index.js`, preserve all quick filter behavior, then verify search/status/quick filters, table render, card render, and no circular imports.

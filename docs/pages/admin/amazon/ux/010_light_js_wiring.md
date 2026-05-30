# Light JS Wiring (Phase 2A)

## Scope

Phase 2A adds **frontend-only** behavior to the Amazon Listings admin page. No Amazon SP-API, Supabase, edge functions, or save/submit/export/sync logic is included.

## What Is Wired

| Feature | Module | Behavior |
|---------|--------|----------|
| View tabs | `tabs.js` | Switches `#amazonViewSynced`, `#amazonViewReadyToPush`, `#amazonViewNeedsMapping`, `#amazonViewDraftsIssues` |
| Push modal | `modals.js` | Open/close `#amazonPushModal` |
| Mapping modal | `modals.js` | Open/close `#amazonMappingModal` |
| Row action menu | `rowActions.js` | Floating popover from `#amazonRowActionMenuTemplate` |
| Mock hydration | `mockHydration.js` | Fills modal `data-hydrate` targets from clicked card/button |

## What Remains Disabled

These controls stay disabled with placeholder titles — no handlers:

- `sync-amazon`
- `export-listings`
- `save-amazon-draft`
- `preview-amazon-issues`
- `submit-amazon-listing`
- `save-amazon-mapping`
- `review-amazon-mapping`
- `ignore-amazon-listing`
- Search, filters, pagination, table settings

Row menu **items** log `console.info` and close the popover only — no backend actions.

## JS Module Structure

```
js/admin/amazon/
  index.js          — entry; initAdminNav + feature inits
  dom.js            — qs, qsa, show, hide, setExpanded, setHydrateText
  tabs.js           — initAmazonTabs()
  modals.js         — initAmazonModals(hydration), closeAmazonModals()
  rowActions.js     — initAmazonRowActions()
  mockHydration.js  — initAmazonMockHydration()
```

Entry file remains `index.js`, loaded by `pages/admin/amazon.html`.

## Tab Switching

- Tab buttons: `[data-view]` inside `#amazonViewTabs`
- Panels: `[data-amazon-view-panel]`
- Default view: `synced`
- Updates: `hidden` class, `aria-selected`, `tabindex`, active Tailwind tab styles
- Filters live inside `#amazonViewSynced` — hidden automatically on other tabs

## Modal Open / Close

**Opens push modal:**

- `push-kk-product` (header)
- `push-product-to-amazon` (Ready to Push cards)
- `create-amazon-draft` (same modal, title changes to “Create Amazon Draft”)

**Opens mapping modal:**

- `import-map-existing` (header)
- `map-existing-listing` (Needs Mapping cards)

**Close:**

- `close-push-modal`, `close-mapping-modal`
- Escape key
- Backdrop / outside-dialog click
- Body scroll locked while open; focus moves to modal title

## Row Action Popover

- Trigger: `[data-action="row-menu"]` with `data-status`
- Template variant: `[data-menu-status="active|low_stock|out_of_stock|draft|issue"]`
- Single floating `#amazonRowActionPopover` at a time
- `aria-expanded` on trigger
- Closes on: Escape, outside click, scroll, another row menu click, modal open

## Mock Hydration

**Push modal** (`data-hydrate`):

- `push-title`, `push-sku`, `push-price`, `push-stock`, `push-readiness`
- `push-review-product`, `push-review-price-qty`, `push-review-status`

Reads from nearest `<article>` card or button `data-*` attributes. Header “Push KK Product” uses default Cat Ear Beanie mock.

**Mapping modal** (`data-hydrate`):

- `mapping-title`, `mapping-asin`, `mapping-amazon-sku`, `mapping-status`
- `mapping-suggested-name`, `mapping-suggested-sku`, `mapping-confidence`

Reads from Needs Mapping card on click.

## Explicit Non-Goals

- No API calls
- No Supabase reads/writes
- No real draft save, mapping save, sync, or export
- No filter/search/pagination logic

## Next Phase (2B+)

- Supabase data loads per view
- Enable sync/export after backend exists
- Wire modal save/submit to SP-API or edge functions
- Real row menu actions (edit, sync SKU, view on Amazon)

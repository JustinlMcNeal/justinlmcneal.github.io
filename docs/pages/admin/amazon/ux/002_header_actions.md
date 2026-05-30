# Header & Action Buttons

## Page Title

**Amazon Listings**

Displayed as the primary `h1` inside the admin header card, with the standard Karry Kraze admin kicker badge (`Admin Panel`).

## Subtitle / Description

> Manage Amazon products, inventory, pricing, and listing health.

Sets context: this page is about operational listing management, not order fulfillment or accounting.

## Main Actions (Phase 1B)

Four actions appear in the page header, with visual priority:

| Button | `data-action` | Priority | Current state | Future behavior |
|--------|---------------|----------|---------------|-----------------|
| **Sync Amazon** | `sync-amazon` | Primary (filled black) | Disabled placeholder | Triggers full or incremental SP-API sync |
| **Push KK Product** | `push-kk-product` | Secondary | Disabled placeholder | Opens `#amazonPushModal` to prepare a KK product for Amazon |
| **Import / Map Existing** | `import-map-existing` | Secondary | Disabled placeholder | Opens `#amazonMappingModal` to link Seller Central listings to KK products |
| **Export** | `export-listings` | Tertiary (lighter border) | Disabled placeholder | Downloads filtered listing data as CSV |

## Helper Copy

Below the action buttons:

> Existing Seller Central listings can be mapped later; new KK products can be prepared for Amazon from here.

Explains the two main future workflows without implying delete/recreate.

## Visual Treatment

- Karry Kraze brand: black borders (`border-4` on primary/secondary), uppercase bold labels
- **Sync Amazon** uses filled black (primary action)
- **Push KK Product** and **Import / Map Existing** use white background with black border
- **Export** uses `border-2` (tertiary weight)
- Icons: inline SVG — no external icon library required

## Placeholder Behavior (Current)

- All buttons use `type="button"`, `disabled`, and `aria-disabled="true"`
- `cursor-not-allowed` and reduced opacity communicate non-interactive state
- `title` attributes explain “Coming soon” for hover tooltips

## Future Wiring Notes

When enabling actions:

1. Remove `disabled` after auth + API connection checks pass
2. Bind click handlers via module JS (no inline handlers)
3. **Sync Amazon** should disable itself during sync and show `#amazonStateSyncing`
4. **Push KK Product** opens `#amazonPushModal` (see `008_actions_and_push_flow.md`)
5. **Import / Map Existing** opens `#amazonMappingModal`
6. **Export** should respect current view tab and filter state

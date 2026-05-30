# Empty, Loading & Error States

## Overview

Placeholder UI blocks are defined after `#amazonListingsContent` in `amazon.html`. All are **hidden by default** via Tailwind `hidden` and `aria-hidden="true"`. Phase 2 JS will hide `#amazonListingsContent` and show the appropriate state panel.

State headings use `h2` (the page keeps a single visible `h1`). Loading and syncing panels use `aria-live="polite"`.

## States

### Loading — `#amazonStateLoading`

- **When:** Initial page load or full table refresh before data arrives
- **UI:** Spinner, “Loading listings…”, subtext about Seller Central
- **Behavior:** Hide stats/table; show centered panel

### Empty — `#amazonStateEmpty`

- **When:** Amazon connected but zero listings mapped
- **UI:** Package emoji, headline, CTA to Sync Amazon
- **Behavior:** Primary path for first-time setup after connection

### Error — `#amazonStateError`

- **When:** Fetch/sync failed unexpectedly (network, 500, parse error)
- **UI:** Red-accent border, Retry button (`data-action="retry-load"`)
- **Behavior:** Log error; allow retry without full page reload

### No Search Results — `#amazonStateNoResults`

- **When:** Filters/search active but zero matches
- **UI:** Neutral message to adjust filters
- **Behavior:** Keep toolbar visible; hide table body only

### API Disconnected — `#amazonStateDisconnected`

- **When:** Missing/expired Amazon credentials or revoked access
- **UI:** Amber border, Connect Amazon CTA (`data-action="connect-amazon"`)
- **Behavior:** Disable sync/actions until reconnected

### Syncing — `#amazonStateSyncing`

- **When:** Manual or scheduled sync in progress
- **UI:** Peach-tinted banner (KK brand colors)
- **Behavior:** Non-blocking banner above table; disable Sync button

## Implementation Notes (Future)

Suggested state machine:

```
disconnected → loading → (empty | populated)
populated → syncing → populated
populated → error
populated + filters → no-results
```

Toggle pattern:

```js
// Pseudocode — not implemented in Phase 1
showState('loading'); // hides #amazonListingsContent, shows #amazonStateLoading
```

HTML placeholders use `data-state` attributes for consistent querying.

## Accessibility

When showing a state panel:

- Move focus to heading or primary action
- Use `aria-live="polite"` on status regions
- Ensure loading spinner has accessible name

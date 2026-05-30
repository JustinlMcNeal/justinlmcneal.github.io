# Stats Cards

## Overview

Four metric cards sit below the page header in a responsive grid (`2×2` on mobile, `4×1` on large screens). Each card includes an icon, main number, label, and helper text.

## Cards

| Card | Element | Placeholder value | Helper text |
|------|---------|-------------------|-------------|
| **Total Listings** | `[data-stat="total"]` | **842** | All SKUs synced to Amazon |
| **Active** | `[data-stat="active"]` | **612** | Buyable on Amazon.com |
| **Low Stock** | `[data-stat="low-stock"]` | **68** | At or below reorder threshold |
| **Issues** | `[data-stat="issues"]` | **23** | Needs review or suppression fix |

Values are stored in `[data-value]` attributes on the number element for future JS updates.

## Visual Design

- White card, soft border, rounded corners (`rounded-xl`)
- Subtle hover shadow
- Icon in tinted rounded square (neutral, green, amber, red by severity)
- Large bold number; uppercase tracked label; muted helper line

## Future Data Source Assumptions

When wired to live data, counts should derive from:

| Metric | Suggested source |
|--------|------------------|
| Total Listings | Count of mapped Amazon SKUs for selected marketplace |
| Active | Listings with Amazon status = buyable / active |
| Low Stock | Inventory ≤ configurable threshold (e.g. 10 units) AND status ≠ draft |
| Issues | Listings with suppression, validation errors, missing ASIN, or sync failures |

Stats should refresh after:

- Manual sync completes
- Filter changes (optional: show global vs filtered counts — default to global)
- Single listing update

Low Stock threshold may eventually be admin-configurable in Settings.

# Filters & Search Toolbar

## Overview

The toolbar lives in a white rounded card between stats and the listings table. It supports finding and narrowing listings before Phase 2 enables live filtering.

## Controls

| Control | ID | Purpose |
|---------|-----|---------|
| Search | `#amazonSearchInput` | Search by product title, ASIN, or SKU |
| Status | `#amazonStatusFilter` | Filter by listing status |
| Category | `#amazonCategoryFilter` | Filter by KK product category |
| Marketplace | `#amazonMarketplaceFilter` | Target Amazon marketplace |
| Inventory | `#amazonInventoryFilter` | In stock / low / out |
| Sort | `#amazonSortFilter` | Sort order for results |
| Table settings | `[data-action="table-settings"]` | Density / column visibility — [`046_table_settings.md`](046_table_settings.md) |

## Search

- Placeholder: *Search by product title, ASIN, or SKU...*
- Debounced client-side search in Phase 2; server-side if dataset is large
- Should match partial ASIN/SKU and title tokens

## Status Filter Options

- All Statuses
- Active
- Low Stock
- Out of Stock
- Draft
- Issue

## Category Filter Options

- All Categories
- Bags, Jewelry, Accessories, Headwear, Keychains (KK taxonomy)

## Marketplace Filter

- Default: **US · Amazon.com**
- Future: CA, MX, and additional marketplaces as Karry Kraze expands

## Inventory Filter

- All Inventory
- In Stock
- Low Stock
- Out of Stock

## Sort Options

- Last Synced (newest) — default
- Title A–Z
- Price (high to low)
- Profit (high to low)
- Inventory (low to high)

## Table Settings

Gear icon `[data-action="table-settings"]` opens `#amazonTableSettingsModal` for row density and column visibility. Preferences persist in localStorage. See [`046_table_settings.md`](046_table_settings.md).

## Current State

Filter controls are live when listings load. Table settings gear is enabled on the Synced tab toolbar.

## Future Behavior

1. Persist last-used **filters** in session or localStorage (table settings already persist)
2. Saved named views (combine filters + column layout)

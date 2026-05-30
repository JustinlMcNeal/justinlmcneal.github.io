# Phase 2V — Synced Tab Search, Filters, Export & Row Actions

**Prior:** [2U bulk requeue + alerts](033_bulk_requeue_and_max_attempt_alerts.md)

Client-side search, filter, sort, and pagination on the Synced tab; CSV export of filtered rows; live row actions for View Details, Sync SKU, and View on Amazon.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Search + filters + sort on loaded rows | Server-side pagination / full catalog search |
| Client pagination (25/50/100 rows) | Edit listing, update inventory, draft actions |
| Export CSV from **filtered** rows | New Amazon write endpoints |
| Row menu delegation (survives re-render) | Profit sort (no live profit data yet) |
| Sync SKU via `single_sku` sync | Scheduled sync cron |

---

## Part A — Data loading

**`liveListings.js`**

- Fetches up to **500** mapped rows from `v_amazon_listing_workspace`
- Holds `allRows` + `queryState` in memory
- `applyQuery()` → filter → sort → paginate → render
- Exposes: `refresh`, `getRowById`, `getFilteredRows`, `setQuery`, `applyQuery`

**`api.js`**

- `fetchAmazonListings({ limit })` cap raised to **500**
- `syncAmazonListingSku(sellerSku)` → `amazon-sync-listings` with `syncType: "single_sku"`

---

## Part B — Query helpers

**`listingsQuery.js`**

| Filter | Behavior |
|--------|----------|
| Search | Title, SKU, ASIN (case-insensitive substring) |
| Status | Exact `listing_status` |
| Category | Keyword match on title / product_type / kk_sku |
| Marketplace | US / CA / MX → marketplace id |
| Inventory | in_stock / low / out |
| Sort | last_synced_desc (default), title_asc, price_desc, inventory_asc |

Profit sort option remains in UI but sorts by last synced (no profit column yet).

---

## Part C — Toolbar wiring

**`listingsToolbar.js`**

- Debounced search input (250ms)
- Filter/sort/rows-per-page `change` → reset to page 1 + `applyQuery()`
- Prev/Next pagination buttons
- Header **Export** → `downloadListingsCsv(getFilteredRows())`

**`pages/admin/amazon.html`**

- Enabled search, filters, sort, rows-per-page, export, prev/next
- Added `#listings-prev-page`, `#listings-next-page`, `#amazonPaginationPageLabel`
- Marketplace filter includes **All Marketplaces**

---

## Part D — Render updates

**`renderListings.js`**

- `updateListingsCounts({ total, filteredTotal, page })` — tab count uses total synced; table label shows filtered vs total when different
- `updatePaginationControls(pageResult)` — enables/disables prev/next, updates page label
- Row menu buttons include `data-asin`, `data-seller-sku`, `data-marketplace-id`

---

## Part E — Row actions

**`rowActions.js`**

- Document-level delegation on `[data-action="row-menu"]` (menus work after table re-render)
- **View Details** → toast with `formatListingSummary(row)`
- **View on Amazon** → opens `amazonProductUrl(marketplaceId, asin)` in new tab
- **Sync SKU** → `syncAmazonListingSku` + refresh listings on success
- Other menu items → “coming soon” toast

Requires Amazon connected (`getAuthState`) for Sync SKU.

---

## Part F — CSV export

**`listingsExport.js`**

- `buildListingsCsv` / `downloadListingsCsv`
- `amazonProductUrl` — US/CA/MX domain map
- Exports all **filtered** rows (not just current page)

Columns: Title, ASIN, Seller SKU, KK SKU, Price, Currency, Inventory, Status, Marketplace, Last Synced.

---

## Files touched

| File | Change |
|------|--------|
| `js/admin/amazon/liveListings.js` | Query state + pagination pipeline |
| `js/admin/amazon/listingsQuery.js` | Filter/sort/paginate helpers |
| `js/admin/amazon/listingsToolbar.js` | Toolbar event wiring |
| `js/admin/amazon/listingsExport.js` | CSV + Amazon URL helpers |
| `js/admin/amazon/renderListings.js` | Counts, pagination, row data attrs |
| `js/admin/amazon/rowActions.js` | Delegation + live actions |
| `js/admin/amazon/api.js` | 500-row fetch + single SKU sync |
| `js/admin/amazon/index.js` | Wire toolbar + row action deps |
| `pages/admin/amazon.html` | Enable controls |

---

## Manual test checklist

1. Load Synced tab — up to 500 rows fetch; stats cards update
2. Search by SKU/ASIN/title — table filters; empty state shows `#amazonStateNoResults`
3. Combine status + marketplace filters — counts show “X shown · Y synced”
4. Change rows per page — pagination summary updates
5. Export — CSV contains all filtered rows, not just visible page
6. Row menu after filter change — Actions ▾ still opens menu
7. View Details — opens listing health modal ([5E](044_listing_health_dashboard.md))
8. View on Amazon — correct domain for marketplace
9. Sync SKU (connected) — single SKU sync + table refresh

---

## Deploy

No new edge functions or migrations. Frontend-only deploy.

Existing sync function already supports `single_sku`:

```bash
# Only if not already deployed
supabase functions deploy amazon-sync-listings
```

---

## Next suggested phase

Superseded by later Synced tab work — see [5E listing health](044_listing_health_dashboard.md), [5C price mismatch](042_price_mismatch_highlights.md), [5D inventory mismatch](043_inventory_mismatch_highlights.md).

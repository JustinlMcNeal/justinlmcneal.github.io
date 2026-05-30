# Phase 6C — Table Settings (Density & Column Visibility)

**Prior:** [5F FBA/FBM inventory columns](045_fba_fbm_inventory_columns.md)

Let admins customize the **Synced listings table** layout: row density and which optional columns appear. Preferences persist in **localStorage** per browser — no server write.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Comfortable vs compact row density | Per-user server-side saved views |
| Show/hide optional columns | Drag-to-reorder columns |
| `#amazonTableSettingsModal` gear button | Mobile card layout editor (fields follow column toggles) |
| localStorage key `kk-amazon-listings-table-settings-v1` | Export template presets (→ future) |

---

## Part A — UI

**Gear button:** `[data-action="table-settings"]` in listings toolbar (enabled).

**Modal:** `#amazonTableSettingsModal`

| Control | ID | Behavior |
|---------|-----|----------|
| Comfortable density | `#amazonTableDensityComfortable` | Default padding + thumbnails |
| Compact density | `#amazonTableDensityCompact` | Tighter rows via `.amazon-table-density-compact` |
| Column checkboxes | `#amazonTableColumnList` | Rendered from column registry |
| Reset defaults | `[data-action="reset-table-settings"]` | Clears saved prefs |
| Apply | `[data-action="apply-table-settings"]` | Saves + applies immediately |

**Locked columns (always visible):** Select, Product, Actions.

---

## Part B — Column registry

**Module:** `js/admin/amazon/tableSettings.js` — `AMAZON_LISTING_TABLE_COLUMNS`

| Column ID | Label | Default | Breakpoint |
|-----------|-------|---------|------------|
| `asin` | ASIN | visible | — |
| `sku` | SKU | visible | — |
| `price` | Price | visible | — |
| `amazonFee` | Amazon Fee | visible | xl |
| `profit` | Est. Profit | visible | — |
| `fulfillment` | Fulfillment | visible | xl |
| `inventory` | Inventory | visible | — |
| `fbaReserved` | FBA Reserved | **hidden** | 2xl (force-show when enabled) |
| `fbaInbound` | FBA Inbound | **hidden** | 2xl (force-show when enabled) |
| `status` | Status | visible | — |
| `lastSynced` | Last Synced | visible | xl |

Breakpoint columns keep responsive behavior by default. Opt-in columns (`fbaReserved`, `fbaInbound`) use `amazon-col-force-show` when enabled so they appear at desktop table width.

---

## Part C — Implementation

| File | Change |
|------|--------|
| `js/admin/amazon/tableSettings.js` | Settings load/save, modal, apply |
| `js/admin/amazon/renderListings.js` | `data-amazon-col` on cells; `data-amazon-mobile-col` on card fields; apply after render |
| `js/admin/amazon/modals.js` | Table settings in close/Escape stack |
| `js/admin/amazon/index.js` | `initAmazonTableSettings()` |
| `css/pages/admin/amazon.css` | Density + column visibility classes |
| `pages/admin/amazon.html` | Modal markup; `data-amazon-col` on `<th>` |

### CSS classes

- `.amazon-table-density-compact` — reduced cell padding + smaller product thumb
- `.amazon-col-hidden` — user-hidden column
- `.amazon-col-force-show` — overrides xl/2xl `hidden` for opt-in columns

---

## Verification

1. Gear opens modal; Apply saves and persists after reload
2. Hiding **Amazon Fee** removes fee column + mobile card field
3. Enabling **FBA Reserved** shows column at lg+ table width
4. Compact density tightens rows without breaking row actions
5. Reset restores defaults (FBA cols off, comfortable density)
6. Opening patch/push modals closes table settings modal

---

## Next

**6D** — Category & image readiness gates polish, or **6F** activity history.

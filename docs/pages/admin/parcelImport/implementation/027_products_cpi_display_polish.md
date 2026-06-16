# Phase 27 — Products CPI Display Polish (Complete)

**Status:** Done  
**Scope:** Display/calculation/testing only — no CPI writes, no order view changes.

---

## Files changed

| File | Change |
|------|--------|
| `js/admin/products/productMargin.js` | `formatVariantMarginRange`, `formatCardMarginHtml`, `formatCardCpiHint`, `renderModalProductProfitPanel` |
| `js/admin/products/modalEditor.js` | Profit panel uses landed CPI default estimate (replaces legacy `calculateProfitProjections`) |
| `js/admin/products/renderTable.js` | Desktop/mobile cards use shared card margin + CPI hint helpers |
| `js/admin/products/modalRows.js` | `data-cpi-source` attribute on variant CPI labels |
| `scripts/verify-products-cpi-browser.mjs` | **New** Playwright browser verification |
| `docs/.../027_products_cpi_display_polish.md` | This doc |

**Unchanged:** Parcel approval/receive, order views, cost write paths, stock.

---

## Modal product profit panel result

- Header: **Default product estimate**
- Uses canonical product fallback: `unit_cost` + est. inbound supplier ship + est. outbound customer ship
- Shows CPI breakdown grid, profit @ price, margin badge
- When variants have `unit_cost_override_cents`:
  - Amber note: *Variant CPI overrides exist — see variant rows for variant-specific margins*
  - Min/max variant margin range when computable
  - Override count
- Variant rows unchanged: landed CPI, margin badge, source label (`Variant CPI` / `Product CPI` / `Missing CPI`)

---

## Card view result

| Surface | Display |
|---------|---------|
| Mobile cards | Default margin badge + **default** label + `Var min–max%` + `N variant CPI` when overrides exist |
| Desktop cards | Same margin block + CPI override count line |
| Table | Unchanged from phase 25–26 (default + Var range) |

Shared helpers avoid duplicated margin math.

---

## Browser test result

```text
node scripts/verify-products-cpi-browser.mjs  ✓
  ✓ Static variant range utility (mocked 70¢ override)
  ✓ Products page loads (magic-link auth)
  ✓ CPI column/header present
  ✓ Margin tooltip on th[data-sort="margin"]
  ✓ Table shows default margin content
  ✓ Modal opens with "Default product estimate"
  ✓ data-product-profit-panel="default-estimate"
  ✓ Variant rows: CPI source labels + margin badges
  ✓ No console errors
```

Also re-run:

```text
node scripts/verify-products-margin-cpi.mjs           ✓
node scripts/verify-cpi-products-orders.mjs           ✓
node scripts/verify-cpi-order-summary-views.mjs       ✓
```

Live DB test variant still has `unit_cost_override_cents = null`; override range verified via utility mock.

---

## Safety grep

Changed files contain **no**:

- `update` to `products.unit_cost`
- `update` to `product_variants.unit_cost_override_cents`
- stock / `stock_ledger` writes
- `approve_parcel_import_cpi` / `receive_parcel_import_inventory` RPC calls

`unit_cost_override_cents` appears only as **read** in margin/display resolution.

---

## Remaining issues

1. **Card view on saved “cards” layout** — browser test forces table view; card margin polish is implemented but not browser-asserted separately from table.
2. **Negative margins** on low-price / high-ship SKUs remain possible with free-shipping formula — expected, not a CPI bug.
3. **Modal profit panel** does not live-update variant override note when only form fields change (override list comes from `state.editing.variants` loaded at open) — acceptable for read-only CPI display.
4. **package.json `"type": "module"`** — Node emits MODULE_TYPELESS_PACKAGE_JSON warnings during verify scripts; cosmetic only.

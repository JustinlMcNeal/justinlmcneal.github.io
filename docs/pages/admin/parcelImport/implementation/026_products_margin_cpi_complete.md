# Phase 26 — Products Margin / Landed CPI (Complete)

**Status:** Done  
**Scope:** Display/calculation only — no CPI writes, no order view changes.

---

## Files inspected

- `js/admin/products/renderTable.js`
- `js/admin/products/modalRows.js`
- `js/admin/products/modalEditor.js`
- `js/admin/pStorage/profitCalc.js`
- `js/shared/landedCpi.js`
- `pages/admin/products.html`

---

## Files changed

| File | Change |
|------|--------|
| `js/shared/landedCpi.js` | `resolveProductsMarginCpiUsd`, `calculateMarginFromCpi`, `marginHealthFromPercent`, `formatMarginBadgeHtml` |
| `js/admin/products/productMargin.js` | **New** — variant/product margin compute + table cell renderer |
| `js/admin/products/renderTable.js` | Table, mobile, card margins use landed CPI; sort fixed |
| `js/admin/products/modalRows.js` | Per-variant margin badge + CPI source |
| `js/admin/products/modalEditor.js` | Pass `_productPrice`, `_productWeightG` into variant rows |
| `pages/admin/products.html` | Margin column tooltip |
| `scripts/verify-products-margin-cpi.mjs` | **New** verification script |
| `docs/.../025_products_margin_cpi_plan.md` | Plan |
| `docs/.../026_products_margin_cpi_complete.md` | This doc |

**Unchanged:** `profitCalc.js` (modal product profit panel), parcel approval/receive, order views, `api.js` cost write paths.

---

## Product margin rule

- **Inbound CPI:** `products.unit_cost` + estimated supplier ship (from `weight_g`, bulk qty 30).
- **Outbound:** existing Pirate Ship customer-ship estimate (free-shipping scenario).
- **Formula:** `margin% = (price - inboundCpi - outboundShip) / price × 100`
- **Table label:** badge + **default** sublabel; when variants have overrides, **Var min–max%** range shown separately.

---

## Variant margin rule

- **Inbound CPI:** `unit_cost_override_cents / 100` when set (landed, no extra supplier ship).
- **Fallback:** product `unit_cost` + estimated supplier ship.
- **Modal row:** Landed CPI, margin badge, source (`Variant CPI` / `Product CPI` / `Missing CPI`) — read-only.

---

## UI result

| Surface | Behavior |
|---------|----------|
| Table margin column | Default product margin + optional `Var 42–58%` |
| Mobile / desktop cards | Same badges |
| Margin sort | Uses variant max when overrides exist, else product default |
| Variant modal rows | CPI + margin + source per row |

---

## Tests passed

```text
node scripts/verify-products-margin-cpi.mjs
  ✓ Variant 70¢ override → inbound CPI $0.70
  ✓ Product fallback adds supplier ship
  ✓ Mock variant margin source = variant
  ✓ Variant range on product with 1 override
  ✓ products.html margin + CPI columns
  ✓ Safety grep on changed files
  ✓ scripts/verify-cpi-products-orders.mjs
  ✓ scripts/verify-cpi-order-summary-views.mjs
```

Live DB test variant `a76174c5-…` has `unit_cost_override_cents = null`; override math tested via mocked rows only.

---

## Safety grep

Changed files contain **no**:

- `update` to `products.unit_cost`
- `update` to `product_variants.unit_cost_override_cents`
- stock / `stock_ledger` writes
- `approve_parcel_import_cpi` / `receive_parcel_import_inventory` RPC calls

`unit_cost_override_cents` appears only as **read** in selects and margin resolution.

---

## Remaining issues

1. **Modal product profit panel** (`modalEditor.js`) still uses legacy `calculateProfitProjections` — product-level only; variant rows now show correct landed CPI margins.
2. **Negative margins** on low-price test SKUs with high weight-based outbound ship are expected with current free-shipping formula; not a CPI regression.
3. **Card view** does not show variant range line (table + mobile do); acceptable for v1.
4. No live browser E2E in verify script — static/utility checks only.

# Phase 25 — Products Margin / Landed CPI (Plan)

**Status:** Implementation

---

## Current margin formula (pre-change)

`getProfitIndicator` → `calculateProfitProjections` in `profitCalc.js`:

```text
cpiFreeShipping = unit_cost + supplier_ship(weight) + customer_ship(weight)
margin% = (price - cpiFreeShipping) / price × 100
```

- **CPI source:** `products.unit_cost` only (ignores `unit_cost_override_cents`)
- **Inbound ship:** always estimated from `weight_g` via EUB/HK-UPS formula
- **Outbound ship:** Pirate Ship USPS estimate (free-shipping scenario)

---

## Affected UI

| Area | Before |
|------|--------|
| Table margin column | Single badge from `getProfitIndicator` |
| Mobile/card margin | Same |
| Margin sort | Broken path (`cpiPaidShipping.marginPercent` — number not object) |
| Variant modal rows | CPI only; no margin |

---

## Desired formula

Use `js/shared/landedCpi.js` + `productMargin.js`:

**Inbound CPI (margin cost basis):**
| Source | Inbound CPI |
|--------|-------------|
| Variant override | `unit_cost_override_cents / 100` (landed only) |
| Product fallback | `unit_cost + est. supplier ship` |

**Margin (free-shipping estimate, unchanged outbound logic):**
```text
totalCpi = inboundCpi + customer_ship(weight_g)
margin% = (price - totalCpi) / price × 100
```

**Table display:**
- Default margin badge labeled **default** (product CPI path)
- When variants have overrides: **Var 42–58%** range from variant landed CPIs

**Modal variant rows:** Landed CPI + margin badge + source label (read-only)

---

## Files to change

- `js/shared/landedCpi.js` — margin helpers
- `js/admin/products/productMargin.js` — **new** bridge to profitCalc shipping
- `js/admin/products/renderTable.js` — table/card/mobile margins
- `js/admin/products/modalRows.js` — variant margin column
- `js/admin/products/modalEditor.js` — pass price/weight into variant rows

**Not changed:** `profitCalc.js` (modal product profit panel still uses it), parcel/order views, cost writes.

---

## Test plan

`scripts/verify-products-margin-cpi.mjs`:
1. Utility: 70¢ override → margin uses $0.70 inbound
2. Product fallback adds supplier ship
3. Variant range helper
4. Safety grep
5. Re-run `verify-cpi-products-orders.mjs` + `verify-cpi-order-summary-views.mjs`

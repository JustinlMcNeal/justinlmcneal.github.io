# Phase 23 — Reflect Landed CPI in Order Summary Views (Plan)

**Status:** Implementation  
**Depends on:** Phase 21–22 (`js/shared/landedCpi.js`, workspace modal CPI)

---

## Current view formulas (pre-migration)

### `v_order_financials` (KK / default list profit)
```sql
product_cost_total = SUM(products.unit_cost * qty)   -- no variant join
profit_cents = total_paid - refund - product_cost - label
```

### `v_ebay_order_profit.item_costs`
```sql
(unit_cost + EUB/HK-UPS supplier ship formula) * qty   -- no variant override
```

### `v_amazon_order_profit.item_costs`
```sql
unit_cost * qty   -- no supplier ship, no variant override
```

### `v_order_summary_plus`
```sql
profit_cents = COALESCE(ebay_net_profit, amazon_net_profit, v_order_financials.profit_cents)
```

---

## JS consumers

| File | Usage |
|------|--------|
| `js/admin/lineItemsOrders/api.js` | `fetchOrderSummaryPage`, `fetchOrderKpis` → `v_order_summary_plus` |
| `js/admin/lineItemsOrders/renderTable.js` | `row.profit_cents`, channel overrides via finance maps |
| `js/admin/lineItemsOrders/index.js` | KPI bar `kpiProfit` |
| `supabase/migrations/20260222_fix_summary_plus_and_kpis.sql` | `rpc_order_kpis` sums `v_order_financials.profit_cents` |

Workspace modal already uses `landedCpi.js` (Phase 21). **List + KPI lagged** because views ignored `unit_cost_override_cents`.

---

## Exact issue

1. Variant-level parcel landed CPI not in SQL cost CTEs.
2. eBay/Amazon net profit subtract wrong (too high) product cost when variant override exists.
3. KK list profit used `unit_cost` only (no supplier ship) while modal added supplier ship — inconsistent even before parcel imports.

---

## Proposed approach

1. Add SQL helpers mirroring `landedCpi.js`:
   - `order_supplier_ship_per_unit_usd(weight_g)`
   - `order_line_cpi_usd(unit_cost, variant_override_cents, weight_g)`
2. Join `product_variants` on `products.id` + `lower(trim(option_value)) = lower(trim(line_items_raw.variant))`.
3. Recreate `v_order_financials`, `v_ebay_order_profit`, `v_amazon_order_profit`, `v_order_summary_plus`.
4. No data mutations; views only.

### Canonical rule
| Source | Per-unit CPI |
|--------|----------------|
| Variant override set | `unit_cost_override_cents / 100` (landed only) |
| Product fallback | `unit_cost + supplier_ship_per_unit(weight_g)` |
| Missing | `0` |

---

## Test plan

1. `scripts/verify-cpi-order-summary-views.mjs`
2. SQL function spot checks (70¢ override → $0.70).
3. Line-level query: variant override vs product fallback.
4. `v_order_summary_plus.profit_cents` readable after migration.
5. Safety grep: no UPDATE products/variants/stock in changed files.

---

## Risks

| Risk | Mitigation |
|------|------------|
| KK list profit changes (adds supplier ship on product fallback) | Aligns with workspace modal; documented |
| Variant text mismatch (`Black` vs `black`) | `lower(trim())` join |
| Multiple variant rows same option_value | Rare; same as JS |
| Analytics views depending on old cost | Out of scope; same CTE pattern if needed later |

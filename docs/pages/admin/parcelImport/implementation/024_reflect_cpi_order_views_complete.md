# Phase 24 — Reflect Landed CPI in Order Summary Views (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Migration:** `supabase/migrations/20260822_update_order_summary_landed_cpi.sql` (applied to linked Supabase)

---

## Summary

Order list profit and KPI totals now use the same landed CPI rules as the workspace modal and `js/shared/landedCpi.js`, implemented in SQL views.

---

## Views changed

| View | Change |
|------|--------|
| `order_line_cpi_usd()` | **New function** — variant override or product + supplier ship |
| `order_supplier_ship_per_unit_usd()` | **New function** — profitCalc EUB/HK-UPS formula |
| `v_order_financials` | Line costs join `product_variants`; use `order_line_cpi_usd` |
| `v_ebay_order_profit` | `item_costs` CTE uses landed CPI + variant join |
| `v_amazon_order_profit` | `item_costs` CTE uses landed CPI + variant join |
| `v_order_summary_plus` | Recreated (same profit precedence: eBay → Amazon → financials) |

No data mutations. No product/variant/stock writes.

---

## Formula

```sql
order_line_cpi_usd(unit_cost, variant_override_cents, weight_g) =
  CASE
    WHEN variant_override_cents IS NOT NULL
      THEN variant_override_cents / 100.0          -- Variant CPI (landed only)
    WHEN unit_cost > 0
      THEN unit_cost + order_supplier_ship_per_unit_usd(weight_g)  -- Product CPI
    ELSE 0
  END
```

Variant join:
```sql
LEFT JOIN product_variants pv
  ON pv.product_id = p.id
 AND NULLIF(trim(li.variant), '') IS NOT NULL
 AND lower(trim(pv.option_value)) = lower(trim(li.variant))
```

Profit (KK / `v_order_financials`):
```text
profit = total_paid - refund - SUM(line_cpi * qty) - label
```

eBay / Amazon net profit subtract the same `product_cost_cents` from marketplace earnings.

---

## Order list / KPI result

- **Table profit column** — reads `v_order_summary_plus.profit_cents` (now variant-aware).
- **KPI Profit** — `fetchOrderKpis` sums filtered `profit_cents` from same view.
- **Tooltips** — Profit KPI + table header note variant landed CPI when available.
- **Product fallback** — `v_order_financials` now includes estimated China supplier ship (aligns with workspace modal; was `unit_cost` only before).

---

## Test results

```bash
node scripts/verify-cpi-order-summary-views.mjs
node scripts/verify-cpi-products-orders.mjs
```

| Check | Result |
|-------|--------|
| `order_line_cpi_usd(0.47, 70, 80)` → 0.70 | Pass |
| Product fallback > unit_cost (supplier ship added) | Pass |
| All three views reference `unit_cost_override_cents` + `order_line_cpi_usd` | Pass |
| Live sample: 1 order line with variant override validates CPI | Pass |
| `v_order_summary_plus` returns profit rows | Pass |
| Safety grep | Pass |

---

## Safety grep

Changed files checked — no:
- `UPDATE products` / `UPDATE product_variants`
- stock / `stock_ledger` writes
- parcel approve / receive RPC calls

Allowed: `CREATE OR REPLACE VIEW`, `CREATE OR REPLACE FUNCTION`, SELECT joins.

---

## Remaining issues

1. **`rpc_order_kpis`** still sums `v_order_financials.profit_cents` in RPC path; JS KPI overrides with filtered `v_order_summary_plus` sum — eBay/Amazon complete orders use channel profit in list via `renderTable.js` finance maps, not in RPC base object.
2. **Analytics aggregate** (`supabase/functions/analytics-aggregate`) may still use old view shapes if cached — not updated in this phase.
3. **Test variant `a76174c5-…`** override is `null` in DB; one other live order line has a variant override (verified in SQL sample).
4. **Margin on Products page** still uses weight formula, not SQL views.

---

## Plan reference

`023_reflect_cpi_order_views_plan.md`

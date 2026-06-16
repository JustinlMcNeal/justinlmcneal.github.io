# Phase 22 — Reflect Parcel CPI on Products & Orders (Complete)

**Status:** Complete  
**Date:** 2026-06-09

---

## Summary

Landed CPI from approved Parcel Imports now surfaces on the admin **Products** and **Orders** (`lineItemsOrders`) pages via read-only resolution of `product_variants.unit_cost_override_cents` and `products.unit_cost`.

No approval, receive, or cost-write logic was changed.

---

## Cost source rule

```
Variant:
  1. unit_cost_override_cents / 100  → Landed CPI (Variant CPI)
  2. else products.unit_cost           → Product CPI
  3. else —                            → Missing CPI

Orders line cost:
  Variant CPI  → landed CPI × qty (no estimated China supplier ship)
  Product CPI  → (unit_cost + est. supplier ship) × qty  [legacy]
  Missing      → $0
```

Canonical module: `js/shared/landedCpi.js`

---

## Files changed

| File | Change |
|------|--------|
| `js/shared/landedCpi.js` | **New** — resolve/format landed CPI + order line cost |
| `js/admin/products/api.js` | Fetch variant `unit_cost_override_cents` with products |
| `js/admin/products/renderTable.js` | CPI column (product default + variant override count) |
| `js/admin/products/modalRows.js` | Read-only per-variant Landed CPI + source label |
| `js/admin/products/modalEditor.js` | Pass product CPI into variant rows |
| `pages/admin/products.html` | CPI column header; label “Product CPI ($)” |
| `js/admin/lineItemsOrders/api.js` | Variant-aware line CPI; no double-count supplier ship |
| `js/admin/lineItemsOrders/workspaceOverview.js` | Landed CPI + cost source per line |
| `js/admin/lineItemsOrders/workspaceFinancials.js` | “Landed CPI” labels (KK / eBay / Amazon) |
| `scripts/verify-cpi-products-orders.mjs` | **New** — utility + DB + safety tests |
| `docs/.../021_reflect_cpi_products_orders_plan.md` | Plan |

---

## Products page result

- Table **CPI** column shows product `unit_cost` as `$X.XX`.
- Badge **“N variant CPI”** when any active variant has `unit_cost_override_cents`.
- Edit modal: each variant row shows read-only **Landed CPI** and **Variant CPI** / **Product CPI** / **Missing CPI**.
- Product CPI field relabeled; still editable on save (existing behavior). Variant override is **not** written from this page.

---

## Orders page result

- `fetchOrderDetails` joins `unit_cost_override_cents` on variants (match `product_id` code + `variant` option_value).
- Overview lines show **Landed CPI**, line total, and **cost source** badge.
- Financials tab uses **Landed CPI** label; outbound USPS label remains separate.
- Variant mapped lines use parcel landed CPI only (no `profitCalc` supplier-ship add-on).

---

## Test results

```bash
node scripts/verify-cpi-products-orders.mjs
```

| Check | Result |
|-------|--------|
| Utility: variant 70¢ → $0.70, 2×qty = 140¢ | Pass |
| Utility: product fallback adds supplier ship | Pass |
| DB: test variant `a76174c5-…` resolves (override null → product $0.47) | Pass |
| Mock 70¢ variant line math | Pass |
| Safety grep (no cost/stock/RPC writes in changed files) | Pass |

**Note:** Test variant override is currently `null` in DB (cleared during parcel test cleanup). Utility tests confirm `$0.70` math when override is set; re-approve a parcel import to repopulate live override.

---

## Safety grep

Changed JS files checked for:

- `products.unit_cost` updates from new code — **none added** (existing product save unchanged)
- `unit_cost_override_cents` writes — **none**
- `stock_ledger` / stock updates — **none**
- `approve_parcel_import_cpi` / `receive_parcel_import_inventory` — **none**

---

## Remaining issues

1. **List/KPI profit** (`v_order_summary_plus`, eBay/Amazon profit views) still use product-level `unit_cost` only — modal/workspace CPI is correct; table profit column may lag until a future SQL phase.
2. **Amazon synced profit** may still use view `amazon_net_profit_cents` (old cost basis) when finance is complete.
3. **Products margin badges** still use `profitCalc` weight formula, not variant landed CPI.
4. **`inventory_summary`** panel likely still product-level cost × stock.
5. Re-run parcel approve on keychain variant to restore `unit_cost_override_cents = 70` for live UI verification.

---

## Plan reference

`021_reflect_cpi_products_orders_plan.md`

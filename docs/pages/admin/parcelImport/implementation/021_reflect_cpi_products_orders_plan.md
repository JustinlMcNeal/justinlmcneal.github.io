# Phase 21 — Reflect Parcel CPI on Products & Orders (Plan)

**Status:** Implementation  
**Pages:** `pages/admin/products.html`, `pages/admin/lineItemsOrders.html` (admin Orders)

---

## Files inspected

| Area | Paths |
|------|--------|
| Products page | `pages/admin/products.html` |
| Products JS | `js/admin/products/index.js`, `api.js`, `renderTable.js`, `modalEditor.js`, `modalRows.js` |
| Orders page | `pages/admin/lineItemsOrders.html` |
| Orders JS | `js/admin/lineItemsOrders/api.js`, `workspaceFinancials.js`, `workspaceOverview.js`, `renderTable.js` |
| Shared | `js/shared/productContract.js`, `js/admin/pStorage/profitCalc.js` |
| Parcel writes (read-only reference) | `supabase/migrations/20260820_approve_parcel_import_cpi.sql` |

---

## Current cost source

### Products page
- **Display:** Margin badge only; uses `products.unit_cost` + `profitCalc.js` weight-based shipping estimates.
- **Variants:** `fetchProductFull` loads `product_variants.*` but UI ignores `unit_cost_override_cents`.
- **Writes:** `upsertProduct({ unit_cost })` only; variants never touch override cents.

### Orders page (`lineItemsOrders`)
- **Per-line CPI:** `products.unit_cost + getSupplierShippingDetails(weight_g)` — estimated China supplier ship.
- **Variant join:** Images only (`productCode|variant` → `preview_image_url`); no cost from variants.
- **Profit:** Modal recomputes `product_cpi_cents` in JS; list/KPI uses `v_order_summary_plus` (product-level `unit_cost` only).

---

## Desired cost source (canonical)

```
Variant row:
  1. unit_cost_override_cents / 100  → Landed CPI (Parcel Imports)
  2. else products.unit_cost
  3. else — / missing

Product-only:
  products.unit_cost

Orders line cost:
  Variant CPI present → landed CPI × qty (no extra supplier-ship estimate)
  Product CPI only    → (unit_cost + estimated supplier ship) × qty  [legacy]
  Missing             → 0 (existing fallback)
```

Label: **Landed CPI** / **CPI** with source badge: Variant CPI | Product CPI | Missing CPI.

Outbound USPS label / customer shipping stays separate.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Double-count inbound ship when variant override exists | Drop `getSupplierShippingDetails` add-on when `unit_cost_override_cents` is set |
| List profit (DB views) still uses old `unit_cost` | Phase is read/display in modal + workspace; no SQL migration |
| Amazon modal uses view `amazon_net_profit_cents` when synced | Document as remaining gap; modal line CPI still corrected |
| `upsertVariants` could wipe override if we add cost field | Display read-only only; do not send override in saves |
| Margin badges still use weight formula | Out of scope; CPI column added separately |

---

## Implementation plan

1. Add `js/shared/landedCpi.js` — `resolveLandedCpiUsd`, `resolveOrderLineItemCost`, formatters.
2. **Products:** nested variant fetch; CPI column in table; read-only variant CPI in edit modal.
3. **Orders:** extend product fetch with `unit_cost_override_cents`; resolve per-line CPI in `fetchOrderDetails`; update Overview + Financials labels.
4. **Test:** `scripts/verify-cpi-products-orders.mjs` — DB check + utility tests.
5. **Safety grep** — no cost/stock writes in changed files.
6. **Doc:** `022_reflect_cpi_products_orders_complete.md`.

---

## Out of scope

- SQL view migrations (`v_order_financials`, eBay/Amazon profit views)
- Parcel Imports approval/receive logic
- Browser writes to `products.unit_cost` / `unit_cost_override_cents`
- Inventory summary view recalculation

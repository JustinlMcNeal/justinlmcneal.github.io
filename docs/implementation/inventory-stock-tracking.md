# Inventory & Stock Tracking — Implementation Plan

> Created: March 16, 2026
> Status: 📋 Planning
> Priority: 🔴 HIGH — affects customer experience + business visibility

---

## Overview

Add real-time inventory tracking across the entire site. Currently `product_variants` already has a `stock` column that's saved from admin but **never read or decremented anywhere**. This plan wires it up end-to-end.

### What Changes
| Area | Change |
|------|--------|
| **Admin Products page** | Stock summary per product, low-stock badges |
| **Admin Dashboard** | Inventory fiscal panel — total cost, potential revenue, profit margin |
| **Customer Product page** | Per-variant stock status, dynamic shipping text, out-of-stock UX |
| **Stripe Webhook** | Auto-decrement variant stock on order |
| **Checkout Session** | Validate stock before creating Stripe session |
| **Catalog page** | No changes (per user request) |

### What Already Exists
| Component | Status | Notes |
|-----------|--------|-------|
| `product_variants.stock` column | ✅ Exists | Integer, saved from admin, never used |
| `products.unit_cost` column | ✅ Exists | `NUMERIC(10,2)`, editable in admin |
| `products.price` column | ✅ Exists | Retail price |
| `products.weight_g` column | ✅ Exists | Used for shipping calc |
| Admin variant stock input | ✅ Exists | Number field per variant in modal editor |
| Product page variant fetch | ✅ Exists | `api.js` selects `stock` but rendering ignores it |

---

## Database Changes

### 1. Add product-level stock view (computed from variants)

No new column on `products` — stock lives on variants. Add a **Postgres function** for convenience:

```sql
-- Get total stock for a product (sum of all active variant stocks)
CREATE OR REPLACE FUNCTION get_product_stock(p_id UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(SUM(stock), 0)::INTEGER
  FROM product_variants
  WHERE product_id = p_id AND is_active = true;
$$ LANGUAGE sql STABLE;
```

### 2. Inventory fiscal view (admin dashboard)

```sql
CREATE OR REPLACE VIEW inventory_summary AS
SELECT
  p.id,
  p.name,
  p.code,
  p.price,
  p.unit_cost,
  COALESCE(SUM(pv.stock), 0)::INTEGER AS total_stock,
  -- Fiscal metrics
  COALESCE(SUM(pv.stock), 0) * COALESCE(p.unit_cost, 0) AS inventory_cost,       -- what we paid
  COALESCE(SUM(pv.stock), 0) * COALESCE(p.price, 0)     AS potential_revenue,     -- what we'd get if sold at list
  COALESCE(SUM(pv.stock), 0) * (COALESCE(p.price, 0) - COALESCE(p.unit_cost, 0)) AS potential_profit
FROM products p
LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
WHERE p.is_active = true
GROUP BY p.id, p.name, p.code, p.price, p.unit_cost;
```

### 3. Stock change log (audit trail)

```sql
CREATE TABLE stock_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id   UUID NOT NULL REFERENCES product_variants(id),
  product_id   UUID NOT NULL REFERENCES products(id),
  change       INTEGER NOT NULL,          -- +5 (restock) or -1 (order)
  reason       TEXT NOT NULL,             -- 'order', 'manual_adjust', 'restock', 'correction'
  reference_id TEXT,                       -- order ID, admin user, etc.
  stock_before INTEGER NOT NULL,
  stock_after  INTEGER NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_stock_ledger_variant ON stock_ledger(variant_id);
CREATE INDEX idx_stock_ledger_product ON stock_ledger(product_id);
CREATE INDEX idx_stock_ledger_created ON stock_ledger(created_at DESC);

-- RLS
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON stock_ledger FOR ALL USING (true) WITH CHECK (true);
```

### 4. Low stock threshold setting

```sql
-- Store in existing social_settings table (or a new `app_settings` table)
INSERT INTO social_settings (setting_key, setting_value)
VALUES ('inventory_settings', '{"low_stock_threshold": 3}')
ON CONFLICT (setting_key) DO NOTHING;
```

---

## File Changes

### Phase A: Backend (Edge Functions)

#### A1. `stripe-webhook/index.ts` — Auto-decrement stock on order

**Where:** After line items are written (around line 483), before push notification.

**Logic:**
```
For each line item in the order:
  1. Find variant by product SKU + color/option string
  2. Read current stock
  3. Decrement by quantity ordered
  4. Log to stock_ledger (reason: 'order', reference: order ID)
  5. If new stock <= low_stock_threshold → flag for admin badge
```

**Key detail:** Current `line_items_raw` stores `product_id` (the SKU string like "KK-1001") and `variant` (the color string like "Pink"). Need to query `product_variants` by matching product code + option_value.

```typescript
// --- STOCK DECREMENT ---
for (const item of lineItems) {
  try {
    // Find the variant
    const { data: variant } = await supabase
      .from("product_variants")
      .select("id, stock, product_id")
      .eq("product_id", productIdFromCode)  // need UUID from earlier product lookup
      .eq("option_value", item.variant || item.description)
      .single();

    if (variant) {
      const newStock = Math.max(0, (variant.stock || 0) - item.quantity);
      await supabase
        .from("product_variants")
        .update({ stock: newStock })
        .eq("id", variant.id);

      // Audit log
      await supabase.from("stock_ledger").insert({
        variant_id: variant.id,
        product_id: variant.product_id,
        change: -item.quantity,
        reason: "order",
        reference_id: orderId,
        stock_before: variant.stock || 0,
        stock_after: newStock,
      });
    }
  } catch (err) {
    console.error(`Stock decrement failed for ${item.product_id}:`, err);
    // Non-blocking — order still succeeds even if stock update fails
  }
}
```

**Important:** Stock decrement must be non-blocking. If it fails, the order still goes through. We don't want payment to succeed but customer to get no order because of a stock bug.

#### A2. `create-checkout-session/index.ts` — Stock validation

**Where:** After product weight lookup (around line 191), before creating Stripe session.

**Logic:**
```
For each cart item:
  1. Look up variant stock
  2. If stock = 0 → item is still allowed (back-order, 4-6 week shipping)
  3. If qty requested > stock available and stock > 0 → cap to available stock, warn
  4. Pass stock status through to Stripe metadata for receipt display
```

> **Note:** Per user requirement, out-of-stock items can still be ordered (4-6 week shipping). So this is informational, not a hard block.

### Phase B: Customer-Facing Product Page

#### B1. `js/product/render.js` — Variant swatch stock state

**Current:** `renderVariantSwatches()` renders color buttons with no stock awareness.

**Change:** When rendering each swatch:
- If `variant.stock > 0` → normal swatch (no change)
- If `variant.stock === 0` → add "sold-out" visual state:
  - Diagonal line through swatch (CSS class `variant-sold-out`)
  - Still clickable (back-orderable), but visually distinct

#### B2. `js/product/index.js` — Dynamic shipping text

**Current:** Line ~286 calls `shippingText(product.shipping_status)` which only checks for `"mto"`.

**Change:** When a variant is selected:
```javascript
function getShippingText(variant, product) {
  if (product.shipping_status === "mto") {
    return "⏳ Made to order — ships in 2-4 weeks";
  }
  if (!variant || variant.stock <= 0) {
    return "📦 Back-order — ships in 4-6 weeks";
  }
  return "🚀 In Stock — ships in 1-2 business days";
}
```

**Update shipping text** every time a variant swatch is clicked (already has a swatch click handler).

#### B3. `js/product/index.js` — Stock badge on detail panel

**Add near price display:**
```html
<!-- In stock -->
<span class="inline-block bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full">
  ✓ In Stock
</span>

<!-- Low stock -->
<span class="inline-block bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded-full">
  ⚠ Only {n} left!
</span>

<!-- Out of stock -->
<span class="inline-block bg-red-100 text-red-800 text-xs px-2 py-0.5 rounded-full">
  Back-order — 4-6 week shipping
</span>
```

Update dynamically when variant changes.

#### B4. `js/product/cart.js` — Add variant_id to cart payload

**Current payload (line ~18):**
```javascript
{ id, product_id, slug, name, price, image, variant, variant_id, qty, category_id, tags }
```

`variant_id` may already be included here — verify it's the UUID from `product_variants.id` (not just the color string). The webhook needs this to decrement the correct variant row.

#### B5. `pages/product.html` — Add stock badge placeholder

Add an empty `<span id="stockBadge">` near the price area that JS will populate.

#### B6. JSON-LD Schema — Dynamic availability

**Current:** Hardcodes `InStock`/`OutOfStock` based on `is_active`.

**Change:** Factor in variant stock:
```javascript
"availability": totalStock > 0
  ? "https://schema.org/InStock"
  : "https://schema.org/BackOrder"  // NOT OutOfStock — they can still order
```

### Phase C: Admin Panel

#### C1. `pages/admin/products.html` — Stock summary column

**Current product table:** Shows name, category, price, status.

**Add column:** "Stock" showing total units across all variants.
- `> 3` → green number
- `1-3` → yellow with ⚠ icon
- `0` → red "OOS" badge

No changes needed to the variant stock *inputs* inside the modal — those already work.

#### C2. `pages/admin/products.html` — Inventory Fiscal Panel

**Add a collapsible panel** at top of products page (or a new admin sub-page):

```
┌─────────────────────────────────────────────────┐
│ 📦 Inventory Overview                           │
├─────────────────────────────────────────────────┤
│ Total Units in Stock    │  342                   │
│ Inventory Cost (COGS)   │  $1,847.50             │
│ Potential Revenue       │  $6,234.00             │
│ Potential Gross Profit  │  $4,386.50 (70.3%)     │
│ Products Out of Stock   │  7 of 49               │
│ Low Stock Items         │  4 (≤ 3 units)         │
└─────────────────────────────────────────────────┘
```

**Data source:** Query the `inventory_summary` view and aggregate:
```javascript
const { data } = await supabase.from("inventory_summary").select("*");
const totals = data.reduce((acc, row) => ({
  totalUnits: acc.totalUnits + row.total_stock,
  totalCost: acc.totalCost + Number(row.inventory_cost),
  totalRevenue: acc.totalRevenue + Number(row.potential_revenue),
  totalProfit: acc.totalProfit + Number(row.potential_profit),
  outOfStock: acc.outOfStock + (row.total_stock === 0 ? 1 : 0),
  lowStock: acc.lowStock + (row.total_stock > 0 && row.total_stock <= 3 ? 1 : 0),
}), { totalUnits: 0, totalCost: 0, totalRevenue: 0, totalProfit: 0, outOfStock: 0, lowStock: 0 });
```

#### C3. Stock Ledger History (optional nice-to-have)

Show recent stock changes in a collapsible section:
```
📋 Recent Stock Changes
─────────────────────────────────────
  -1  Starry Bear (Pink)    order #ABC123    2 min ago
  +10 Halloween Bracelet    manual restock   1 hour ago
  -2  Mini Tote (Black)     order #DEF456    3 hours ago
```

---

## Implementation Order

| Step | Task | Files | Effort |
|------|------|-------|--------|
| 1 | DB migration: `stock_ledger` table + `inventory_summary` view + `get_product_stock` function | SQL migration | 10 min |
| 2 | Stripe webhook: stock decrement after order | `stripe-webhook/index.ts` | 30 min |
| 3 | Product page: variant stock badges, dynamic shipping text | `js/product/render.js`, `js/product/index.js`, `pages/product.html` | 45 min |
| 4 | Product page: cart payload includes variant_id | `js/product/cart.js` | 10 min |
| 5 | Admin products: stock summary column + low-stock badges | `pages/admin/products.html`, related JS | 30 min |
| 6 | Admin products: inventory fiscal panel | `pages/admin/products.html`, related JS | 30 min |
| 7 | Checkout validation: stock-aware messaging | `create-checkout-session/index.ts` | 20 min |
| 8 | JSON-LD: dynamic availability schema | `js/product/index.js` | 5 min |
| 9 | Deploy + test | All edge functions | 15 min |

**Total estimated effort:** ~3 hours

---

## Shipping Logic Summary

| Condition | Shipping Text | Badge |
|-----------|---------------|-------|
| `shipping_status === "mto"` | ⏳ Made to order — ships in 2-4 weeks | Made to Order |
| `variant.stock > 3` | 🚀 In Stock — ships in 1-2 business days | ✓ In Stock |
| `variant.stock 1-3` | 🚀 In Stock — ships in 1-2 business days | ⚠ Only {n} left! |
| `variant.stock === 0` | 📦 Back-order — ships in 4-6 weeks | Back-order |

**Key:** Out-of-stock items are still purchasable — they just show longer shipping times. The "Add to Cart" button **never** gets disabled.

---

## Edge Cases to Handle

1. **No variants on a product** — Some products may not have variants. Need a product-level stock fallback or require at least one "default" variant.

2. **Race conditions** — Two customers buying the last unit simultaneously. The webhook decrement uses `Math.max(0, stock - qty)` so stock never goes negative. Both orders succeed, one becomes a back-order implicitly.

3. **Cancelled/refunded orders** — When a refund is processed via `charge.refunded` in the webhook, stock should be **re-incremented** (add back to `stock_ledger` with reason `"refund"`).

4. **Variant deleted/deactivated** — If admin deactivates a variant, its stock should be excluded from product totals (the SQL view already filters `is_active = true`).

5. **Bulk restock** — The admin variant editor already has individual stock inputs. Consider adding a "Restock All" button that sets all variants for a product to a chosen number.

6. **Cart stale stock** — Customer adds item to cart, sits for an hour, someone else buys the last one. At checkout, inform them it's now back-order rather than silently processing. Handle in `create-checkout-session`.

---

## Files Touched (Complete List)

| File | Type | Change |
|------|------|--------|
| `supabase/migrations/YYYYMMDD_inventory_tracking.sql` | New | DB migration |
| `supabase/functions/stripe-webhook/index.ts` | Edit | Stock decrement + refund re-increment |
| `supabase/functions/create-checkout-session/index.ts` | Edit | Stock validation messaging |
| `js/product/render.js` | Edit | Variant swatch sold-out state |
| `js/product/index.js` | Edit | Dynamic shipping text, stock badges, JSON-LD |
| `js/product/cart.js` | Edit | Verify variant_id in payload |
| `pages/product.html` | Edit | Stock badge placeholder, CSS for sold-out swatches |
| `pages/admin/products.html` | Edit | Stock column, fiscal panel, low-stock badges |
| `js/admin/products/tableRenderer.js` (or equivalent) | Edit | Stock column in product table |

---

*This document is the implementation spec. Once approved, work begins at Step 1.*

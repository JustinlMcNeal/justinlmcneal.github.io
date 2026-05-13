-- ─────────────────────────────────────────────────────────────────────────────
-- 20260512_ebay_product_recent_sales_view.sql
-- Phase 4: eBay per-product recent sales view.
--
-- Creates public.v_ebay_product_recent_sales — a flat read model of eBay line-
-- item sales for the eBay Listings sales drilldown modal.
--
-- ── Join strategy ─────────────────────────────────────────────────────────────
--
--   Identical join and eBay filter to v_ebay_listing_workspace:
--     line_items_raw.product_id = products.code  (proven reliable)
--     eBay order filter: stripe_checkout_session_id LIKE 'ebay_api_%' OR 'ebay_%'
--
--   Note on product_id casing: line_items_raw.product_id is text and directly
--   used as product_code in the view. The JS filters by eq("product_code", code)
--   where code comes from products.code. Case must match — no normalization done
--   here; the join is proven to work as-is in production.
--
-- ── Fields exposed ────────────────────────────────────────────────────────────
--
--   SAFE (exposed):
--     product_code          — line_items_raw.product_id (maps to products.code)
--     sold_at               — orders_raw.order_date (reliable timestamptz)
--     kk_order_id           — orders_raw.kk_order_id (internal admin ref, e.g. EBAY-27-14595-12804)
--     quantity              — line_items_raw.quantity
--     unit_price_cents      — line_items_raw.unit_price_cents (original listed price)
--     sold_price_cents      — COALESCE(post_discount_unit_price_cents, unit_price_cents)
--                             i.e. actual amount buyer paid per unit after discount
--     line_total_cents      — quantity * sold_price_cents (total for this line)
--     variant_title         — line_items_raw.variant_title (NULL for single-variant items)
--     source                — static 'ebay' text for UI labeling
--
--   NOT EXPOSED (privacy / irrelevant):
--     Buyer PII: first_name, last_name, email, phone_number, address fields
--     stripe_customer_id, stripe_payment_intent_id, stripe_refund_id
--     Order-level totals (shipping_paid_cents, tax_cents, total_paid_cents...)
--     line_items_raw.selected_options (JSONB — too complex for this surface)
--     refund_status — excluded in Phase 4 to avoid complexity
--
-- ── Phase 4 exclusions ────────────────────────────────────────────────────────
--
--   Per-product realized profit/fees: order-level proration blocker still applies.
--   Impressions, clicks, watchers: no data source in current stack.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_ebay_product_recent_sales AS
SELECT
  -- Product identifier (matches products.code — used for the page-side filter)
  li.product_id                                                        AS product_code,

  -- When the sale happened (from orders_raw — canonical timestamp)
  o.order_date                                                         AS sold_at,

  -- Internal order reference (admin-safe, format: EBAY-27-14595-12804)
  o.kk_order_id,

  -- Quantity of this line item sold in this order
  li.quantity,

  -- Original listed price per unit (before any discount)
  li.unit_price_cents,

  -- Actual per-unit sold price (post-discount if applicable; falls back to unit_price_cents)
  COALESCE(li.post_discount_unit_price_cents, li.unit_price_cents)    AS sold_price_cents,

  -- Full line value: quantity × actual sold price
  (li.quantity * COALESCE(li.post_discount_unit_price_cents, li.unit_price_cents))
                                                                       AS line_total_cents,

  -- Variant sold (NULL for most single-variant products)
  li.variant_title,

  -- Static marketplace label for UI display
  'ebay'::text                                                         AS source

FROM public.line_items_raw li
JOIN public.orders_raw o
     ON o.stripe_checkout_session_id = li.stripe_checkout_session_id
WHERE (
    o.stripe_checkout_session_id LIKE 'ebay_api_%'
 OR o.stripe_checkout_session_id LIKE 'ebay_%'
)
  AND li.product_id IS NOT NULL;

-- ── Permissions ───────────────────────────────────────────────────────────────
-- Matches pattern used by v_ebay_listing_workspace.
-- anon not granted — this is admin-only data.
GRANT SELECT ON public.v_ebay_product_recent_sales TO authenticated, service_role;

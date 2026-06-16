-- 20260904_inventory_phase7b_kk_available_stock.sql
--
-- Phase 7B — read-only KK storefront available stock view.
-- available = on_hand - active (non-shadow) reservations.

CREATE OR REPLACE VIEW public.v_kk_variant_available_stock AS
WITH variant_reserved AS (
  SELECT
    ir.variant_id,
    COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
  FROM public.inventory_reservations ir
  WHERE ir.status = 'reserved'
    AND ir.variant_id IS NOT NULL
    AND COALESCE(ir.is_shadow, false) = false
  GROUP BY ir.variant_id
)
SELECT
  pv.id AS variant_id,
  pv.product_id,
  NULLIF(BTRIM(pv.sku), '') AS sku,
  NULLIF(BTRIM(pv.option_value), '') AS option_value,
  COALESCE(pv.stock, 0) AS on_hand,
  COALESCE(vr.reserved_qty, 0) AS reserved,
  COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS available,
  GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) AS available_display,
  (GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) > 0) AS is_available,
  (
    GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) > 0
    AND GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) <= 3
  ) AS low_stock,
  (
    SELECT MAX(ir.updated_at)
    FROM public.inventory_reservations ir
    WHERE ir.variant_id = pv.id
      AND ir.status = 'reserved'
      AND COALESCE(ir.is_shadow, false) = false
  ) AS updated_at
FROM public.product_variants pv
LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
JOIN public.products p ON p.id = pv.product_id
WHERE COALESCE(pv.is_active, true) = true
  AND COALESCE(p.is_active, true) = true;

COMMENT ON VIEW public.v_kk_variant_available_stock IS
  'KK storefront sellable qty: available = on_hand - reserved (non-shadow). Use available_display for customer UI (clamped >= 0).';

GRANT SELECT ON public.v_kk_variant_available_stock TO anon, authenticated, service_role;

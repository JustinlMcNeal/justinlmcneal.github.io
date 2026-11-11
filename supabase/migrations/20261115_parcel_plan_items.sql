-- ================================================================
-- Parcel Planner — items queued for the next Baestao parcel
-- + restock suggestion RPC (sales velocity vs on-hand stock).
-- ================================================================

CREATE TABLE IF NOT EXISTS public.parcel_plan_items (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text          NOT NULL,
  product_id          uuid          REFERENCES public.products(id) ON DELETE SET NULL,
  variant_label       text,
  supplier_url        text,
  unit_price_cny      numeric(10,2) NOT NULL DEFAULT 0 CHECK (unit_price_cny >= 0),
  qty                 integer       NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_weight_g       numeric(10,1) NOT NULL DEFAULT 0 CHECK (unit_weight_g >= 0),
  seller_freight_cny  numeric(10,2) NOT NULL DEFAULT 0 CHECK (seller_freight_cny >= 0),
  target_price_usd    numeric(10,2) CHECK (target_price_usd IS NULL OR target_price_usd >= 0),
  status              text          NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned', 'ordered', 'removed')),
  notes               text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parcel_plan_items_status_idx
  ON public.parcel_plan_items (status, created_at);

DROP TRIGGER IF EXISTS parcel_plan_items_set_updated_at ON public.parcel_plan_items;
CREATE TRIGGER parcel_plan_items_set_updated_at
  BEFORE UPDATE ON public.parcel_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.parcel_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parcel_plan_items_authenticated_all_admin_gated ON public.parcel_plan_items;
CREATE POLICY parcel_plan_items_authenticated_all_admin_gated
  ON public.parcel_plan_items
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));

DROP POLICY IF EXISTS parcel_plan_items_service_role_all ON public.parcel_plan_items;
CREATE POLICY parcel_plan_items_service_role_all
  ON public.parcel_plan_items
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Products selling faster than stock covers (< p_cover_days of stock left).
-- SECURITY INVOKER: callers only see rows their RLS allows (admin-only tables).
CREATE OR REPLACE FUNCTION public.parcel_planner_restock_suggestions(
  p_window_days integer DEFAULT 90,
  p_cover_days  integer DEFAULT 60
)
RETURNS TABLE (
  product_id        uuid,
  code              text,
  name              text,
  image_url         text,
  supplier_url      text,
  stock             integer,
  sold_in_window    integer,
  days_of_cover     numeric,
  suggested_qty     integer,
  last_unit_price_cny numeric,
  unit_weight_g     numeric,
  sell_price_usd    numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH sales AS (
    SELECT li.product_id AS code, SUM(li.quantity)::int AS sold
    FROM line_items_raw li
    WHERE li.order_date >= now() - make_interval(days => p_window_days)
    GROUP BY 1
  ),
  stock AS (
    SELECT v.product_id, COALESCE(SUM(v.stock) FILTER (WHERE v.is_active), 0)::int AS stock
    FROM product_variants v
    GROUP BY 1
  ),
  last_buy AS (
    SELECT DISTINCT ON (m.product_id)
      m.product_id, i.unit_price_cny, i.item_weight_grams, i.quantity
    FROM parcel_import_item_mappings m
    JOIN parcel_import_items i ON i.id = m.parcel_import_item_id
    WHERE m.product_id IS NOT NULL
    ORDER BY m.product_id, i.created_at DESC
  ),
  base AS (
    SELECT
      p.id, p.code, p.name,
      COALESCE(p.catalog_image_url, p.primary_image_url) AS image_url,
      p.supplier_url,
      COALESCE(s.stock, 0) AS stock,
      sa.sold,
      sa.sold::numeric / GREATEST(p_window_days, 1) AS per_day,
      lb.unit_price_cny,
      COALESCE(
        CASE WHEN lb.quantity > 0 AND lb.item_weight_grams > 0
             THEN round(lb.item_weight_grams / lb.quantity, 1) END,
        p.weight_g
      ) AS unit_weight_g,
      COALESCE(p.ebay_price_cents / 100.0, p.price) AS sell_price_usd
    FROM products p
    JOIN sales sa ON sa.code = p.code
    LEFT JOIN stock s ON s.product_id = p.id
    LEFT JOIN last_buy lb ON lb.product_id = p.id
    WHERE p.is_active
  )
  SELECT
    b.id, b.code, b.name, b.image_url, b.supplier_url,
    b.stock, b.sold,
    round(b.stock / NULLIF(b.per_day, 0), 0) AS days_of_cover,
    GREATEST(CEIL(b.per_day * p_cover_days * 1.5) - b.stock, 1)::int AS suggested_qty,
    b.unit_price_cny, b.unit_weight_g, b.sell_price_usd
  FROM base b
  WHERE b.stock < b.per_day * p_cover_days
  ORDER BY b.stock / NULLIF(b.per_day, 0) ASC NULLS FIRST, b.sold DESC;
$$;

REVOKE ALL ON FUNCTION public.parcel_planner_restock_suggestions(integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.parcel_planner_restock_suggestions(integer, integer) TO authenticated;

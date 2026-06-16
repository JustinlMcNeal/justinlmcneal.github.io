-- Phase 7E — eBay ended-listing relist assist (read-only candidates + audit log).
-- No eBay publish/relist automation; no stock or reservation mutations.

CREATE TABLE IF NOT EXISTS public.ebay_relist_assist_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id          uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  old_ebay_listing_id text,
  action_type         text NOT NULL
    CHECK (action_type IN ('opened_admin', 'marked_review', 'draft_created', 'relist_attempted')),
  status              text,
  notes               text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ebay_relist_assist_actions IS
  'Admin audit log for eBay relist assist actions from Inventory sync modal. Not inventory truth.';

CREATE INDEX IF NOT EXISTS ebay_relist_assist_actions_product_created_idx
  ON public.ebay_relist_assist_actions (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ebay_relist_assist_actions_created_at_idx
  ON public.ebay_relist_assist_actions (created_at DESC);

ALTER TABLE public.ebay_relist_assist_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ebay_relist_assist_actions_service_role_all
  ON public.ebay_relist_assist_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY ebay_relist_assist_actions_authenticated_select
  ON public.ebay_relist_assist_actions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY ebay_relist_assist_actions_authenticated_insert
  ON public.ebay_relist_assist_actions FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT ALL ON public.ebay_relist_assist_actions TO service_role;
GRANT SELECT, INSERT ON public.ebay_relist_assist_actions TO authenticated;

-- Ended eBay listings eligible for relist assist (conservative classification).
CREATE OR REPLACE VIEW public.v_inventory_ebay_relist_candidates AS
SELECT
  sc.variant_id,
  sc.product_id,
  sc.product_label,
  sc.internal_sku,
  p.code AS product_code,
  COALESCE(NULLIF(BTRIM(p.ebay_sku), ''), NULLIF(BTRIM(p.code), '')) AS ebay_sku,
  p.ebay_listing_id AS old_ebay_listing_id,
  p.ebay_offer_id AS old_ebay_offer_id,
  sc.ebay_listing_status AS old_status,
  sc.available_qty,
  sc.on_hand_qty AS on_hand,
  sc.reserved_qty AS reserved,
  GREATEST(COALESCE(sc.available_qty_nonneg, 0), 0) AS suggested_qty,
  sc.ebay_listing_status AS last_seen_status,
  sc.ebay_cache_synced_at AS last_cache_sync_at,
  p.ebay_item_group_key,
  p.ebay_category_id,
  p.ebay_price_cents,
  sc.product_active_variant_count,
  ARRAY_REMOVE(
    ARRAY[
      CASE WHEN p.ebay_category_id IS NULL THEN 'ebay_category_id' END,
      CASE WHEN COALESCE(p.ebay_price_cents, 0) <= 0 THEN 'ebay_price_cents' END,
      CASE WHEN NULLIF(BTRIM(COALESCE(p.ebay_sku, p.code)), '') IS NULL THEN 'ebay_sku' END
    ],
    NULL
  ) AS required_fields_missing,
  CASE
    WHEN sc.product_active_variant_count > 1
      AND p.ebay_item_group_key IS NOT NULL
      THEN 'unsupported_variation'
    WHEN sc.available_qty <= 0
      THEN 'no_available_stock'
    WHEN sc.ebay_sync_action = 'missing_mapping'
      OR (p.ebay_offer_id IS NOT NULL AND p.ebay_listing_id IS NULL)
      THEN 'needs_mapping'
    WHEN p.ebay_category_id IS NULL
      OR COALESCE(p.ebay_price_cents, 0) <= 0
      OR NULLIF(BTRIM(COALESCE(p.ebay_sku, p.code)), '') IS NULL
      THEN 'missing_required_listing_data'
    WHEN sc.available_qty > 0
      AND (p.ebay_item_group_key IS NULL OR sc.product_active_variant_count <= 1)
      THEN 'ready_to_relist'
    ELSE 'manual_review'
  END AS relist_action
FROM public.v_inventory_channel_sync_candidates sc
JOIN public.products p ON p.id = sc.product_id
WHERE sc.ebay_sync_action = 'ended_needs_relist';

COMMENT ON VIEW public.v_inventory_ebay_relist_candidates IS
  'Conservative eBay ended-listing relist assist candidates. Assist-only — no live relist automation.';

GRANT SELECT ON public.v_inventory_ebay_relist_candidates TO authenticated, service_role;

-- 20261103_security_phase3_security_invoker_views.sql
--
-- Phase 3 — Convert public views to security_invoker and classify grants.
-- Requires PostgreSQL 15+ (Supabase default). Nested views included.

BEGIN;

-- ---------------------------------------------------------------------------
-- Storefront base-table RLS (required before invoker views enforce caller perms)
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_public_read ON public.products;
DROP POLICY IF EXISTS products_admin_all ON public.products;
CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated
  USING (COALESCE(is_active, true) = true);
CREATE POLICY products_admin_all ON public.products
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));
GRANT SELECT ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;

ALTER TABLE IF EXISTS public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_public_read ON public.categories;
DROP POLICY IF EXISTS categories_admin_all ON public.categories;
CREATE POLICY categories_public_read ON public.categories
  FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY categories_admin_all ON public.categories
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;

ALTER TABLE IF EXISTS public.product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_variants_public_read ON public.product_variants;
DROP POLICY IF EXISTS product_variants_admin_all ON public.product_variants;
CREATE POLICY product_variants_public_read ON public.product_variants
  FOR SELECT TO anon, authenticated
  USING (COALESCE(is_active, true) = true);
CREATE POLICY product_variants_admin_all ON public.product_variants
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));
GRANT SELECT ON public.product_variants TO anon, authenticated;
GRANT ALL ON public.product_variants TO service_role;

-- tags / product_tags — required by v_products_with_tags and v_home_best_sellers (invoker)
ALTER TABLE IF EXISTS public.tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tags_admin_all ON public.tags;
DROP POLICY IF EXISTS tags_public_select ON public.tags;
DROP POLICY IF EXISTS tags_admin_write ON public.tags;
CREATE POLICY tags_public_select ON public.tags
  FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY tags_admin_all ON public.tags
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));
GRANT SELECT ON public.tags TO anon, authenticated;
GRANT ALL ON public.tags TO service_role;

ALTER TABLE IF EXISTS public.product_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_tags_admin_all ON public.product_tags;
DROP POLICY IF EXISTS product_tags_public_select_active_products ON public.product_tags;
DROP POLICY IF EXISTS product_tags_admin_write ON public.product_tags;
CREATE POLICY product_tags_public_select_active_products ON public.product_tags
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_tags.product_id
        AND COALESCE(p.is_active, true) = true
    )
  );
CREATE POLICY product_tags_admin_all ON public.product_tags
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));
GRANT SELECT ON public.product_tags TO anon, authenticated;
GRANT ALL ON public.product_tags TO service_role;

-- ---------------------------------------------------------------------------
-- Bulk security_invoker on all public views except documented exceptions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_exceptions text[] := ARRAY[
    -- Reads inventory_reservations aggregate; stays definer until dedicated storefront RPC.
    'v_kk_variant_available_stock',
    -- Nested chain for live bundle virtual stock in v_kk_variant_available_stock
    'v_inventory_bundle_summary_preview',
    'v_inventory_bundle_availability_preview',
    'v_inventory_bundle_like_variants'
  ];
BEGIN
  FOR r IN
    SELECT c.relname AS view_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
      AND NOT (c.relname = ANY (v_exceptions))
  LOOP
    EXECUTE format(
      'ALTER VIEW public.%I SET (security_invoker = true)',
      r.view_name
    );
  END LOOP;
END $$;

COMMENT ON VIEW public.v_kk_variant_available_stock IS
  'DOCUMENTED EXCEPTION: remains security definer — exposes clamped available stock only; '
  'underlying inventory_reservations lacks safe anon RLS. Replace with invoker + narrow policy in future.';

-- ---------------------------------------------------------------------------
-- Revoke anon from sensitive admin / order / finance / inventory views
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sensitive text[] := ARRAY[
    'v_customers_summary',
    'v_order_summary',
    'v_order_summary_with_ship',
    'v_order_summary_plus',
    'v_order_lines',
    'v_order_refunds',
    'v_order_financials',
    'v_order_marketplace_status',
    'v_ebay_order_profit',
    'v_amazon_order_profit',
    'v_inventory_workspace',
    'v_inventory_kpis',
    'v_inventory_ledger_recent',
    'v_inventory_issues',
    'v_inventory_issues_core',
    'v_inventory_issues_with_state',
    'v_inventory_channel_status',
    'v_inventory_channel_sync_candidates',
    'v_inventory_mapping_suggestions',
    'v_inventory_ebay_mapping_worklist',
    'v_inventory_ebay_mapping_worklist_lines',
    'v_inventory_ebay_unmapped_group_counts',
    'v_inventory_ebay_relist_candidates',
    'v_inventory_ebay_variation_relist_candidates',
    'v_inventory_ebay_variation_sync_candidates',
    'v_inventory_post_mapping_workflow_candidates',
    'v_inventory_post_map_queue_with_resolution',
    'v_inventory_parcel_receive_summary',
    'v_inventory_unmapped_order_lines',
    'v_inventory_shipped_finalize_audit',
    'v_inventory_reservation_audit',
    'v_inventory_reservation_retry_candidates',
    'v_inventory_shadow_reservation_audit',
    'v_inventory_shadow_kpis',
    'v_inventory_shadow_reservation_reconciliation',
    'v_inventory_bundle_shadow_events_recent',
    'v_inventory_bundle_like_variants',
    'v_inventory_bundle_availability_preview',
    'v_inventory_bundle_summary_preview',
    'v_inventory_bundle_cutover_readiness',
    'v_inventory_bundle_component_return_candidates',
    'v_inventory_bundle_component_return_guidance',
    'v_inventory_bundle_component_return_workflow_guidance',
    'v_inventory_cutover_readiness_summary',
    'v_inventory_cutover_active_blockers',
    'v_inventory_kk_order_lines_resolved',
    'v_inventory_kk_paid_unshipped_reservation_candidates',
    'v_inventory_kk_cutover_backfill_dry_run',
    'v_inventory_marketplace_restock_assist_candidates',
    'v_inventory_marketplace_restock_assist_queue',
    'v_inventory_marketplace_restock_assist_queue_with_triage',
    'v_inventory_marketplace_restock_assist_queue_summary',
    'v_inventory_marketplace_restock_assist_audit',
    'v_inventory_marketplace_refund_observations',
    'v_inventory_restock_followup_candidates',
    'v_inventory_returns_restock_dashboard_worklist',
    'v_inventory_returns_restock_dashboard_metrics',
    'v_inventory_returns_restock_dashboard_summary',
    'v_inventory_returns_restock_digest_summary',
    'v_inventory_returns_restock_digest_items',
    'inventory_summary',
    'products_needing_social_posts',
    'v_ship_ready',
    'v_products_with_costs',
    'v_ebay_listing_workspace',
    'v_ebay_product_recent_sales',
    'v_amazon_drafts_issues',
    'v_amazon_unmapped_listings',
    'v_amazon_listing_workspace',
    'v_amazon_ready_to_push_products',
    'sms_v_outcome_aging',
    'sms_v_subscriber_funnel',
    'sms_v_fatigue_monitor',
    'sms_v_contact_fatigue',
    'sms_v_flow_performance',
    'sms_v_flow_performance_dated',
    'sms_v_abandoned_cart',
    'sms_v_coupon_cohorts',
    'sms_v_click_to_purchase'
  ];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY v_sensitive LOOP
    IF to_regclass(format('public.%I', v_name)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_name);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v_name);
    END IF;
  END LOOP;
END $$;

-- Storefront views — keep anon SELECT (base-table RLS must enforce safety)
DO $$
DECLARE
  v_storefront text[] := ARRAY[
    'v_home_active_promo',
    'v_home_categories',
    'v_home_best_sellers',
    'v_categories_public',
    'v_products_with_tags',
    'v_kk_variant_available_stock'
  ];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY v_storefront LOOP
    IF to_regclass(format('public.%I', v_name)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role', v_name);
    END IF;
  END LOOP;
END $$;

COMMIT;

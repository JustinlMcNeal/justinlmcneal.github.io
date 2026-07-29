-- 20261105_security_hotfix_public_execute_and_storefront_stock.sql
--
-- Hotfix after initial security deploy:
-- 1) REVOKE EXECUTE FROM PUBLIC (default PG grant) on SECURITY DEFINER RPCs
-- 2) Revert security_invoker on bundle views in storefront stock dependency chain

BEGIN;

DO $$
DECLARE
  r record;
  v_anon_allow text[] := ARRAY['get_product_stock'];
  v_service_only text[] := ARRAY[
    'amazon_get_lwa_refresh_token',
    'amazon_store_lwa_refresh_token',
    'analytics_backfill',
    'analytics_refresh_day',
    'claim_inventory_sale_sync_jobs',
    'process_scheduled_posts_trigger',
    'refresh_product_review_stats',
    'refresh_inventory_issue_snapshots',
    'reserve_inventory_for_marketplace_sale',
    'release_marketplace_sale_reservation'
  ];
BEGIN
  FOR r IN
    SELECT
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC',
      r.function_name,
      r.args
    );

    IF NOT (r.function_name = ANY (v_anon_allow)) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM anon',
        r.function_name,
        r.args
      );
    END IF;

    IF r.function_name = ANY (v_service_only) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated',
        r.function_name,
        r.args
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
        r.function_name,
        r.args
      );
    ELSIF NOT (r.function_name = ANY (v_anon_allow)) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
        r.function_name,
        r.args
      );
    END IF;
  END LOOP;
END $$;

-- Storefront stock: v_kk_variant_available_stock (definer) calls bundle preview views.
-- Nested invoker views fail for anon callers — keep this chain as definer.
DO $$
DECLARE
  v_name text;
  v_chain text[] := ARRAY[
    'v_inventory_bundle_summary_preview',
    'v_inventory_bundle_availability_preview',
    'v_inventory_bundle_like_variants'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_chain LOOP
    IF to_regclass(format('public.%I', v_name)) IS NOT NULL THEN
      EXECUTE format(
        'ALTER VIEW public.%I SET (security_invoker = false)',
        v_name
      );
      EXECUTE format(
        'COMMENT ON VIEW public.%I IS %L',
        v_name,
        'DOCUMENTED EXCEPTION: security definer — nested dependency of v_kk_variant_available_stock storefront stock view.'
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

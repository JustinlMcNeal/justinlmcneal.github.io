-- 20261101_security_phase1_rpc_secret_lockdown.sql
--
-- Phase 1 — Emergency RPC and secret-risk lockdown.
-- - Harden public.is_admin()
-- - Revoke anon EXECUTE on sensitive SECURITY DEFINER functions
-- - Grant authenticated EXECUTE for admin UI RPCs (internal is_admin() guard required)
-- - Restrict service/cron-only RPCs to service_role

BEGIN;

-- ---------------------------------------------------------------------------
-- is_admin() — canonical admin gate (SECURITY DEFINER, fixed search_path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'is_admin', '')::boolean,
    false
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'Returns true when JWT app_metadata.is_admin is true. Used by RLS policies and admin RPC guards.';

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Legacy uuid overload — keep for policies that reference is_admin(uuid); harden in place.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
      AND pg_get_function_identity_arguments(p.oid) = 'check_uid uuid'
  ) THEN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public.is_admin(check_uid uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
        SELECT CASE
          WHEN check_uid IS NULL OR check_uid = auth.uid() THEN COALESCE(public.is_admin(), false)
          ELSE false
        END;
      $body$;
    $sql$;
    REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Bulk EXECUTE lockdown for SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_anon_allow text[] := ARRAY[
    -- Storefront-safe SECURITY DEFINER RPCs (review before adding)
    'get_product_stock'
  ];
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
      p.oid,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.prokind = 'f'
  LOOP
    -- Revoke default PUBLIC execute (Supabase/Postgres default) and anon
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
        'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated',
        r.function_name,
        r.args
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
        r.function_name,
        r.args
      );
    ELSIF NOT (r.function_name = ANY (v_anon_allow)) THEN
      -- Admin / mixed RPCs: authenticated + service_role, never anon
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
        r.function_name,
        r.args
      );
    END IF;
  END LOOP;
END $$;

-- Explicit revokes for high-risk RPCs (idempotent even if loop already ran)
REVOKE EXECUTE ON FUNCTION public.amazon_get_lwa_refresh_token(uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_get_lwa_refresh_token(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.amazon_store_lwa_refresh_token(uuid, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_store_lwa_refresh_token(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_order_kpis(text, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_order_kpis(text, text, text, text) TO authenticated, service_role;

COMMIT;

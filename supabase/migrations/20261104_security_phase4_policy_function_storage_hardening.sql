-- 20261104_security_phase4_policy_function_storage_hardening.sql
--
-- Phase 4 — Policy, function search_path, storage listing, and extension notes.

BEGIN;

-- ---------------------------------------------------------------------------
-- personal_expenses — CRITICAL: remove anon CRUD
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS personal_expenses_anon_read ON public.personal_expenses;
DROP POLICY IF EXISTS personal_expenses_anon_insert ON public.personal_expenses;
DROP POLICY IF EXISTS personal_expenses_anon_update ON public.personal_expenses;
DROP POLICY IF EXISTS personal_expenses_anon_delete ON public.personal_expenses;
DROP POLICY IF EXISTS personal_expenses_auth_read ON public.personal_expenses;
DROP POLICY IF EXISTS personal_expenses_auth_insert ON public.personal_expenses;
DROP POLICY IF EXISTS personal_expenses_auth_update ON public.personal_expenses;
DROP POLICY IF EXISTS personal_expenses_auth_delete ON public.personal_expenses;

CREATE POLICY personal_expenses_admin_all ON public.personal_expenses
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));

REVOKE ALL ON public.personal_expenses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_expenses TO authenticated;
GRANT ALL ON public.personal_expenses TO service_role;

-- ---------------------------------------------------------------------------
-- promotions — replace permissive authenticated manage
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_manage_promotions ON public.promotions;
CREATE POLICY promotions_admin_manage ON public.promotions
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));

-- ---------------------------------------------------------------------------
-- Generic admin-gate for authenticated write policies using true
-- (inventory, parcel, social, reviews, CMS, expenses, amazon drafts, etc.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_admin_expr text := 'COALESCE(public.is_admin(), false)';
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      pol.polname AS policy_name,
      pol.polcmd AS cmd
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pol.polcmd IN ('a', 'w', 'd', '*')
      AND (
        pg_get_expr(pol.polqual, pol.polrelid) = 'true'
        OR pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true'
      )
      AND EXISTS (
        SELECT 1 FROM pg_roles role
        WHERE role.oid = ANY(pol.polroles)
          AND role.rolname IN ('authenticated', '-')
      )
      AND c.relname NOT IN (
        'push_subscriptions',
        'push_notifications_log',
        'pwa_events',
        'personal_expenses'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policy_name, r.schema_name, r.table_name);
    IF r.cmd = 'd' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR DELETE TO authenticated USING (%s)',
        r.policy_name || '_admin_gated',
        r.schema_name,
        r.table_name,
        v_admin_expr
      );
    ELSIF r.cmd = 'w' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
        r.policy_name || '_admin_gated',
        r.schema_name,
        r.table_name,
        v_admin_expr,
        v_admin_expr
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR %s TO authenticated USING (%s) WITH CHECK (%s)',
        r.policy_name || '_admin_gated',
        r.schema_name,
        r.table_name,
        CASE r.cmd WHEN 'a' THEN 'ALL' WHEN '*' THEN 'ALL' ELSE 'ALL' END,
        v_admin_expr,
        v_admin_expr
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- PWA / push — narrow public insert, no public update/delete
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.push_subscriptions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "anon_insert_push_sub" ON public.push_subscriptions;
    DROP POLICY IF EXISTS "anon_delete_own_push_sub" ON public.push_subscriptions;
    DROP POLICY IF EXISTS push_subscriptions_anon_insert ON public.push_subscriptions;
    DROP POLICY IF EXISTS push_subscriptions_anon_update ON public.push_subscriptions;
    DROP POLICY IF EXISTS push_subscriptions_anon_delete ON public.push_subscriptions;
    DROP POLICY IF EXISTS push_subscriptions_public_insert ON public.push_subscriptions;
    DROP POLICY IF EXISTS push_subscriptions_owner_update ON public.push_subscriptions;
    DROP POLICY IF EXISTS push_subscriptions_admin_delete ON public.push_subscriptions;

    CREATE POLICY push_subscriptions_public_insert ON public.push_subscriptions
      FOR INSERT TO anon, authenticated
      WITH CHECK (endpoint IS NOT NULL AND length(btrim(endpoint)) > 8);

    CREATE POLICY push_subscriptions_admin_manage ON public.push_subscriptions
      FOR ALL TO authenticated
      USING (COALESCE(public.is_admin(), false))
      WITH CHECK (COALESCE(public.is_admin(), false));
  END IF;

  IF to_regclass('public.push_notifications_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS "anon_insert_push_log" ON public.push_notifications_log;
    DROP POLICY IF EXISTS push_notifications_log_anon_insert ON public.push_notifications_log;
    DROP POLICY IF EXISTS push_notifications_log_service_insert ON public.push_notifications_log;

    CREATE POLICY push_notifications_log_admin_insert ON public.push_notifications_log
      FOR INSERT TO authenticated
      WITH CHECK (COALESCE(public.is_admin(), false));

    CREATE POLICY push_notifications_log_admin_select ON public.push_notifications_log
      FOR SELECT TO authenticated
      USING (COALESCE(public.is_admin(), false));

    REVOKE ALL ON public.push_notifications_log FROM anon;
    GRANT SELECT, INSERT ON public.push_notifications_log TO authenticated;
    GRANT ALL ON public.push_notifications_log TO service_role;
  END IF;

  IF to_regclass('public.pwa_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "anon_insert_pwa_events" ON public.pwa_events;
    DROP POLICY IF EXISTS pwa_events_anon_insert ON public.pwa_events;
    DROP POLICY IF EXISTS pwa_events_public_insert ON public.pwa_events;

    CREATE POLICY pwa_events_public_insert ON public.pwa_events
      FOR INSERT TO anon, authenticated
      WITH CHECK (event_type IS NOT NULL AND length(btrim(event_type)) > 0);

    REVOKE UPDATE, DELETE ON public.pwa_events FROM anon;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Misleading "service role" policies on PUBLIC role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access on image_blacklist" ON public.image_blacklist;
DROP POLICY IF EXISTS "Service role full access on social_generated_images" ON public.social_generated_images;
DROP POLICY IF EXISTS stock_ledger_service_full ON public.stock_ledger;

-- Re-apply admin policies where tables exist
DO $$
BEGIN
  IF to_regclass('public.image_blacklist') IS NOT NULL THEN
    DROP POLICY IF EXISTS image_blacklist_admin_all ON public.image_blacklist;
    CREATE POLICY image_blacklist_admin_all ON public.image_blacklist
      FOR ALL TO authenticated
      USING (COALESCE(public.is_admin(), false))
      WITH CHECK (COALESCE(public.is_admin(), false));
    REVOKE ALL ON public.image_blacklist FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.image_blacklist TO authenticated;
    GRANT ALL ON public.image_blacklist TO service_role;
  END IF;

  IF to_regclass('public.social_generated_images') IS NOT NULL THEN
    DROP POLICY IF EXISTS social_generated_images_admin_all ON public.social_generated_images;
    CREATE POLICY social_generated_images_admin_all ON public.social_generated_images
      FOR ALL TO authenticated
      USING (COALESCE(public.is_admin(), false))
      WITH CHECK (COALESCE(public.is_admin(), false));
    REVOKE ALL ON public.social_generated_images FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_generated_images TO authenticated;
    GRANT ALL ON public.social_generated_images TO service_role;
  END IF;

  IF to_regclass('public.stock_ledger') IS NOT NULL THEN
    DROP POLICY IF EXISTS stock_ledger_admin_select ON public.stock_ledger;
    CREATE POLICY stock_ledger_admin_select ON public.stock_ledger
      FOR SELECT TO authenticated
      USING (COALESCE(public.is_admin(), false));
    REVOKE ALL ON public.stock_ledger FROM anon;
    GRANT SELECT ON public.stock_ledger TO authenticated;
    GRANT ALL ON public.stock_ledger TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Function search_path hardening (ALTER … SET search_path = public)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) SET search_path = public',
        r.schema_name,
        r.function_name,
        r.args
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'search_path skip %.%(%) — %', r.schema_name, r.function_name, r.args, SQLERRM;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Storage — remove public bucket listing (keep public bucket URLs working)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Access Looks" ON storage.objects;
DROP POLICY IF EXISTS "Banner images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for products bucket" ON storage.objects;
DROP POLICY IF EXISTS "Public can read social media" ON storage.objects;

-- Admin listing/upload for media buckets (direct public URLs still work on public buckets)
DROP POLICY IF EXISTS storage_banners_admin_list ON storage.objects;
DROP POLICY IF EXISTS storage_looks_admin_list ON storage.objects;
DROP POLICY IF EXISTS storage_products_admin_list ON storage.objects;
DROP POLICY IF EXISTS storage_social_admin_list ON storage.objects;

CREATE POLICY storage_banners_admin_list ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'banners' AND COALESCE(public.is_admin(), false));

CREATE POLICY storage_looks_admin_list ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'looks' AND COALESCE(public.is_admin(), false));

CREATE POLICY storage_products_admin_list ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'products' AND COALESCE(public.is_admin(), false));

CREATE POLICY storage_social_admin_list ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'social-media' AND COALESCE(public.is_admin(), false));

-- ---------------------------------------------------------------------------
-- citext in public — deferred (requires column type migration testing)
-- See docs/security/KK_SECURITY_REMEDIATION.md follow-up.
-- ---------------------------------------------------------------------------

COMMIT;

-- 20261106_security_storefront_stock_function_grant.sql
--
-- Allow anon to invoke read-only is_bundle_live_deduction_enabled inside
-- security-definer v_kk_variant_available_stock (Postgres checks session EXECUTE).

BEGIN;

GRANT EXECUTE ON FUNCTION public.is_bundle_live_deduction_enabled(uuid) TO anon, authenticated, service_role;

COMMIT;

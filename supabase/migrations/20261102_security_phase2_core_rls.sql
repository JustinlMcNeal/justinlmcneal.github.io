-- 20261102_security_phase2_core_rls.sql
--
-- Phase 2 — Core RLS for PII, orders, fulfillment, webhook, and ops tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- customers — admin-only (PII)
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_admin_all ON public.customers;
CREATE POLICY customers_admin_all ON public.customers
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));

REVOKE ALL ON public.customers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;

-- ---------------------------------------------------------------------------
-- orders_raw — admin read/write; ingestion via service_role
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.orders_raw ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_raw_admin_all ON public.orders_raw;
CREATE POLICY orders_raw_admin_all ON public.orders_raw
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));

REVOKE ALL ON public.orders_raw FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders_raw TO authenticated;
GRANT ALL ON public.orders_raw TO service_role;

-- ---------------------------------------------------------------------------
-- fulfillment_shipments — admin read/write; webhooks via service_role
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.fulfillment_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fulfillment_shipments_admin_all ON public.fulfillment_shipments;
CREATE POLICY fulfillment_shipments_admin_all ON public.fulfillment_shipments
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));

REVOKE ALL ON public.fulfillment_shipments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fulfillment_shipments TO authenticated;
GRANT ALL ON public.fulfillment_shipments TO service_role;

-- ---------------------------------------------------------------------------
-- product_storage, package_presets, imported_product_images — admin-only ops
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.product_storage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_storage_admin_all ON public.product_storage;
CREATE POLICY product_storage_admin_all ON public.product_storage
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));
REVOKE ALL ON public.product_storage FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_storage TO authenticated;
GRANT ALL ON public.product_storage TO service_role;

ALTER TABLE IF EXISTS public.package_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS package_presets_admin_all ON public.package_presets;
CREATE POLICY package_presets_admin_all ON public.package_presets
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));
REVOKE ALL ON public.package_presets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_presets TO authenticated;
GRANT ALL ON public.package_presets TO service_role;

ALTER TABLE IF EXISTS public.imported_product_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS imported_product_images_admin_all ON public.imported_product_images;
CREATE POLICY imported_product_images_admin_all ON public.imported_product_images
  FOR ALL TO authenticated
  USING (COALESCE(public.is_admin(), false))
  WITH CHECK (COALESCE(public.is_admin(), false));
REVOKE ALL ON public.imported_product_images FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imported_product_images TO authenticated;
GRANT ALL ON public.imported_product_images TO service_role;

-- ---------------------------------------------------------------------------
-- Webhook ingestion — service_role only (no client policies)
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;

ALTER TABLE IF EXISTS public.shippo_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shippo_webhook_events FROM anon, authenticated;
GRANT ALL ON public.shippo_webhook_events TO service_role;

-- ---------------------------------------------------------------------------
-- coupon_attempt_logs — admin read; writes via service_role / RPC
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.coupon_attempt_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coupon_attempt_logs_admin_select ON public.coupon_attempt_logs;
CREATE POLICY coupon_attempt_logs_admin_select ON public.coupon_attempt_logs
  FOR SELECT TO authenticated
  USING (COALESCE(public.is_admin(), false));
REVOKE ALL ON public.coupon_attempt_logs FROM anon;
GRANT SELECT ON public.coupon_attempt_logs TO authenticated;
GRANT ALL ON public.coupon_attempt_logs TO service_role;

-- ---------------------------------------------------------------------------
-- analytics_daily — admin read; writes via service_role / RPC
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.analytics_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytics_daily_admin_select ON public.analytics_daily;
CREATE POLICY analytics_daily_admin_select ON public.analytics_daily
  FOR SELECT TO authenticated
  USING (COALESCE(public.is_admin(), false));
REVOKE ALL ON public.analytics_daily FROM anon;
GRANT SELECT ON public.analytics_daily TO authenticated;
GRANT ALL ON public.analytics_daily TO service_role;

-- ---------------------------------------------------------------------------
-- inventory_issue_snapshots — admin read; writes via service_role / RPC
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.inventory_issue_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_issue_snapshots_admin_select ON public.inventory_issue_snapshots;
CREATE POLICY inventory_issue_snapshots_admin_select ON public.inventory_issue_snapshots
  FOR SELECT TO authenticated
  USING (COALESCE(public.is_admin(), false));
REVOKE ALL ON public.inventory_issue_snapshots FROM anon;
GRANT SELECT ON public.inventory_issue_snapshots TO authenticated;
GRANT ALL ON public.inventory_issue_snapshots TO service_role;

COMMIT;

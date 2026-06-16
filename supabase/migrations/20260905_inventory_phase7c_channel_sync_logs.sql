-- 20260905_inventory_phase7c_channel_sync_logs.sql
--
-- Phase 7C — inventory channel sync run/result audit log (Amazon FBM qty push).
-- Logs do not affect stock truth; service_role writes from edge functions.

CREATE TABLE IF NOT EXISTS public.inventory_channel_sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         text NOT NULL DEFAULT 'amazon',
  mode            text NOT NULL CHECK (mode IN ('dry_run', 'push')),
  status          text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'complete', 'failed', 'partial')),
  requested_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  candidate_count integer NOT NULL DEFAULT 0,
  success_count   integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  skipped_count   integer NOT NULL DEFAULT 0,
  notes           text
);

COMMENT ON TABLE public.inventory_channel_sync_runs IS
  'Audit log for inventory channel quantity sync runs (Phase 7C+). Does not mutate stock.';

CREATE INDEX IF NOT EXISTS idx_inv_channel_sync_runs_channel_started
  ON public.inventory_channel_sync_runs (channel, started_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_channel_sync_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.inventory_channel_sync_runs(id) ON DELETE CASCADE,
  variant_id      uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_id      uuid REFERENCES public.products(id) ON DELETE SET NULL,
  amazon_listing_id uuid REFERENCES public.amazon_listings(id) ON DELETE SET NULL,
  seller_sku      text,
  marketplace_id  text,
  previous_qty    integer,
  target_qty      integer,
  status          text NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  action          text,
  error_code      text,
  error_message   text,
  response_ref    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_channel_sync_results IS
  'Per-row results for inventory channel sync runs.';

CREATE INDEX IF NOT EXISTS idx_inv_channel_sync_results_run
  ON public.inventory_channel_sync_results (run_id);

ALTER TABLE public.inventory_channel_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_channel_sync_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_channel_sync_runs_service_role_all
  ON public.inventory_channel_sync_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_channel_sync_results_service_role_all
  ON public.inventory_channel_sync_results FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_channel_sync_runs_authenticated_select
  ON public.inventory_channel_sync_runs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY inventory_channel_sync_results_authenticated_select
  ON public.inventory_channel_sync_results FOR SELECT TO authenticated
  USING (true);

GRANT ALL ON public.inventory_channel_sync_runs TO service_role;
GRANT ALL ON public.inventory_channel_sync_results TO service_role;
GRANT SELECT ON public.inventory_channel_sync_runs TO authenticated;
GRANT SELECT ON public.inventory_channel_sync_results TO authenticated;

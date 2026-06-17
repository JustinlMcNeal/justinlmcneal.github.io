-- Phase 059A.4 — correlate inventory channel sync runs with manual adjust orchestration.

ALTER TABLE public.inventory_channel_sync_runs
  ADD COLUMN IF NOT EXISTS trigger_source text,
  ADD COLUMN IF NOT EXISTS trigger_reference_type text,
  ADD COLUMN IF NOT EXISTS trigger_reference_id uuid,
  ADD COLUMN IF NOT EXISTS stock_ledger_id uuid REFERENCES public.stock_ledger(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS orchestration_id text;

COMMENT ON COLUMN public.inventory_channel_sync_runs.trigger_source IS
  'Origin of sync run, e.g. manual_adjust from Adjust orchestrator (059A.4).';
COMMENT ON COLUMN public.inventory_channel_sync_runs.stock_ledger_id IS
  'Optional stock_ledger row that triggered this channel sync.';
COMMENT ON COLUMN public.inventory_channel_sync_runs.orchestration_id IS
  'Client orchestration / adjust idempotency correlation id.';

CREATE INDEX IF NOT EXISTS idx_inv_channel_sync_runs_orchestration
  ON public.inventory_channel_sync_runs (orchestration_id)
  WHERE orchestration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inv_channel_sync_runs_stock_ledger
  ON public.inventory_channel_sync_runs (stock_ledger_id)
  WHERE stock_ledger_id IS NOT NULL;

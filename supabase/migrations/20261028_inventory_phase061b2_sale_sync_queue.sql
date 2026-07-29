-- Phase 061B.2 — Sale-triggered channel sync queue (worker processes jobs; no sale trigger wiring in 061B.2).

CREATE TABLE IF NOT EXISTS public.inventory_sale_sync_queue (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  available_at          timestamptz NOT NULL DEFAULT now(),
  locked_at             timestamptz,
  locked_by             text,
  attempt_count         integer NOT NULL DEFAULT 0,
  max_attempts          integer NOT NULL DEFAULT 5,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'processing', 'succeeded', 'dry_run',
                          'skipped', 'partial', 'failed', 'dead'
                        )),
  source_channel        text NOT NULL
                        CHECK (source_channel IN ('kk', 'amazon', 'ebay')),
  target_channels       text[] NOT NULL DEFAULT '{}',
  product_id            uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id            uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  available_qty         integer NOT NULL CHECK (available_qty >= 0),
  external_order_id     text,
  external_line_id      text,
  reservation_id        uuid REFERENCES public.inventory_reservations(id) ON DELETE SET NULL,
  hold_action_id        uuid REFERENCES public.inventory_sale_hold_actions(id) ON DELETE SET NULL,
  push_idempotency_key  text NOT NULL,
  sync_context          jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error            text,
  last_result           jsonb,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.inventory_sale_sync_queue IS
  'Phase 061B — queued sale-triggered cross-channel qty push jobs. Processed by process-sale-channel-sync-queue worker.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_sale_sync_queue_push_idempotency
  ON public.inventory_sale_sync_queue (push_idempotency_key);

CREATE INDEX IF NOT EXISTS idx_inv_sale_sync_queue_pending_available
  ON public.inventory_sale_sync_queue (status, available_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_inv_sale_sync_queue_variant
  ON public.inventory_sale_sync_queue (variant_id);

CREATE INDEX IF NOT EXISTS idx_inv_sale_sync_queue_order_line
  ON public.inventory_sale_sync_queue (external_order_id, external_line_id)
  WHERE external_order_id IS NOT NULL AND external_line_id IS NOT NULL;

ALTER TABLE public.inventory_sale_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_sale_sync_queue_service_role_all
  ON public.inventory_sale_sync_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON public.inventory_sale_sync_queue TO service_role;

-- Atomic claim for worker (service role only).
CREATE OR REPLACE FUNCTION public.claim_inventory_sale_sync_jobs(
  p_limit     integer DEFAULT 10,
  p_worker_id text DEFAULT 'worker'
)
RETURNS SETOF public.inventory_sale_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.inventory_sale_sync_queue q
    WHERE q.status = 'pending'
      AND q.available_at <= now()
    ORDER BY q.available_at ASC, q.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.inventory_sale_sync_queue q
    SET
      status = 'processing',
      locked_at = now(),
      locked_by = NULLIF(BTRIM(COALESCE(p_worker_id, 'worker')), ''),
      updated_at = now()
    FROM picked
    WHERE q.id = picked.id
      AND q.status = 'pending'
    RETURNING q.*
  )
  SELECT * FROM updated;
END;
$$;

COMMENT ON FUNCTION public.claim_inventory_sale_sync_jobs IS
  'Worker: atomically claim pending sale sync queue jobs (Phase 061B.2).';

GRANT EXECUTE ON FUNCTION public.claim_inventory_sale_sync_jobs TO service_role;

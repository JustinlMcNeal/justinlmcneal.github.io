-- Phase 10N — Persisted marketplace refund/cancel observations (read-only, no inventory mutations).

CREATE TABLE IF NOT EXISTS public.marketplace_refund_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel text NOT NULL CHECK (source_channel IN ('ebay', 'amazon')),
  source_order_id text NOT NULL,
  source_order_item_id text,
  external_refund_id text,
  external_transaction_id text,
  external_event_id text,
  refund_amount_cents integer,
  currency text DEFAULT 'usd',
  refund_status text,
  refund_reason text,
  cancellation_status text,
  return_status text,
  quantity_refunded numeric,
  quantity_returned numeric,
  line_allocation_confidence text NOT NULL DEFAULT 'order_level',
  fulfillment_channel text,
  is_afn boolean NOT NULL DEFAULT false,
  observation_kind text NOT NULL DEFAULT 'refund',
  observation_dedup_key text NOT NULL,
  observed_at timestamptz,
  sync_source text NOT NULL DEFAULT 'admin_backfill'
    CHECK (sync_source IN ('order_sync', 'finance_sync', 'webhook', 'admin_backfill')),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_refund_obs_channel_txn_uidx
  ON public.marketplace_refund_observations (source_channel, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_refund_obs_channel_refund_uidx
  ON public.marketplace_refund_observations (source_channel, external_refund_id)
  WHERE external_refund_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_refund_obs_dedup_key_uidx
  ON public.marketplace_refund_observations (source_channel, observation_dedup_key);

CREATE INDEX IF NOT EXISTS marketplace_refund_obs_order_idx
  ON public.marketplace_refund_observations (source_order_id);

CREATE INDEX IF NOT EXISTS marketplace_refund_obs_observed_at_idx
  ON public.marketplace_refund_observations (observed_at DESC);

COMMENT ON TABLE public.marketplace_refund_observations IS
  'Phase 10N: persisted read-only eBay/Amazon refund/cancel/return observations for inventory guidance.';

ALTER TABLE public.marketplace_refund_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketplace_refund_observations_select_authenticated
  ON public.marketplace_refund_observations FOR SELECT TO authenticated USING (true);

CREATE POLICY marketplace_refund_observations_service_role
  ON public.marketplace_refund_observations FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.marketplace_refund_observations TO authenticated;
GRANT ALL ON public.marketplace_refund_observations TO service_role;

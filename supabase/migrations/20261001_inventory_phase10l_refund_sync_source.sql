-- Phase 10L — refund detail sync_source for webhook vs admin refresh tracking.

ALTER TABLE public.order_refund_details
  ADD COLUMN IF NOT EXISTS sync_source text
    CHECK (sync_source IS NULL OR sync_source IN ('webhook', 'admin_refresh'));

COMMENT ON COLUMN public.order_refund_details.sync_source IS
  'Phase 10L: how this row was last written — webhook enrichment or admin refresh.';

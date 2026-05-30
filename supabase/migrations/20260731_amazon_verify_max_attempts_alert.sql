-- Phase 2U — Dedupe operator alerts when auto-verify hits max_attempts.

ALTER TABLE public.amazon_listing_drafts
  ADD COLUMN IF NOT EXISTS verify_max_attempts_alerted_at timestamptz;

COMMENT ON COLUMN public.amazon_listing_drafts.verify_max_attempts_alerted_at IS
  'When operator alert (Slack/email) was sent for verify_status=max_attempts. Cleared on requeue.';

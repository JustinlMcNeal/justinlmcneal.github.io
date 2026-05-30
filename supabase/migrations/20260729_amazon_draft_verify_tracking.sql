-- Phase 2Q — Scheduled verification retry tracking for submitted Amazon drafts.

ALTER TABLE public.amazon_listing_drafts
  ADD COLUMN IF NOT EXISTS verify_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_verify_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_verify_after timestamptz,
  ADD COLUMN IF NOT EXISTS verify_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS verify_last_error text;

ALTER TABLE public.amazon_listing_drafts
  DROP CONSTRAINT IF EXISTS amazon_listing_drafts_verify_status_check;

ALTER TABLE public.amazon_listing_drafts
  ADD CONSTRAINT amazon_listing_drafts_verify_status_check
  CHECK (verify_status IN (
    'idle', 'queued', 'running', 'verified', 'not_found', 'failed', 'max_attempts'
  ));

CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_verify_queue
  ON public.amazon_listing_drafts (draft_status, next_verify_after, verify_attempts)
  WHERE draft_status = 'submitted';

COMMENT ON COLUMN public.amazon_listing_drafts.verify_attempts IS
  'Count of automated verification attempts (cron). Manual verify does not increment.';
COMMENT ON COLUMN public.amazon_listing_drafts.next_verify_after IS
  'Earliest time cron should retry read-only verification for this draft.';
COMMENT ON COLUMN public.amazon_listing_drafts.verify_status IS
  'Automated verification state: idle, queued, running, verified, not_found, failed, max_attempts.';

-- Extend drafts/issues read model with retry metadata.
CREATE OR REPLACE VIEW public.v_amazon_drafts_issues AS
WITH issue_stats AS (
  SELECT
    i.draft_id,
    COUNT(*) FILTER (WHERE i.status = 'open') AS issue_count,
    MAX(
      CASE i.severity
        WHEN 'error'   THEN 3
        WHEN 'warning' THEN 2
        WHEN 'info'    THEN 1
        ELSE 0
      END
    ) FILTER (WHERE i.status = 'open') AS latest_issue_severity_rank
  FROM public.amazon_listing_issues i
  WHERE i.draft_id IS NOT NULL
  GROUP BY i.draft_id
)
SELECT
  d.id                              AS draft_id,
  d.published_amazon_listing_id     AS amazon_listing_id,
  d.kk_product_id,
  d.kk_sku,
  p.name                            AS kk_product_title,
  d.marketplace_id,
  d.seller_sku,
  d.asin,
  d.matched_asin,
  d.product_type,
  d.draft_status,
  d.submission_status,
  d.validation_errors,
  d.last_validation_result,
  d.last_submission_response,
  COALESCE(ist.issue_count, 0)    AS issue_count,
  CASE COALESCE(ist.latest_issue_severity_rank, 0)
    WHEN 3 THEN 'error'
    WHEN 2 THEN 'warning'
    WHEN 1 THEN 'info'
    ELSE NULL
  END                               AS latest_issue_severity,
  d.draft_payload,
  d.verify_attempts,
  d.last_verify_attempt_at,
  d.next_verify_after,
  d.verify_status,
  d.verify_last_error,
  d.updated_at,
  d.created_at
FROM public.amazon_listing_drafts d
LEFT JOIN public.products p
  ON p.id = d.kk_product_id
LEFT JOIN issue_stats ist
  ON ist.draft_id = d.id
WHERE d.draft_status NOT IN ('published', 'archived');

GRANT SELECT ON public.v_amazon_drafts_issues TO authenticated, service_role;

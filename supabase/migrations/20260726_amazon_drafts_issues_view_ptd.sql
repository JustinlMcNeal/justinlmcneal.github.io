-- Extend v_amazon_drafts_issues with PTD preview metadata.

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
  COALESCE(ist.issue_count, 0)    AS issue_count,
  CASE COALESCE(ist.latest_issue_severity_rank, 0)
    WHEN 3 THEN 'error'
    WHEN 2 THEN 'warning'
    WHEN 1 THEN 'info'
    ELSE NULL
  END                               AS latest_issue_severity,
  d.draft_payload,
  d.updated_at,
  d.created_at
FROM public.amazon_listing_drafts d
LEFT JOIN public.products p
  ON p.id = d.kk_product_id
LEFT JOIN issue_stats ist
  ON ist.draft_id = d.id
WHERE d.draft_status NOT IN ('published', 'archived');

GRANT SELECT ON public.v_amazon_drafts_issues TO authenticated, service_role;

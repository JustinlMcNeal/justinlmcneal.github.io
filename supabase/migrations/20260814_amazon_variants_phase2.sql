-- Phase 7A.2 — Amazon variation family metadata on drafts.



ALTER TABLE public.amazon_listing_drafts

  ADD COLUMN IF NOT EXISTS variation_role text

    CHECK (variation_role IS NULL OR variation_role IN ('standalone', 'parent', 'child'))

    DEFAULT 'standalone';



ALTER TABLE public.amazon_listing_drafts

  ADD COLUMN IF NOT EXISTS parent_draft_id uuid

    REFERENCES public.amazon_listing_drafts(id) ON DELETE SET NULL;



ALTER TABLE public.amazon_listing_drafts

  ADD COLUMN IF NOT EXISTS parent_seller_sku text;



ALTER TABLE public.amazon_listing_drafts

  ADD COLUMN IF NOT EXISTS variation_theme text;



COMMENT ON COLUMN public.amazon_listing_drafts.variation_role IS

  'standalone = normal SKU; parent = variation family shell; child = variant linked to parent_seller_sku.';



CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_variation_parent

  ON public.amazon_listing_drafts (kk_product_id, variation_role)

  WHERE variation_role = 'parent'

    AND draft_status NOT IN ('published', 'archived');



CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_parent_draft

  ON public.amazon_listing_drafts (parent_draft_id)

  WHERE parent_draft_id IS NOT NULL;



-- Expose variation columns on drafts/issues view (rebuild from 20260813 base).

DROP VIEW IF EXISTS public.v_amazon_drafts_issues CASCADE;



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

  d.kk_variant_id,

  pv.option_value                   AS kk_variant_label,

  d.kk_sku,

  p.name                            AS kk_product_title,

  d.marketplace_id,

  d.seller_sku,

  d.asin,

  d.matched_asin,

  d.product_type,

  d.draft_status,

  d.submission_status,

  d.variation_role,

  d.parent_draft_id,

  d.parent_seller_sku,

  d.variation_theme,

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

LEFT JOIN public.product_variants pv

  ON pv.id = d.kk_variant_id

LEFT JOIN issue_stats ist

  ON ist.draft_id = d.id

WHERE d.draft_status NOT IN ('published', 'archived');



GRANT SELECT ON public.v_amazon_drafts_issues TO authenticated, service_role;



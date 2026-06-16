-- Phase 8C — mapping assist suggestions, audit log, and admin apply RPC.
-- Assistive only: no stock/reservation/channel API mutations.

CREATE TABLE IF NOT EXISTS public.inventory_mapping_assist_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type            text NOT NULL,
  source_channel        text,
  source_reference      text,
  source_sku            text,
  source_title          text,
  selected_product_id   uuid REFERENCES public.products(id) ON DELETE SET NULL,
  selected_variant_id   uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  amazon_listing_id     uuid REFERENCES public.amazon_listings(id) ON DELETE SET NULL,
  action_type           text NOT NULL
                        CHECK (action_type IN ('order_line_variant', 'amazon_variant_mapping')),
  status                text NOT NULL DEFAULT 'success'
                        CHECK (status IN ('success', 'failed', 'cancelled')),
  confidence            text,
  note                  text,
  before_snapshot       jsonb,
  after_snapshot        jsonb,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_mapping_assist_actions IS
  'Audit log for inventory mapping assist wizard actions (Phase 8C).';

CREATE INDEX IF NOT EXISTS idx_inv_mapping_assist_actions_issue_type
  ON public.inventory_mapping_assist_actions (issue_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_mapping_assist_actions_created_at
  ON public.inventory_mapping_assist_actions (created_at DESC);

ALTER TABLE public.inventory_mapping_assist_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_mapping_assist_actions_service_role_all
  ON public.inventory_mapping_assist_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_mapping_assist_actions_authenticated_select
  ON public.inventory_mapping_assist_actions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY inventory_mapping_assist_actions_authenticated_insert
  ON public.inventory_mapping_assist_actions FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT ALL ON public.inventory_mapping_assist_actions TO service_role;
GRANT SELECT, INSERT ON public.inventory_mapping_assist_actions TO authenticated;

-- Read-only mapping suggestions for assist wizard.
CREATE OR REPLACE VIEW public.v_inventory_mapping_suggestions AS
WITH unmapped AS (
  SELECT *
  FROM public.v_inventory_unmapped_order_lines
  WHERE reason <> 'afn_skip'
),
unmapped_ranked AS (
  SELECT
    'unmapped_order_line'::text AS issue_type,
    u.source_channel,
    u.source_order_id,
    u.source_order_item_id,
    u.sku AS source_sku,
    u.title AS source_title,
    u.listing_id AS source_asin,
    u.ebay_item_id AS source_listing_id,
    u.reason AS source_reason,
    u.recommended_action,
    cand.suggested_product_id,
    cand.suggested_variant_id,
    cand.suggested_product_label,
    cand.suggested_internal_sku,
    cand.match_type,
    cand.confidence,
    cand.confidence_reason,
    cand.is_safe_auto_apply,
    ROW_NUMBER() OVER (
      PARTITION BY u.source_order_id, u.source_order_item_id
      ORDER BY cand.rank_score DESC, cand.suggested_variant_id NULLS LAST
    ) AS rn
  FROM unmapped u
  LEFT JOIN LATERAL (
    SELECT * FROM (
      -- exact variant SKU
      SELECT
        p.id AS suggested_product_id,
        pv.id AS suggested_variant_id,
        p.name AS suggested_product_label,
        COALESCE(pv.sku, p.code) AS suggested_internal_sku,
        'exact_sku'::text AS match_type,
        'high'::text AS confidence,
        'Variant SKU matches order line SKU'::text AS confidence_reason,
        true AS is_safe_auto_apply,
        100 AS rank_score
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE COALESCE(pv.is_active, true)
        AND COALESCE(p.is_active, true)
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(pv.sku) = BTRIM(u.sku)
      UNION ALL
      -- product code + single active variant
      SELECT
        p.id,
        pv.id,
        p.name,
        COALESCE(pv.sku, p.code),
        'product_code'::text,
        'high'::text,
        'Product code matches and product has one active variant'::text,
        true,
        90
      FROM public.products p
      JOIN public.product_variants pv ON pv.product_id = p.id AND COALESCE(pv.is_active, true)
      WHERE COALESCE(p.is_active, true)
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND (SELECT COUNT(*) FROM public.product_variants pv2
             WHERE pv2.product_id = p.id AND COALESCE(pv2.is_active, true)) = 1
      UNION ALL
      -- product code known (multi-variant) — suggestion only
      SELECT
        p.id,
        pv.id,
        p.name,
        COALESCE(pv.sku, p.code),
        'product_code'::text,
        'medium'::text,
        'Product code matches — confirm correct variant'::text,
        false,
        70
      FROM public.products p
      JOIN public.product_variants pv ON pv.product_id = p.id AND COALESCE(pv.is_active, true)
      WHERE COALESCE(p.is_active, true)
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND (SELECT COUNT(*) FROM public.product_variants pv2
             WHERE pv2.product_id = p.id AND COALESCE(pv2.is_active, true)) > 1
      UNION ALL
      -- Amazon seller SKU listing exists
      SELECT
        p.id,
        pv.id,
        p.name,
        COALESCE(pv.sku, al.seller_sku),
        'seller_sku'::text,
        'high'::text,
        'Amazon listing seller SKU matches line SKU'::text,
        false,
        85
      FROM public.amazon_listings al
      LEFT JOIN public.amazon_listing_mappings m
        ON m.amazon_listing_id = al.id AND m.mapping_status = 'mapped'
      LEFT JOIN public.products p ON p.id = m.kk_product_id
      LEFT JOIN public.product_variants pv ON pv.id = m.kk_variant_id
      WHERE u.source_channel = 'amazon'
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(al.seller_sku) = BTRIM(u.sku)
        AND p.id IS NOT NULL
        AND pv.id IS NOT NULL
    ) s
  ) cand ON true
),
amazon_gaps AS (
  SELECT
    pv.id AS variant_id,
    pv.product_id,
    pv.sku AS variant_sku,
    p.name AS product_name,
    p.code AS product_code
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE COALESCE(pv.is_active, true)
    AND COALESCE(p.is_active, true)
    AND EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m2
      WHERE m2.kk_product_id = p.id AND m2.mapping_status = 'mapped'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m3
      WHERE m3.kk_variant_id = pv.id AND m3.mapping_status = 'mapped'
    )
),
amazon_ranked AS (
  SELECT
    'amazon_mapping_missing'::text AS issue_type,
    'amazon'::text AS source_channel,
    NULL::text AS source_order_id,
    ag.variant_id::text AS source_order_item_id,
    COALESCE(al.seller_sku, ag.variant_sku, ag.product_code) AS source_sku,
    ag.product_name AS source_title,
    al.asin AS source_asin,
    al.id::text AS source_listing_id,
    'missing_variant_mapping'::text AS source_reason,
    'Map Amazon listing to KK variant'::text AS recommended_action,
    ag.product_id AS suggested_product_id,
    ag.variant_id AS suggested_variant_id,
    ag.product_name AS suggested_product_label,
    COALESCE(ag.variant_sku, ag.product_code) AS suggested_internal_sku,
    CASE
      WHEN al.seller_sku IS NOT NULL AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, '')) THEN 'exact_sku'
      WHEN al.id IS NOT NULL THEN 'seller_sku'
      ELSE 'manual_required'
    END AS match_type,
    CASE
      WHEN al.seller_sku IS NOT NULL AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, '')) THEN 'high'
      WHEN al.id IS NOT NULL THEN 'medium'
      ELSE 'low'
    END AS confidence,
    CASE
      WHEN al.seller_sku IS NOT NULL AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, ''))
        THEN 'Variant SKU matches Amazon seller SKU'
      WHEN al.id IS NOT NULL THEN 'Product-level Amazon listing exists — confirm variant'
      ELSE 'Select Amazon listing and variant manually'
    END AS confidence_reason,
    (
      al.seller_sku IS NOT NULL
      AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, ''))
    ) AS is_safe_auto_apply,
    ROW_NUMBER() OVER (
      PARTITION BY ag.variant_id
      ORDER BY
        CASE WHEN al.seller_sku IS NOT NULL AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, '')) THEN 0 ELSE 1 END,
        al.last_synced_at DESC NULLS LAST
    ) AS rn
  FROM amazon_gaps ag
  LEFT JOIN public.amazon_listings al
    ON BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, ag.product_code, ''))
    OR al.id IN (
      SELECT m.amazon_listing_id
      FROM public.amazon_listing_mappings m
      WHERE m.kk_product_id = ag.product_id
        AND m.mapping_status = 'mapped'
    )
)
SELECT
  issue_type, source_channel, source_order_id, source_order_item_id,
  source_sku, source_title, source_asin, source_listing_id,
  source_reason, recommended_action,
  suggested_product_id, suggested_variant_id,
  suggested_product_label, suggested_internal_sku,
  match_type, confidence, confidence_reason, is_safe_auto_apply
FROM unmapped_ranked
WHERE rn = 1

UNION ALL

SELECT
  issue_type, source_channel, source_order_id, source_order_item_id,
  source_sku, source_title, source_asin, source_listing_id,
  source_reason, recommended_action,
  suggested_product_id, suggested_variant_id,
  suggested_product_label, suggested_internal_sku,
  match_type, confidence, confidence_reason, is_safe_auto_apply
FROM amazon_ranked
WHERE rn = 1;

COMMENT ON VIEW public.v_inventory_mapping_suggestions IS
  'Best-effort mapping suggestions for inventory assist wizard (Phase 8C). Not auto-applied.';

GRANT SELECT ON public.v_inventory_mapping_suggestions TO authenticated, service_role;

-- Admin-only apply RPC (mapping tables / order line variant_id only).
CREATE OR REPLACE FUNCTION public.apply_inventory_mapping_assist(
  p_action_type         text,
  p_issue_type          text,
  p_source_order_id     text DEFAULT NULL,
  p_source_order_item_id text DEFAULT NULL,
  p_amazon_listing_id   uuid DEFAULT NULL,
  p_selected_product_id uuid DEFAULT NULL,
  p_selected_variant_id uuid DEFAULT NULL,
  p_confidence          text DEFAULT NULL,
  p_note                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor           uuid := auth.uid();
  v_is_admin        boolean := false;
  v_line            public.line_items_raw%ROWTYPE;
  v_variant         public.product_variants%ROWTYPE;
  v_product         public.products%ROWTYPE;
  v_listing         public.amazon_listings%ROWTYPE;
  v_before          jsonb;
  v_after           jsonb;
  v_mapping_id      uuid;
  v_audit_id        uuid;
  v_now             timestamptz := now();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_action_type NOT IN ('order_line_variant', 'amazon_variant_mapping') THEN
    RAISE EXCEPTION 'Invalid action_type' USING ERRCODE = 'P0001';
  END IF;

  IF p_selected_variant_id IS NULL THEN
    RAISE EXCEPTION 'selected_variant_id is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_variant
  FROM public.product_variants
  WHERE id = p_selected_variant_id;

  IF NOT FOUND OR COALESCE(v_variant.is_active, true) = false THEN
    RAISE EXCEPTION 'Variant not found or inactive' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = v_variant.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0001';
  END IF;

  IF p_selected_product_id IS NOT NULL AND p_selected_product_id <> v_variant.product_id THEN
    RAISE EXCEPTION 'Variant does not belong to selected product' USING ERRCODE = 'P0001';
  END IF;

  IF p_action_type = 'order_line_variant' THEN
    IF p_source_order_id IS NULL OR p_source_order_item_id IS NULL THEN
      RAISE EXCEPTION 'Order line identifiers required' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_line
    FROM public.line_items_raw
    WHERE stripe_checkout_session_id = p_source_order_id
      AND stripe_line_item_id = p_source_order_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order line not found' USING ERRCODE = 'P0001';
    END IF;

    IF v_line.variant_id IS NOT NULL THEN
      RAISE EXCEPTION 'Order line already has variant_id' USING ERRCODE = 'P0001';
    END IF;

    v_before := jsonb_build_object(
      'variant_id', v_line.variant_id,
      'variant_sku', v_line.variant_sku,
      'product_id', v_line.product_id
    );

    UPDATE public.line_items_raw
    SET
      variant_id = v_variant.id,
      variant_sku = v_variant.sku,
      variant_title = COALESCE(v_variant.title, v_variant.option_value, v_variant.option_name),
      selected_options = CASE
        WHEN v_variant.option_name IS NOT NULL OR v_variant.option_value IS NOT NULL THEN
          jsonb_build_array(
            jsonb_strip_nulls(
              jsonb_build_object('name', v_variant.option_name, 'value', v_variant.option_value)
            )
          )
        ELSE selected_options
      END,
      updated_at = v_now
    WHERE stripe_checkout_session_id = p_source_order_id
      AND stripe_line_item_id = p_source_order_item_id;

    v_after := jsonb_build_object(
      'variant_id', v_variant.id,
      'variant_sku', v_variant.sku,
      'product_id', v_line.product_id
    );

    INSERT INTO public.inventory_mapping_assist_actions (
      issue_type, source_channel, source_reference, source_sku, source_title,
      selected_product_id, selected_variant_id, action_type, status,
      confidence, note, before_snapshot, after_snapshot, created_by
    ) VALUES (
      COALESCE(p_issue_type, 'unmapped_order_line'),
      CASE
        WHEN p_source_order_id LIKE 'ebay_%' THEN 'ebay'
        WHEN p_source_order_id LIKE 'amazon_%' THEN 'amazon'
        ELSE 'kk'
      END,
      p_source_order_id || ':' || p_source_order_item_id,
      v_line.product_id,
      v_line.product_name,
      v_variant.product_id,
      v_variant.id,
      'order_line_variant',
      'success',
      p_confidence,
      p_note,
      v_before,
      v_after,
      v_actor
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action_type', 'order_line_variant',
      'audit_id', v_audit_id,
      'variant_id', v_variant.id
    );
  END IF;

  -- amazon_variant_mapping
  IF p_amazon_listing_id IS NULL THEN
    RAISE EXCEPTION 'amazon_listing_id is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_listing FROM public.amazon_listings WHERE id = p_amazon_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amazon listing not found' USING ERRCODE = 'P0001';
  END IF;

  v_before := (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'mapping_id', m.id,
      'kk_product_id', m.kk_product_id,
      'kk_variant_id', m.kk_variant_id,
      'mapping_status', m.mapping_status
    )), '[]'::jsonb)
    FROM public.amazon_listing_mappings m
    WHERE m.amazon_listing_id = p_amazon_listing_id
      AND m.mapping_status = 'mapped'
  );

  UPDATE public.amazon_listing_mappings
  SET mapping_status = 'legacy', updated_at = v_now
  WHERE amazon_listing_id = p_amazon_listing_id
    AND mapping_status = 'mapped';

  UPDATE public.amazon_listing_mappings
  SET mapping_status = 'legacy', updated_at = v_now
  WHERE kk_product_id = v_variant.product_id
    AND kk_variant_id = v_variant.id
    AND mapping_status = 'mapped';

  INSERT INTO public.amazon_listing_mappings (
    amazon_listing_id,
    kk_product_id,
    kk_variant_id,
    kk_sku,
    mapping_status,
    mapping_confidence,
    mapped_by,
    mapped_at,
    notes,
    updated_at
  ) VALUES (
    p_amazon_listing_id,
    v_variant.product_id,
    v_variant.id,
    COALESCE(v_variant.sku, v_product.code),
    'mapped',
    COALESCE(NULLIF(BTRIM(p_confidence), ''), 'manual'),
    v_actor,
    v_now,
    COALESCE(p_note, 'Applied via inventory mapping assist wizard'),
    v_now
  )
  RETURNING id INTO v_mapping_id;

  v_after := jsonb_build_object(
    'mapping_id', v_mapping_id,
    'amazon_listing_id', p_amazon_listing_id,
    'kk_product_id', v_variant.product_id,
    'kk_variant_id', v_variant.id
  );

  INSERT INTO public.inventory_mapping_assist_actions (
    issue_type, source_channel, source_reference, source_sku, source_title,
    selected_product_id, selected_variant_id, amazon_listing_id,
    action_type, status, confidence, note, before_snapshot, after_snapshot, created_by
  ) VALUES (
    COALESCE(p_issue_type, 'amazon_mapping_missing'),
    'amazon',
    p_amazon_listing_id::text,
    v_listing.seller_sku,
    v_listing.amazon_title,
    v_variant.product_id,
    v_variant.id,
    p_amazon_listing_id,
    'amazon_variant_mapping',
    'success',
    p_confidence,
    p_note,
    v_before,
    v_after,
    v_actor
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'action_type', 'amazon_variant_mapping',
    'audit_id', v_audit_id,
    'mapping_id', v_mapping_id
  );
END;
$$;

COMMENT ON FUNCTION public.apply_inventory_mapping_assist IS
  'Admin-only mapping assist apply (order line variant_id or amazon_listing_mappings). No stock/reservation changes.';

GRANT EXECUTE ON FUNCTION public.apply_inventory_mapping_assist TO authenticated;

-- Phase 8H — eBay bulk mapping visibility + selected-line apply.
-- No auto-map, stock/reservation/finalize, or channel API writes.

CREATE TABLE IF NOT EXISTS public.inventory_mapping_assist_batches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel        text NOT NULL DEFAULT 'ebay',
  group_type            text,
  group_key             text,
  selected_count        integer NOT NULL DEFAULT 0,
  success_count         integer NOT NULL DEFAULT 0,
  failed_count          integer NOT NULL DEFAULT 0,
  skipped_count         integer NOT NULL DEFAULT 0,
  selected_product_id   uuid REFERENCES public.products(id) ON DELETE SET NULL,
  selected_variant_id   uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  confidence            text,
  note                  text,
  results               jsonb,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_mapping_assist_batches IS
  'Batch wrapper audit for selected-line eBay mapping apply (Phase 8H). Per-line audit in inventory_mapping_assist_actions.';

CREATE INDEX IF NOT EXISTS idx_inv_mapping_assist_batches_created
  ON public.inventory_mapping_assist_batches (created_at DESC);

ALTER TABLE public.inventory_mapping_assist_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_mapping_assist_batches_service_role_all
  ON public.inventory_mapping_assist_batches FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_mapping_assist_batches_authenticated_select
  ON public.inventory_mapping_assist_batches FOR SELECT TO authenticated USING (true);

CREATE POLICY inventory_mapping_assist_batches_authenticated_insert
  ON public.inventory_mapping_assist_batches FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON public.inventory_mapping_assist_batches TO authenticated;
GRANT ALL ON public.inventory_mapping_assist_batches TO service_role;

-- Line-level detail for eBay unmapped rows (reused by worklist + review).
CREATE OR REPLACE VIEW public.v_inventory_ebay_mapping_worklist_lines AS
WITH ebay_line_detail AS (
  SELECT
    u.source_order_id,
    u.source_order_item_id,
    'ebay'::text AS source_channel,
    NULLIF(BTRIM(u.sku), '') AS source_sku,
    NULLIF(BTRIM(u.title), '') AS source_title,
    u.quantity,
    NULLIF(BTRIM(p.code), '') AS product_code,
    NULLIF(BTRIM(COALESCE(p.ebay_listing_id, s.source_listing_id)), '') AS ebay_listing_id,
    s.match_type,
    s.confidence,
    s.confidence_reason,
    COALESCE(s.variant_pick_required, false) AS variant_pick_required,
    s.suggested_product_id,
    s.suggested_variant_id,
    s.suggested_product_label,
    s.suggested_internal_sku,
    COALESCE(fs.label_status, 'pending') AS fulfillment_status,
    (COALESCE(fs.label_status, 'pending') IN ('shipped', 'delivered')) AS is_shipped
  FROM public.v_inventory_unmapped_order_lines u
  JOIN public.line_items_raw li
    ON li.stripe_checkout_session_id = u.source_order_id
   AND li.stripe_line_item_id = u.source_order_item_id
  LEFT JOIN public.fulfillment_shipments fs
    ON fs.stripe_checkout_session_id = u.source_order_id
  LEFT JOIN public.v_inventory_mapping_suggestions s
    ON s.issue_type = 'unmapped_order_line'
   AND s.source_order_id = u.source_order_id
   AND s.source_order_item_id = u.source_order_item_id
  LEFT JOIN public.products p ON BTRIM(p.code) = BTRIM(u.sku)
  WHERE u.source_channel = 'ebay'
    AND u.reason <> 'afn_skip'
),
with_group_sizes AS (
  SELECT
    eld.*,
    COUNT(*) OVER (PARTITION BY eld.source_sku) AS sku_group_size,
    COUNT(*) OVER (PARTITION BY eld.product_code) AS product_code_group_size,
    COUNT(*) OVER (PARTITION BY eld.ebay_listing_id) AS listing_group_size,
    COUNT(*) OVER (PARTITION BY eld.source_title) AS title_group_size
  FROM ebay_line_detail eld
)
SELECT
  group_type,
  group_key,
  source_order_id,
  source_order_item_id,
  source_channel,
  source_sku,
  source_title,
  quantity,
  product_code,
  ebay_listing_id,
  match_type,
  confidence,
  confidence_reason,
  variant_pick_required,
  suggested_product_id,
  suggested_variant_id,
  suggested_product_label,
  suggested_internal_sku,
  fulfillment_status,
  is_shipped
FROM (
  SELECT 'source_sku'::text AS group_type, w.source_sku AS group_key, w.*
  FROM with_group_sizes w
  WHERE w.source_sku IS NOT NULL AND w.sku_group_size > 1

  UNION ALL

  SELECT 'product_code'::text, w.product_code, w.*
  FROM with_group_sizes w
  WHERE w.product_code IS NOT NULL AND w.product_code_group_size > 1

  UNION ALL

  SELECT 'ebay_listing_id'::text, w.ebay_listing_id, w.*
  FROM with_group_sizes w
  WHERE w.ebay_listing_id IS NOT NULL AND w.listing_group_size > 1

  UNION ALL

  SELECT 'title'::text, w.source_title, w.*
  FROM with_group_sizes w
  WHERE w.source_title IS NOT NULL AND w.title_group_size > 1
) grouped;

COMMENT ON VIEW public.v_inventory_ebay_mapping_worklist_lines IS
  'Line-level eBay unmapped rows within repeated mapping groups (Phase 8H).';

-- Grouped worklist summaries.
CREATE OR REPLACE VIEW public.v_inventory_ebay_mapping_worklist AS
WITH lines AS (
  SELECT * FROM public.v_inventory_ebay_mapping_worklist_lines
),
counts AS (
  SELECT
    group_type,
    group_key,
    MAX(source_channel) AS source_channel,
    MAX(source_sku) AS source_sku,
    MAX(source_title) AS source_title,
    MAX(ebay_listing_id) AS ebay_listing_id,
    MAX(product_code) AS product_code,
    COUNT(*)::int AS row_count,
    COUNT(*) FILTER (WHERE is_shipped)::int AS shipped_count,
    COUNT(*) FILTER (WHERE NOT is_shipped)::int AS unshipped_count,
    COALESCE(SUM(quantity), 0)::int AS total_qty,
    COUNT(*) FILTER (WHERE confidence = 'high')::int AS high_confidence_count,
    COUNT(*) FILTER (WHERE confidence = 'medium')::int AS medium_confidence_count,
    COUNT(*) FILTER (WHERE variant_pick_required)::int AS manual_variant_pick_count,
    COUNT(*) FILTER (WHERE suggested_variant_id IS NULL)::int AS no_suggestion_count,
    BOOL_OR(variant_pick_required) AS variant_pick_required
  FROM lines
  GROUP BY group_type, group_key
),
best_suggestion AS (
  SELECT DISTINCT ON (group_type, group_key)
    group_type,
    group_key,
    suggested_product_id,
    suggested_variant_id,
    suggested_product_label,
    suggested_internal_sku,
    confidence,
    confidence_reason
  FROM lines
  WHERE suggested_product_id IS NOT NULL
  ORDER BY
    group_type,
    group_key,
    CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
    CASE WHEN variant_pick_required THEN 1 ELSE 0 END,
    source_order_id
)
SELECT
  c.group_key,
  c.group_type,
  c.source_channel,
  c.source_sku,
  c.source_title,
  c.ebay_listing_id,
  c.row_count,
  c.shipped_count,
  c.unshipped_count,
  c.total_qty,
  c.high_confidence_count,
  c.medium_confidence_count,
  c.manual_variant_pick_count,
  c.no_suggestion_count,
  bs.suggested_product_id,
  CASE WHEN c.variant_pick_required THEN NULL ELSE bs.suggested_variant_id END AS suggested_variant_id,
  bs.suggested_product_label,
  CASE WHEN c.variant_pick_required THEN NULL ELSE bs.suggested_internal_sku END AS suggested_internal_sku,
  bs.confidence,
  bs.confidence_reason,
  c.variant_pick_required,
  CASE
    WHEN c.no_suggestion_count = c.row_count THEN 'manual_search'
    WHEN c.variant_pick_required OR bs.suggested_variant_id IS NULL THEN 'manual_variant_pick'
    WHEN c.high_confidence_count > 0 AND c.manual_variant_pick_count = 0 THEN 'review_and_apply_selected'
    WHEN c.medium_confidence_count > 0 THEN 'manual_variant_pick'
    ELSE 'manual_search'
  END AS recommended_action
FROM counts c
LEFT JOIN best_suggestion bs
  ON bs.group_type = c.group_type AND bs.group_key = c.group_key;

COMMENT ON VIEW public.v_inventory_ebay_mapping_worklist IS
  'Grouped eBay unmapped mapping worklist — visibility only until admin selects lines (Phase 8H).';

GRANT SELECT ON public.v_inventory_ebay_mapping_worklist TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_ebay_mapping_worklist_lines TO authenticated, service_role;

-- Batch apply: calls existing per-line RPC internally; per-line audit preserved.
CREATE OR REPLACE FUNCTION public.apply_inventory_mapping_assist_batch(
  p_lines               jsonb,
  p_group_type          text DEFAULT NULL,
  p_group_key           text DEFAULT NULL,
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
  v_actor       uuid := auth.uid();
  v_is_admin    boolean := false;
  v_line        jsonb;
  v_results     jsonb := '[]'::jsonb;
  v_success     integer := 0;
  v_failed      integer := 0;
  v_skipped     integer := 0;
  v_total       integer := 0;
  v_batch_id    uuid;
  v_one         jsonb;
  v_err         text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_selected_variant_id IS NULL THEN
    RAISE EXCEPTION 'selected_variant_id is required' USING ERRCODE = 'P0001';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line is required' USING ERRCODE = 'P0001';
  END IF;

  v_total := jsonb_array_length(p_lines);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      IF NULLIF(BTRIM(v_line->>'source_order_id'), '') IS NULL
        OR NULLIF(BTRIM(v_line->>'source_order_item_id'), '') IS NULL THEN
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'ok', false, 'skipped', true,
          'source_order_id', v_line->>'source_order_id',
          'source_order_item_id', v_line->>'source_order_item_id',
          'error', 'Missing order line identifiers'
        ));
        CONTINUE;
      END IF;

      v_one := public.apply_inventory_mapping_assist(
        'order_line_variant',
        'unmapped_order_line',
        v_line->>'source_order_id',
        v_line->>'source_order_item_id',
        NULL,
        p_selected_product_id,
        p_selected_variant_id,
        COALESCE(p_confidence, 'manual'),
        COALESCE(p_note, 'Batch mapping apply (Phase 8H)')
      );

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_array(v_one || jsonb_build_object(
        'source_order_id', v_line->>'source_order_id',
        'source_order_item_id', v_line->>'source_order_item_id'
      ));
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'ok', false,
        'source_order_id', v_line->>'source_order_id',
        'source_order_item_id', v_line->>'source_order_item_id',
        'error', v_err
      ));
    END;
  END LOOP;

  INSERT INTO public.inventory_mapping_assist_batches (
    source_channel, group_type, group_key,
    selected_count, success_count, failed_count, skipped_count,
    selected_product_id, selected_variant_id,
    confidence, note, results, created_by
  ) VALUES (
    'ebay', p_group_type, p_group_key,
    v_total, v_success, v_failed, v_skipped,
    p_selected_product_id, p_selected_variant_id,
    p_confidence, p_note, v_results, v_actor
  )
  RETURNING id INTO v_batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'selected_count', v_total,
    'success_count', v_success,
    'failed_count', v_failed,
    'skipped_count', v_skipped,
    'results', v_results
  );
END;
$$;

COMMENT ON FUNCTION public.apply_inventory_mapping_assist_batch IS
  'Admin-only batch wrapper for selected-line mapping apply. No stock/reservation/finalize.';

GRANT EXECUTE ON FUNCTION public.apply_inventory_mapping_assist_batch TO authenticated;

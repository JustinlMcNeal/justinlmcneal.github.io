-- Phase 10A — Bundle/component inventory design + read-only preview.
-- Table + views only. No checkout, reservation, finalize, stock, ledger, or channel sync behavior.

CREATE TABLE IF NOT EXISTS public.inventory_bundle_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_variant_id     uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  component_variant_id  uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  component_qty         numeric(12, 4) NOT NULL,
  rule_type             text NOT NULL DEFAULT 'virtual_bundle'
                        CHECK (rule_type IN ('virtual_bundle', 'separate_stocked')),
  is_active             boolean NOT NULL DEFAULT true,
  notes                 text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_bundle_rules_qty_positive CHECK (component_qty > 0),
  CONSTRAINT inventory_bundle_rules_no_self_reference
    CHECK (bundle_variant_id <> component_variant_id),
  CONSTRAINT inventory_bundle_rules_unique_component
    UNIQUE (bundle_variant_id, component_variant_id)
);

COMMENT ON TABLE public.inventory_bundle_rules IS
  'Future bundle BOM rules (Phase 10A). Configuration only — not consumed by checkout/reservations yet.';

CREATE INDEX IF NOT EXISTS idx_bundle_rules_bundle
  ON public.inventory_bundle_rules (bundle_variant_id);

CREATE INDEX IF NOT EXISTS idx_bundle_rules_component
  ON public.inventory_bundle_rules (component_variant_id);

CREATE INDEX IF NOT EXISTS idx_bundle_rules_active
  ON public.inventory_bundle_rules (is_active)
  WHERE is_active = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_bundle_rules_set_updated_at'
  ) THEN
    CREATE TRIGGER inventory_bundle_rules_set_updated_at
      BEFORE UPDATE ON public.inventory_bundle_rules
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.inventory_bundle_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_bundle_rules_service_role_all
  ON public.inventory_bundle_rules FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_bundle_rules_authenticated_select
  ON public.inventory_bundle_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY inventory_bundle_rules_authenticated_insert
  ON public.inventory_bundle_rules FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY inventory_bundle_rules_authenticated_update
  ON public.inventory_bundle_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY inventory_bundle_rules_authenticated_delete
  ON public.inventory_bundle_rules FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_bundle_rules TO authenticated;
GRANT ALL ON public.inventory_bundle_rules TO service_role;

-- Heuristic bundle-like SKU detection (read-only audit aid).
CREATE OR REPLACE VIEW public.v_inventory_bundle_like_variants AS
SELECT
  pv.id AS variant_id,
  p.id AS product_id,
  COALESCE(NULLIF(BTRIM(p.name), ''), 'Unknown') AS product_label,
  COALESCE(
    NULLIF(BTRIM(pv.title), ''),
    NULLIF(BTRIM(pv.option_value), ''),
    'Default'
  ) AS variant_label,
  NULLIF(BTRIM(pv.sku), '') AS internal_sku,
  COALESCE(pv.stock, 0) AS on_hand,
  CASE
    WHEN p.name ~* '\bx[0-9]+\b' OR COALESCE(pv.title, '') ~* '\bx[0-9]+\b'
      OR COALESCE(pv.sku, '') ~* '\bx[0-9]+\b' THEN 'quantity_suffix'
    WHEN p.name ~* '\d+\s*[- ]?pack\b' OR COALESCE(pv.title, '') ~* '\d+\s*[- ]?pack\b'
      OR COALESCE(pv.sku, '') ~* '\d+pk\b' OR COALESCE(pv.sku, '') ~* '-pk\b'
      OR COALESCE(pv.option_value, '') ~* '\d+\s*[- ]?pack\b' THEN 'pack_pattern'
    WHEN p.name ~* '\bbundle\b' OR COALESCE(pv.title, '') ~* '\bbundle\b'
      OR COALESCE(pv.sku, '') ~* '\bbundle\b' THEN 'bundle_keyword'
    WHEN p.name ~* '\bkit\b' OR COALESCE(pv.title, '') ~* '\bkit\b'
      OR COALESCE(pv.sku, '') ~* '\bkit\b' THEN 'kit_keyword'
    ELSE 'other'
  END AS detection_reason,
  (p.ebay_listing_id IS NOT NULL) AS on_ebay,
  EXISTS (
    SELECT 1 FROM public.amazon_listing_mappings m
    WHERE m.kk_variant_id = pv.id AND m.mapping_status = 'mapped'
  ) AS on_amazon,
  EXISTS (
    SELECT 1 FROM public.inventory_bundle_rules br
    WHERE br.bundle_variant_id = pv.id AND br.is_active = true
  ) AS has_virtual_rules,
  COALESCE(pv.is_active, true) AS is_active
FROM public.product_variants pv
JOIN public.products p ON p.id = pv.product_id
WHERE COALESCE(pv.is_active, true)
  AND (
    p.name ~* '(\bx[0-9]+\b|\d+\s*[- ]?pack\b|\bbundle\b|\bkit\b)'
    OR COALESCE(pv.title, '') ~* '(\bx[0-9]+\b|\d+\s*[- ]?pack\b|\bbundle\b|\bkit\b)'
    OR COALESCE(pv.sku, '') ~* '(\bx[0-9]+\b|\d+pk\b|-pk\b|\bbundle\b|\bkit\b|\d+\s*[- ]?pack\b)'
    OR COALESCE(pv.option_value, '') ~* '(\d+\s*[- ]?pack\b|\d+pk\b|x[0-9]+\b)'
  );

COMMENT ON VIEW public.v_inventory_bundle_like_variants IS
  'Heuristic bundle/pack/kit SKU detection for Phase 10A preview (read-only).';

-- Variant stock/reserved helper for preview views.
CREATE OR REPLACE VIEW public.v_inventory_bundle_availability_preview AS
WITH variant_reserved AS (
  SELECT
    ir.variant_id,
    COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
  FROM public.inventory_reservations ir
  WHERE ir.status = 'reserved'
    AND ir.variant_id IS NOT NULL
    AND COALESCE(ir.is_shadow, false) = false
  GROUP BY ir.variant_id
),
variant_levels AS (
  SELECT
    pv.id AS variant_id,
    pv.product_id,
    COALESCE(NULLIF(BTRIM(p.name), ''), 'Unknown') AS product_label,
    COALESCE(
      NULLIF(BTRIM(pv.sku), ''),
      NULLIF(BTRIM(pv.title), ''),
      NULLIF(BTRIM(pv.option_value), ''),
      '—'
    ) AS sku_label,
    COALESCE(pv.stock, 0) AS on_hand,
    COALESCE(vr.reserved_qty, 0) AS reserved,
    COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS available,
    COALESCE(pv.is_active, true) AS is_active
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
),
rule_rows AS (
  SELECT
    br.id AS rule_id,
    br.bundle_variant_id,
    br.component_variant_id,
    br.component_qty,
    br.rule_type,
    br.is_active,
    br.notes,
    bv.product_label AS bundle_product_label,
    bv.sku_label AS bundle_sku,
    bv.on_hand AS bundle_on_hand,
    bv.reserved AS bundle_reserved,
    bv.available AS bundle_available,
    cv.product_label AS component_product_label,
    cv.sku_label AS component_sku,
    cv.on_hand AS component_on_hand,
    cv.reserved AS component_reserved,
    cv.available AS component_available,
    CASE
      WHEN br.bundle_variant_id = br.component_variant_id THEN 'self_reference_error'
      WHEN NOT br.is_active THEN 'inactive_rule'
      WHEN cv.variant_id IS NULL OR cv.is_active = false THEN 'missing_component'
      WHEN cv.available < 0 THEN 'component_shortage'
      WHEN FLOOR(GREATEST(cv.available, 0) / NULLIF(br.component_qty, 0)) <= 0 THEN 'component_shortage'
      ELSE 'ready'
    END AS preview_status,
    CASE
      WHEN br.component_qty > 0 AND cv.variant_id IS NOT NULL
        THEN FLOOR(GREATEST(cv.available, 0) / br.component_qty)::integer
      ELSE 0
    END AS max_bundle_available_from_component
  FROM public.inventory_bundle_rules br
  JOIN variant_levels bv ON bv.variant_id = br.bundle_variant_id
  LEFT JOIN variant_levels cv ON cv.variant_id = br.component_variant_id
),
with_limiting AS (
  SELECT
    rr.*,
    (
      rr.is_active
      AND rr.preview_status IN ('ready', 'component_shortage')
      AND rr.max_bundle_available_from_component = (
        SELECT MIN(r2.max_bundle_available_from_component)
        FROM rule_rows r2
        WHERE r2.bundle_variant_id = rr.bundle_variant_id
          AND r2.is_active
          AND r2.preview_status IN ('ready', 'component_shortage')
      )
    ) AS limiting_component
  FROM rule_rows rr
)
SELECT
  wl.rule_id,
  wl.bundle_variant_id,
  wl.bundle_product_label,
  wl.bundle_sku,
  wl.bundle_on_hand,
  wl.bundle_reserved,
  wl.bundle_available,
  wl.component_variant_id,
  wl.component_product_label,
  wl.component_sku,
  wl.component_on_hand,
  wl.component_reserved,
  wl.component_available,
  wl.component_qty,
  wl.max_bundle_available_from_component,
  wl.limiting_component,
  CASE
    WHEN NOT wl.is_active THEN NULL
    WHEN wl.preview_status IN ('missing_component', 'self_reference_error', 'inactive_rule') THEN NULL
    ELSE (
      SELECT MIN(r.min_avail)::integer
      FROM (
        SELECT MIN(w2.max_bundle_available_from_component) AS min_avail
        FROM with_limiting w2
        WHERE w2.bundle_variant_id = wl.bundle_variant_id
          AND w2.is_active
          AND w2.preview_status IN ('ready', 'component_shortage')
      ) r
    )
  END AS virtual_bundle_available,
  wl.preview_status,
  wl.rule_type,
  wl.is_active,
  wl.notes
FROM with_limiting wl;

COMMENT ON VIEW public.v_inventory_bundle_availability_preview IS
  'Read-only virtual bundle availability preview per component rule (Phase 10A). Not live checkout stock.';

CREATE OR REPLACE VIEW public.v_inventory_bundle_summary_preview AS
WITH active_rules AS (
  SELECT
    bundle_variant_id,
    COUNT(*) FILTER (WHERE is_active) AS active_rule_count,
    COUNT(*) AS total_rule_count
  FROM public.inventory_bundle_rules
  GROUP BY bundle_variant_id
),
virtual_avail AS (
  SELECT
    p.bundle_variant_id,
    MIN(p.max_bundle_available_from_component) FILTER (
      WHERE p.is_active AND p.preview_status IN ('ready', 'component_shortage')
    )::integer AS virtual_bundle_available,
    BOOL_OR(p.preview_status = 'component_shortage' AND p.is_active) AS has_component_shortage,
    BOOL_OR(p.preview_status = 'missing_component' AND p.is_active) AS has_missing_component,
    BOOL_OR(p.preview_status = 'self_reference_error') AS has_self_reference
  FROM public.v_inventory_bundle_availability_preview p
  GROUP BY p.bundle_variant_id
),
bundle_heads AS (
  SELECT DISTINCT bundle_variant_id FROM public.inventory_bundle_rules
  UNION
  SELECT variant_id FROM public.v_inventory_bundle_like_variants
)
SELECT
  bh.bundle_variant_id,
  COALESCE(
    NULLIF(BTRIM(p.name), ''),
    'Unknown'
  ) AS bundle_label,
  COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(pv.title), ''), pv.option_value, '—') AS bundle_sku,
  COALESCE(pv.stock, 0) AS bundle_on_hand,
  CASE
    WHEN COALESCE(ar.active_rule_count, 0) > 0 THEN 'model_b_virtual_preview'
    ELSE 'model_a_separate_stocked'
  END AS current_model,
  COALESCE(ar.active_rule_count, 0)::integer AS component_count,
  va.virtual_bundle_available,
  (
    SELECT p2.component_product_label
    FROM public.v_inventory_bundle_availability_preview p2
    WHERE p2.bundle_variant_id = bh.bundle_variant_id
      AND p2.is_active
      AND p2.limiting_component = true
    LIMIT 1
  ) AS limiting_component_label,
  CASE
    WHEN COALESCE(va.has_self_reference, false) THEN
      'Preview: self-reference rule detected — fix configuration'
    WHEN COALESCE(va.has_missing_component, false) THEN
      'Preview: missing or inactive component variant'
    WHEN COALESCE(ar.active_rule_count, 0) = 0 THEN
      'Separate stocked SKU (Model A default) — no virtual rules configured'
    WHEN COALESCE(va.has_component_shortage, false) OR COALESCE(va.virtual_bundle_available, 0) <= 0 THEN
      'Preview: component shortage would limit virtual bundle availability'
    ELSE
      'Preview: virtual availability computed from components (not live)'
  END AS preview_warning,
  COALESCE(bl.detection_reason, 'configured_rule') AS detection_reason,
  COALESCE(bl.on_ebay, false) AS on_ebay,
  COALESCE(bl.on_amazon, false) AS on_amazon
FROM bundle_heads bh
JOIN public.product_variants pv ON pv.id = bh.bundle_variant_id
JOIN public.products p ON p.id = pv.product_id
LEFT JOIN active_rules ar ON ar.bundle_variant_id = bh.bundle_variant_id
LEFT JOIN virtual_avail va ON va.bundle_variant_id = bh.bundle_variant_id
LEFT JOIN public.v_inventory_bundle_like_variants bl ON bl.variant_id = bh.bundle_variant_id;

COMMENT ON VIEW public.v_inventory_bundle_summary_preview IS
  'Bundle summary preview — Model A vs Model B classification (Phase 10A, read-only).';

GRANT SELECT ON public.v_inventory_bundle_like_variants TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_bundle_availability_preview TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_bundle_summary_preview TO authenticated, service_role;

-- Admin-only configuration RPC (no inventory mutations).
CREATE OR REPLACE FUNCTION public.upsert_inventory_bundle_rule(
  p_bundle_variant_id    uuid,
  p_component_variant_id uuid,
  p_component_qty        numeric,
  p_rule_type            text DEFAULT 'virtual_bundle',
  p_is_active            boolean DEFAULT true,
  p_notes                text DEFAULT NULL,
  p_rule_id              uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_is_admin boolean := false;
  v_id       uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_bundle_variant_id = p_component_variant_id THEN
    RAISE EXCEPTION 'Bundle and component must differ' USING ERRCODE = 'P0001';
  END IF;

  IF p_component_qty IS NULL OR p_component_qty <= 0 THEN
    RAISE EXCEPTION 'component_qty must be positive' USING ERRCODE = 'P0001';
  END IF;

  IF p_rule_type NOT IN ('virtual_bundle', 'separate_stocked') THEN
    RAISE EXCEPTION 'Invalid rule_type' USING ERRCODE = 'P0001';
  END IF;

  IF p_rule_id IS NOT NULL THEN
    UPDATE public.inventory_bundle_rules
    SET
      bundle_variant_id = p_bundle_variant_id,
      component_variant_id = p_component_variant_id,
      component_qty = p_component_qty,
      rule_type = p_rule_type,
      is_active = COALESCE(p_is_active, true),
      notes = p_notes,
      updated_at = now()
    WHERE id = p_rule_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.inventory_bundle_rules (
      bundle_variant_id, component_variant_id, component_qty,
      rule_type, is_active, notes, created_by
    ) VALUES (
      p_bundle_variant_id, p_component_variant_id, p_component_qty,
      p_rule_type, COALESCE(p_is_active, true), p_notes, v_actor
    )
    ON CONFLICT ON CONSTRAINT inventory_bundle_rules_unique_component
    DO UPDATE SET
      component_qty = EXCLUDED.component_qty,
      rule_type = EXCLUDED.rule_type,
      is_active = EXCLUDED.is_active,
      notes = EXCLUDED.notes,
      updated_at = now()
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'rule_id', v_id);
END;
$$;

COMMENT ON FUNCTION public.upsert_inventory_bundle_rule IS
  'Admin-only bundle rule configuration (Phase 10A). Does not affect checkout or stock.';

GRANT EXECUTE ON FUNCTION public.upsert_inventory_bundle_rule TO authenticated;

-- Extend issue summaries with bundle preview groups (informational only).
CREATE OR REPLACE VIEW public.v_inventory_issues AS
WITH issue_counts AS (
  SELECT
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true) AND COALESCE(pv.stock, 0) < 0
    )::bigint AS negative_stock,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true) AND COALESCE(pv.stock, 0) > 0
        AND COALESCE(pv.stock, 0) <= 3
    )::bigint AS low_stock,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND NULLIF(BTRIM(COALESCE(pv.sku, '')), '') IS NULL
    )::bigint AS missing_sku,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true) AND p.ebay_offer_id IS NOT NULL
        AND p.ebay_listing_id IS NULL
    )::bigint AS ebay_mapping_missing,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND EXISTS (
          SELECT 1 FROM public.amazon_listing_mappings m2
          WHERE m2.kk_product_id = p.id AND m2.mapping_status = 'mapped'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.amazon_listing_mappings m3
          WHERE m3.kk_variant_id = pv.id AND m3.mapping_status = 'mapped'
        )
    )::bigint AS amazon_mapping_missing,
    (
      SELECT COUNT(*)::bigint FROM public.parcel_import_item_mappings m
      JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
      WHERE m.row_type = 'business_inventory' AND pi.status = 'approved'
        AND pi.inventory_received_at IS NULL
        AND (m.mapping_status <> 'matched' OR m.product_variant_id IS NULL)
    ) AS parcel_mapping_missing,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true) AND p.ebay_listing_id IS NOT NULL
        AND LOWER(COALESCE(p.ebay_status, '')) IN ('ended', 'out_of_stock')
    )::bigint AS ebay_listing_ended,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND EXISTS (
          SELECT 1 FROM public.amazon_listing_mappings m
          JOIN public.amazon_listings al ON al.id = m.amazon_listing_id
          WHERE m.kk_variant_id = pv.id AND m.mapping_status = 'mapped'
            AND (
              COALESCE(al.listing_status_buyable, false) = false
              OR LOWER(COALESCE(al.listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
            )
        )
    )::bigint AS amazon_listing_inactive,
    (
      SELECT COUNT(*)::bigint FROM public.v_inventory_unmapped_order_lines u
      WHERE u.reason <> 'afn_skip'
    ) AS unmapped_order_line
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
),
sync_issue_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE sc.available_qty < 0)::bigint AS negative_available,
    COUNT(*) FILTER (WHERE sc.ebay_sync_action = 'qty_cache_missing')::bigint AS ebay_qty_cache_missing,
    COUNT(*) FILTER (WHERE sc.ebay_sync_action = 'unsupported_variation')::bigint AS ebay_unsupported_variation
  FROM public.v_inventory_channel_sync_candidates sc
),
sync_fail_counts AS (
  SELECT COUNT(*)::bigint AS channel_sync_failed
  FROM public.inventory_channel_sync_results r
  JOIN public.inventory_channel_sync_runs run ON run.id = r.run_id
  WHERE r.status = 'failed' AND run.mode IN ('push', 'dry_run')
    AND r.created_at > now() - interval '7 days'
),
audit_issue_counts AS (
  SELECT COUNT(*)::bigint AS shipped_finalize_audit_needed
  FROM public.v_inventory_shipped_finalize_audit a
  WHERE a.needs_audit_issue = true
),
bundle_issue_counts AS (
  SELECT
    COUNT(*) FILTER (
      WHERE s.current_model = 'model_b_virtual_preview'
        AND (s.virtual_bundle_available IS NULL OR s.virtual_bundle_available <= 0)
    )::bigint AS bundle_component_shortage,
    COUNT(*) FILTER (
      WHERE s.current_model = 'model_a_separate_stocked'
        AND s.detection_reason IN ('quantity_suffix', 'pack_pattern', 'bundle_keyword', 'kit_keyword')
    )::bigint AS bundle_rule_missing,
    (
      SELECT COUNT(*)::bigint
      FROM public.inventory_bundle_rules br
      WHERE br.bundle_variant_id = br.component_variant_id
    )::bigint AS bundle_self_reference
  FROM public.v_inventory_bundle_summary_preview s
)
SELECT issues.issue_id, issues.issue_type, issues.issue_label, issues.severity,
  issues.description, issues.affected_count, issues.source, issues.reference, now() AS updated_at
FROM (
  SELECT 'negative_stock'::text, 'negative_stock'::text, 'Negative Stock'::text, 'critical'::text,
    'On-hand quantity below zero — fulfillment may exceed physical stock.'::text,
    ic.negative_stock, 'product_variants'::text, NULL::text
  FROM issue_counts ic WHERE ic.negative_stock > 0
  UNION ALL SELECT 'low_stock', 'low_stock', 'Low Stock', 'medium',
    'Active variants at or below the low-stock threshold (1–3 units).',
    ic.low_stock, 'product_variants', NULL FROM issue_counts ic WHERE ic.low_stock > 0
  UNION ALL SELECT 'missing_sku', 'missing_sku', 'Missing SKU', 'high',
    'Variants without an internal SKU — harder to map orders and channels.',
    ic.missing_sku, 'product_variants', NULL FROM issue_counts ic WHERE ic.missing_sku > 0
  UNION ALL SELECT 'ebay_mapping_missing', 'ebay_mapping_missing', 'eBay Mapping Missing', 'high',
    'Products with an eBay offer but no listing id — channel link incomplete.',
    ic.ebay_mapping_missing, 'products', NULL FROM issue_counts ic WHERE ic.ebay_mapping_missing > 0
  UNION ALL SELECT 'amazon_mapping_missing', 'amazon_mapping_missing', 'Amazon Mapping Missing', 'high',
    'Variants on products with Amazon listings but no variant-level mapping.',
    ic.amazon_mapping_missing, 'amazon_listing_mappings', NULL FROM issue_counts ic WHERE ic.amazon_mapping_missing > 0
  UNION ALL SELECT 'parcel_mapping_missing', 'parcel_mapping_missing', 'Parcel Mapping Missing', 'high',
    'Approved parcel import rows not mapped to KK products — stock not received.',
    ic.parcel_mapping_missing, 'parcel_import_item_mappings', NULL FROM issue_counts ic WHERE ic.parcel_mapping_missing > 0
  UNION ALL SELECT 'unmapped_order_line', 'unmapped_order_line', 'Unmapped Order Lines', 'high',
    'Order lines need variant mapping before inventory can reserve or deduct.',
    ic.unmapped_order_line, 'orders', NULL FROM issue_counts ic WHERE ic.unmapped_order_line > 0
  UNION ALL SELECT 'ebay_listing_ended', 'ebay_listing_ended', 'eBay Listing Ended', 'medium',
    'eBay listing ended or out of stock — restock may require relist flow.',
    ic.ebay_listing_ended, 'products', NULL FROM issue_counts ic WHERE ic.ebay_listing_ended > 0
  UNION ALL SELECT 'amazon_listing_inactive', 'amazon_listing_inactive', 'Amazon Listing Inactive', 'medium',
    'Mapped Amazon listing inactive or not buyable — channel may not be selling.',
    ic.amazon_listing_inactive, 'amazon_listings', NULL FROM issue_counts ic WHERE ic.amazon_listing_inactive > 0
  UNION ALL SELECT 'negative_available', 'negative_available', 'Negative Available', 'critical',
    'Reserved quantity exceeds on-hand — available qty is negative.',
    sic.negative_available, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.negative_available > 0
  UNION ALL SELECT 'ebay_qty_cache_missing', 'ebay_qty_cache_missing', 'eBay Qty Cache Missing', 'medium',
    'Active eBay listings without cached quantity — refresh eBay cache before sync.',
    sic.ebay_qty_cache_missing, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.ebay_qty_cache_missing > 0
  UNION ALL SELECT 'ebay_unsupported_variation', 'ebay_unsupported_variation', 'eBay Unsupported Variation', 'medium',
    'Multi-variant eBay group listings require manual per-SKU handling.',
    sic.ebay_unsupported_variation, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.ebay_unsupported_variation > 0
  UNION ALL SELECT 'channel_sync_failed', 'channel_sync_failed', 'Channel Sync Failed', 'high',
    'Recent Amazon or eBay quantity sync attempts failed (last 7 days).',
    sfc.channel_sync_failed, 'inventory_channel_sync_results', NULL
  FROM sync_fail_counts sfc WHERE sfc.channel_sync_failed > 0
  UNION ALL SELECT 'shipped_finalize_audit_needed', 'shipped_finalize_audit_needed',
    'Shipped Finalize Audit Needed', 'high',
    'Shipped/delivered lines lack finalized reservation or stock ledger accounting signal.',
    aic.shipped_finalize_audit_needed, 'v_inventory_shipped_finalize_audit', NULL
  FROM audit_issue_counts aic WHERE aic.shipped_finalize_audit_needed > 0
  UNION ALL SELECT 'bundle_component_shortage', 'bundle_component_shortage',
    'Bundle Component Shortage (Preview)', 'low',
    'Preview only: configured virtual bundle would have zero availability from components. Does not affect checkout or sync.',
    bic.bundle_component_shortage, 'v_inventory_bundle_summary_preview', 'preview'
  FROM bundle_issue_counts bic WHERE bic.bundle_component_shortage > 0
  UNION ALL SELECT 'bundle_rule_missing', 'bundle_rule_missing',
    'Bundle-Like SKU (Preview)', 'low',
    'Preview only: pack/bundle-like SKU defaults to separate stocked Model A — no virtual rules configured.',
    bic.bundle_rule_missing, 'v_inventory_bundle_like_variants', 'preview'
  FROM bundle_issue_counts bic WHERE bic.bundle_rule_missing > 0
  UNION ALL SELECT 'bundle_self_reference', 'bundle_self_reference',
    'Bundle Self-Reference (Preview)', 'low',
    'Preview only: invalid bundle rule references itself — fix configuration before Phase 10B.',
    bic.bundle_self_reference, 'inventory_bundle_rules', 'preview'
  FROM bundle_issue_counts bic WHERE bic.bundle_self_reference > 0
) AS issues(issue_id, issue_type, issue_label, severity, description, affected_count, source, reference);

COMMENT ON VIEW public.v_inventory_issues IS
  'Grouped inventory issue summaries including bundle preview groups (Phase 10A).';

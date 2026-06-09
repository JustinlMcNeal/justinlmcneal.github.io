-- ================================================================
-- Parcel Imports — Migration 002: Save Draft RPC
-- Source: docs/pages/admin/parcelImport/implementation/007_migration_002_rpc_plan.md
--
-- Creates public.save_parcel_import_draft(payload jsonb) for atomic
-- Save Draft (header + items + mappings + preview allocations + events).
-- Does NOT: approve, product CPI, expenses, inventory, mapping memory.
-- ================================================================

-- ── Helpers (internal; not granted to clients) ───────────────────

CREATE OR REPLACE FUNCTION public.parcel_jsonb_optional_numeric(
  p_obj jsonb,
  p_key text,
  p_allow_negative boolean DEFAULT false
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text text;
  v_num  numeric;
BEGIN
  IF p_obj IS NULL OR jsonb_typeof(p_obj) <> 'object' THEN
    RETURN NULL;
  END IF;

  IF NOT (p_obj ? p_key) OR p_obj -> p_key = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  v_text := btrim(p_obj ->> p_key);
  IF v_text IS NULL OR v_text = '' THEN
    RETURN NULL;
  END IF;

  IF lower(v_text) IN ('nan', 'infinity', '-infinity') THEN
    RAISE EXCEPTION 'Invalid numeric value for %: %', p_key, v_text
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    v_num := v_text::numeric;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'Invalid numeric value for %: %', p_key, v_text
        USING ERRCODE = 'P0001';
  END;

  IF NOT p_allow_negative AND v_num < 0 THEN
    RAISE EXCEPTION 'Negative value not allowed for %: %', p_key, v_num
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_num;
END;
$$;

CREATE OR REPLACE FUNCTION public.parcel_jsonb_optional_integer(
  p_obj jsonb,
  p_key text,
  p_allow_negative boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_num numeric;
BEGIN
  v_num := public.parcel_jsonb_optional_numeric(p_obj, p_key, p_allow_negative);
  IF v_num IS NULL THEN
    RETURN NULL;
  END IF;
  IF trunc(v_num) <> v_num THEN
    RAISE EXCEPTION 'Expected integer for %, got %', p_key, v_num
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_num::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.parcel_jsonb_optional_boolean(p_obj jsonb, p_key text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text text;
BEGIN
  IF p_obj IS NULL OR jsonb_typeof(p_obj) <> 'object' THEN
    RETURN NULL;
  END IF;
  IF NOT (p_obj ? p_key) OR p_obj -> p_key = 'null'::jsonb THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_obj -> p_key) = 'boolean' THEN
    RETURN (p_obj ->> p_key)::boolean;
  END IF;
  v_text := lower(btrim(p_obj ->> p_key));
  IF v_text IN ('true', 't', '1', 'yes') THEN RETURN true; END IF;
  IF v_text IN ('false', 'f', '0', 'no') THEN RETURN false; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.parcel_jsonb_optional_uuid(p_obj jsonb, p_key text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text text;
BEGIN
  IF p_obj IS NULL OR jsonb_typeof(p_obj) <> 'object' THEN
    RETURN NULL;
  END IF;
  IF NOT (p_obj ? p_key) OR p_obj -> p_key = 'null'::jsonb THEN
    RETURN NULL;
  END IF;
  v_text := btrim(p_obj ->> p_key);
  IF v_text IS NULL OR v_text = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN v_text::uuid;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'Invalid UUID for %: %', p_key, v_text
        USING ERRCODE = 'P0001';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.parcel_assert_row_type(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR p_value NOT IN (
    'business_inventory', 'personal_excluded', 'supplies', 'unknown'
  ) THEN
    RAISE EXCEPTION 'Invalid row_type: %', coalesce(p_value, '<null>')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.parcel_assert_mapping_status(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR p_value NOT IN (
    'needs_mapping', 'matched', 'variant_uncertain',
    'personal_excluded', 'parser_warning'
  ) THEN
    RAISE EXCEPTION 'Invalid mapping_status: %', coalesce(p_value, '<null>')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.parcel_build_raw_footer(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parcel jsonb := coalesce(p_payload -> 'parcel', '{}'::jsonb);
  v_warnings jsonb := coalesce(p_payload -> 'warnings', '{}'::jsonb);
  v_cpi jsonb := coalesce(p_payload -> 'cpiPreview', '{}'::jsonb);
BEGIN
  RETURN jsonb_strip_nulls(
    jsonb_build_object(
      'parcelRaw', coalesce(v_parcel -> 'raw', '{}'::jsonb),
      'warnings', v_warnings,
      'cpiPreviewWarnings', coalesce(v_cpi -> 'warnings', '[]'::jsonb)
    )
  );
END;
$$;

-- Helpers: INVOKER RPC calls these as authenticated — grant EXECUTE to authenticated only.
REVOKE ALL ON FUNCTION public.parcel_jsonb_optional_numeric(jsonb, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parcel_jsonb_optional_numeric(jsonb, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.parcel_jsonb_optional_numeric(jsonb, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.parcel_jsonb_optional_integer(jsonb, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parcel_jsonb_optional_integer(jsonb, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.parcel_jsonb_optional_integer(jsonb, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.parcel_jsonb_optional_boolean(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parcel_jsonb_optional_boolean(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parcel_jsonb_optional_boolean(jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION public.parcel_jsonb_optional_uuid(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parcel_jsonb_optional_uuid(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parcel_jsonb_optional_uuid(jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION public.parcel_assert_row_type(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parcel_assert_row_type(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parcel_assert_row_type(text) TO authenticated;

REVOKE ALL ON FUNCTION public.parcel_assert_mapping_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parcel_assert_mapping_status(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parcel_assert_mapping_status(text) TO authenticated;

REVOKE ALL ON FUNCTION public.parcel_build_raw_footer(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parcel_build_raw_footer(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.parcel_build_raw_footer(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- save_parcel_import_draft
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_parcel_import_draft(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor              uuid;
  v_import_id          uuid;
  v_created            boolean;
  v_status             text;
  v_import_id_text     text;
  v_is_update          boolean;
  v_parcel             jsonb;
  v_xls                jsonb;
  v_overrides          jsonb;
  v_file_meta          jsonb;
  v_cpi                jsonb;
  v_cpi_summary        jsonb;
  v_alloc_method       text;
  v_item_count         integer;
  v_alloc_count        integer;
  v_raw_footer         jsonb;
  v_imported_at        timestamptz;
  v_existing_status    text;
  v_existing_imported  timestamptz;
  v_item               jsonb;
  v_mapping            jsonb;
  v_alloc              jsonb;
  v_row_number         integer;
  v_item_id            uuid;
  v_row_type           text;
  v_mapping_status     text;
  v_landed_total       numeric;
  v_fx_rate            numeric;
  v_seen_rows          integer[];
  v_map_row            integer;
  v_products_affected  integer;
  v_rows_excluded      integer;
  v_rows_needing       integer;
BEGIN
  -- ── Auth ───────────────────────────────────────────────────────
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- ── Root validation ────────────────────────────────────────────
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid payload: expected JSON object' USING ERRCODE = 'P0001';
  END IF;

  v_parcel := payload -> 'parcel';
  IF v_parcel IS NULL OR jsonb_typeof(v_parcel) <> 'object' THEN
    RAISE EXCEPTION 'Missing parcel object' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(btrim(v_parcel ->> 'parcelId'), '') = '' THEN
    RAISE EXCEPTION 'Missing parcel.parcelId' USING ERRCODE = 'P0001';
  END IF;

  v_status := payload ->> 'statusIntent';
  IF v_status IS NULL OR v_status NOT IN ('draft', 'needs_review', 'ready_to_approve') THEN
    RAISE EXCEPTION 'statusIntent must be draft, needs_review, or ready_to_approve'
      USING ERRCODE = 'P0001';
  END IF;

  v_import_id_text := nullif(btrim(payload ->> 'importId'), '');
  IF payload -> 'importId' = 'null'::jsonb THEN
    v_import_id_text := NULL;
  END IF;

  v_is_update := v_import_id_text IS NOT NULL;

  IF v_is_update THEN
    BEGIN
      v_import_id := v_import_id_text::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'Invalid importId' USING ERRCODE = 'P0001';
    END;
  END IF;

  IF payload -> 'items' IS NULL OR jsonb_typeof(payload -> 'items') <> 'array' THEN
    RAISE EXCEPTION 'items must be a non-empty array' USING ERRCODE = 'P0001';
  END IF;

  v_item_count := jsonb_array_length(payload -> 'items');
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'items must be a non-empty array' USING ERRCODE = 'P0001';
  END IF;

  IF payload -> 'mappings' IS NULL OR jsonb_typeof(payload -> 'mappings') <> 'array' THEN
    RAISE EXCEPTION 'mappings must be an array' USING ERRCODE = 'P0001';
  END IF;

  v_overrides := payload -> 'overrides';
  IF v_overrides IS NULL OR jsonb_typeof(v_overrides) <> 'object' THEN
    RAISE EXCEPTION 'Missing overrides object' USING ERRCODE = 'P0001';
  END IF;

  v_cpi := payload -> 'cpiPreview';
  IF v_cpi IS NULL OR jsonb_typeof(v_cpi) <> 'object' THEN
    RAISE EXCEPTION 'Missing cpiPreview object' USING ERRCODE = 'P0001';
  END IF;

  IF v_cpi -> 'rows' IS NULL OR jsonb_typeof(v_cpi -> 'rows') <> 'array' THEN
    RAISE EXCEPTION 'cpiPreview.rows must be an array' USING ERRCODE = 'P0001';
  END IF;

  v_alloc_count := jsonb_array_length(v_cpi -> 'rows');
  IF v_alloc_count <> v_item_count THEN
    RAISE EXCEPTION 'allocation row count (%) must equal item count (%)',
      v_alloc_count, v_item_count
      USING ERRCODE = 'P0001';
  END IF;

  v_alloc_method := v_cpi ->> 'allocationMethod';
  IF v_alloc_method IS NULL OR v_alloc_method NOT IN ('weight_based', 'equal_split') THEN
    RAISE EXCEPTION 'Invalid allocationMethod' USING ERRCODE = 'P0001';
  END IF;

  v_xls := payload -> 'xlsBaseline';
  IF NOT v_is_update THEN
    IF v_xls IS NULL OR jsonb_typeof(v_xls) <> 'object' THEN
      RAISE EXCEPTION 'Missing xlsBaseline on create' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_file_meta := coalesce(payload -> 'fileMeta', '{}'::jsonb);
  v_cpi_summary := coalesce(v_cpi -> 'summary', '{}'::jsonb);
  v_products_affected := coalesce(
    public.parcel_jsonb_optional_integer(v_cpi_summary, 'productsAffected', false),
    0
  );
  v_rows_excluded := coalesce(
    public.parcel_jsonb_optional_integer(v_cpi_summary, 'rowsExcluded', false),
    0
  );
  v_rows_needing := coalesce(
    public.parcel_jsonb_optional_integer(v_cpi_summary, 'needsMappingRows', false),
    0
  );

  v_fx_rate := public.parcel_jsonb_optional_numeric(v_overrides, 'effectiveFxRate', false);
  IF v_fx_rate IS NOT NULL AND v_fx_rate <= 0 THEN
    RAISE EXCEPTION 'effectiveFxRate must be null or greater than 0' USING ERRCODE = 'P0001';
  END IF;

  v_raw_footer := public.parcel_build_raw_footer(payload);

  -- ── Temp tables for row_number maps ────────────────────────────
  CREATE TEMP TABLE IF NOT EXISTS _parcel_save_item_ids (
    row_number integer PRIMARY KEY,
    item_id    uuid NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _parcel_save_mappings (
    row_number integer PRIMARY KEY,
    mapping    jsonb NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE _parcel_save_item_ids;
  TRUNCATE _parcel_save_mappings;

  -- ── Validate items (unique rowNumber) ──────────────────────────
  v_seen_rows := ARRAY[]::integer[];

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(payload -> 'items')
  LOOP
    v_row_number := public.parcel_jsonb_optional_integer(v_item, 'rowNumber', false);
    IF v_row_number IS NULL OR v_row_number <= 0 THEN
      RAISE EXCEPTION 'item rowNumber is required and must be a positive integer'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_row_number = ANY (v_seen_rows) THEN
      RAISE EXCEPTION 'Duplicate item rowNumber: %', v_row_number
        USING ERRCODE = 'P0001';
    END IF;
    v_seen_rows := array_append(v_seen_rows, v_row_number);

    IF coalesce(btrim(v_item ->> 'sourceItemName'), '') = '' THEN
      RAISE EXCEPTION 'item sourceItemName is required for rowNumber %', v_row_number
        USING ERRCODE = 'P0001';
    END IF;

    PERFORM public.parcel_jsonb_optional_integer(v_item, 'quantity', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_item, 'itemWeightGrams', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_item, 'unitPriceCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_item, 'sellerFreightCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_item, 'rowTotalCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_item, 'lineItemSubtotalCny', false);
  END LOOP;

  -- ── Validate mappings provided ─────────────────────────────────
  FOR v_mapping IN
    SELECT value FROM jsonb_array_elements(payload -> 'mappings')
  LOOP
    v_map_row := public.parcel_jsonb_optional_integer(v_mapping, 'rowNumber', false);
    IF v_map_row IS NULL OR v_map_row <= 0 THEN
      RAISE EXCEPTION 'mapping rowNumber is required and must be a positive integer'
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT (v_map_row = ANY (v_seen_rows)) THEN
      RAISE EXCEPTION 'mapping rowNumber % does not match any item', v_map_row
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (SELECT 1 FROM _parcel_save_mappings WHERE row_number = v_map_row) THEN
      RAISE EXCEPTION 'Duplicate mapping rowNumber: %', v_map_row
        USING ERRCODE = 'P0001';
    END IF;

    PERFORM public.parcel_assert_row_type(v_mapping ->> 'rowType');
    PERFORM public.parcel_assert_mapping_status(v_mapping ->> 'mappingStatus');
    PERFORM public.parcel_jsonb_optional_uuid(v_mapping, 'productId');
    PERFORM public.parcel_jsonb_optional_uuid(v_mapping, 'productVariantId');

    INSERT INTO _parcel_save_mappings (row_number, mapping)
    VALUES (v_map_row, v_mapping);
  END LOOP;

  -- Synthesize missing mappings
  FOREACH v_row_number IN ARRAY v_seen_rows
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM _parcel_save_mappings WHERE row_number = v_row_number
    ) THEN
      INSERT INTO _parcel_save_mappings (row_number, mapping)
      VALUES (
        v_row_number,
        jsonb_build_object(
          'rowNumber', v_row_number,
          'rowType', 'unknown',
          'mappingStatus', 'needs_mapping',
          'mappedProductLabel', NULL,
          'mappedVariantLabel', NULL,
          'mappingSource', 'imported_placeholder',
          'notes', NULL
        )
      );
    END IF;
  END LOOP;

  -- ── Validate allocations ───────────────────────────────────────
  FOR v_alloc IN
    SELECT value FROM jsonb_array_elements(v_cpi -> 'rows')
  LOOP
    v_row_number := public.parcel_jsonb_optional_integer(v_alloc, 'rowNumber', false);
    IF v_row_number IS NULL OR NOT (v_row_number = ANY (v_seen_rows)) THEN
      RAISE EXCEPTION 'Unknown allocation rowNumber: %', coalesce(v_row_number::text, '<null>')
        USING ERRCODE = 'P0001';
    END IF;

    v_landed_total := public.parcel_jsonb_optional_numeric(v_alloc, 'landedTotalCny', false);
    IF v_landed_total IS NULL THEN
      RAISE EXCEPTION 'landedTotalCny is required for allocation rowNumber %', v_row_number
        USING ERRCODE = 'P0001';
    END IF;

    PERFORM public.parcel_jsonb_optional_numeric(v_alloc, 'productCostCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_alloc, 'sellerFreightCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_alloc, 'parcelShippingShareCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_alloc, 'serviceShareCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_alloc, 'insuranceShareCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_alloc, 'fxPaymentShareCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_alloc, 'landedCpiCny', false);
    PERFORM public.parcel_jsonb_optional_numeric(v_alloc, 'landedCpiUsd', false);

    v_fx_rate := public.parcel_jsonb_optional_numeric(v_alloc, 'effectiveFxRate', false);
    IF v_fx_rate IS NULL THEN
      v_fx_rate := public.parcel_jsonb_optional_numeric(v_cpi_summary, 'effectiveFxRate', false);
    END IF;
    IF v_fx_rate IS NOT NULL AND v_fx_rate <= 0 THEN
      RAISE EXCEPTION 'effectiveFxRate must be null or greater than 0'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ── imported_at (create only) ──────────────────────────────────
  IF NOT v_is_update THEN
    BEGIN
      v_imported_at := (v_parcel ->> 'importedAt')::timestamptz;
    EXCEPTION
      WHEN others THEN
        v_imported_at := NULL;
    END;
    IF v_imported_at IS NULL THEN
      v_imported_at := now();
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- UPDATE PATH
  -- ══════════════════════════════════════════════════════════════
  IF v_is_update THEN
    SELECT status, imported_at
    INTO v_existing_status, v_existing_imported
    FROM public.parcel_imports
    WHERE id = v_import_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Import not found: %', v_import_id USING ERRCODE = 'P0001';
    END IF;

    IF v_existing_status IN ('approved', 'voided', 'error') THEN
      RAISE EXCEPTION 'Import cannot be edited: status is %', v_existing_status
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.parcel_imports
    SET
      parcel_id                    = btrim(v_parcel ->> 'parcelId'),
      source_file_name             = nullif(btrim(v_file_meta ->> 'name'), ''),
      source_format                = coalesce(nullif(v_file_meta ->> 'sourceFormat', ''), 'baestao_html_xls'),
      file_size_bytes              = public.parcel_jsonb_optional_integer(v_file_meta, 'sizeBytes', false),
      file_hash                    = nullif(btrim(v_file_meta ->> 'hash'), ''),
      status                       = v_status,
      raw_footer                   = v_raw_footer,
      actual_parcel_weight_grams   = public.parcel_jsonb_optional_numeric(v_overrides, 'parcelWeightGrams', false),
      actual_charged_weight_grams  = public.parcel_jsonb_optional_numeric(v_overrides, 'chargedWeightGrams', false),
      actual_shipment_fee_cny      = public.parcel_jsonb_optional_numeric(v_overrides, 'shipmentFeeCny', false),
      actual_service_fee_cny       = public.parcel_jsonb_optional_numeric(v_overrides, 'serviceFeeCny', false),
      actual_insurance_yes         = public.parcel_jsonb_optional_boolean(v_overrides, 'insuranceYes'),
      actual_insurance_cny         = public.parcel_jsonb_optional_numeric(v_overrides, 'insuranceCny', false),
      actual_total_charge_cny      = public.parcel_jsonb_optional_numeric(v_overrides, 'totalParcelChargeCny', false),
      effective_fx_rate            = public.parcel_jsonb_optional_numeric(v_overrides, 'effectiveFxRate', false),
      usd_equivalent               = public.parcel_jsonb_optional_numeric(v_overrides, 'usdEquivalent', false),
      products_affected_count      = v_products_affected,
      rows_excluded_count          = v_rows_excluded,
      rows_needing_mapping_count   = v_rows_needing
    WHERE id = v_import_id;

    DELETE FROM public.parcel_import_cost_allocations
    WHERE parcel_import_id = v_import_id
      AND allocation_run_type = 'preview';

    DELETE FROM public.parcel_import_items
    WHERE parcel_import_id = v_import_id;

    v_created := false;

  -- ══════════════════════════════════════════════════════════════
  -- CREATE PATH
  -- ══════════════════════════════════════════════════════════════
  ELSE
    INSERT INTO public.parcel_imports (
      parcel_id,
      source_file_name,
      source_format,
      file_size_bytes,
      file_hash,
      status,
      imported_at,
      raw_footer,
      xls_total_items,
      xls_parcel_weight_grams,
      xls_charged_weight_grams,
      xls_total_item_fee_cny,
      xls_shipment_fee_cny,
      xls_insurance_text,
      xls_insurance_cny,
      xls_service_fee_cny,
      xls_total_parcel_charge_cny,
      actual_parcel_weight_grams,
      actual_charged_weight_grams,
      actual_shipment_fee_cny,
      actual_service_fee_cny,
      actual_insurance_yes,
      actual_insurance_cny,
      actual_total_charge_cny,
      effective_fx_rate,
      usd_equivalent,
      products_affected_count,
      rows_excluded_count,
      rows_needing_mapping_count
    ) VALUES (
      btrim(v_parcel ->> 'parcelId'),
      nullif(btrim(v_file_meta ->> 'name'), ''),
      coalesce(nullif(v_file_meta ->> 'sourceFormat', ''), 'baestao_html_xls'),
      public.parcel_jsonb_optional_integer(v_file_meta, 'sizeBytes', false),
      nullif(btrim(v_file_meta ->> 'hash'), ''),
      v_status,
      v_imported_at,
      v_raw_footer,
      coalesce(
        public.parcel_jsonb_optional_integer(v_parcel, 'totalItems', false),
        public.parcel_jsonb_optional_integer(v_xls, 'totalItems', false)
      ),
      coalesce(
        public.parcel_jsonb_optional_numeric(v_xls, 'parcelWeightGrams', false),
        public.parcel_jsonb_optional_numeric(v_parcel, 'parcelWeightGrams', false)
      ),
      coalesce(
        public.parcel_jsonb_optional_numeric(v_xls, 'chargedWeightGrams', false),
        public.parcel_jsonb_optional_numeric(v_parcel, 'chargedWeightGrams', false)
      ),
      coalesce(
        public.parcel_jsonb_optional_numeric(v_parcel, 'totalItemFeeCny', false),
        public.parcel_jsonb_optional_numeric(v_xls, 'totalItemFeeCny', false)
      ),
      coalesce(
        public.parcel_jsonb_optional_numeric(v_xls, 'shipmentFeeCny', false),
        public.parcel_jsonb_optional_numeric(v_parcel, 'shipmentFeeCny', false)
      ),
      nullif(btrim(v_parcel ->> 'insuranceLabel'), ''),
      coalesce(
        public.parcel_jsonb_optional_numeric(v_xls, 'insuranceCny', false),
        public.parcel_jsonb_optional_numeric(v_parcel, 'insuranceCny', false)
      ),
      coalesce(
        public.parcel_jsonb_optional_numeric(v_xls, 'serviceFeeCny', false),
        public.parcel_jsonb_optional_numeric(v_parcel, 'serviceFeeCny', false)
      ),
      coalesce(
        public.parcel_jsonb_optional_numeric(v_xls, 'totalParcelChargeCny', false),
        public.parcel_jsonb_optional_numeric(v_parcel, 'totalParcelChargeCny', false)
      ),
      public.parcel_jsonb_optional_numeric(v_overrides, 'parcelWeightGrams', false),
      public.parcel_jsonb_optional_numeric(v_overrides, 'chargedWeightGrams', false),
      public.parcel_jsonb_optional_numeric(v_overrides, 'shipmentFeeCny', false),
      public.parcel_jsonb_optional_numeric(v_overrides, 'serviceFeeCny', false),
      public.parcel_jsonb_optional_boolean(v_overrides, 'insuranceYes'),
      public.parcel_jsonb_optional_numeric(v_overrides, 'insuranceCny', false),
      public.parcel_jsonb_optional_numeric(v_overrides, 'totalParcelChargeCny', false),
      public.parcel_jsonb_optional_numeric(v_overrides, 'effectiveFxRate', false),
      public.parcel_jsonb_optional_numeric(v_overrides, 'usdEquivalent', false),
      v_products_affected,
      v_rows_excluded,
      v_rows_needing
    )
    RETURNING id INTO v_import_id;

    v_created := true;
  END IF;

  -- ── Insert items ───────────────────────────────────────────────
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(payload -> 'items')
  LOOP
    v_row_number := (v_item ->> 'rowNumber')::integer;

    INSERT INTO public.parcel_import_items (
      parcel_import_id,
      row_number,
      export_row_no,
      source_item_name,
      seller_name,
      baestao_order_id,
      unit_price_cny,
      quantity,
      item_weight_grams,
      seller_freight_cny,
      row_total_cny,
      line_item_subtotal_cny,
      remove_package,
      raw,
      parser_warnings
    ) VALUES (
      v_import_id,
      v_row_number,
      public.parcel_jsonb_optional_integer(v_item, 'exportRowNo', false),
      btrim(v_item ->> 'sourceItemName'),
      nullif(btrim(v_item ->> 'sellerName'), ''),
      nullif(btrim(v_item ->> 'baestaoOrderId'), ''),
      public.parcel_jsonb_optional_numeric(v_item, 'unitPriceCny', false),
      public.parcel_jsonb_optional_integer(v_item, 'quantity', false),
      public.parcel_jsonb_optional_numeric(v_item, 'itemWeightGrams', false),
      coalesce(public.parcel_jsonb_optional_numeric(v_item, 'sellerFreightCny', false), 0),
      public.parcel_jsonb_optional_numeric(v_item, 'rowTotalCny', false),
      public.parcel_jsonb_optional_numeric(v_item, 'lineItemSubtotalCny', false),
      nullif(btrim(v_item ->> 'removePackage'), ''),
      coalesce(v_item -> 'raw', '{}'::jsonb),
      coalesce(v_item -> 'rowIssues', coalesce(v_item -> 'parserWarnings', '[]'::jsonb))
    )
    RETURNING id INTO v_item_id;

    INSERT INTO _parcel_save_item_ids (row_number, item_id)
    VALUES (v_row_number, v_item_id);
  END LOOP;

  -- ── Insert mappings ────────────────────────────────────────────
  FOR v_mapping IN
    SELECT mapping FROM _parcel_save_mappings ORDER BY row_number
  LOOP
    v_row_number := (v_mapping ->> 'rowNumber')::integer;

    SELECT item_id INTO v_item_id
    FROM _parcel_save_item_ids
    WHERE row_number = v_row_number;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Internal error: missing item id for rowNumber %', v_row_number
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.parcel_import_item_mappings (
      parcel_import_item_id,
      parcel_import_id,
      product_id,
      product_variant_id,
      mapped_product_label,
      mapped_variant_label,
      row_type,
      mapping_status,
      mapping_source,
      notes
    ) VALUES (
      v_item_id,
      v_import_id,
      public.parcel_jsonb_optional_uuid(v_mapping, 'productId'),
      public.parcel_jsonb_optional_uuid(v_mapping, 'productVariantId'),
      nullif(btrim(v_mapping ->> 'mappedProductLabel'), ''),
      nullif(btrim(v_mapping ->> 'mappedVariantLabel'), ''),
      public.parcel_assert_row_type(v_mapping ->> 'rowType'),
      public.parcel_assert_mapping_status(v_mapping ->> 'mappingStatus'),
      coalesce(nullif(v_mapping ->> 'mappingSource', ''), 'imported_placeholder'),
      nullif(btrim(v_mapping ->> 'notes'), '')
    );
  END LOOP;

  -- ── Insert preview allocations ─────────────────────────────────
  FOR v_alloc IN
    SELECT value FROM jsonb_array_elements(v_cpi -> 'rows')
  LOOP
    v_row_number := (v_alloc ->> 'rowNumber')::integer;

    SELECT item_id INTO v_item_id
    FROM _parcel_save_item_ids
    WHERE row_number = v_row_number;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Unknown allocation rowNumber: %', v_row_number
        USING ERRCODE = 'P0001';
    END IF;

    v_fx_rate := public.parcel_jsonb_optional_numeric(v_alloc, 'effectiveFxRate', false);
    IF v_fx_rate IS NULL THEN
      v_fx_rate := public.parcel_jsonb_optional_numeric(v_cpi_summary, 'effectiveFxRate', false);
    END IF;

    INSERT INTO public.parcel_import_cost_allocations (
      parcel_import_id,
      parcel_import_item_id,
      allocation_run_type,
      allocation_method,
      product_cost_cny,
      seller_freight_cny,
      parcel_shipping_share_cny,
      service_share_cny,
      insurance_share_cny,
      fx_payment_share_cny,
      landed_total_cny,
      landed_cpi_cny,
      landed_cpi_usd,
      effective_fx_rate,
      included_in_product_cpi_preview,
      included_in_final_product_cpi,
      warnings
    ) VALUES (
      v_import_id,
      v_item_id,
      'preview',
      v_alloc_method,
      coalesce(public.parcel_jsonb_optional_numeric(v_alloc, 'productCostCny', false), 0),
      coalesce(public.parcel_jsonb_optional_numeric(v_alloc, 'sellerFreightCny', false), 0),
      coalesce(public.parcel_jsonb_optional_numeric(v_alloc, 'parcelShippingShareCny', false), 0),
      coalesce(public.parcel_jsonb_optional_numeric(v_alloc, 'serviceShareCny', false), 0),
      coalesce(public.parcel_jsonb_optional_numeric(v_alloc, 'insuranceShareCny', false), 0),
      coalesce(public.parcel_jsonb_optional_numeric(v_alloc, 'fxPaymentShareCny', false), 0),
      public.parcel_jsonb_optional_numeric(v_alloc, 'landedTotalCny', false),
      public.parcel_jsonb_optional_numeric(v_alloc, 'landedCpiCny', false),
      public.parcel_jsonb_optional_numeric(v_alloc, 'landedCpiUsd', false),
      v_fx_rate,
      coalesce(public.parcel_jsonb_optional_boolean(v_alloc, 'includedInProductCpiPreview'), false),
      false,
      coalesce(v_alloc -> 'warnings', '[]'::jsonb)
    );
  END LOOP;

  -- ── Events ─────────────────────────────────────────────────────
  IF v_created THEN
    INSERT INTO public.parcel_import_events (
      parcel_import_id, event_type, event_message, event_payload, actor_id
    ) VALUES (
      v_import_id,
      'parsed',
      'Baestao file parsed and draft created',
      jsonb_build_object(
        'parcelId', btrim(v_parcel ->> 'parcelId'),
        'itemCount', v_item_count,
        'fileHash', nullif(btrim(v_file_meta ->> 'hash'), ''),
        'sourceFileName', nullif(btrim(v_file_meta ->> 'name'), '')
      ),
      v_actor
    );
  END IF;

  INSERT INTO public.parcel_import_events (
    parcel_import_id, event_type, event_message, event_payload, actor_id
  ) VALUES (
    v_import_id,
    'draft_saved',
    'Draft saved',
    jsonb_build_object(
      'status', v_status,
      'itemCount', v_item_count,
      'productsAffected', v_products_affected,
      'rowsNeedingMapping', v_rows_needing,
      'rowsExcluded', v_rows_excluded
    ),
    v_actor
  );

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'status', v_status,
    'created', v_created,
    'item_count', v_item_count,
    'allocation_count', v_alloc_count
  );
END;
$$;

COMMENT ON FUNCTION public.save_parcel_import_draft(jsonb) IS
  'Atomically create or update a parcel import draft bundle (header, items, mappings, preview allocations, events). Requires authenticated caller.';

REVOKE ALL ON FUNCTION public.save_parcel_import_draft(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_parcel_import_draft(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_parcel_import_draft(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- Post-apply validation (read-only; run manually after migration)
-- ════════════════════════════════════════════════════════════════
--
-- SELECT proname, prosecdef FROM pg_proc
-- WHERE proname = 'save_parcel_import_draft';
--
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
-- WHERE routine_name = 'save_parcel_import_draft';
--
-- -- Expect Authentication required (auth.uid() null in SQL editor):
-- SELECT public.save_parcel_import_draft('{}'::jsonb);
--
-- Full smoke: scripts/supabase/validate-parcel-migration-002-rpc.sql
-- Browser: supabase.rpc('save_parcel_import_draft', { payload }) with admin JWT

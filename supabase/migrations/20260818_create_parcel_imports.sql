-- ================================================================
-- Parcel Imports — Migration 001: persistence foundation
-- Source: docs/pages/admin/parcelImport/implementation/004_migration_001_plan.md
--
-- Creates parcel import header, items, mappings, cost allocations,
-- events, and mapping memory tables.
-- Does NOT: approve RPC, inventory, product CPI updates, storage bucket,
--           edge functions, or app/API changes.
-- ================================================================

-- ── updated_at helper (idempotent) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- 1. parcel_imports
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.parcel_imports (
  id                              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id                       text            NOT NULL,
  source_file_name                text,
  source_format                   text            NOT NULL DEFAULT 'baestao_html_xls',
  file_size_bytes                   bigint,
  file_hash                         text,
  raw_file_storage_path             text,
  status                          text            NOT NULL DEFAULT 'draft'
                                  CHECK (status IN (
                                    'draft', 'needs_review', 'ready_to_approve',
                                    'approved', 'voided', 'error'
                                  )),
  imported_at                     timestamptz     NOT NULL DEFAULT now(),
  created_at                      timestamptz     NOT NULL DEFAULT now(),
  updated_at                      timestamptz     NOT NULL DEFAULT now(),
  approved_at                     timestamptz,
  approved_by                     uuid            REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at                       timestamptz,
  voided_by                       uuid            REFERENCES auth.users(id) ON DELETE SET NULL,
  notes                           text,

  -- XLS baseline
  xls_total_items                 integer,
  xls_parcel_weight_grams         numeric(12,2),
  xls_charged_weight_grams        numeric(12,2),
  xls_total_item_fee_cny          numeric(12,2),
  xls_shipment_fee_cny            numeric(12,2),
  xls_insurance_text              text,
  xls_insurance_cny               numeric(12,2),
  xls_service_fee_cny             numeric(12,2),
  xls_total_parcel_charge_cny     numeric(12,2),
  raw_footer                      jsonb           NOT NULL DEFAULT '{}'::jsonb,

  -- Actual / override values
  actual_parcel_weight_grams      numeric(12,2),
  actual_charged_weight_grams     numeric(12,2),
  actual_shipment_fee_cny         numeric(12,2),
  actual_service_fee_cny          numeric(12,2),
  actual_insurance_yes            boolean,
  actual_insurance_cny            numeric(12,2),
  actual_total_charge_cny         numeric(12,2),
  effective_fx_rate               numeric(12,6),
  usd_equivalent                  numeric(12,2),

  -- Final approval snapshot
  final_total_allocated_cny       numeric(12,2),
  final_weighted_landed_cpi_cny   numeric(12,4),
  final_weighted_landed_cpi_usd   numeric(12,4),
  final_fulfilled_cpi_preview_usd numeric(12,4),
  products_affected_count         integer         NOT NULL DEFAULT 0,
  rows_excluded_count             integer         NOT NULL DEFAULT 0,
  rows_needing_mapping_count      integer         NOT NULL DEFAULT 0,
  approval_idempotency_key        text,
  cpi_update_applied_at           timestamptz,

  -- Expense linkage
  expense_id                      uuid            REFERENCES public.expenses(id) ON DELETE SET NULL,

  -- Non-negative weight / money (nullable columns)
  CONSTRAINT parcel_imports_xls_parcel_weight_nonneg
    CHECK (xls_parcel_weight_grams IS NULL OR xls_parcel_weight_grams >= 0),
  CONSTRAINT parcel_imports_xls_charged_weight_nonneg
    CHECK (xls_charged_weight_grams IS NULL OR xls_charged_weight_grams >= 0),
  CONSTRAINT parcel_imports_xls_total_item_fee_nonneg
    CHECK (xls_total_item_fee_cny IS NULL OR xls_total_item_fee_cny >= 0),
  CONSTRAINT parcel_imports_xls_shipment_fee_nonneg
    CHECK (xls_shipment_fee_cny IS NULL OR xls_shipment_fee_cny >= 0),
  CONSTRAINT parcel_imports_xls_insurance_cny_nonneg
    CHECK (xls_insurance_cny IS NULL OR xls_insurance_cny >= 0),
  CONSTRAINT parcel_imports_xls_service_fee_nonneg
    CHECK (xls_service_fee_cny IS NULL OR xls_service_fee_cny >= 0),
  CONSTRAINT parcel_imports_xls_total_parcel_charge_nonneg
    CHECK (xls_total_parcel_charge_cny IS NULL OR xls_total_parcel_charge_cny >= 0),
  CONSTRAINT parcel_imports_actual_parcel_weight_nonneg
    CHECK (actual_parcel_weight_grams IS NULL OR actual_parcel_weight_grams >= 0),
  CONSTRAINT parcel_imports_actual_charged_weight_nonneg
    CHECK (actual_charged_weight_grams IS NULL OR actual_charged_weight_grams >= 0),
  CONSTRAINT parcel_imports_actual_shipment_fee_nonneg
    CHECK (actual_shipment_fee_cny IS NULL OR actual_shipment_fee_cny >= 0),
  CONSTRAINT parcel_imports_actual_service_fee_nonneg
    CHECK (actual_service_fee_cny IS NULL OR actual_service_fee_cny >= 0),
  CONSTRAINT parcel_imports_actual_insurance_cny_nonneg
    CHECK (actual_insurance_cny IS NULL OR actual_insurance_cny >= 0),
  CONSTRAINT parcel_imports_actual_total_charge_nonneg
    CHECK (actual_total_charge_cny IS NULL OR actual_total_charge_cny >= 0),
  CONSTRAINT parcel_imports_final_total_allocated_nonneg
    CHECK (final_total_allocated_cny IS NULL OR final_total_allocated_cny >= 0),
  CONSTRAINT parcel_imports_effective_fx_rate_positive
    CHECK (effective_fx_rate IS NULL OR effective_fx_rate > 0),
  CONSTRAINT parcel_imports_usd_equivalent_nonneg
    CHECK (usd_equivalent IS NULL OR usd_equivalent >= 0),
  CONSTRAINT parcel_imports_products_affected_count_nonneg
    CHECK (products_affected_count >= 0),
  CONSTRAINT parcel_imports_rows_excluded_count_nonneg
    CHECK (rows_excluded_count >= 0),
  CONSTRAINT parcel_imports_rows_needing_mapping_count_nonneg
    CHECK (rows_needing_mapping_count >= 0)
);

COMMENT ON TABLE public.parcel_imports IS
  'Baestao parcel import header: XLS baseline, operator overrides, approval snapshot, and optional expense link. Admin-only via RLS.';

COMMENT ON COLUMN public.parcel_imports.parcel_id IS
  'Baestao parcel ID from export; not globally unique across imports.';

COMMENT ON COLUMN public.parcel_imports.raw_footer IS
  'Footer KV and parser metadata from Baestao XLS; may contain PII. Admin-only.';

COMMENT ON COLUMN public.parcel_imports.expense_id IS
  'Optional link to public.expenses after approve (Phase 9). ON DELETE SET NULL.';

COMMENT ON COLUMN public.parcel_imports.approval_idempotency_key IS
  'Client-supplied idempotency key for approve; partial unique when set.';

-- ════════════════════════════════════════════════════════════════
-- 2. parcel_import_items
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.parcel_import_items (
  id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_import_id        uuid            NOT NULL
                          REFERENCES public.parcel_imports(id) ON DELETE CASCADE,
  row_number              integer         NOT NULL,
  export_row_no           integer,
  source_item_name        text            NOT NULL,
  seller_name             text,
  baestao_order_id        text,
  unit_price_cny          numeric(12,4),
  quantity                integer,
  item_weight_grams       numeric(12,2),
  seller_freight_cny      numeric(12,2)   DEFAULT 0,
  row_total_cny           numeric(12,2),
  line_item_subtotal_cny  numeric(12,2),
  remove_package          text,
  raw                     jsonb           NOT NULL DEFAULT '{}'::jsonb,
  parser_warnings         jsonb           NOT NULL DEFAULT '[]'::jsonb,
  created_at              timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT parcel_import_items_import_row_unique
    UNIQUE (parcel_import_id, row_number),
  CONSTRAINT parcel_import_items_quantity_nonneg
    CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT parcel_import_items_weight_nonneg
    CHECK (item_weight_grams IS NULL OR item_weight_grams >= 0),
  CONSTRAINT parcel_import_items_seller_freight_nonneg
    CHECK (seller_freight_cny IS NULL OR seller_freight_cny >= 0)
);

COMMENT ON TABLE public.parcel_import_items IS
  'Parsed Baestao line rows for a parcel import. Replace-on-save in draft; no updated_at.';

COMMENT ON COLUMN public.parcel_import_items.item_weight_grams IS
  'Per-unit weight from Baestao Weight(g) column. Allocation uses item_weight_grams * quantity.';

COMMENT ON COLUMN public.parcel_import_items.raw IS
  'Column-keyed source cells preserved for re-parse.';

-- ════════════════════════════════════════════════════════════════
-- 3. parcel_import_item_mappings
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.parcel_import_item_mappings (
  id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_import_item_id   uuid            NOT NULL UNIQUE
                          REFERENCES public.parcel_import_items(id) ON DELETE CASCADE,
  parcel_import_id        uuid            NOT NULL
                          REFERENCES public.parcel_imports(id) ON DELETE CASCADE,
  product_id              uuid            REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id      uuid            REFERENCES public.product_variants(id) ON DELETE SET NULL,
  mapped_product_label    text,
  mapped_variant_label    text,
  row_type                text            NOT NULL
                          CHECK (row_type IN (
                            'business_inventory', 'personal_excluded', 'supplies', 'unknown'
                          )),
  mapping_status          text            NOT NULL
                          CHECK (mapping_status IN (
                            'needs_mapping', 'matched', 'variant_uncertain',
                            'personal_excluded', 'parser_warning'
                          )),
  mapping_confidence      numeric(5,4),
  mapping_source          text,
  notes                   text,
  created_at              timestamptz     NOT NULL DEFAULT now(),
  updated_at              timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT parcel_import_item_mappings_confidence_range
    CHECK (mapping_confidence IS NULL OR (mapping_confidence >= 0 AND mapping_confidence <= 1))
);

COMMENT ON TABLE public.parcel_import_item_mappings IS
  'One mapping row per import item: row type, catalog match, and UI snapshot labels.';

-- ════════════════════════════════════════════════════════════════
-- 4. parcel_import_cost_allocations
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.parcel_import_cost_allocations (
  id                              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_import_id                uuid            NOT NULL
                                  REFERENCES public.parcel_imports(id) ON DELETE CASCADE,
  parcel_import_item_id           uuid            NOT NULL
                                  REFERENCES public.parcel_import_items(id) ON DELETE CASCADE,
  allocation_run_type             text            NOT NULL
                                  CHECK (allocation_run_type IN ('preview', 'final')),
  allocation_method               text            NOT NULL
                                  CHECK (allocation_method IN ('weight_based', 'equal_split')),
  product_cost_cny                numeric(12,4)   NOT NULL DEFAULT 0,
  seller_freight_cny              numeric(12,2)   NOT NULL DEFAULT 0,
  parcel_shipping_share_cny       numeric(12,4)   NOT NULL DEFAULT 0,
  service_share_cny               numeric(12,4)   NOT NULL DEFAULT 0,
  insurance_share_cny             numeric(12,4)   NOT NULL DEFAULT 0,
  fx_payment_share_cny            numeric(12,4)   NOT NULL DEFAULT 0,
  landed_total_cny                numeric(12,4)   NOT NULL,
  landed_cpi_cny                  numeric(12,4),
  landed_cpi_usd                  numeric(12,4),
  effective_fx_rate               numeric(12,6),
  included_in_product_cpi_preview boolean         NOT NULL DEFAULT false,
  included_in_final_product_cpi   boolean         NOT NULL DEFAULT false,
  warnings                        jsonb           NOT NULL DEFAULT '[]'::jsonb,
  created_at                      timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT parcel_import_cost_allocations_product_cost_nonneg
    CHECK (product_cost_cny >= 0),
  CONSTRAINT parcel_import_cost_allocations_seller_freight_nonneg
    CHECK (seller_freight_cny >= 0),
  CONSTRAINT parcel_import_cost_allocations_shipping_share_nonneg
    CHECK (parcel_shipping_share_cny >= 0),
  CONSTRAINT parcel_import_cost_allocations_service_share_nonneg
    CHECK (service_share_cny >= 0),
  CONSTRAINT parcel_import_cost_allocations_insurance_share_nonneg
    CHECK (insurance_share_cny >= 0),
  CONSTRAINT parcel_import_cost_allocations_fx_share_nonneg
    CHECK (fx_payment_share_cny >= 0),
  CONSTRAINT parcel_import_cost_allocations_landed_total_nonneg
    CHECK (landed_total_cny >= 0),
  CONSTRAINT parcel_import_cost_allocations_landed_cpi_cny_nonneg
    CHECK (landed_cpi_cny IS NULL OR landed_cpi_cny >= 0),
  CONSTRAINT parcel_import_cost_allocations_landed_cpi_usd_nonneg
    CHECK (landed_cpi_usd IS NULL OR landed_cpi_usd >= 0),
  CONSTRAINT parcel_import_cost_allocations_effective_fx_rate_positive
    CHECK (effective_fx_rate IS NULL OR effective_fx_rate > 0)
);

COMMENT ON TABLE public.parcel_import_cost_allocations IS
  'CPI allocation lines per item. preview rows replaced on Save Draft; final rows inserted on approve.';

COMMENT ON COLUMN public.parcel_import_cost_allocations.allocation_run_type IS
  'preview = Save Draft snapshot; final = immutable approve snapshot (Phase 8).';

-- ════════════════════════════════════════════════════════════════
-- 5. parcel_import_events
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.parcel_import_events (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_import_id    uuid            NOT NULL
                      REFERENCES public.parcel_imports(id) ON DELETE CASCADE,
  event_type          text            NOT NULL,
  event_message       text,
  event_payload       jsonb           NOT NULL DEFAULT '{}'::jsonb,
  actor_id            uuid            REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.parcel_import_events IS
  'Append-only audit log for parcel import lifecycle (draft_saved, approved, etc.).';

-- ════════════════════════════════════════════════════════════════
-- 6. parcel_mapping_memory
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.parcel_mapping_memory (
  id                          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_name                 text,
  normalized_source_item_name text,
  source_item_name_sample     text,
  source_url                  text,
  source_url_hash             text,
  product_id                  uuid            NOT NULL
                              REFERENCES public.products(id) ON DELETE CASCADE,
  product_variant_id          uuid            REFERENCES public.product_variants(id) ON DELETE SET NULL,
  confidence_score            numeric(5,4),
  usage_count                 integer         NOT NULL DEFAULT 1,
  last_used_at                timestamptz     NOT NULL DEFAULT now(),
  created_at                  timestamptz     NOT NULL DEFAULT now(),
  updated_at                  timestamptz     NOT NULL DEFAULT now(),
  notes                       text,

  CONSTRAINT parcel_mapping_memory_confidence_range
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  CONSTRAINT parcel_mapping_memory_usage_count_nonneg
    CHECK (usage_count >= 0)
);

COMMENT ON TABLE public.parcel_mapping_memory IS
  'Cross-import mapping suggestions keyed by seller/title/URL. Suggests only; never auto-approves.';

-- ════════════════════════════════════════════════════════════════
-- Indexes
-- ════════════════════════════════════════════════════════════════

-- parcel_imports
CREATE INDEX IF NOT EXISTS idx_parcel_imports_status
  ON public.parcel_imports (status);
CREATE INDEX IF NOT EXISTS idx_parcel_imports_imported_at
  ON public.parcel_imports (imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_parcel_imports_parcel_id
  ON public.parcel_imports (parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_imports_file_hash
  ON public.parcel_imports (file_hash)
  WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parcel_imports_expense_id
  ON public.parcel_imports (expense_id)
  WHERE expense_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_imports_idempotency
  ON public.parcel_imports (approval_idempotency_key)
  WHERE approval_idempotency_key IS NOT NULL;

-- parcel_import_items
CREATE INDEX IF NOT EXISTS idx_parcel_import_items_import
  ON public.parcel_import_items (parcel_import_id);
CREATE INDEX IF NOT EXISTS idx_parcel_import_items_row
  ON public.parcel_import_items (parcel_import_id, row_number);
CREATE INDEX IF NOT EXISTS idx_parcel_import_items_order
  ON public.parcel_import_items (baestao_order_id);
CREATE INDEX IF NOT EXISTS idx_parcel_import_items_seller
  ON public.parcel_import_items (seller_name);

-- parcel_import_item_mappings
CREATE INDEX IF NOT EXISTS idx_piim_import
  ON public.parcel_import_item_mappings (parcel_import_id);
CREATE INDEX IF NOT EXISTS idx_piim_product
  ON public.parcel_import_item_mappings (product_id)
  WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_piim_variant
  ON public.parcel_import_item_mappings (product_variant_id)
  WHERE product_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_piim_status
  ON public.parcel_import_item_mappings (parcel_import_id, mapping_status);

-- parcel_import_cost_allocations
CREATE INDEX IF NOT EXISTS idx_pica_import
  ON public.parcel_import_cost_allocations (parcel_import_id);
CREATE INDEX IF NOT EXISTS idx_pica_item
  ON public.parcel_import_cost_allocations (parcel_import_item_id);
CREATE INDEX IF NOT EXISTS idx_pica_run
  ON public.parcel_import_cost_allocations (parcel_import_id, allocation_run_type);

-- parcel_import_events
CREATE INDEX IF NOT EXISTS idx_pie_import_created
  ON public.parcel_import_events (parcel_import_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pie_type
  ON public.parcel_import_events (event_type);

-- parcel_mapping_memory
CREATE INDEX IF NOT EXISTS idx_pmm_seller
  ON public.parcel_mapping_memory (seller_name);
CREATE INDEX IF NOT EXISTS idx_pmm_url_hash
  ON public.parcel_mapping_memory (source_url_hash)
  WHERE source_url_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pmm_product
  ON public.parcel_mapping_memory (product_id);
CREATE INDEX IF NOT EXISTS idx_pmm_normalized_name
  ON public.parcel_mapping_memory (normalized_source_item_name);

-- ════════════════════════════════════════════════════════════════
-- updated_at triggers (parcel_imports, mappings, mapping_memory only)
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'parcel_imports',
    'parcel_import_item_mappings',
    'parcel_mapping_memory'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════
-- Row Level Security + grants
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.parcel_imports                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_import_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_import_item_mappings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_import_cost_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_import_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_mapping_memory           ENABLE ROW LEVEL SECURITY;

CREATE POLICY parcel_imports_authenticated_all
  ON public.parcel_imports FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_imports_service_role_all
  ON public.parcel_imports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_import_items_authenticated_all
  ON public.parcel_import_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_import_items_service_role_all
  ON public.parcel_import_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_import_item_mappings_authenticated_all
  ON public.parcel_import_item_mappings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_import_item_mappings_service_role_all
  ON public.parcel_import_item_mappings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_import_cost_allocations_authenticated_all
  ON public.parcel_import_cost_allocations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_import_cost_allocations_service_role_all
  ON public.parcel_import_cost_allocations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_import_events_authenticated_all
  ON public.parcel_import_events FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_import_events_service_role_all
  ON public.parcel_import_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_mapping_memory_authenticated_all
  ON public.parcel_mapping_memory FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY parcel_mapping_memory_service_role_all
  ON public.parcel_mapping_memory FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parcel_imports                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parcel_import_items             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parcel_import_item_mappings     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parcel_import_cost_allocations  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parcel_import_events            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parcel_mapping_memory           TO authenticated;

GRANT ALL ON public.parcel_imports                  TO service_role;
GRANT ALL ON public.parcel_import_items             TO service_role;
GRANT ALL ON public.parcel_import_item_mappings     TO service_role;
GRANT ALL ON public.parcel_import_cost_allocations  TO service_role;
GRANT ALL ON public.parcel_import_events            TO service_role;
GRANT ALL ON public.parcel_mapping_memory           TO service_role;

-- ════════════════════════════════════════════════════════════════
-- Post-apply validation (read-only; run manually after migration)
-- ════════════════════════════════════════════════════════════════
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'parcel_%'
-- ORDER BY table_name;
--
-- SELECT c.relname, c.relrowsecurity, pol.polname
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
-- WHERE n.nspname = 'public' AND c.relname LIKE 'parcel_%'
-- ORDER BY c.relname, pol.polname;
--
-- SELECT tgname, tgrelid::regclass
-- FROM pg_trigger
-- WHERE tgname LIKE 'trg_parcel%_updated_at' AND NOT tgisinternal;
--
-- Smoke insert (authenticated session; rollback in transaction):
-- BEGIN;
-- INSERT INTO parcel_imports (parcel_id) VALUES ('227461') RETURNING id;
-- ROLLBACK;

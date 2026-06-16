-- 20260827_inventory_phase5_parcel_receive_summary.sql
--
-- Phase 5 — read-only parcel receive summary for Inventory dashboard.
-- Does not alter receive_parcel_import_inventory or parcel CPI/approve paths.

CREATE OR REPLACE VIEW public.v_inventory_parcel_receive_summary AS
SELECT
  (
    SELECT COUNT(*)::bigint
    FROM public.parcel_import_item_mappings m
    JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
    WHERE m.row_type = 'business_inventory'
      AND pi.status = 'approved'
      AND pi.inventory_received_at IS NULL
      AND (
        m.mapping_status <> 'matched'
        OR m.product_variant_id IS NULL
      )
  ) AS awaiting_mapping,
  (
    SELECT COUNT(*)::bigint
    FROM public.parcel_imports pi
    WHERE pi.status = 'approved'
      AND pi.inventory_received_at IS NULL
  ) AS ready_to_receive,
  (
    SELECT COUNT(*)::bigint
    FROM public.parcel_imports pi
    WHERE pi.inventory_received_at IS NOT NULL
      AND pi.inventory_received_at >= (now() - interval '30 days')
  ) AS recently_received,
  (
    SELECT MAX(pi.inventory_received_at)
    FROM public.parcel_imports pi
    WHERE pi.inventory_received_at IS NOT NULL
  ) AS last_parcel_receive_at,
  (
    SELECT COUNT(*)::bigint
    FROM public.stock_ledger sl
    WHERE sl.reason = 'parcel_receive'
  ) AS parcel_ledger_entries;

COMMENT ON VIEW public.v_inventory_parcel_receive_summary IS
  'Read-only parcel receive KPIs for Inventory admin: mapping backlog, receive queue, recent receives, ledger volume.';

GRANT SELECT ON public.v_inventory_parcel_receive_summary TO authenticated, service_role;

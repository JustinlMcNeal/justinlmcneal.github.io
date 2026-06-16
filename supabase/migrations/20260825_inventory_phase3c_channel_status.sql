-- 20260825_inventory_phase3c_channel_status.sql
--
-- Phase 3C — read-only channel sync aggregates for Inventory admin strip.
-- No tokens exposed; Amazon OAuth detail comes from amazon-auth-status edge function.

CREATE OR REPLACE VIEW public.v_inventory_channel_status AS
SELECT
  (
    SELECT MAX(al.last_synced_at)
    FROM public.amazon_listings al
  ) AS amazon_last_listing_sync_at,
  (
    SELECT MAX(sl.created_at)
    FROM public.stock_ledger sl
  ) AS last_stock_activity_at,
  (
    SELECT COUNT(*)::bigint
    FROM public.products p
    WHERE COALESCE(p.is_active, true) = true
      AND p.ebay_listing_id IS NOT NULL
      AND COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
  ) AS ebay_active_listing_count,
  (
    SELECT COUNT(*)::bigint
    FROM public.products p
    WHERE COALESCE(p.ebay_status, '') IN ('ended', 'out_of_stock')
  ) AS ebay_ended_listing_count,
  (
    SELECT COUNT(*)::bigint
    FROM public.amazon_listings al
  ) AS amazon_listing_count;

COMMENT ON VIEW public.v_inventory_channel_status IS
  'Inventory dashboard channel sync aggregates. eBay OAuth metadata is optional via marketplace_tokens in API.';

GRANT SELECT ON public.v_inventory_channel_status TO authenticated, service_role;

-- Phase 7F — eBay quantity sync result columns (extends Phase 7C log table).

ALTER TABLE public.inventory_channel_sync_results
  ADD COLUMN IF NOT EXISTS ebay_offer_id text,
  ADD COLUMN IF NOT EXISTS ebay_listing_id text;

COMMENT ON COLUMN public.inventory_channel_sync_results.ebay_offer_id IS
  'eBay offer ID for ebay channel set_quantity results (Phase 7F).';

COMMENT ON COLUMN public.inventory_channel_sync_results.ebay_listing_id IS
  'eBay listing/item ID for ebay channel set_quantity results (Phase 7F).';

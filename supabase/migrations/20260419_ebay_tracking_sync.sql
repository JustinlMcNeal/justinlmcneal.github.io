-- Phase 1c: eBay Fulfillment Tracking Sync
-- Adds columns to track whether shipping tracking has been pushed to eBay
ALTER TABLE fulfillment_shipments
  ADD COLUMN IF NOT EXISTS ebay_fulfillment_id text,
  ADD COLUMN IF NOT EXISTS tracking_pushed_to_ebay boolean DEFAULT false;

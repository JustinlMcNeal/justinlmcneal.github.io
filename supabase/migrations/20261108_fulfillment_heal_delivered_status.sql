-- Heal fulfillment rows where Shippo set delivered_at but a later
-- track_updated event regressively overwrote label_status back to shipped
-- (or another pre-delivery status). Safe to re-run.

UPDATE public.fulfillment_shipments
SET label_status = 'delivered'
WHERE delivered_at IS NOT NULL
  AND label_status IN ('pending', 'label_purchased', 'shipped', 'failed')
  AND COALESCE(label_status, '') <> 'delivered';

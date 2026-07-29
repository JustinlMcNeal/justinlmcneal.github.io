-- NOTE: Original heal used label_status = 'cancelled', which violated
-- fulfillment_shipments_label_status_check. Superseded by
-- 20261110_fulfillment_label_status_cancelled.sql (expands check + heals).
-- Kept as a no-op so migration history stays consistent.

SELECT 1;

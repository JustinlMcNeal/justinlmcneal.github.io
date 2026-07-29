-- Expand fulfillment_shipments.label_status to include cancel/refund statuses
-- used by stripe-refund, eBay cancel-aware sync, and the Orders UI.
-- Then heal full cancelled_before_ship refunds stuck on pending/label_purchased.
-- (20261109 heal failed: cancelled was not in the check constraint.)

ALTER TABLE public.fulfillment_shipments
  DROP CONSTRAINT IF EXISTS fulfillment_shipments_label_status_check;

ALTER TABLE public.fulfillment_shipments
  ADD CONSTRAINT fulfillment_shipments_label_status_check
  CHECK (
    label_status = ANY (
      ARRAY[
        'pending'::text,
        'label_purchased'::text,
        'shipped'::text,
        'delivered'::text,
        'voided'::text,
        'returned'::text,
        'cancelled'::text,
        'canceled'::text,
        'refunded'::text,
        'partial_refund'::text,
        'failed'::text
      ]
    )
  );

UPDATE public.fulfillment_shipments s
SET label_status = 'cancelled'
FROM public.orders_raw o
WHERE o.stripe_checkout_session_id = s.stripe_checkout_session_id
  AND o.refund_status = 'full'
  AND o.refund_reason = 'cancelled_before_ship'
  AND s.label_status IN ('pending', 'label_purchased');

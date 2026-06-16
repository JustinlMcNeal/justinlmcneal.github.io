-- Phase 10N — Update observations view: persisted table + Stripe + raw fallbacks.

CREATE OR REPLACE VIEW public.v_inventory_marketplace_refund_observations AS
SELECT
  observation_key,
  refund_source,
  source_channel,
  source_order_id,
  source_order_item_id,
  external_refund_id,
  external_event_id,
  refund_amount_cents,
  currency,
  refund_status,
  refund_reason,
  cancellation_status,
  return_status,
  quantity_refunded,
  quantity_returned,
  line_allocation_confidence,
  observed_at,
  sync_source,
  observation_kind,
  is_afn,
  observation_source,
  raw_payload
FROM (
  -- Persisted marketplace observations (preferred)
  SELECT
    ('mro:' || m.id::text) AS observation_key,
    m.source_channel AS refund_source,
    m.source_channel,
    m.source_order_id,
    m.source_order_item_id,
    m.external_refund_id,
    m.external_event_id,
    m.refund_amount_cents,
    m.currency,
    m.refund_status,
    m.refund_reason,
    m.cancellation_status,
    m.return_status,
    m.quantity_refunded,
    m.quantity_returned,
    m.line_allocation_confidence,
    m.observed_at,
    m.sync_source,
    m.observation_kind,
    m.is_afn,
    'persisted'::text AS observation_source,
    m.raw_payload
  FROM public.marketplace_refund_observations m

  UNION ALL

  -- Stripe/KK cached refund rows (Phase 10K/L)
  SELECT
    ('ord:' || COALESCE(d.stripe_refund_id, d.id::text)) AS observation_key,
    'stripe'::text AS refund_source,
    d.source_channel,
    d.source_order_id,
    d.source_order_item_id,
    d.stripe_refund_id AS external_refund_id,
    NULL::text AS external_event_id,
    d.refund_amount_cents,
    d.currency,
    d.refund_status,
    d.refund_reason,
    NULL::text AS cancellation_status,
    NULL::text AS return_status,
    NULL::numeric AS quantity_refunded,
    NULL::numeric AS quantity_returned,
    d.line_allocation_confidence,
    COALESCE(d.refund_created_at, d.updated_at, d.created_at) AS observed_at,
    COALESCE(d.sync_source, 'order_sync') AS sync_source,
    'refund'::text AS observation_kind,
    false AS is_afn,
    'stripe'::text AS observation_source,
    d.raw_payload
  FROM public.order_refund_details d

  UNION ALL

  -- Raw fallback: orders_raw (when not yet persisted)
  SELECT
    ('oro:' || o.stripe_checkout_session_id || ':' || COALESCE(o.refund_status, 'none')) AS observation_key,
    CASE
      WHEN o.stripe_checkout_session_id LIKE 'ebay%' THEN 'ebay'
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'marketplace'
    END AS refund_source,
    CASE
      WHEN o.stripe_checkout_session_id LIKE 'ebay%' THEN 'ebay'
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'marketplace'
    END AS source_channel,
    o.stripe_checkout_session_id AS source_order_id,
    NULL::text AS source_order_item_id,
    o.stripe_refund_id AS external_refund_id,
    NULL::text AS external_event_id,
    COALESCE(o.refund_amount_cents, 0) AS refund_amount_cents,
    'usd'::text AS currency,
    o.refund_status,
    o.refund_reason,
    NULL::text AS cancellation_status,
    CASE WHEN o.refund_reason = 'returned' THEN 'returned' ELSE NULL END AS return_status,
    NULL::numeric AS quantity_refunded,
    NULL::numeric AS quantity_returned,
    'order_level'::text AS line_allocation_confidence,
    COALESCE(o.refunded_at, o.updated_at, o.order_date) AS observed_at,
    'order_sync'::text AS sync_source,
    CASE
      WHEN o.refund_reason = 'returned' THEN 'return'
      WHEN COALESCE(o.refund_reason, '') IN ('cancelled_before_ship', 'cancelled') THEN 'cancellation'
      ELSE 'refund'
    END AS observation_kind,
    COALESCE(
      o.stripe_checkout_session_id LIKE 'amazon_%'
        AND EXISTS (
          SELECT 1 FROM public.fulfillment_shipments fs2
          WHERE fs2.stripe_checkout_session_id = o.stripe_checkout_session_id
            AND (fs2.service ILIKE '%Fulfilled by Amazon%' OR fs2.carrier = 'Amazon')
        ),
      false
    ) AS is_afn,
    'raw_fallback'::text AS observation_source,
    jsonb_build_object(
      'refund_status', o.refund_status,
      'refund_reason', o.refund_reason,
      'refund_amount_cents', o.refund_amount_cents
    ) AS raw_payload
  FROM public.orders_raw o
  WHERE (
      o.stripe_checkout_session_id LIKE 'ebay%'
      OR o.stripe_checkout_session_id LIKE 'amazon_%'
    )
    AND COALESCE(o.refund_status, '') NOT IN ('', 'none')
    AND o.stripe_checkout_session_id NOT LIKE 'cs_%'
    AND NOT EXISTS (
      SELECT 1 FROM public.marketplace_refund_observations p
      WHERE p.observation_dedup_key = (
        'order:' || o.stripe_checkout_session_id || ':' || COALESCE(o.refund_status, 'none')
      )
    )

  UNION ALL

  -- Raw fallback: fulfillment cancellation / return
  SELECT
    ('fs:' || fs.stripe_checkout_session_id || ':' || COALESCE(fs.label_status, '') || ':'
      || COALESCE(fs.returned_at::text, '')) AS observation_key,
    CASE
      WHEN fs.stripe_checkout_session_id LIKE 'ebay%' THEN 'ebay'
      WHEN fs.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'marketplace'
    END AS refund_source,
    CASE
      WHEN fs.stripe_checkout_session_id LIKE 'ebay%' THEN 'ebay'
      WHEN fs.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'marketplace'
    END AS source_channel,
    fs.stripe_checkout_session_id AS source_order_id,
    NULL::text AS source_order_item_id,
    NULL::text AS external_refund_id,
    NULL::text AS external_event_id,
    NULL::integer AS refund_amount_cents,
    NULL::text AS currency,
    fs.label_status AS refund_status,
    NULL::text AS refund_reason,
    CASE WHEN LOWER(COALESCE(fs.label_status, '')) = 'cancelled' THEN 'cancelled' ELSE NULL END AS cancellation_status,
    CASE WHEN fs.returned_at IS NOT NULL THEN 'returned' ELSE NULL END AS return_status,
    NULL::numeric AS quantity_refunded,
    NULL::numeric AS quantity_returned,
    'order_level'::text AS line_allocation_confidence,
    COALESCE(fs.returned_at, fs.updated_at, fs.created_at) AS observed_at,
    'order_sync'::text AS sync_source,
    CASE
      WHEN LOWER(COALESCE(fs.label_status, '')) = 'cancelled' THEN 'cancellation'
      WHEN fs.returned_at IS NOT NULL THEN 'return'
      ELSE 'fulfillment'
    END AS observation_kind,
    COALESCE(fs.service ILIKE '%Fulfilled by Amazon%' OR fs.carrier = 'Amazon', false) AS is_afn,
    'raw_fallback'::text AS observation_source,
    jsonb_build_object(
      'label_status', fs.label_status,
      'returned_at', fs.returned_at,
      'carrier', fs.carrier,
      'service', fs.service
    ) AS raw_payload
  FROM public.fulfillment_shipments fs
  WHERE (
      fs.stripe_checkout_session_id LIKE 'ebay%'
      OR fs.stripe_checkout_session_id LIKE 'amazon_%'
    )
    AND (
      LOWER(COALESCE(fs.label_status, '')) = 'cancelled'
      OR fs.returned_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.marketplace_refund_observations p
      WHERE p.observation_dedup_key = (
        'fulfillment:' || fs.stripe_checkout_session_id || ':'
          || COALESCE(fs.label_status, '') || ':' || COALESCE(fs.returned_at::text, '')
      )
    )

  UNION ALL

  -- Raw fallback: Amazon finance
  SELECT
    ('aft:' || aft.transaction_id) AS observation_key,
    'amazon'::text AS refund_source,
    'amazon'::text AS source_channel,
    aft.stripe_checkout_session_id AS source_order_id,
    NULL::text AS source_order_item_id,
    aft.transaction_id AS external_refund_id,
    NULL::text AS external_event_id,
    ABS(aft.amount_cents) AS refund_amount_cents,
    'usd'::text AS currency,
    aft.transaction_status AS refund_status,
    aft.transaction_type AS refund_reason,
    NULL::text AS cancellation_status,
    CASE WHEN aft.transaction_type ILIKE '%return%' THEN 'returned' ELSE NULL END AS return_status,
    NULL::numeric AS quantity_refunded,
    NULL::numeric AS quantity_returned,
    'order_level'::text AS line_allocation_confidence,
    COALESCE(aft.transaction_date, aft.synced_at, aft.created_at) AS observed_at,
    'order_sync'::text AS sync_source,
    CASE
      WHEN aft.transaction_type ILIKE '%refund%' OR aft.transaction_type ILIKE '%chargeback%' THEN 'refund'
      WHEN aft.transaction_type ILIKE '%return%' THEN 'return'
      ELSE 'refund'
    END AS observation_kind,
    false AS is_afn,
    'raw_fallback'::text AS observation_source,
    aft.raw_payload
  FROM public.amazon_finance_transactions aft
  WHERE aft.stripe_checkout_session_id LIKE 'amazon_%'
    AND (
      aft.transaction_type ILIKE '%refund%'
      OR aft.transaction_type ILIKE '%return%'
      OR aft.transaction_type ILIKE '%chargeback%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.marketplace_refund_observations p
      WHERE p.observation_dedup_key = ('finance:' || aft.transaction_id)
    )

  UNION ALL

  -- Raw fallback: eBay finance REFUND/CREDIT/REVERSAL
  SELECT
    ('eft:' || eft.transaction_id) AS observation_key,
    'ebay'::text AS refund_source,
    'ebay'::text AS source_channel,
    eft.stripe_checkout_session_id AS source_order_id,
    NULL::text AS source_order_item_id,
    eft.transaction_id AS external_refund_id,
    NULL::text AS external_event_id,
    ABS(eft.amount_cents) AS refund_amount_cents,
    'usd'::text AS currency,
    eft.transaction_status AS refund_status,
    eft.transaction_type AS refund_reason,
    NULL::text AS cancellation_status,
    NULL::text AS return_status,
    NULL::numeric AS quantity_refunded,
    NULL::numeric AS quantity_returned,
    'order_level'::text AS line_allocation_confidence,
    COALESCE(eft.transaction_date, eft.synced_at, eft.created_at) AS observed_at,
    'order_sync'::text AS sync_source,
    'refund'::text AS observation_kind,
    false AS is_afn,
    'raw_fallback'::text AS observation_source,
    eft.raw_payload
  FROM public.ebay_finance_transactions eft
  WHERE eft.stripe_checkout_session_id LIKE 'ebay%'
    AND UPPER(COALESCE(eft.transaction_type, '')) IN ('REFUND', 'CREDIT', 'REVERSAL')
    AND NOT EXISTS (
      SELECT 1 FROM public.marketplace_refund_observations p
      WHERE p.observation_dedup_key = ('finance:' || eft.transaction_id)
    )
) AS observations
WHERE source_order_id IS NOT NULL;

COMMENT ON VIEW public.v_inventory_marketplace_refund_observations IS
  'Phase 10N: persisted marketplace observations + Stripe cache + raw fallbacks when not yet backfilled.';

GRANT SELECT ON public.v_inventory_marketplace_refund_observations TO authenticated, service_role;

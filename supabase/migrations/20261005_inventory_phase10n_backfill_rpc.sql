-- Phase 10N — Backfill RPC for marketplace_refund_observations (local data only, idempotent).

CREATE OR REPLACE FUNCTION public.backfill_marketplace_refund_observations(
  p_channel text DEFAULT 'all',
  p_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_source_order_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_updated integer := 0;
  v_batch_ins integer;
  v_batch_upd integer;
  v_limit integer := COALESCE(p_limit, 100000);
BEGIN
  -- Amazon finance refund/return/chargeback rows
  IF p_channel IN ('all', 'amazon') THEN
    WITH src AS (
      SELECT
        'amazon'::text AS source_channel,
        aft.stripe_checkout_session_id AS source_order_id,
        NULL::text AS source_order_item_id,
        aft.transaction_id AS external_transaction_id,
        aft.transaction_id AS external_refund_id,
        ABS(aft.amount_cents)::integer AS refund_amount_cents,
        aft.transaction_status AS refund_status,
        aft.transaction_type AS refund_reason,
        CASE WHEN aft.transaction_type ILIKE '%return%' THEN 'returned' ELSE NULL END AS return_status,
        'order_level'::text AS line_allocation_confidence,
        CASE
          WHEN fs.service ILIKE '%Fulfilled by Amazon%' OR fs.carrier = 'Amazon' THEN 'AFN'
          ELSE 'FBM'
        END AS fulfillment_channel,
        COALESCE(fs.service ILIKE '%Fulfilled by Amazon%' OR fs.carrier = 'Amazon', false) AS is_afn,
        CASE
          WHEN aft.transaction_type ILIKE '%refund%' OR aft.transaction_type ILIKE '%chargeback%' THEN 'refund'
          WHEN aft.transaction_type ILIKE '%return%' THEN 'return'
          ELSE 'refund'
        END AS observation_kind,
        ('finance:' || aft.transaction_id) AS observation_dedup_key,
        COALESCE(aft.transaction_date, aft.synced_at, aft.created_at) AS observed_at,
        'finance_sync'::text AS sync_source,
        aft.raw_payload
      FROM public.amazon_finance_transactions aft
      LEFT JOIN public.fulfillment_shipments fs
        ON fs.stripe_checkout_session_id = aft.stripe_checkout_session_id
      WHERE aft.stripe_checkout_session_id LIKE 'amazon_%'
        AND (
          aft.transaction_type ILIKE '%refund%'
          OR aft.transaction_type ILIKE '%return%'
          OR aft.transaction_type ILIKE '%chargeback%'
        )
        AND (p_since IS NULL OR COALESCE(aft.transaction_date, aft.synced_at, aft.created_at) >= p_since)
        AND (p_source_order_id IS NULL OR aft.stripe_checkout_session_id = p_source_order_id)
      ORDER BY COALESCE(aft.transaction_date, aft.synced_at, aft.created_at) DESC
      LIMIT v_limit
    ),
    upserted AS (
      INSERT INTO public.marketplace_refund_observations (
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, external_transaction_id,
        refund_amount_cents, currency, refund_status, refund_reason,
        return_status, line_allocation_confidence, fulfillment_channel, is_afn,
        observation_kind, observation_dedup_key, observed_at, sync_source, raw_payload, updated_at
      )
      SELECT
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, external_transaction_id,
        refund_amount_cents, 'usd', refund_status, refund_reason,
        return_status, line_allocation_confidence, fulfillment_channel, is_afn,
        observation_kind, observation_dedup_key, observed_at, sync_source, raw_payload, now()
      FROM src
      ON CONFLICT (source_channel, observation_dedup_key) DO UPDATE SET
        refund_amount_cents = EXCLUDED.refund_amount_cents,
        refund_status = EXCLUDED.refund_status,
        refund_reason = EXCLUDED.refund_reason,
        return_status = EXCLUDED.return_status,
        is_afn = EXCLUDED.is_afn,
        fulfillment_channel = EXCLUDED.fulfillment_channel,
        observed_at = EXCLUDED.observed_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT
      COUNT(*) FILTER (WHERE was_insert),
      COUNT(*) FILTER (WHERE NOT was_insert)
    INTO v_batch_ins, v_batch_upd
    FROM upserted;
    v_inserted := v_inserted + COALESCE(v_batch_ins, 0);
    v_updated := v_updated + COALESCE(v_batch_upd, 0);
  END IF;

  -- eBay finance REFUND/CREDIT/REVERSAL
  IF p_channel IN ('all', 'ebay') THEN
    WITH src AS (
      SELECT
        'ebay'::text AS source_channel,
        eft.stripe_checkout_session_id AS source_order_id,
        NULL::text AS source_order_item_id,
        eft.transaction_id AS external_transaction_id,
        eft.transaction_id AS external_refund_id,
        ABS(eft.amount_cents)::integer AS refund_amount_cents,
        eft.transaction_status AS refund_status,
        eft.transaction_type AS refund_reason,
        NULL::text AS return_status,
        'order_level'::text AS line_allocation_confidence,
        NULL::text AS fulfillment_channel,
        false AS is_afn,
        'refund'::text AS observation_kind,
        ('finance:' || eft.transaction_id) AS observation_dedup_key,
        COALESCE(eft.transaction_date, eft.synced_at, eft.created_at) AS observed_at,
        'finance_sync'::text AS sync_source,
        eft.raw_payload
      FROM public.ebay_finance_transactions eft
      WHERE eft.stripe_checkout_session_id LIKE 'ebay%'
        AND UPPER(COALESCE(eft.transaction_type, '')) IN ('REFUND', 'CREDIT', 'REVERSAL')
        AND (p_since IS NULL OR COALESCE(eft.transaction_date, eft.synced_at, eft.created_at) >= p_since)
        AND (p_source_order_id IS NULL OR eft.stripe_checkout_session_id = p_source_order_id)
      ORDER BY COALESCE(eft.transaction_date, eft.synced_at, eft.created_at) DESC
      LIMIT v_limit
    ),
    upserted AS (
      INSERT INTO public.marketplace_refund_observations (
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, external_transaction_id,
        refund_amount_cents, currency, refund_status, refund_reason,
        return_status, line_allocation_confidence, fulfillment_channel, is_afn,
        observation_kind, observation_dedup_key, observed_at, sync_source, raw_payload, updated_at
      )
      SELECT
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, external_transaction_id,
        refund_amount_cents, 'usd', refund_status, refund_reason,
        return_status, line_allocation_confidence, fulfillment_channel, is_afn,
        observation_kind, observation_dedup_key, observed_at, sync_source, raw_payload, now()
      FROM src
      ON CONFLICT (source_channel, observation_dedup_key) DO UPDATE SET
        refund_amount_cents = EXCLUDED.refund_amount_cents,
        refund_status = EXCLUDED.refund_status,
        refund_reason = EXCLUDED.refund_reason,
        observed_at = EXCLUDED.observed_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT
      COUNT(*) FILTER (WHERE was_insert),
      COUNT(*) FILTER (WHERE NOT was_insert)
    INTO v_batch_ins, v_batch_upd
    FROM upserted;
    v_inserted := v_inserted + COALESCE(v_batch_ins, 0);
    v_updated := v_updated + COALESCE(v_batch_upd, 0);
  END IF;

  -- orders_raw marketplace refund fields
  IF p_channel IN ('all', 'ebay', 'amazon') THEN
    WITH src AS (
      SELECT
        CASE
          WHEN o.stripe_checkout_session_id LIKE 'ebay%' THEN 'ebay'
          WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
        END AS source_channel,
        o.stripe_checkout_session_id AS source_order_id,
        NULL::text AS source_order_item_id,
        o.stripe_refund_id AS external_refund_id,
        NULL::text AS external_transaction_id,
        COALESCE(o.refund_amount_cents, 0)::integer AS refund_amount_cents,
        o.refund_status,
        o.refund_reason,
        NULL::text AS cancellation_status,
        CASE WHEN o.refund_reason = 'returned' THEN 'returned' ELSE NULL END AS return_status,
        'order_level'::text AS line_allocation_confidence,
        CASE
          WHEN o.stripe_checkout_session_id LIKE 'amazon_%'
            AND (fs.service ILIKE '%Fulfilled by Amazon%' OR fs.carrier = 'Amazon')
          THEN 'AFN'
          ELSE NULL
        END AS fulfillment_channel,
        COALESCE(
          o.stripe_checkout_session_id LIKE 'amazon_%'
            AND (fs.service ILIKE '%Fulfilled by Amazon%' OR fs.carrier = 'Amazon'),
          false
        ) AS is_afn,
        CASE
          WHEN o.refund_reason = 'returned' THEN 'return'
          WHEN COALESCE(o.refund_reason, '') IN ('cancelled_before_ship', 'cancelled') THEN 'cancellation'
          ELSE 'refund'
        END AS observation_kind,
        ('order:' || o.stripe_checkout_session_id || ':' || COALESCE(o.refund_status, 'none')) AS observation_dedup_key,
        COALESCE(o.refunded_at, o.updated_at, o.order_date) AS observed_at,
        'order_sync'::text AS sync_source,
        jsonb_build_object(
          'refund_status', o.refund_status,
          'refund_reason', o.refund_reason,
          'refund_amount_cents', o.refund_amount_cents
        ) AS raw_payload
      FROM public.orders_raw o
      LEFT JOIN public.fulfillment_shipments fs
        ON fs.stripe_checkout_session_id = o.stripe_checkout_session_id
      WHERE (
          (p_channel = 'all' AND (o.stripe_checkout_session_id LIKE 'ebay%' OR o.stripe_checkout_session_id LIKE 'amazon_%'))
          OR (p_channel = 'ebay' AND o.stripe_checkout_session_id LIKE 'ebay%')
          OR (p_channel = 'amazon' AND o.stripe_checkout_session_id LIKE 'amazon_%')
        )
        AND COALESCE(o.refund_status, '') NOT IN ('', 'none')
        AND (p_since IS NULL OR COALESCE(o.refunded_at, o.updated_at, o.order_date) >= p_since)
        AND (p_source_order_id IS NULL OR o.stripe_checkout_session_id = p_source_order_id)
      LIMIT v_limit
    ),
    upserted AS (
      INSERT INTO public.marketplace_refund_observations (
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, external_transaction_id,
        refund_amount_cents, currency, refund_status, refund_reason,
        cancellation_status, return_status, line_allocation_confidence,
        fulfillment_channel, is_afn, observation_kind, observation_dedup_key,
        observed_at, sync_source, raw_payload, updated_at
      )
      SELECT
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, external_transaction_id,
        refund_amount_cents, 'usd', refund_status, refund_reason,
        cancellation_status, return_status, line_allocation_confidence,
        fulfillment_channel, is_afn, observation_kind, observation_dedup_key,
        observed_at, sync_source, raw_payload, now()
      FROM src
      WHERE source_channel IS NOT NULL
      ON CONFLICT (source_channel, observation_dedup_key) DO UPDATE SET
        refund_amount_cents = EXCLUDED.refund_amount_cents,
        refund_status = EXCLUDED.refund_status,
        refund_reason = EXCLUDED.refund_reason,
        return_status = EXCLUDED.return_status,
        is_afn = EXCLUDED.is_afn,
        observed_at = EXCLUDED.observed_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT
      COUNT(*) FILTER (WHERE was_insert),
      COUNT(*) FILTER (WHERE NOT was_insert)
    INTO v_batch_ins, v_batch_upd
    FROM upserted;
    v_inserted := v_inserted + COALESCE(v_batch_ins, 0);
    v_updated := v_updated + COALESCE(v_batch_upd, 0);
  END IF;

  -- fulfillment cancel / carrier return
  IF p_channel IN ('all', 'ebay', 'amazon') THEN
    WITH src AS (
      SELECT
        CASE
          WHEN fs.stripe_checkout_session_id LIKE 'ebay%' THEN 'ebay'
          WHEN fs.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
        END AS source_channel,
        fs.stripe_checkout_session_id AS source_order_id,
        NULL::text AS source_order_item_id,
        NULL::text AS external_refund_id,
        NULL::text AS external_transaction_id,
        NULL::integer AS refund_amount_cents,
        fs.label_status AS refund_status,
        NULL::text AS refund_reason,
        CASE WHEN LOWER(COALESCE(fs.label_status, '')) = 'cancelled' THEN 'cancelled' ELSE NULL END AS cancellation_status,
        CASE WHEN fs.returned_at IS NOT NULL THEN 'returned' ELSE NULL END AS return_status,
        'order_level'::text AS line_allocation_confidence,
        CASE
          WHEN fs.service ILIKE '%Fulfilled by Amazon%' OR fs.carrier = 'Amazon' THEN 'AFN'
          ELSE NULL
        END AS fulfillment_channel,
        COALESCE(fs.service ILIKE '%Fulfilled by Amazon%' OR fs.carrier = 'Amazon', false) AS is_afn,
        CASE
          WHEN LOWER(COALESCE(fs.label_status, '')) = 'cancelled' THEN 'cancellation'
          WHEN fs.returned_at IS NOT NULL THEN 'return'
          ELSE 'fulfillment'
        END AS observation_kind,
        ('fulfillment:' || fs.stripe_checkout_session_id || ':'
          || COALESCE(fs.label_status, '') || ':' || COALESCE(fs.returned_at::text, '')) AS observation_dedup_key,
        COALESCE(fs.returned_at, fs.updated_at, fs.created_at) AS observed_at,
        'order_sync'::text AS sync_source,
        jsonb_build_object(
          'label_status', fs.label_status,
          'returned_at', fs.returned_at,
          'carrier', fs.carrier,
          'service', fs.service
        ) AS raw_payload
      FROM public.fulfillment_shipments fs
      WHERE (
          (p_channel = 'all' AND (fs.stripe_checkout_session_id LIKE 'ebay%' OR fs.stripe_checkout_session_id LIKE 'amazon_%'))
          OR (p_channel = 'ebay' AND fs.stripe_checkout_session_id LIKE 'ebay%')
          OR (p_channel = 'amazon' AND fs.stripe_checkout_session_id LIKE 'amazon_%')
        )
        AND (
          LOWER(COALESCE(fs.label_status, '')) = 'cancelled'
          OR fs.returned_at IS NOT NULL
        )
        AND (p_since IS NULL OR COALESCE(fs.returned_at, fs.updated_at, fs.created_at) >= p_since)
        AND (p_source_order_id IS NULL OR fs.stripe_checkout_session_id = p_source_order_id)
      LIMIT v_limit
    ),
    upserted AS (
      INSERT INTO public.marketplace_refund_observations (
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, external_transaction_id,
        refund_amount_cents, currency, refund_status, refund_reason,
        cancellation_status, return_status, line_allocation_confidence,
        fulfillment_channel, is_afn, observation_kind, observation_dedup_key,
        observed_at, sync_source, raw_payload, updated_at
      )
      SELECT
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, external_transaction_id,
        refund_amount_cents, 'usd', refund_status, refund_reason,
        cancellation_status, return_status, line_allocation_confidence,
        fulfillment_channel, is_afn, observation_kind, observation_dedup_key,
        observed_at, sync_source, raw_payload, now()
      FROM src
      WHERE source_channel IS NOT NULL
      ON CONFLICT (source_channel, observation_dedup_key) DO UPDATE SET
        refund_status = EXCLUDED.refund_status,
        cancellation_status = EXCLUDED.cancellation_status,
        return_status = EXCLUDED.return_status,
        is_afn = EXCLUDED.is_afn,
        observed_at = EXCLUDED.observed_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT
      COUNT(*) FILTER (WHERE was_insert),
      COUNT(*) FILTER (WHERE NOT was_insert)
    INTO v_batch_ins, v_batch_upd
    FROM upserted;
    v_inserted := v_inserted + COALESCE(v_batch_ins, 0);
    v_updated := v_updated + COALESCE(v_batch_upd, 0);
  END IF;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', 0,
    'channel', p_channel,
    'since', p_since,
    'source_order_id', p_source_order_id
  );
END;
$$;

COMMENT ON FUNCTION public.backfill_marketplace_refund_observations IS
  'Phase 10N: idempotent backfill from local order/finance/fulfillment data — no inventory mutations.';

GRANT EXECUTE ON FUNCTION public.backfill_marketplace_refund_observations TO authenticated, service_role;

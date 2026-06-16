-- Phase 10O — Line-level extraction helpers + enhanced backfill reporting.

CREATE OR REPLACE FUNCTION public.infer_marketplace_line_from_payload(
  p_channel text,
  p_source_order_id text,
  p_raw_payload jsonb,
  p_fee_breakdown jsonb DEFAULT NULL
)
RETURNS TABLE (
  source_order_item_id text,
  line_allocation_confidence text
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_elem jsonb;
  v_line_id text;
  v_order_id text;
BEGIN
  source_order_item_id := NULL;
  line_allocation_confidence := 'order_level';

  IF p_channel = 'ebay' THEN
    FOR v_elem IN
      SELECT elem
      FROM jsonb_array_elements(
        COALESCE(
          p_fee_breakdown,
          p_raw_payload -> 'orderLineItems',
          p_raw_payload -> 'fee_breakdown',
          '[]'::jsonb
        )
      ) AS elem
    LOOP
      v_line_id := COALESCE(
        v_elem ->> 'lineItemId',
        v_elem ->> 'orderLineItemId',
        v_elem ->> 'legacyItemId'
      );
      IF v_line_id IS NOT NULL AND v_line_id <> '' THEN
        source_order_item_id := 'ebay_li_' || v_line_id;
        line_allocation_confidence := 'line_confirmed';
        RETURN NEXT;
        RETURN;
      END IF;
    END LOOP;

    IF jsonb_array_length(COALESCE(p_raw_payload -> 'lineItems', '[]'::jsonb)) = 1 THEN
      v_elem := (p_raw_payload -> 'lineItems') -> 0;
      v_line_id := COALESCE(v_elem ->> 'lineItemId', v_elem ->> 'legacyItemId');
      IF v_line_id IS NOT NULL AND v_line_id <> '' THEN
        source_order_item_id := 'ebay_li_' || v_line_id;
        line_allocation_confidence := 'line_confirmed';
        RETURN NEXT;
        RETURN;
      END IF;
      IF COALESCE(v_elem ->> 'sku', v_elem ->> 'legacyVariationId') IS NOT NULL THEN
        line_allocation_confidence := 'sku_inferred';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  ELSIF p_channel = 'amazon' THEN
    v_order_id := regexp_replace(p_source_order_id, '^amazon_', '');

    FOR v_elem IN
      SELECT elem
      FROM jsonb_array_elements(
        COALESCE(
          p_fee_breakdown,
          p_raw_payload -> 'fee_breakdown',
          p_raw_payload -> 'OrderItems',
          '[]'::jsonb
        )
      ) AS elem
    LOOP
      v_line_id := COALESCE(
        v_elem ->> 'OrderItemId',
        v_elem ->> 'orderItemId',
        v_elem ->> 'shipmentItemId'
      );
      IF v_line_id IS NOT NULL AND v_line_id <> '' THEN
        source_order_item_id := 'amazon_' || v_order_id || '_li_' || v_line_id;
        line_allocation_confidence := 'line_confirmed';
        RETURN NEXT;
        RETURN;
      END IF;
      IF COALESCE(v_elem ->> 'SellerSKU', v_elem ->> 'sellerSKU') IS NOT NULL THEN
        line_allocation_confidence := 'sku_inferred';
        RETURN NEXT;
        RETURN;
      END IF;
    END LOOP;

    FOR v_elem IN
      SELECT elem
      FROM jsonb_array_elements(COALESCE(p_raw_payload -> 'relatedIdentifiers', '[]'::jsonb)) AS elem
    LOOP
      IF COALESCE(v_elem ->> 'relatedIdentifierName', v_elem ->> 'RelatedIdentifierName') = 'ORDER_ITEM_ID' THEN
        v_line_id := COALESCE(v_elem ->> 'relatedIdentifierValue', v_elem ->> 'RelatedIdentifierValue');
        IF v_line_id IS NOT NULL AND v_line_id <> '' THEN
          source_order_item_id := 'amazon_' || v_order_id || '_li_' || v_line_id;
          line_allocation_confidence := 'line_confirmed';
          RETURN NEXT;
          RETURN;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.infer_marketplace_line_from_payload IS
  'Phase 10O: extract stripe_line_item_id + confidence from marketplace finance/order payloads.';

-- Replace backfill RPC with line extraction + confidence reporting.
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
  v_conf jsonb;
BEGIN
  IF p_channel IN ('all', 'amazon') THEN
    WITH src AS (
      SELECT
        'amazon'::text AS source_channel,
        aft.stripe_checkout_session_id AS source_order_id,
        line_inf.source_order_item_id,
        line_inf.line_allocation_confidence,
        aft.transaction_id AS external_transaction_id,
        aft.transaction_id AS external_refund_id,
        ABS(aft.amount_cents)::integer AS refund_amount_cents,
        aft.transaction_status AS refund_status,
        aft.transaction_type AS refund_reason,
        CASE WHEN aft.transaction_type ILIKE '%return%' THEN 'returned' ELSE NULL END AS return_status,
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
        aft.raw_payload,
        aft.fee_breakdown
      FROM public.amazon_finance_transactions aft
      LEFT JOIN public.fulfillment_shipments fs
        ON fs.stripe_checkout_session_id = aft.stripe_checkout_session_id
      LEFT JOIN LATERAL public.infer_marketplace_line_from_payload(
        'amazon', aft.stripe_checkout_session_id, aft.raw_payload, aft.fee_breakdown
      ) line_inf ON true
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
        source_order_item_id = COALESCE(EXCLUDED.source_order_item_id, marketplace_refund_observations.source_order_item_id),
        line_allocation_confidence = EXCLUDED.line_allocation_confidence,
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
    SELECT COUNT(*) FILTER (WHERE was_insert), COUNT(*) FILTER (WHERE NOT was_insert)
    INTO v_batch_ins, v_batch_upd FROM upserted;
    v_inserted := v_inserted + COALESCE(v_batch_ins, 0);
    v_updated := v_updated + COALESCE(v_batch_upd, 0);
  END IF;

  IF p_channel IN ('all', 'ebay') THEN
    WITH src AS (
      SELECT
        'ebay'::text AS source_channel,
        eft.stripe_checkout_session_id AS source_order_id,
        line_inf.source_order_item_id,
        line_inf.line_allocation_confidence,
        eft.transaction_id AS external_transaction_id,
        eft.transaction_id AS external_refund_id,
        ABS(eft.amount_cents)::integer AS refund_amount_cents,
        eft.transaction_status AS refund_status,
        eft.transaction_type AS refund_reason,
        NULL::text AS return_status,
        NULL::text AS fulfillment_channel,
        false AS is_afn,
        'refund'::text AS observation_kind,
        ('finance:' || eft.transaction_id) AS observation_dedup_key,
        COALESCE(eft.transaction_date, eft.synced_at, eft.created_at) AS observed_at,
        'finance_sync'::text AS sync_source,
        eft.raw_payload,
        eft.fee_breakdown
      FROM public.ebay_finance_transactions eft
      LEFT JOIN LATERAL public.infer_marketplace_line_from_payload(
        'ebay', eft.stripe_checkout_session_id, eft.raw_payload, eft.fee_breakdown
      ) line_inf ON true
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
        source_order_item_id = COALESCE(EXCLUDED.source_order_item_id, marketplace_refund_observations.source_order_item_id),
        line_allocation_confidence = EXCLUDED.line_allocation_confidence,
        refund_amount_cents = EXCLUDED.refund_amount_cents,
        observed_at = EXCLUDED.observed_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT v_inserted + COUNT(*) FILTER (WHERE was_insert), v_updated + COUNT(*) FILTER (WHERE NOT was_insert)
    INTO v_inserted, v_updated FROM upserted;
  END IF;

  -- orders_raw + fulfillment sources (unchanged logic, order-level)
  IF p_channel IN ('all', 'ebay', 'amazon') THEN
    WITH src AS (
      SELECT
        CASE
          WHEN o.stripe_checkout_session_id LIKE 'ebay%' THEN 'ebay'
          WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
        END AS source_channel,
        o.stripe_checkout_session_id AS source_order_id,
        NULL::text AS source_order_item_id,
        'order_level'::text AS line_allocation_confidence,
        o.stripe_refund_id AS external_refund_id,
        COALESCE(o.refund_amount_cents, 0)::integer AS refund_amount_cents,
        o.refund_status,
        o.refund_reason,
        CASE WHEN o.refund_reason = 'returned' THEN 'returned' ELSE NULL END AS return_status,
        COALESCE(
          o.stripe_checkout_session_id LIKE 'amazon_%'
            AND EXISTS (
              SELECT 1 FROM public.fulfillment_shipments fs2
              WHERE fs2.stripe_checkout_session_id = o.stripe_checkout_session_id
                AND (fs2.service ILIKE '%Fulfilled by Amazon%' OR fs2.carrier = 'Amazon')
            ),
          false
        ) AS is_afn,
        CASE
          WHEN o.refund_reason = 'returned' THEN 'return'
          WHEN COALESCE(o.refund_reason, '') IN ('cancelled_before_ship', 'cancelled') THEN 'cancellation'
          ELSE 'refund'
        END AS observation_kind,
        ('order:' || o.stripe_checkout_session_id || ':' || COALESCE(o.refund_status, 'none')) AS observation_dedup_key,
        COALESCE(o.refunded_at, o.updated_at, o.order_date) AS observed_at,
        jsonb_build_object('refund_status', o.refund_status, 'refund_reason', o.refund_reason) AS raw_payload
      FROM public.orders_raw o
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
        external_refund_id, refund_amount_cents, currency, refund_status, refund_reason,
        return_status, line_allocation_confidence, is_afn, observation_kind,
        observation_dedup_key, observed_at, sync_source, raw_payload, updated_at
      )
      SELECT
        source_channel, source_order_id, source_order_item_id,
        external_refund_id, refund_amount_cents, 'usd', refund_status, refund_reason,
        return_status, line_allocation_confidence, is_afn, observation_kind,
        observation_dedup_key, observed_at, 'order_sync', raw_payload, now()
      FROM src WHERE source_channel IS NOT NULL
      ON CONFLICT (source_channel, observation_dedup_key) DO UPDATE SET
        refund_amount_cents = EXCLUDED.refund_amount_cents,
        observed_at = EXCLUDED.observed_at,
        updated_at = now()
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT v_inserted + COUNT(*) FILTER (WHERE was_insert), v_updated + COUNT(*) FILTER (WHERE NOT was_insert)
    INTO v_inserted, v_updated FROM upserted;
  END IF;

  IF p_channel IN ('all', 'ebay', 'amazon') THEN
    WITH src AS (
      SELECT
        CASE
          WHEN fs.stripe_checkout_session_id LIKE 'ebay%' THEN 'ebay'
          WHEN fs.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
        END AS source_channel,
        fs.stripe_checkout_session_id AS source_order_id,
        NULL::text AS source_order_item_id,
        'order_level'::text AS line_allocation_confidence,
        fs.label_status AS refund_status,
        CASE WHEN LOWER(COALESCE(fs.label_status, '')) = 'cancelled' THEN 'cancelled' ELSE NULL END AS cancellation_status,
        CASE WHEN fs.returned_at IS NOT NULL THEN 'returned' ELSE NULL END AS return_status,
        COALESCE(fs.service ILIKE '%Fulfilled by Amazon%' OR fs.carrier = 'Amazon', false) AS is_afn,
        CASE
          WHEN LOWER(COALESCE(fs.label_status, '')) = 'cancelled' THEN 'cancellation'
          WHEN fs.returned_at IS NOT NULL THEN 'return'
          ELSE 'fulfillment'
        END AS observation_kind,
        ('fulfillment:' || fs.stripe_checkout_session_id || ':'
          || COALESCE(fs.label_status, '') || ':' || COALESCE(fs.returned_at::text, '')) AS observation_dedup_key,
        COALESCE(fs.returned_at, fs.updated_at, fs.created_at) AS observed_at,
        jsonb_build_object('label_status', fs.label_status, 'returned_at', fs.returned_at) AS raw_payload
      FROM public.fulfillment_shipments fs
      WHERE (
          (p_channel = 'all' AND (fs.stripe_checkout_session_id LIKE 'ebay%' OR fs.stripe_checkout_session_id LIKE 'amazon_%'))
          OR (p_channel = 'ebay' AND fs.stripe_checkout_session_id LIKE 'ebay%')
          OR (p_channel = 'amazon' AND fs.stripe_checkout_session_id LIKE 'amazon_%')
        )
        AND (LOWER(COALESCE(fs.label_status, '')) = 'cancelled' OR fs.returned_at IS NOT NULL)
        AND (p_since IS NULL OR COALESCE(fs.returned_at, fs.updated_at, fs.created_at) >= p_since)
        AND (p_source_order_id IS NULL OR fs.stripe_checkout_session_id = p_source_order_id)
      LIMIT v_limit
    ),
    upserted AS (
      INSERT INTO public.marketplace_refund_observations (
        source_channel, source_order_id, source_order_item_id,
        refund_status, cancellation_status, return_status,
        line_allocation_confidence, is_afn, observation_kind,
        observation_dedup_key, observed_at, sync_source, raw_payload, updated_at
      )
      SELECT
        source_channel, source_order_id, source_order_item_id,
        refund_status, cancellation_status, return_status,
        line_allocation_confidence, is_afn, observation_kind,
        observation_dedup_key, observed_at, 'order_sync', raw_payload, now()
      FROM src WHERE source_channel IS NOT NULL
      ON CONFLICT (source_channel, observation_dedup_key) DO UPDATE SET
        cancellation_status = EXCLUDED.cancellation_status,
        return_status = EXCLUDED.return_status,
        observed_at = EXCLUDED.observed_at,
        updated_at = now()
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT v_inserted + COUNT(*) FILTER (WHERE was_insert), v_updated + COUNT(*) FILTER (WHERE NOT was_insert)
    INTO v_inserted, v_updated FROM upserted;
  END IF;

  SELECT jsonb_object_agg(line_allocation_confidence, cnt)
  INTO v_conf
  FROM (
    SELECT line_allocation_confidence, COUNT(*)::int AS cnt
    FROM public.marketplace_refund_observations
    WHERE (p_source_order_id IS NULL OR source_order_id = p_source_order_id)
      AND (
        p_channel = 'all'
        OR (p_channel = 'ebay' AND source_channel = 'ebay')
        OR (p_channel = 'amazon' AND source_channel = 'amazon')
      )
    GROUP BY line_allocation_confidence
  ) c;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', 0,
    'channel', p_channel,
    'since', p_since,
    'source_order_id', p_source_order_id,
    'confidence_counts', COALESCE(v_conf, '{}'::jsonb),
    'total_observations', (
      SELECT COUNT(*)::int FROM public.marketplace_refund_observations
      WHERE (p_source_order_id IS NULL OR source_order_id = p_source_order_id)
    ),
    'amazon_canceled_retained', (
      SELECT COUNT(*)::int FROM public.marketplace_refund_observations
      WHERE source_channel = 'amazon'
        AND observation_kind = 'cancellation'
        AND sync_source = 'order_sync'
        AND (p_source_order_id IS NULL OR source_order_id = p_source_order_id)
    ),
    'ebay_canceled_updated', (
      SELECT COUNT(*)::int FROM public.marketplace_refund_observations
      WHERE source_channel = 'ebay'
        AND observation_kind = 'cancellation'
        AND (p_source_order_id IS NULL OR source_order_id = p_source_order_id)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.infer_marketplace_line_from_payload TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_marketplace_refund_observations TO authenticated, service_role;

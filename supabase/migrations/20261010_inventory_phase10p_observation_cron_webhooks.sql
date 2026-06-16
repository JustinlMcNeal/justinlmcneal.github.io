-- Phase 10P — Amazon TSV canceled observation retention + Line Items marketplace status view.
-- Observational only: no reservations, stock, or ledger mutations.

-- Retain canceled Amazon TSV rows as marketplace observations (no orders_raw insert).
CREATE OR REPLACE FUNCTION public.retain_amazon_tsv_canceled_observations(
  p_amazon_order_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_session_id text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_batch_ins integer;
  v_batch_upd integer;
BEGIN
  IF p_amazon_order_ids IS NULL OR array_length(p_amazon_order_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('inserted', 0, 'updated', 0, 'skipped', 0, 'retained', 0);
  END IF;

  FOREACH v_id IN ARRAY p_amazon_order_ids LOOP
    IF v_id IS NULL OR btrim(v_id) = '' THEN
      CONTINUE;
    END IF;

    v_session_id := 'amazon_' || btrim(v_id);

    INSERT INTO public.marketplace_refund_observations (
      source_channel,
      source_order_id,
      observation_kind,
      observation_dedup_key,
      cancellation_status,
      sync_source,
      line_allocation_confidence,
      observed_at,
      raw_payload,
      updated_at
    )
    VALUES (
      'amazon',
      v_session_id,
      'cancellation',
      'cancel:' || v_session_id,
      'cancelled',
      'admin_backfill',
      'order_level',
      now(),
      jsonb_build_object(
        'source', 'amazon_tsv_import',
        'amazon_order_id', btrim(v_id),
        'order_status', 'Cancelled'
      ),
      now()
    )
    ON CONFLICT (source_channel, observation_dedup_key)
    DO UPDATE SET
      cancellation_status = EXCLUDED.cancellation_status,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = now()
    RETURNING (xmax = 0) INTO v_batch_ins;

    IF v_batch_ins THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', 0,
    'retained', v_inserted + v_updated
  );
END;
$$;

COMMENT ON FUNCTION public.retain_amazon_tsv_canceled_observations IS
  'Phase 10P: persist canceled Amazon TSV order ids as read-only cancellation observations (no fulfillable order rows).';

GRANT EXECUTE ON FUNCTION public.retain_amazon_tsv_canceled_observations TO authenticated, service_role;

-- Unified marketplace status for Line Items UI (derived, guidance-only).
CREATE OR REPLACE VIEW public.v_order_marketplace_status AS
SELECT
  o.stripe_checkout_session_id,
  CASE
    WHEN lower(COALESCE(fs.label_status, '')) IN ('cancelled', 'canceled') THEN 'canceled'
    WHEN o.refund_status IN ('full', 'partial') THEN 'refunded'
    WHEN obs.cancel_observed THEN 'canceled_observed'
    WHEN obs.refund_observed THEN 'refund_observed'
    ELSE 'active'
  END AS order_status,
  CASE
    WHEN lower(COALESCE(fs.label_status, '')) IN ('cancelled', 'canceled') THEN 'cancelled'
    WHEN obs.cancel_observed THEN 'observed'
    ELSE NULL
  END AS cancel_status,
  o.refund_status,
  CASE
    WHEN obs.refund_observed AND COALESCE(o.refund_status, '') = '' THEN 'observed'
    WHEN o.refund_status IN ('full', 'partial') THEN o.refund_status
    ELSE NULL
  END AS refund_status_derived,
  obs.return_observation_status AS return_observation_status,
  COALESCE(fs.label_status, 'pending') AS fulfillment_status,
  obs.is_afn_observed,
  obs.marketplace_line_confidence
FROM public.orders_raw o
LEFT JOIN public.fulfillment_shipments fs
  ON fs.stripe_checkout_session_id = o.stripe_checkout_session_id
LEFT JOIN LATERAL (
  SELECT
    bool_or(m.observation_kind = 'refund') AS refund_observed,
    bool_or(m.observation_kind = 'cancellation') AS cancel_observed,
    max(m.return_status) FILTER (WHERE m.return_status IS NOT NULL) AS return_observation_status,
    bool_or(m.is_afn) AS is_afn_observed,
    max(m.line_allocation_confidence) FILTER (WHERE m.line_allocation_confidence IS NOT NULL) AS marketplace_line_confidence
  FROM public.marketplace_refund_observations m
  WHERE m.source_order_id = o.stripe_checkout_session_id
) obs ON true;

COMMENT ON VIEW public.v_order_marketplace_status IS
  'Phase 10P: derived order/cancel/refund/fulfillment status from orders + observations (guidance-only).';

GRANT SELECT ON public.v_order_marketplace_status TO authenticated, anon;

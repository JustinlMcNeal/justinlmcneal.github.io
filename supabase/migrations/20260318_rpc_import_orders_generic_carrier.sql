-- Migration: Make rpc_import_amazon_orders read carrier/service/tracking/notes
-- from the order JSON instead of hardcoding Amazon values.
-- This lets eBay (and future) imports set their own carrier info.

CREATE OR REPLACE FUNCTION public.rpc_import_amazon_orders(
  p_orders  jsonb,
  p_items   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders_count  int := 0;
  v_items_count   int := 0;
  v_ships_count   int := 0;
BEGIN
  -- 1) Upsert orders_raw
  INSERT INTO orders_raw (
    stripe_checkout_session_id,
    kk_order_id,
    order_date,
    total_items,
    subtotal_original_cents,
    subtotal_paid_cents,
    tax_cents,
    shipping_paid_cents,
    total_paid_cents,
    total_weight_g,
    order_savings_total_cents,
    order_savings_code_cents,
    order_savings_auto_cents,
    coupon_code_used,
    first_name,
    last_name,
    email,
    phone_number,
    street_address,
    city,
    state,
    zip,
    country,
    stripe_customer_id,
    order_cost_total_cents
  )
  SELECT
    o->>'stripe_checkout_session_id',
    o->>'kk_order_id',
    (o->>'order_date')::timestamptz,
    (o->>'total_items')::int,
    (o->>'subtotal_original_cents')::int,
    (o->>'subtotal_paid_cents')::int,
    (o->>'tax_cents')::int,
    (o->>'shipping_paid_cents')::int,
    (o->>'total_paid_cents')::int,
    (o->>'total_weight_g')::int,
    (o->>'order_savings_total_cents')::int,
    (o->>'order_savings_code_cents')::int,
    (o->>'order_savings_auto_cents')::int,
    NULLIF(o->>'coupon_code_used', ''),
    NULLIF(o->>'first_name', ''),
    NULLIF(o->>'last_name', ''),
    NULLIF(o->>'email', ''),
    NULLIF(o->>'phone_number', ''),
    NULLIF(o->>'street_address', ''),
    NULLIF(o->>'city', ''),
    NULLIF(o->>'state', ''),
    NULLIF(o->>'zip', ''),
    NULLIF(o->>'country', ''),
    NULLIF(o->>'stripe_customer_id', ''),
    (o->>'order_cost_total_cents')::int
  FROM jsonb_array_elements(p_orders) AS o
  ON CONFLICT (stripe_checkout_session_id) DO UPDATE SET
    total_paid_cents         = EXCLUDED.total_paid_cents,
    order_cost_total_cents   = EXCLUDED.order_cost_total_cents,
    updated_at               = now();

  GET DIAGNOSTICS v_orders_count = ROW_COUNT;

  -- 2) Upsert line_items_raw
  INSERT INTO line_items_raw (
    stripe_checkout_session_id,
    stripe_line_item_id,
    order_date,
    product_id,
    product_name,
    variant,
    quantity,
    unit_price_cents,
    post_discount_unit_price_cents,
    item_weight_g
  )
  SELECT
    i->>'stripe_checkout_session_id',
    i->>'stripe_line_item_id',
    (i->>'order_date')::timestamptz,
    i->>'product_id',
    i->>'product_name',
    NULLIF(i->>'variant', ''),
    (i->>'quantity')::int,
    (i->>'unit_price_cents')::int,
    (i->>'post_discount_unit_price_cents')::int,
    (i->>'item_weight_g')::int
  FROM jsonb_array_elements(p_items) AS i
  ON CONFLICT (stripe_checkout_session_id, stripe_line_item_id) DO UPDATE SET
    quantity                       = EXCLUDED.quantity,
    unit_price_cents               = EXCLUDED.unit_price_cents,
    post_discount_unit_price_cents = EXCLUDED.post_discount_unit_price_cents,
    updated_at                     = now();

  GET DIAGNOSTICS v_items_count = ROW_COUNT;

  -- 3) Upsert fulfillment_shipments
  --    Now reads carrier, service, tracking_number, notes from the JSON
  --    so it works for Amazon, eBay, or any future source.
  INSERT INTO fulfillment_shipments (
    stripe_checkout_session_id,
    kk_order_id,
    label_status,
    carrier,
    service,
    tracking_number,
    shipped_at,
    label_cost_cents,
    notes
  )
  SELECT
    o->>'stripe_checkout_session_id',
    o->>'kk_order_id',
    'shipped',
    COALESCE(NULLIF(o->>'carrier', ''),        'Unknown'),
    COALESCE(NULLIF(o->>'shipping_service', ''), 'Standard'),
    NULLIF(o->>'tracking_number', ''),
    COALESCE((o->>'shipped_at')::timestamptz, (o->>'order_date')::timestamptz),
    COALESCE((o->>'label_cost_cents')::int, 0),
    COALESCE(NULLIF(o->>'import_notes', ''),   'Imported order')
  FROM jsonb_array_elements(p_orders) AS o
  ON CONFLICT (stripe_checkout_session_id) DO UPDATE SET
    label_status     = EXCLUDED.label_status,
    carrier          = COALESCE(NULLIF(EXCLUDED.carrier, 'Unknown'), fulfillment_shipments.carrier),
    service          = COALESCE(NULLIF(EXCLUDED.service, 'Standard'), fulfillment_shipments.service),
    tracking_number  = COALESCE(EXCLUDED.tracking_number, fulfillment_shipments.tracking_number),
    shipped_at       = COALESCE(fulfillment_shipments.shipped_at, EXCLUDED.shipped_at),
    label_cost_cents = COALESCE(fulfillment_shipments.label_cost_cents, EXCLUDED.label_cost_cents),
    updated_at       = now();

  GET DIAGNOSTICS v_ships_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'orders_count', v_orders_count,
    'items_count',  v_items_count,
    'ships_count',  v_ships_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_import_amazon_orders(jsonb, jsonb) TO authenticated;

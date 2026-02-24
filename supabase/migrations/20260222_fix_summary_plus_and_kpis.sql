-- Fix: Recreate v_order_summary_plus (dropped by CASCADE) and remove stale rpc_order_kpis overload
-- The CASCADE from DROP VIEW v_order_financials took out v_order_summary_plus.
-- The old rpc_order_kpis(text,text,date,date) references the missing view and causes PGRST203 ambiguity.

-- 1) Recreate v_order_summary_plus = v_order_summary + v_order_financials
CREATE OR REPLACE VIEW v_order_summary_plus AS
SELECT
  s.*,
  f.product_cost_total_cents,
  f.label_cost_cents,
  f.label_status,
  f.profit_cents,
  f.refund_status,
  f.refund_reason,
  f.refund_amount_cents
FROM v_order_summary s
LEFT JOIN v_order_financials f USING (stripe_checkout_session_id);

-- 2) Grant access
GRANT SELECT ON v_order_summary_plus TO anon, authenticated;

-- 3) Drop the stale date-param overload that references v_order_summary_plus
--    and conflicts with the newer text-param version
DROP FUNCTION IF EXISTS public.rpc_order_kpis(text, text, date, date);

-- 4) Replace the text-param version so NULL is treated the same as ''
CREATE OR REPLACE FUNCTION public.rpc_order_kpis(
  p_q         text DEFAULT ''::text,
  p_status    text DEFAULT ''::text,
  p_date_from text DEFAULT ''::text,
  p_date_to   text DEFAULT ''::text
)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  result json;
  v_q         text := COALESCE(p_q, '');
  v_status    text := COALESCE(p_status, '');
  v_date_from text := COALESCE(p_date_from, '');
  v_date_to   text := COALESCE(p_date_to, '');
BEGIN
  WITH base AS (
    SELECT o.stripe_checkout_session_id,
           o.total_paid_cents,
           o.refund_status,
           o.refund_amount_cents,
           f.profit_cents,
           s.label_status
    FROM   orders_raw o
    LEFT JOIN v_order_financials f USING (stripe_checkout_session_id)
    LEFT JOIN fulfillment_shipments s USING (stripe_checkout_session_id)
    WHERE (v_q = '' OR (
              o.kk_order_id              ILIKE '%' || v_q || '%' OR
              o.email                    ILIKE '%' || v_q || '%' OR
              o.first_name               ILIKE '%' || v_q || '%' OR
              o.last_name                ILIKE '%' || v_q || '%' OR
              o.coupon_code_used         ILIKE '%' || v_q || '%' OR
              o.stripe_checkout_session_id ILIKE '%' || v_q || '%'
            ))
      AND (v_date_from = '' OR o.order_date >= v_date_from::timestamptz)
      AND (v_date_to   = '' OR o.order_date <= (v_date_to || 'T23:59:59Z')::timestamptz)
  )
  SELECT json_build_object(
    'order_count',     COUNT(*),
    'revenue_cents',   COALESCE(SUM(total_paid_cents - COALESCE(refund_amount_cents,0)), 0),
    'profit_cents',    COALESCE(SUM(profit_cents), 0),
    'unfulfilled',     COUNT(*) FILTER (WHERE COALESCE(label_status,'pending') = 'pending'),
    'refunded_count',  COUNT(*) FILTER (WHERE refund_status IS NOT NULL),
    'refunded_cents',  COALESCE(SUM(refund_amount_cents) FILTER (WHERE refund_status IS NOT NULL), 0)
  ) INTO result
  FROM base;

  RETURN result;
END;
$function$;

-- 5) Grant execute
GRANT EXECUTE ON FUNCTION public.rpc_order_kpis(text,text,text,text) TO anon, authenticated;

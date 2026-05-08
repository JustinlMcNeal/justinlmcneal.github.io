-- ================================================================
-- Phase 7: Universal Analytics Daily Aggregates
-- Grain model:
--   - channel_day: top-line KPI truth source (orders/revenue/units)
--   - product_day: product ranking and channel comparison rows
-- ================================================================

CREATE TABLE IF NOT EXISTS analytics_daily (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	metric_date date NOT NULL,
	channel text NOT NULL CHECK (channel IN ('website', 'ebay', 'amazon', 'other')),
	grain_type text NOT NULL CHECK (grain_type IN ('channel_day', 'product_day')),
	product_bucket text NOT NULL,
	product_code text,
	product_id uuid REFERENCES products(id) ON DELETE SET NULL,
	orders_count integer NOT NULL DEFAULT 0,
	units_sold integer NOT NULL DEFAULT 0,
	revenue_cents integer NOT NULL DEFAULT 0,
	abandoned_carts integer NOT NULL DEFAULT 0,
	recovered_carts integer NOT NULL DEFAULT 0,
	views integer NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CHECK (orders_count >= 0),
	CHECK (units_sold >= 0),
	CHECK (revenue_cents >= 0),
	CHECK (abandoned_carts >= 0),
	CHECK (recovered_carts >= 0),
	CHECK (views >= 0)
);

-- Normalized uniqueness for idempotent upserts
CREATE UNIQUE INDEX IF NOT EXISTS ux_analytics_daily_grain
	ON analytics_daily (metric_date, channel, grain_type, product_bucket);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_metric_date
	ON analytics_daily (metric_date);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_channel_date
	ON analytics_daily (channel, metric_date);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_product_code
	ON analytics_daily (product_code);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_product_id
	ON analytics_daily (product_id);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_grain_date_channel
	ON analytics_daily (grain_type, metric_date, channel);

-- Keep updated_at current on updates
CREATE OR REPLACE FUNCTION set_analytics_daily_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	NEW.updated_at := now();
	RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_analytics_daily_updated_at ON analytics_daily;
CREATE TRIGGER trg_set_analytics_daily_updated_at
	BEFORE UPDATE ON analytics_daily
	FOR EACH ROW
	EXECUTE FUNCTION set_analytics_daily_updated_at();

-- Derive channel from session id prefix
CREATE OR REPLACE FUNCTION analytics_channel_from_session(p_session_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
	SELECT CASE
		WHEN p_session_id LIKE 'ebay_api_%' OR p_session_id LIKE 'ebay_%' THEN 'ebay'
		WHEN p_session_id LIKE 'amazon_%' THEN 'amazon'
		WHEN p_session_id LIKE 'cs_%' THEN 'website'
		ELSE 'other'
	END;
$function$;

-- Refresh one day (idempotent)
CREATE OR REPLACE FUNCTION analytics_refresh_day(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
	v_channel_rows integer := 0;
	v_product_rows integer := 0;
	v_abandoned integer := 0;
	v_recovered integer := 0;
BEGIN
	-- 1) Channel-day rows (top-line KPI truth source)
	INSERT INTO analytics_daily (
		metric_date, channel, grain_type, product_bucket,
		orders_count, units_sold, revenue_cents,
		abandoned_carts, recovered_carts, views
	)
	WITH order_base AS (
		SELECT
			analytics_channel_from_session(o.stripe_checkout_session_id) AS channel,
			o.stripe_checkout_session_id,
			COALESCE(o.total_paid_cents, 0) AS total_paid_cents
		FROM orders_raw o
		WHERE (o.order_date AT TIME ZONE 'UTC')::date = p_day
	),
	unit_base AS (
		SELECT
			analytics_channel_from_session(li.stripe_checkout_session_id) AS channel,
			SUM(COALESCE(li.quantity, 0))::int AS units_sold
		FROM line_items_raw li
		WHERE (li.order_date AT TIME ZONE 'UTC')::date = p_day
		GROUP BY 1
	)
	SELECT
		p_day,
		ob.channel,
		'channel_day',
		'__channel__',
		COUNT(DISTINCT ob.stripe_checkout_session_id)::int,
		COALESCE(ub.units_sold, 0),
		SUM(ob.total_paid_cents)::int,
		0,
		0,
		0
	FROM order_base ob
	LEFT JOIN unit_base ub ON ub.channel = ob.channel
	GROUP BY ob.channel, ub.units_sold
	ON CONFLICT (metric_date, channel, grain_type, product_bucket)
	DO UPDATE SET
		orders_count = EXCLUDED.orders_count,
		units_sold = EXCLUDED.units_sold,
		revenue_cents = EXCLUDED.revenue_cents,
		abandoned_carts = EXCLUDED.abandoned_carts,
		recovered_carts = EXCLUDED.recovered_carts,
		views = EXCLUDED.views,
		updated_at = now();

	GET DIAGNOSTICS v_channel_rows = ROW_COUNT;

	-- 2) Website-only funnel counts for channel_day row
	SELECT COUNT(*)::int
	INTO v_abandoned
	FROM saved_carts s
	WHERE s.abandoned_at IS NOT NULL
		AND (s.abandoned_at AT TIME ZONE 'UTC')::date = p_day;

	SELECT COUNT(*)::int
	INTO v_recovered
	FROM saved_carts s
	WHERE s.purchased_at IS NOT NULL
		AND s.abandoned_at IS NOT NULL
		AND (s.purchased_at AT TIME ZONE 'UTC')::date = p_day;

	INSERT INTO analytics_daily (
		metric_date, channel, grain_type, product_bucket,
		orders_count, units_sold, revenue_cents,
		abandoned_carts, recovered_carts, views
	)
	VALUES (
		p_day, 'website', 'channel_day', '__channel__',
		0, 0, 0,
		COALESCE(v_abandoned, 0), COALESCE(v_recovered, 0), 0
	)
	ON CONFLICT (metric_date, channel, grain_type, product_bucket)
	DO UPDATE SET
		abandoned_carts = EXCLUDED.abandoned_carts,
		recovered_carts = EXCLUDED.recovered_carts,
		updated_at = now();

	-- 3) Product-day rows
	INSERT INTO analytics_daily (
		metric_date, channel, grain_type, product_bucket,
		product_code, product_id,
		orders_count, units_sold, revenue_cents,
		abandoned_carts, recovered_carts, views
	)
	SELECT
		p_day,
		analytics_channel_from_session(li.stripe_checkout_session_id) AS channel,
		'product_day' AS grain_type,
		COALESCE(p.id::text, '__unmatched__') AS product_bucket,
		COALESCE(NULLIF(li.product_id, ''), '__unmatched__') AS product_code,
		p.id AS product_id,
		COUNT(DISTINCT li.stripe_checkout_session_id)::int AS orders_count,
		SUM(COALESCE(li.quantity, 0))::int AS units_sold,
		SUM(COALESCE(li.post_discount_unit_price_cents, li.unit_price_cents, 0) * COALESCE(li.quantity, 0))::int AS revenue_cents,
		0,
		0,
		0
	FROM line_items_raw li
	LEFT JOIN products p ON p.code = li.product_id
	WHERE (li.order_date AT TIME ZONE 'UTC')::date = p_day
	GROUP BY 1,2,3,4,5,6
	ON CONFLICT (metric_date, channel, grain_type, product_bucket)
	DO UPDATE SET
		product_code = EXCLUDED.product_code,
		product_id = EXCLUDED.product_id,
		orders_count = EXCLUDED.orders_count,
		units_sold = EXCLUDED.units_sold,
		revenue_cents = EXCLUDED.revenue_cents,
		abandoned_carts = EXCLUDED.abandoned_carts,
		recovered_carts = EXCLUDED.recovered_carts,
		views = EXCLUDED.views,
		updated_at = now();

	GET DIAGNOSTICS v_product_rows = ROW_COUNT;

	RETURN jsonb_build_object(
		'metric_date', p_day,
		'channel_rows_upserted', v_channel_rows,
		'product_rows_upserted', v_product_rows,
		'website_abandoned_carts', COALESCE(v_abandoned, 0),
		'website_recovered_carts', COALESCE(v_recovered, 0)
	);
END;
$function$;

-- Backfill a date range (inclusive)
CREATE OR REPLACE FUNCTION analytics_backfill(
	p_start date DEFAULT NULL,
	p_end date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
	v_start date;
	v_end date;
	v_day date;
	v_count integer := 0;
BEGIN
	SELECT COALESCE(p_start, MIN((order_date AT TIME ZONE 'UTC')::date), CURRENT_DATE)
	INTO v_start
	FROM orders_raw;

	SELECT COALESCE(p_end, MAX((order_date AT TIME ZONE 'UTC')::date), CURRENT_DATE)
	INTO v_end
	FROM orders_raw;

	IF v_end < v_start THEN
		RETURN jsonb_build_object('days_processed', 0, 'start', v_start, 'end', v_end);
	END IF;

	v_day := v_start;
	WHILE v_day <= v_end LOOP
		PERFORM analytics_refresh_day(v_day);
		v_count := v_count + 1;
		v_day := v_day + 1;
	END LOOP;

	RETURN jsonb_build_object(
		'days_processed', v_count,
		'start', v_start,
		'end', v_end
	);
END;
$function$;

-- Permissions for admin client calls (through authenticated users)
GRANT SELECT ON analytics_daily TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_refresh_day(date) TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_backfill(date, date) TO authenticated;

-- Optional initial refresh for yesterday (safe to rerun)
SELECT analytics_refresh_day((now() AT TIME ZONE 'UTC')::date - 1);


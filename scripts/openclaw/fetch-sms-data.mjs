/**
 * scripts/openclaw/fetch-sms-data.mjs
 *
 * Fetches SMS aggregate data from Supabase for OpenClaw V1 report.
 *
 * Rules (V1):
 *   - Reads only the 6 approved aggregate views. No raw PII tables.
 *   - Uses anon key only. No service-role key.
 *   - Makes zero writes to any Supabase table.
 *   - Aborts if phone number pattern is detected in the payload.
 *
 * Approved views:
 *   sms_v_flow_performance_dated (date-bounded flow data, replaces sms_v_flow_performance for
 *     date-windowed queries), sms_v_coupon_cohorts, sms_v_abandoned_cart,
 *   sms_v_click_to_purchase, sms_v_subscriber_funnel, sms_v_fatigue_monitor
 */

import { createClient } from '@supabase/supabase-js';

// ─── Supabase client (anon key only) ──────────────────────────────────────────
// Both env vars are required. No hardcoded fallbacks — credentials belong in
// .env only, not in source code.

/**
 * Returns a Supabase client using the anon key from environment variables.
 * Throws early if required variables are missing so the error is clear.
 */
function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_ANON_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Add them to your .env file and run with: node --env-file=.env scripts/openclaw/run-sms-report.mjs'
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

// ─── ET date helpers ───────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Formats a Date as YYYY-MM-DD in America/New_York timezone.
 * Uses wall-clock time, not UTC midnight, so the result is always the correct
 * ET calendar date regardless of what time UTC midnight falls in ET.
 *
 * @param {Date} date
 * @returns {string} YYYY-MM-DD
 */
function toETDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// ─── Date windows ─────────────────────────────────────────────────────────────

/**
 * Returns yesterday and last-7-days UTC window boundaries (for metadata and
 * non-flow-performance filters), plus corrected ET date strings for
 * sms_v_flow_performance_dated.
 *
 * UTC ISO boundaries are preserved for sms_v_click_to_purchase (uses order_date
 * timestamp) and payload metadata.  ET date strings are derived by subtracting
 * elapsed wall-clock time so the ET calendar date is always correct — not by
 * converting a UTC midnight boundary.
 *
 * @returns {{
 *   yesterday: {start:string, end:string},
 *   last7days: {start:string, end:string},
 *   sentDateYesterday: string,
 *   sentDateLast7Start: string,
 *   sentDateToday: string
 * }}
 */
export function buildDateWindows() {
  const now = new Date();

  const yesterdayStart = new Date(now);
  yesterdayStart.setUTCDate(now.getUTCDate() - 1);
  yesterdayStart.setUTCHours(0, 0, 0, 0);

  const yesterdayEnd = new Date(yesterdayStart);
  yesterdayEnd.setUTCHours(23, 59, 59, 999);

  const last7Start = new Date(now);
  last7Start.setUTCDate(now.getUTCDate() - 7);
  last7Start.setUTCHours(0, 0, 0, 0);

  // ET business dates: subtract wall-clock elapsed time, then format in ET.
  // This correctly handles the 4–5 hour UTC-to-ET offset without an off-by-one.
  const sentDateYesterday   = toETDate(new Date(now - MS_PER_DAY));
  const sentDateLast7Start  = toETDate(new Date(now - 7 * MS_PER_DAY));
  const sentDateToday       = toETDate(now);

  return {
    yesterday: {
      start: yesterdayStart.toISOString(),
      end: yesterdayEnd.toISOString(),
    },
    last7days: {
      start: last7Start.toISOString(),
      end: now.toISOString(),
    },
    sentDateYesterday,
    sentDateLast7Start,
    sentDateToday,
  };
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Execute a Supabase query builder function with error handling.
 * Returns { rows, error } — never throws.
 *
 * @param {function} queryFn - receives a Supabase QueryBuilder, returns a promise
 * @returns {{ rows: object[], error: string|null }}
 */
async function safeQuery(queryFn) {
  try {
    const result = await queryFn();
    if (result.error) {
      return { rows: [], error: result.error.message };
    }
    return { rows: result.data ?? [], error: null };
  } catch (err) {
    return {
      rows: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Query a view with an optional date column filter.
 * If the date column does not exist on the view, falls back to a full select.
 *
 * @param {object} supabase
 * @param {string} viewName
 * @param {string|null} dateColumn - column to filter on, or null to skip
 * @param {string} start - ISO string
 * @param {string} end - ISO string
 * @returns {{ rows: object[], dateFiltered: boolean, warnings: string[] }}
 */
async function queryView(supabase, viewName, dateColumn, start, end) {
  const warnings = [];

  if (dateColumn) {
    const filtered = await safeQuery(() =>
      supabase
        .from(viewName)
        .select('*')
        .gte(dateColumn, start)
        .lte(dateColumn, end)
    );

    if (!filtered.error) {
      return { rows: filtered.rows, dateFiltered: true, warnings };
    }

    // Date column probably doesn't exist on view — fall back to full select
    warnings.push(
      `${viewName}: date filter on '${dateColumn}' failed (${filtered.error}); returning all-time data.`
    );
  }

  const full = await safeQuery(() => supabase.from(viewName).select('*'));

  if (full.error) {
    warnings.push(`${viewName}: query failed — ${full.error}`);
    return { rows: [], dateFiltered: false, warnings };
  }

  return { rows: full.rows, dateFiltered: false, warnings };
}

// ─── Main fetch function ───────────────────────────────────────────────────────

/**
 * Fetches all 6 approved aggregate views.
 *
 * Flow performance uses sms_v_flow_performance_dated filtered by sent_date.
 * sms_v_click_to_purchase is filtered by order_date where available.
 * All other views are read in full (they are lifetime aggregates).
 *
 * @param {{ yesterday: {start,end}, last7days: {start,end} }} windows
 * @returns {{ views: object, warnings: string[] }}
 */
export async function fetchSmsData({ yesterday, last7days, sentDateYesterday, sentDateLast7Start, sentDateToday }) {
  const supabase = getClient();
  const warnings = [];

  // ── sms_v_flow_performance_dated ──────────────────────────────────────────
  // Uses the companion dated view which exposes sent_date (DATE, Eastern TZ).
  // ET date strings are pre-computed by buildDateWindows() using wall-clock
  // subtraction — never derived from UTC midnight boundaries.

  const flowYesterdayResult = await queryView(
    supabase, 'sms_v_flow_performance_dated', 'sent_date', sentDateYesterday, sentDateYesterday
  );
  warnings.push(...flowYesterdayResult.warnings);

  const flowLast7Result = await queryView(
    supabase, 'sms_v_flow_performance_dated', 'sent_date', sentDateLast7Start, sentDateToday
  );
  warnings.push(...flowLast7Result.warnings);

  if (
    flowYesterdayResult.rows.length === 0 &&
    flowLast7Result.rows.length === 0
  ) {
    warnings.push('sms_v_flow_performance_dated: no sends found in selected date windows.');
  }

  // ── sms_v_coupon_cohorts ──────────────────────────────────────────────────
  // Lifetime cohort comparison — no date filtering expected.
  const cohortsResult = await queryView(supabase, 'sms_v_coupon_cohorts', null, null, null);
  warnings.push(...cohortsResult.warnings);
  if (cohortsResult.rows.length === 0) {
    warnings.push('sms_v_coupon_cohorts: returned zero rows. Coupon cohort data unavailable.');
  }

  // ── sms_v_abandoned_cart ──────────────────────────────────────────────────
  // Aggregate view — no date filtering expected.
  const cartResult = await queryView(supabase, 'sms_v_abandoned_cart', null, null, null);
  warnings.push(...cartResult.warnings);
  if (cartResult.rows.length === 0) {
    warnings.push('sms_v_abandoned_cart: returned zero rows. Abandoned cart data unavailable.');
  }

  // ── sms_v_click_to_purchase ───────────────────────────────────────────────
  // May contain per-order rows with order_date. Attempt date filter for last 7 days.
  const ctpResult = await queryView(
    supabase, 'sms_v_click_to_purchase', 'order_date', last7days.start, last7days.end
  );
  warnings.push(...ctpResult.warnings);
  if (!ctpResult.dateFiltered) {
    warnings.push(
      'sms_v_click_to_purchase: date filtering not applied; data reflects all available orders.'
    );
  }
  if (ctpResult.rows.length === 0) {
    warnings.push('sms_v_click_to_purchase: returned zero rows. Click-to-purchase data unavailable.');
  }
  // Note when click timing is null on all rows (Method 2 attribution not yet occurred)
  if (ctpResult.rows.length > 0 && ctpResult.rows.every(r => r.sms_click_at === null)) {
    warnings.push(
      'sms_v_click_to_purchase: all attributed orders used coupon-based attribution (Method 1). ' +
      'hours_click_to_purchase is null for all rows — click-window attribution (Method 2) ' +
      'has not yet occurred. This is expected; timing data will appear when a subscriber ' +
      'clicks an SMS link and completes checkout with a matching phone number within 48 hours.'
    );
  }

  // ── sms_v_subscriber_funnel ───────────────────────────────────────────────
  // Expected to return a single aggregate row.
  const funnelResult = await queryView(supabase, 'sms_v_subscriber_funnel', null, null, null);
  warnings.push(...funnelResult.warnings);
  if (funnelResult.rows.length === 0) {
    warnings.push('sms_v_subscriber_funnel: returned zero rows. Subscriber funnel data unavailable.');
  }

  // ── sms_v_fatigue_monitor ─────────────────────────────────────────────────
  // Expected to return a single aggregate row or bucketed rows.
  const fatigueResult = await queryView(supabase, 'sms_v_fatigue_monitor', null, null, null);
  warnings.push(...fatigueResult.warnings);
  if (fatigueResult.rows.length === 0) {
    warnings.push('sms_v_fatigue_monitor: returned zero rows. Fatigue data unavailable.');
  }

  return {
    views: {
      flowPerformanceYesterday: flowYesterdayResult.rows,
      flowPerformanceLast7: flowLast7Result.rows,
      flowDateFiltered: flowYesterdayResult.dateFiltered,
      couponCohorts: cohortsResult.rows,
      abandonedCart: cartResult.rows,
      clickToPurchase: ctpResult.rows,
      clickToPurchaseDateFiltered: ctpResult.dateFiltered,
      subscriberFunnel: funnelResult.rows,
      fatigueMonitor: fatigueResult.rows,
    },
    warnings,
  };
}

// ─── Click-to-purchase aggregator ─────────────────────────────────────────────

/**
 * Aggregates per-order click-to-purchase rows into summary stats.
 * If the view already returns aggregate rows (no hours_click_to_purchase column), returns as-is.
 *
 * @param {object[]} rows
 * @returns {object|null}
 */
function aggregateClickToPurchase(rows) {
  if (!rows || rows.length === 0) return null;

  // If first row has hours_click_to_purchase, treat as per-order rows and aggregate
  const hasHoursLag = 'hours_click_to_purchase' in rows[0];

  if (!hasHoursLag) {
    // View already returns aggregate — return first row (or all, if multiple)
    return rows.length === 1 ? rows[0] : rows;
  }

  const lags = rows
    .map((r) => (r.hours_click_to_purchase !== null && r.hours_click_to_purchase !== undefined ? Number(r.hours_click_to_purchase) : null))
    .filter((n) => n !== null && !isNaN(n));

  const total = rows.length;
  const avg = lags.length > 0 ? lags.reduce((s, v) => s + v, 0) / lags.length : null;

  // Median: sort a copy and pick the middle value
  let median = null;
  if (lags.length > 0) {
    const sorted = [...lags].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    median = sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
    median = Math.round(median * 10) / 10;
  }

  const within24 = lags.filter((h) => h <= 24).length;
  const within48 = lags.filter((h) => h <= 48).length;

  // Group by flow
  const byFlowMap = {};
  for (const row of rows) {
    const key = row.flow || 'unknown';
    if (!byFlowMap[key]) byFlowMap[key] = { flow: key, lags: [], order_count: 0 };
    byFlowMap[key].order_count++;
    if (row.hours_click_to_purchase !== null && row.hours_click_to_purchase !== undefined) {
      byFlowMap[key].lags.push(Number(row.hours_click_to_purchase));
    }
  }
  const byFlow = Object.values(byFlowMap).map(({ lags: fl, ...rest }) => ({
    ...rest,
    avg_hours: fl.length > 0 ? Math.round((fl.reduce((s, v) => s + v, 0) / fl.length) * 10) / 10 : null,
  }));

  // Group by attribution method
  const byMethodMap = {};
  for (const row of rows) {
    const key = row.attribution_method || 'unknown';
    if (!byMethodMap[key]) byMethodMap[key] = { method: key, order_count: 0 };
    byMethodMap[key].order_count++;
  }

  return {
    total_attributed_orders: total,
    avg_hours_to_purchase: avg !== null ? Math.round(avg * 10) / 10 : null,
    median_hours_to_purchase: median,
    within_24h_pct:
      lags.length > 0 ? Math.round((within24 / lags.length) * 1000) / 10 : null,
    within_48h_pct:
      lags.length > 0 ? Math.round((within48 / lags.length) * 1000) / 10 : null,
    by_flow: byFlow,
    by_attribution_method: Object.values(byMethodMap),
  };
}

// ─── Phone number safety check ─────────────────────────────────────────────────

/**
 * Aborts if a US E.164 phone number pattern is found in the JSON payload string.
 * This is a safety backstop for the case where a view unexpectedly returns raw contact data.
 *
 * @param {string} jsonString
 * @throws {Error} if phone pattern detected
 */
function assertNoPiiInPayload(jsonString) {
  const phonePattern = /\+1\d{10}/;
  if (phonePattern.test(jsonString)) {
    throw new Error(
      'ERROR: Phone number pattern detected in payload. Aborting. ' +
      'Do not send this data to OpenClaw. ' +
      'Check that the aggregate views do not expose raw phone columns.'
    );
  }
}

// ─── Payload normalizer ────────────────────────────────────────────────────────

/**
 * Builds the structured JSON payload for OpenClaw from raw view data.
 * Runs the phone number safety check before returning.
 *
 * Shape matches §10 of openclawSmsBuildV1.md.
 *
 * @param {{
 *   rawViews: object,
 *   reportDate: string,
 *   windows: { yesterday: object, last7days: object },
 *   warnings: string[]
 * }} params
 * @returns {object} PII-safe payload
 * @throws {Error} if phone number pattern detected
 */
export function normalizePayload({ rawViews, reportDate, windows, warnings }) {
  const {
    flowPerformanceYesterday,
    flowPerformanceLast7,
    flowDateFiltered,
    couponCohorts,
    abandonedCart,
    clickToPurchase,
    subscriberFunnel,
    fatigueMonitor,
  } = rawViews;

  // Single-row views: take first row if array
  const funnelRow = Array.isArray(subscriberFunnel)
    ? (subscriberFunnel[0] ?? null)
    : (subscriberFunnel ?? null);

  const fatigueRow = Array.isArray(fatigueMonitor)
    ? (fatigueMonitor[0] ?? null)
    : (fatigueMonitor ?? null);

  const cartRow = Array.isArray(abandonedCart)
    ? (abandonedCart[0] ?? null)
    : (abandonedCart ?? null);

  // If flow date filtering didn't work, we only have one bucket of all-time data.
  // Put the same data into both slots and let OpenClaw note the limitation.
  const flowYesterdayData = flowDateFiltered
    ? flowPerformanceYesterday
    : flowPerformanceLast7; // all-time fallback

  const flowLast7Data = flowPerformanceLast7;

  const payload = {
    report_date: reportDate,
    generated_at: new Date().toISOString(),
    yesterday_window: windows.yesterday,
    last_7_days_window: windows.last7days,
    flow_performance: {
      yesterday: flowYesterdayData,
      last_7_days: flowLast7Data,
      date_filtered: flowDateFiltered,
      note: flowDateFiltered
        ? 'Date-filtered by sent_date column (sms_v_flow_performance_dated).'
        : 'Date filtering unavailable. Both windows show all-time totals.',
    },
    coupon_cohorts: couponCohorts ?? [],
    abandoned_cart: cartRow,
    click_to_purchase: aggregateClickToPurchase(Array.isArray(clickToPurchase) ? clickToPurchase : []),
    subscriber_funnel: funnelRow,
    fatigue_monitor: fatigueRow,
    data_quality_warnings: warnings.filter(Boolean),
  };

  // Safety check — abort before any data reaches OpenClaw if phone found
  const jsonString = JSON.stringify(payload);
  assertNoPiiInPayload(jsonString);

  return payload;
}

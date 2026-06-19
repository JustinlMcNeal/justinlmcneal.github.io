// Growth tab — aggregation, PoP deltas, buckets, platform breakdown, coverage

import { buildBucketTimeline, computePeriodWindow, formatBucketLabel } from "./growthFilters.js";
import { findEarliestPostDate } from "./growthData.js";

/** @typedef {import("./growthData.js").GrowthPostRow} GrowthPostRow */
/** @typedef {import("./growthFilters.js").GrowthDateRange} GrowthDateRange */
/** @typedef {import("./growthState.js").GrowthPlatform} GrowthPlatform */
/** @typedef {import("./growthState.js").GrowthMetric} GrowthMetric */

const SUM_METRICS = ["likes", "comments", "saves", "impressions", "reach"];
const PLATFORMS = ["instagram", "facebook", "pinterest"];
const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {GrowthPostRow} row
 * @param {Date} start
 * @param {Date} end
 * @returns {boolean}
 */
function rowInRange(row, start, end) {
  if (!row.effectiveDate) return false;
  const t = row.effectiveDate.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * @param {GrowthPostRow[]} rows
 * @param {GrowthPlatform} platform
 * @returns {GrowthPostRow[]}
 */
function filterByPlatform(rows, platform) {
  if (platform === "all") return rows;
  return rows.filter((row) => row.platform === platform);
}

/**
 * @param {GrowthPostRow[]} rows
 * @returns {number}
 */
export function sumReach(rows) {
  return rows.reduce((acc, row) => acc + (row.reach || 0), 0);
}

/**
 * Reach-weighted engagement rate; simple mean fallback.
 * @param {GrowthPostRow[]} rows
 * @returns {number|null}
 */
export function computeWeightedEngagementRate(rows) {
  let weightedSum = 0;
  let reachTotal = 0;
  /** @type {number[]} */
  const simple = [];

  for (const row of rows) {
    if (row.engagement_rate == null || !Number.isFinite(row.engagement_rate)) continue;
    if (row.reach > 0) {
      weightedSum += row.engagement_rate * row.reach;
      reachTotal += row.reach;
    } else {
      simple.push(row.engagement_rate);
    }
  }

  if (reachTotal > 0) return weightedSum / reachTotal;
  if (simple.length > 0) return simple.reduce((a, b) => a + b, 0) / simple.length;
  return null;
}

/**
 * @param {number|null} current
 * @param {number|null} previous
 * @returns {{ text: string, tone: 'neutral'|'up'|'down'|'new' }}
 */
export function formatPeriodChange(current, previous) {
  const cur = current ?? 0;
  const prev = previous ?? 0;

  if (prev === 0 && cur === 0) return { text: "--", tone: "neutral" };
  if (prev === 0 && cur > 0) return { text: "New activity", tone: "new" };

  const pct = ((cur - prev) / prev) * 100;
  const sign = pct > 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    tone: pct > 0 ? "up" : pct < 0 ? "down" : "neutral",
  };
}

/**
 * @param {GrowthPostRow[]} rows
 * @param {string} metric
 * @returns {number|null}
 */
function metricTotal(rows, metric) {
  if (metric === "engagement_rate") return computeWeightedEngagementRate(rows);
  if (!SUM_METRICS.includes(metric)) return null;
  return rows.reduce((acc, row) => acc + (row[metric] || 0), 0);
}

/**
 * @param {GrowthPostRow[]} rows
 * @param {{ start: Date, end: Date }} bucket
 * @param {GrowthMetric} metric
 * @returns {number|null}
 */
function bucketMetricValue(rows, bucket, metric) {
  const inBucket = rows.filter((row) => rowInRange(row, bucket.start, bucket.end));
  if (metric === "engagement_rate") return computeWeightedEngagementRate(inBucket);
  if (!SUM_METRICS.includes(metric)) return null;
  return inBucket.reduce((acc, row) => acc + (row[metric] || 0), 0);
}

/**
 * @param {GrowthPostRow} row
 * @returns {boolean}
 */
function hasEngagementMetrics(row) {
  return (
    row.likes > 0 ||
    row.comments > 0 ||
    row.saves > 0 ||
    row.impressions > 0 ||
    row.reach > 0 ||
    (row.engagement_rate != null && row.engagement_rate > 0)
  );
}

/**
 * @param {GrowthPostRow[]} rows
 * @param {GrowthDateRange} dateRange
 * @param {GrowthPlatform} platform
 * @param {GrowthMetric} chartMetric
 * @param {Date} [now]
 */
export function computeGrowthAnalysis(rows, dateRange, platform, chartMetric, now = new Date()) {
  const firstPostDate = findEarliestPostDate(rows);
  const window = computePeriodWindow(dateRange, now, firstPostDate);

  const scopedRows = filterByPlatform(rows, platform);
  const currentRows = scopedRows.filter((row) =>
    rowInRange(row, window.currentStart, window.currentEnd)
  );
  const previousRows = scopedRows.filter((row) =>
    rowInRange(row, window.previousStart, window.previousEnd)
  );

  /** @type {Record<string, { current: number|null, previous: number|null, change: ReturnType<typeof formatPeriodChange> }>} */
  const cards = {};

  for (const metric of [...SUM_METRICS, "engagement_rate"]) {
    const current = metricTotal(currentRows, metric);
    const previous = metricTotal(previousRows, metric);
    cards[metric] = {
      current,
      previous,
      change: formatPeriodChange(current, previous),
    };
  }

  const breakdownMetric = chartMetric === "score" ? "likes" : chartMetric;

  const buckets = buildBucketTimeline(
    window.currentStart,
    window.currentEnd,
    window.bucketType
  ).map((bucket) => {
    const postsInBucket = scopedRows.filter((row) => rowInRange(row, bucket.start, bucket.end));
    const value =
      chartMetric === "score" ? null : bucketMetricValue(scopedRows, bucket, chartMetric);
    return {
      start: bucket.start,
      end: bucket.end,
      label: formatBucketLabel(bucket.start, window.bucketType),
      value: value ?? 0,
      postCount: postsInBucket.length,
    };
  });

  const allCurrentRows = rows.filter((row) =>
    rowInRange(row, window.currentStart, window.currentEnd)
  );
  const breakdownSourceRows = scopedRows.filter((row) =>
    rowInRange(row, window.currentStart, window.currentEnd)
  );

  const platformBreakdown = PLATFORMS.map((plat) => {
    const platRows = breakdownSourceRows.filter((row) => row.platform === plat);
    const total =
      breakdownMetric === "engagement_rate"
        ? computeWeightedEngagementRate(platRows)
        : metricTotal(platRows, breakdownMetric) ?? 0;
    const postCount = platRows.length;
    const withMetrics = platRows.filter(hasEngagementMetrics).length;
    const lastUpdated = platRows.reduce((latest, row) => {
      if (!row.engagement_updated_at) return latest;
      const d = new Date(row.engagement_updated_at);
      return !latest || d > latest ? d : latest;
    }, /** @type {Date|null} */ (null));

    const limited =
      postCount > 0 &&
      (withMetrics === 0 ||
        (lastUpdated != null && now.getTime() - lastUpdated.getTime() > STALE_DAYS * DAY_MS));

    return {
      platform: plat,
      total: total ?? 0,
      postCount,
      withMetrics,
      lastUpdated,
      limited,
    };
  });

  const coverage = buildCoverageSummary(allCurrentRows, now);

  return {
    window,
    cards,
    buckets,
    platformBreakdown,
    coverage,
    currentPostCount: currentRows.length,
    previousPostCount: previousRows.length,
    hasCurrentData: currentRows.length > 0,
  };
}

/**
 * @param {GrowthPostRow[]} rows
 * @param {Date} now
 */
function buildCoverageSummary(rows, now) {
  /** @type {Record<string, { posts: number, withMetrics: number, lastUpdated: Date|null }>} */
  const byPlatform = {};

  for (const plat of PLATFORMS) {
    byPlatform[plat] = { posts: 0, withMetrics: 0, lastUpdated: null };
  }

  for (const row of rows) {
    const slot = byPlatform[row.platform];
    if (!slot) continue;
    slot.posts += 1;
    if (hasEngagementMetrics(row)) slot.withMetrics += 1;
    if (row.engagement_updated_at) {
      const d = new Date(row.engagement_updated_at);
      if (!slot.lastUpdated || d > slot.lastUpdated) slot.lastUpdated = d;
    }
  }

  const warnings = [];
  for (const plat of ["facebook", "pinterest"]) {
    const slot = byPlatform[plat];
    if (slot.posts === 0) continue;
    const stale =
      !slot.lastUpdated || now.getTime() - slot.lastUpdated.getTime() > STALE_DAYS * DAY_MS;
    if (slot.withMetrics === 0 || stale) {
      const label = plat === "facebook" ? "Facebook" : "Pinterest";
      warnings.push(`${label}: limited engagement data — sync via Analytics when available.`);
    }
  }

  const lines = PLATFORMS.map((plat) => {
    const slot = byPlatform[plat];
    const name = plat.charAt(0).toUpperCase() + plat.slice(1);
    const sync =
      slot.lastUpdated != null
        ? `last insight update ${slot.lastUpdated.toLocaleDateString()}`
        : "no insight sync yet";
    return `${name}: ${slot.posts} posted · ${slot.withMetrics} with metrics · ${sync}`;
  });

  return { lines, warnings };
}

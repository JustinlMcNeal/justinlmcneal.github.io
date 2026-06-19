// Growth tab — aggregation, PoP, score, insights, buckets, coverage

import { buildBucketTimeline, computePeriodWindow, formatBucketLabel } from "./growthFilters.js";
import { findEarliestPostDate } from "./growthData.js";

/** @typedef {import("./growthData.js").GrowthPostRow} GrowthPostRow */
/** @typedef {import("./growthFilters.js").GrowthDateRange} GrowthDateRange */
/** @typedef {import("./growthState.js").GrowthPlatform} GrowthPlatform */
/** @typedef {import("./growthState.js").GrowthMetric} GrowthMetric */

const SUM_METRICS = ["likes", "comments", "saves", "impressions", "reach"];
const SCORE_METRICS = [
  { key: "reach", weight: 0.2, label: "Reach" },
  { key: "impressions", weight: 0.2, label: "Impressions" },
  { key: "engagement_rate", weight: 0.25, label: "Engagement Rate" },
  { key: "likes", weight: 0.15, label: "Likes" },
  { key: "comments", weight: 0.1, label: "Comments" },
  { key: "saves", weight: 0.1, label: "Saves" },
];
const METRIC_LABELS = {
  likes: "Likes",
  comments: "Comments",
  saves: "Saves",
  impressions: "Impressions",
  reach: "Reach",
  engagement_rate: "Engagement Rate",
};
const PLATFORMS = ["instagram", "facebook", "pinterest"];
const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 0.0001;

function rowInRange(row, start, end) {
  if (!row.effectiveDate) return false;
  const t = row.effectiveDate.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function filterByPlatform(rows, platform) {
  if (platform === "all") return rows;
  return rows.filter((row) => row.platform === platform);
}

export function computeWeightedEngagementRate(rows) {
  let weightedSum = 0;
  let reachTotal = 0;
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

export function formatPeriodChange(current, previous) {
  const cur = current ?? 0;
  const prev = previous ?? 0;
  if (prev === 0 && cur === 0) return { text: "--", tone: "neutral" };
  if (prev === 0 && cur > 0) return { text: "New activity", tone: "new" };
  const pct = ((cur - prev) / prev) * 100;
  const sign = pct > 0 ? "+" : "";
  return { text: `${sign}${pct.toFixed(1)}%`, tone: pct > 0 ? "up" : pct < 0 ? "down" : "neutral" };
}

function metricTotal(rows, metric) {
  if (metric === "engagement_rate") return computeWeightedEngagementRate(rows);
  if (!SUM_METRICS.includes(metric)) return null;
  return rows.reduce((acc, row) => acc + (row[metric] || 0), 0);
}

function buildMetricCards(currentRows, previousRows) {
  /** @type {Record<string, { current: number|null, previous: number|null, change: ReturnType<typeof formatPeriodChange> }>} */
  const cards = {};
  for (const metric of [...SUM_METRICS, "engagement_rate"]) {
    const current = metricTotal(currentRows, metric);
    const previous = metricTotal(previousRows, metric);
    cards[metric] = { current, previous, change: formatPeriodChange(current, previous) };
  }
  return cards;
}

function metricHasScoreData(current, previous, key) {
  if (key === "engagement_rate") {
    return (current != null && current > 0) || (previous != null && previous > 0);
  }
  const cur = current ?? 0;
  const prev = previous ?? 0;
  return cur !== 0 || prev !== 0;
}

function clampGrowthRate(current, previous) {
  const cur = current ?? 0;
  const prev = previous ?? 0;
  if (prev === 0 && cur === 0) return null;
  if (prev === 0 && cur > 0) return 1;
  if (cur === 0 && prev > 0) return -1;
  const rate = (cur - prev) / Math.max(prev, EPSILON);
  return Math.max(-1, Math.min(1, rate));
}

/**
 * @param {Record<string, { current: number|null, previous: number|null }>} cards
 */
export function computeGrowthScore(cards) {
  /** @type {{ key: string, label: string, weight: number, growthRate: number, normalized: number, contribution: number }[]} */
  const contributions = [];
  const excluded = [];
  let weightSum = 0;
  let weightedNorm = 0;

  for (const m of SCORE_METRICS) {
    const card = cards[m.key];
    const current = card?.current ?? null;
    const previous = card?.previous ?? null;

    if (!metricHasScoreData(current, previous, m.key)) {
      excluded.push({ key: m.key, label: m.label, reason: "missing both periods" });
      continue;
    }

    const growthRate = clampGrowthRate(current, previous);
    if (growthRate == null) {
      excluded.push({ key: m.key, label: m.label, reason: "no movement" });
      continue;
    }

    const normalized = (growthRate + 1) / 2;
    weightSum += m.weight;
    weightedNorm += normalized * m.weight;
    contributions.push({
      key: m.key,
      label: m.label,
      weight: m.weight,
      growthRate,
      normalized,
      contribution: normalized * m.weight,
    });
  }

  if (weightSum === 0 || contributions.length === 0) {
    return {
      score: null,
      previousScore: null,
      scoreDelta: null,
      sufficient: false,
      contributions,
      included: contributions.map((c) => c.key),
      excluded,
      weightSum: 0,
    };
  }

  const score = Math.round(100 * (weightedNorm / weightSum));
  return {
    score,
    previousScore: null,
    scoreDelta: null,
    sufficient: true,
    contributions,
    included: contributions.map((c) => c.key),
    excluded,
    weightSum,
  };
}

/**
 * @param {number|null} score
 */
export function getTrendBadge(score) {
  if (score == null || !Number.isFinite(score)) {
    return { label: "Waiting for data", className: "growth-badge--neutral", interpretation: "Not enough metric data to score this period." };
  }
  if (score >= 70) {
    return { label: "Growing", className: "growth-badge--up", interpretation: "Momentum is strong across included metrics." };
  }
  if (score >= 45) {
    return { label: "Stable / Mixed", className: "growth-badge--mid", interpretation: "Some metrics are up and others flat or down." };
  }
  return { label: "Declining", className: "growth-badge--down", interpretation: "Most included metrics are down vs the prior period." };
}

function getMomentumNote(score, previousScore) {
  if (score == null) return "Waiting for data";
  if (previousScore == null) return "Baseline forming for this date range";
  const delta = score - previousScore;
  if (delta >= 3) return "Momentum improving";
  if (delta <= -3) return "Momentum weakening";
  return "Momentum steady";
}

function bucketMetricValue(rows, bucket, metric) {
  const inBucket = rows.filter((row) => rowInRange(row, bucket.start, bucket.end));
  if (metric === "engagement_rate") return computeWeightedEngagementRate(inBucket);
  if (!SUM_METRICS.includes(metric)) return null;
  return inBucket.reduce((acc, row) => acc + (row[metric] || 0), 0);
}

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

function buildCoverageSummary(rows, now) {
  const byPlatform = {};
  for (const plat of PLATFORMS) byPlatform[plat] = { posts: 0, withMetrics: 0, lastUpdated: null };

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
    const stale = !slot.lastUpdated || now.getTime() - slot.lastUpdated.getTime() > STALE_DAYS * DAY_MS;
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

  return { lines, warnings, byPlatform };
}

/**
 * @param {object} analysis
 */
export function computeGrowthInsights(analysis) {
  const { cards, platformBreakdown, coverage, growthScore } = analysis;
  /** @type {string[]} */
  const items = [];

  const reachRows = platformBreakdown
    .filter((p) => p.postCount > 0)
    .sort((a, b) => (b.total || 0) - (a.total || 0));
  if (reachRows.length > 0) {
    const top = reachRows[0];
    const name = top.platform.charAt(0).toUpperCase() + top.platform.slice(1);
    items.push(`${name} is driving most reach this period.`);
  }

  if (growthScore?.sufficient && growthScore.contributions?.length) {
    const sorted = [...growthScore.contributions].sort((a, b) => b.contribution - a.contribution);
    items.push(`${sorted[0].label} is the strongest growth driver.`);
    const weakest = sorted[sorted.length - 1];
    if (weakest.growthRate < 0) {
      items.push(`${weakest.label} are lagging compared with the previous period.`);
    }
  } else {
    const changes = Object.entries(cards || {})
      .map(([key, card]) => ({ key, change: card.change }))
      .filter((x) => x.change.tone === "down");
    if (changes.length > 0) {
      items.push(`${METRIC_LABELS[changes[0].key] || changes[0].key} are lagging compared with the previous period.`);
    }
  }

  if (coverage.warnings.length > 0) {
    items.push("Facebook and Pinterest metrics may be incomplete.");
  }

  const igHeavy =
    coverage.byPlatform?.instagram?.withMetrics > 0 &&
    (coverage.byPlatform?.facebook?.withMetrics || 0) + (coverage.byPlatform?.pinterest?.withMetrics || 0) === 0;
  if (igHeavy && growthScore?.sufficient) {
    items.push("Score is based mostly on Instagram insights until other platforms sync.");
  }

  return items.slice(0, 4);
}

/**
 * @param {GrowthPostRow[]} scopedRows
 * @param {{ currentStart: Date, currentEnd: Date, bucketType: string }} window
 */
export function buildComparisonSeries(scopedRows, window) {
  const timeline = buildBucketTimeline(window.currentStart, window.currentEnd, window.bucketType);
  const metrics = [...SUM_METRICS, "engagement_rate"];

  return metrics.map((metric) => {
    const rawPoints = timeline.map((bucket) => ({
      label: formatBucketLabel(bucket.start, window.bucketType),
      raw: bucketMetricValue(scopedRows, bucket, metric) ?? 0,
    }));
    const max = Math.max(...rawPoints.map((p) => p.raw), metric === "engagement_rate" ? 0.01 : 1);
    return {
      metric,
      label: METRIC_LABELS[metric] || metric,
      points: rawPoints.map((p) => ({
        label: p.label,
        raw: p.raw,
        normalized: max > 0 ? (p.raw / max) * 100 : 0,
      })),
    };
  });
}

export function computeGrowthAnalysis(rows, dateRange, platform, chartMetric, now = new Date()) {
  const firstPostDate = findEarliestPostDate(rows);
  const window = computePeriodWindow(dateRange, now, firstPostDate);
  const scopedRows = filterByPlatform(rows, platform);
  const currentRows = scopedRows.filter((row) => rowInRange(row, window.currentStart, window.currentEnd));
  const previousRows = scopedRows.filter((row) => rowInRange(row, window.previousStart, window.previousEnd));

  const prevSpanMs = window.previousEnd.getTime() - window.previousStart.getTime();
  const beforePreviousEnd = new Date(window.previousStart.getTime() - 1);
  const beforePreviousStart = new Date(beforePreviousEnd.getTime() - prevSpanMs);
  const beforePreviousRows = scopedRows.filter((row) =>
    rowInRange(row, beforePreviousStart, beforePreviousEnd)
  );

  const cards = buildMetricCards(currentRows, previousRows);
  const previousPeriodCards = buildMetricCards(previousRows, beforePreviousRows);

  const growthScore = computeGrowthScore(cards);
  const previousGrowthScore = computeGrowthScore(previousPeriodCards);
  growthScore.previousScore = previousGrowthScore.score;
  growthScore.scoreDelta =
    growthScore.score != null && previousGrowthScore.score != null
      ? growthScore.score - previousGrowthScore.score
      : null;
  growthScore.momentum = getMomentumNote(growthScore.score, growthScore.previousScore);
  growthScore.trend = getTrendBadge(growthScore.score);
  growthScore.weights = SCORE_METRICS.map((m) => ({ label: m.label, weight: Math.round(m.weight * 100) }));

  const breakdownMetric = chartMetric === "score" ? "reach" : chartMetric;
  const timeline = buildBucketTimeline(window.currentStart, window.currentEnd, window.bucketType);

  let buckets;
  if (chartMetric === "score") {
    buckets = timeline.map((bucket, index) => {
      const currentBucketRows = scopedRows.filter((row) => rowInRange(row, bucket.start, bucket.end));
      const prevBucket = index > 0 ? timeline[index - 1] : null;
      const previousBucketRows = prevBucket
        ? scopedRows.filter((row) => rowInRange(row, prevBucket.start, prevBucket.end))
        : [];
      const miniScore = computeGrowthScore(buildMetricCards(currentBucketRows, previousBucketRows));
      return {
        start: bucket.start,
        end: bucket.end,
        label: formatBucketLabel(bucket.start, window.bucketType),
        value: miniScore.score ?? 50,
        postCount: currentBucketRows.length,
      };
    });
  } else {
    buckets = timeline.map((bucket) => {
      const postsInBucket = scopedRows.filter((row) => rowInRange(row, bucket.start, bucket.end));
      const value = bucketMetricValue(scopedRows, bucket, chartMetric);
      return {
        start: bucket.start,
        end: bucket.end,
        label: formatBucketLabel(bucket.start, window.bucketType),
        value: value ?? 0,
        postCount: postsInBucket.length,
      };
    });
  }

  const allCurrentRows = rows.filter((row) => rowInRange(row, window.currentStart, window.currentEnd));
  const breakdownSourceRows = scopedRows.filter((row) => rowInRange(row, window.currentStart, window.currentEnd));

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
    return { platform: plat, total: total ?? 0, postCount, withMetrics, lastUpdated, limited };
  });

  const coverage = buildCoverageSummary(allCurrentRows, now);
  const comparisonSeries = buildComparisonSeries(scopedRows, window);
  const insights = computeGrowthInsights({
    cards,
    platformBreakdown,
    coverage,
    growthScore,
  });

  return {
    window,
    cards,
    buckets,
    platformBreakdown,
    coverage,
    growthScore,
    insights,
    comparisonSeries,
    currentPostCount: currentRows.length,
    previousPostCount: previousRows.length,
    hasCurrentData: currentRows.length > 0,
  };
}

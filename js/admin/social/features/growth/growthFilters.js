// Growth tab — date/platform presets and period boundaries

/** @typedef {'7d'|'30d'|'90d'|'ytd'|'since_first'} GrowthDateRange */
/** @typedef {'daily'|'weekly'|'monthly'} GrowthBucketType */

const DAY_MS = 24 * 60 * 60 * 1000;

/** @type {GrowthDateRange[]} */
export const GROWTH_DATE_RANGES = ["7d", "30d", "90d", "ytd", "since_first"];

/**
 * @param {Date} date
 * @returns {Date}
 */
export function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * @param {Date} date
 * @returns {Date}
 */
export function endOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Same calendar day one year earlier (handles Feb 29 → Feb 28).
 * @param {Date} date
 * @returns {Date}
 */
export function priorYearSameCalendarDay(date) {
  const d = new Date(date);
  const target = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
  if (target.getMonth() !== d.getMonth()) {
    return endOfLocalDay(new Date(d.getFullYear() - 1, d.getMonth() + 1, 0));
  }
  return endOfLocalDay(target);
}

/**
 * Monday-start week containing `date` (local).
 * @param {Date} date
 * @returns {Date}
 */
export function startOfLocalWeek(date) {
  const d = startOfLocalDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * @param {GrowthDateRange} dateRange
 * @param {number} [spanDays]
 * @returns {GrowthBucketType}
 */
export function getBucketType(dateRange, spanDays = 0) {
  if (dateRange === "7d" || dateRange === "30d") return "daily";
  if (dateRange === "90d" || dateRange === "ytd") return "weekly";
  if (spanDays <= 60) return "daily";
  if (spanDays <= 365) return "weekly";
  return "monthly";
}

/**
 * @typedef {object} GrowthPeriodWindow
 * @property {Date} currentStart
 * @property {Date} currentEnd
 * @property {Date} previousStart
 * @property {Date} previousEnd
 * @property {GrowthBucketType} bucketType
 * @property {string} comparisonLabel
 */

/**
 * @param {GrowthDateRange} dateRange
 * @param {Date} [now]
 * @param {Date|null} [firstPostDate]
 * @returns {GrowthPeriodWindow}
 */
export function computePeriodWindow(dateRange, now = new Date(), firstPostDate = null) {
  const todayEnd = endOfLocalDay(now);

  if (dateRange === "7d") {
    const currentEnd = todayEnd;
    const currentStart = startOfLocalDay(new Date(now.getTime() - 6 * DAY_MS));
    const spanMs = currentEnd.getTime() - currentStart.getTime();
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - spanMs);
    return {
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      bucketType: "daily",
      comparisonLabel: "vs prior 7 days",
    };
  }

  if (dateRange === "30d") {
    const currentEnd = todayEnd;
    const currentStart = startOfLocalDay(new Date(now.getTime() - 29 * DAY_MS));
    const spanMs = currentEnd.getTime() - currentStart.getTime();
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - spanMs);
    return {
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      bucketType: "daily",
      comparisonLabel: "vs prior 30 days",
    };
  }

  if (dateRange === "90d") {
    const currentEnd = todayEnd;
    const currentStart = startOfLocalDay(new Date(now.getTime() - 89 * DAY_MS));
    const spanMs = currentEnd.getTime() - currentStart.getTime();
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - spanMs);
    return {
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      bucketType: "weekly",
      comparisonLabel: "vs prior 90 days",
    };
  }

  if (dateRange === "ytd") {
    const currentStart = startOfLocalDay(new Date(now.getFullYear(), 0, 1));
    const currentEnd = todayEnd;
    const previousStart = startOfLocalDay(new Date(now.getFullYear() - 1, 0, 1));
    const previousEnd = priorYearSameCalendarDay(now);
    return {
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      bucketType: "weekly",
      comparisonLabel: "vs prior-year YTD",
    };
  }

  const anchor = firstPostDate ? startOfLocalDay(firstPostDate) : startOfLocalDay(now);
  const currentStart = anchor;
  const currentEnd = todayEnd;
  const spanMs = Math.max(0, currentEnd.getTime() - currentStart.getTime());
  const previousEnd = new Date(currentStart.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - spanMs);
  const spanDays = Math.ceil(spanMs / DAY_MS) + 1;

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    bucketType: getBucketType("since_first", spanDays),
    comparisonLabel: "vs prior period",
  };
}

/**
 * @param {Date} currentStart
 * @param {Date} currentEnd
 * @param {GrowthBucketType} bucketType
 * @returns {{ start: Date, end: Date }[]}
 */
export function buildBucketTimeline(currentStart, currentEnd, bucketType) {
  /** @type {{ start: Date, end: Date }[]} */
  const buckets = [];

  if (bucketType === "daily") {
    let cursor = startOfLocalDay(currentStart);
    while (cursor.getTime() <= currentEnd.getTime()) {
      buckets.push({ start: new Date(cursor), end: endOfLocalDay(cursor) });
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
    return buckets;
  }

  if (bucketType === "weekly") {
    let cursor = startOfLocalWeek(currentStart);
    while (cursor.getTime() <= currentEnd.getTime()) {
      const weekStart = new Date(cursor);
      const weekEnd = endOfLocalDay(new Date(cursor.getTime() + 6 * DAY_MS));
      buckets.push({ start: weekStart, end: weekEnd });
      cursor = new Date(cursor.getTime() + 7 * DAY_MS);
    }
    return buckets;
  }

  let cursor = startOfLocalDay(new Date(currentStart.getFullYear(), currentStart.getMonth(), 1));
  while (cursor.getTime() <= currentEnd.getTime()) {
    const monthStart = new Date(cursor);
    const monthEnd = endOfLocalDay(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    buckets.push({ start: monthStart, end: monthEnd });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return buckets;
}

/**
 * @param {Date} date
 * @param {GrowthBucketType} bucketType
 * @returns {string}
 */
export function formatBucketLabel(date, bucketType) {
  if (bucketType === "monthly") {
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Earliest fetch boundary for Supabase query (covers previous period too).
 * @param {GrowthDateRange} dateRange
 * @param {Date} [now]
 * @param {Date|null} [firstPostDate]
 * @returns {Date}
 */
export function computeFetchStart(dateRange, now = new Date(), firstPostDate = null) {
  const window = computePeriodWindow(dateRange, now, firstPostDate);
  let fetchStart = window.previousStart;

  if (dateRange === "since_first" && firstPostDate) {
    fetchStart = window.previousStart;
  }

  return fetchStart;
}

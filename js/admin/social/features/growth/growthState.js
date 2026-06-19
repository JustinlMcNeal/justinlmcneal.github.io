// Growth tab — filter state (Phase 1 placeholders only)

/** @typedef {'7d'|'30d'|'90d'|'ytd'|'since_first'} GrowthDateRange */
/** @typedef {'all'|'instagram'|'facebook'|'pinterest'} GrowthPlatform */
/** @typedef {'score'|'likes'|'comments'|'saves'|'impressions'|'reach'|'engagement_rate'} GrowthMetric */

/** @type {{ dateRange: GrowthDateRange, platform: GrowthPlatform, metric: GrowthMetric, initialized: boolean }} */
const state = {
  dateRange: "30d",
  platform: "all",
  metric: "score",
  initialized: false,
};

export function getGrowthState() {
  return state;
}

export function setGrowthFilters(partial) {
  if (partial.dateRange !== undefined) state.dateRange = partial.dateRange;
  if (partial.platform !== undefined) state.platform = partial.platform;
  if (partial.metric !== undefined) state.metric = partial.metric;
}

export function markGrowthInitialized() {
  state.initialized = true;
}

export function isGrowthInitialized() {
  return state.initialized;
}

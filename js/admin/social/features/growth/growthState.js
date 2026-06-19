// Growth tab — filter state, cache, loading flags

/** @typedef {'7d'|'30d'|'90d'|'ytd'|'since_first'} GrowthDateRange */
/** @typedef {'all'|'instagram'|'facebook'|'pinterest'} GrowthPlatform */
/** @typedef {'score'|'likes'|'comments'|'saves'|'impressions'|'reach'|'engagement_rate'} GrowthMetric */

/** @typedef {import("./growthData.js").GrowthPostRow} GrowthPostRow */

/** @type {{
 *   dateRange: GrowthDateRange,
 *   platform: GrowthPlatform,
 *   metric: GrowthMetric,
 *   initialized: boolean,
 *   rows: GrowthPostRow[],
 *   lastLoadedAt: Date|null,
 *   loading: boolean,
 *   error: string|null,
 *   renderGeneration: number,
 *   dataLoaded: boolean,
 * }} */
const state = {
  dateRange: "30d",
  platform: "all",
  metric: "likes",
  initialized: false,
  rows: [],
  lastLoadedAt: null,
  loading: false,
  error: null,
  renderGeneration: 0,
  dataLoaded: false,
};

export function getGrowthState() {
  return state;
}

/**
 * @param {Partial<typeof state>} partial
 */
export function setGrowthFilters(partial) {
  if (partial.dateRange !== undefined) state.dateRange = partial.dateRange;
  if (partial.platform !== undefined) state.platform = partial.platform;
  if (partial.metric !== undefined) state.metric = partial.metric;
}

export function setGrowthRows(rows) {
  state.rows = rows;
  state.lastLoadedAt = new Date();
  state.dataLoaded = true;
}

export function setGrowthLoading(loading) {
  state.loading = loading;
}

export function setGrowthError(message) {
  state.error = message;
}

export function clearGrowthError() {
  state.error = null;
}

export function markGrowthInitialized() {
  state.initialized = true;
}

export function isGrowthInitialized() {
  return state.initialized;
}

export function bumpRenderGeneration() {
  state.renderGeneration += 1;
  return state.renderGeneration;
}

/**
 * @param {number} generation
 * @returns {boolean}
 */
export function isRenderStale(generation) {
  return generation !== state.renderGeneration;
}

export function invalidateGrowthCache() {
  state.rows = [];
  state.dataLoaded = false;
  state.lastLoadedAt = null;
}

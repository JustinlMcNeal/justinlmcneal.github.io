// Growth tab controller — Phase 2 data dashboard

import { switchTab } from "../../boot/tabRouter.js";
import { resolveGrowthElements } from "./growthContext.js";
import { fetchGrowthPosts } from "./growthData.js";
import { computeGrowthAnalysis } from "./growthMetrics.js";
import {
  bumpRenderGeneration,
  clearGrowthError,
  getGrowthState,
  invalidateGrowthCache,
  isGrowthInitialized,
  isRenderStale,
  markGrowthInitialized,
  setGrowthError,
  setGrowthFilters,
  setGrowthLoading,
  setGrowthRows,
} from "./growthState.js";
import {
  renderGrowthDashboard,
  renderGrowthError,
  renderGrowthLoading,
  syncGrowthFilterControls,
} from "./growthRender.js";

let debounceTimer = null;

function readFiltersFromDom() {
  const els = resolveGrowthElements();
  setGrowthFilters({
    dateRange: els.filterRange?.value || "30d",
    platform: els.filterPlatform?.value || "all",
    metric: els.filterMetric?.value || "likes",
  });
}

function renderFromCache() {
  const state = getGrowthState();
  if (!state.dataLoaded || state.error) return;

  const analysis = computeGrowthAnalysis(
    state.rows,
    state.dateRange,
    state.platform,
    state.metric
  );
  renderGrowthDashboard(analysis);
}

function scheduleRenderFromCache() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderFromCache, 150);
}

async function loadGrowthData(forceRefresh = false) {
  const state = getGrowthState();

  if (state.dataLoaded && !forceRefresh) {
    renderFromCache();
    return;
  }

  const generation = bumpRenderGeneration();

  if (forceRefresh) invalidateGrowthCache();

  clearGrowthError();
  setGrowthLoading(true);
  renderGrowthLoading();

  const { rows, error } = await fetchGrowthPosts();

  if (isRenderStale(generation)) return;

  setGrowthLoading(false);

  if (error) {
    setGrowthError(error);
    renderGrowthError(error);
    return;
  }

  setGrowthRows(rows);
  renderFromCache();
}

function setupGrowthListeners() {
  if (isGrowthInitialized()) return;

  const els = resolveGrowthElements();

  els.filterRange?.addEventListener("change", () => {
    readFiltersFromDom();
    scheduleRenderFromCache();
  });
  els.filterPlatform?.addEventListener("change", () => {
    readFiltersFromDom();
    scheduleRenderFromCache();
  });
  els.filterMetric?.addEventListener("change", () => {
    readFiltersFromDom();
    scheduleRenderFromCache();
  });

  els.btnRefresh?.addEventListener("click", () => {
    readFiltersFromDom();
    loadGrowthData(true);
  });

  els.btnGoAnalytics?.addEventListener("click", () => {
    switchTab("analytics");
  });

  els.btnRetry?.addEventListener("click", () => {
    loadGrowthData(true);
  });

  markGrowthInitialized();
}

/**
 * Lazy-load entry when Growth tab is activated.
 */
export function loadGrowth() {
  resolveGrowthElements();
  setupGrowthListeners();
  syncGrowthFilterControls();
  readFiltersFromDom();
  loadGrowthData(false);
}

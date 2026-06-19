// Growth tab controller — Phase 1 static shell

import { switchTab } from "../../boot/tabRouter.js";
import { resolveGrowthElements } from "./growthContext.js";
import {
  isGrowthInitialized,
  markGrowthInitialized,
  setGrowthFilters,
} from "./growthState.js";
import { renderGrowthPlaceholders, syncGrowthFilterControls } from "./growthRender.js";

function readFiltersFromDom() {
  const els = resolveGrowthElements();
  setGrowthFilters({
    dateRange: els.filterRange?.value || "30d",
    platform: els.filterPlatform?.value || "all",
    metric: els.filterMetric?.value || "score",
  });
}

function setupGrowthListeners() {
  if (isGrowthInitialized()) return;

  const els = resolveGrowthElements();

  els.filterRange?.addEventListener("change", () => {
    readFiltersFromDom();
    renderGrowthPlaceholders();
  });
  els.filterPlatform?.addEventListener("change", () => {
    readFiltersFromDom();
    renderGrowthPlaceholders();
  });
  els.filterMetric?.addEventListener("change", () => {
    readFiltersFromDom();
    renderGrowthPlaceholders();
  });

  els.btnRefresh?.addEventListener("click", () => {
    readFiltersFromDom();
    renderGrowthPlaceholders();
  });

  els.btnGoAnalytics?.addEventListener("click", () => {
    switchTab("analytics");
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
  renderGrowthPlaceholders();
}

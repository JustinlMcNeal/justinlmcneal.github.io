// Growth tab — static placeholder rendering (Phase 1)

import { getGrowthElements } from "./growthContext.js";
import { getGrowthState } from "./growthState.js";

const PLACEHOLDER = "--";
const CHANGE_PLACEHOLDER = "-- vs previous period";

function setText(el, text) {
  if (el) el.textContent = text;
}

function highlightMetricCard(metric) {
  document.querySelectorAll(".growth-metric-card").forEach((card) => {
    const key = card.getAttribute("data-metric");
    card.classList.toggle("growth-metric-card--active", key === metric);
  });
}

/**
 * Render Phase 1 placeholder UI (no data calculations).
 */
export function renderGrowthPlaceholders() {
  const els = getGrowthElements();
  const { metric } = getGrowthState();

  setText(els.scoreValue, PLACEHOLDER);
  setText(els.scoreBadge, "Waiting for data");

  setText(els.cardLikes, PLACEHOLDER);
  setText(els.cardLikesChange, CHANGE_PLACEHOLDER);
  setText(els.cardComments, PLACEHOLDER);
  setText(els.cardCommentsChange, CHANGE_PLACEHOLDER);
  setText(els.cardSaves, PLACEHOLDER);
  setText(els.cardSavesChange, CHANGE_PLACEHOLDER);
  setText(els.cardImpressions, PLACEHOLDER);
  setText(els.cardImpressionsChange, CHANGE_PLACEHOLDER);
  setText(els.cardReach, PLACEHOLDER);
  setText(els.cardReachChange, CHANGE_PLACEHOLDER);
  setText(els.cardEngRate, PLACEHOLDER);
  setText(els.cardEngRateChange, CHANGE_PLACEHOLDER);

  if (els.mainChart) {
    els.mainChart.className =
      "growth-chart-placeholder flex flex-col items-center justify-center text-center text-sm text-gray-400 min-h-[220px] border border-dashed border-gray-200 rounded-lg bg-gray-50 p-6";
    els.mainChart.textContent = "Phase 2 will render the selected metric over time.";
  }

  if (els.platformBarInstagram) els.platformBarInstagram.style.width = "40%";
  if (els.platformBarFacebook) els.platformBarFacebook.style.width = "15%";
  if (els.platformBarPinterest) els.platformBarPinterest.style.width = "10%";

  highlightMetricCard(metric === "score" ? null : metric);

  els.loadingState?.classList.add("hidden");
  els.emptyState?.classList.add("hidden");
  els.errorState?.classList.add("hidden");
}

/**
 * Sync filter controls from state (after programmatic updates).
 */
export function syncGrowthFilterControls() {
  const els = getGrowthElements();
  const { dateRange, platform, metric } = getGrowthState();

  if (els.filterRange) els.filterRange.value = dateRange;
  if (els.filterPlatform) els.filterPlatform.value = platform;
  if (els.filterMetric) els.filterMetric.value = metric;
}

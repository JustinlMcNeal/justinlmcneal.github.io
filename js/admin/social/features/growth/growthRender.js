// Growth tab — dashboard rendering (Phase 2)

import { formatCompactNumber, formatPercent } from "../../utils/formatters.js";
import { getGrowthElements } from "./growthContext.js";
import { getGrowthState } from "./growthState.js";
import {
  renderChartPlaceholder,
  renderGrowthLineChart,
  renderPlatformBreakdown,
} from "./growthCharts.js";

const CARD_MAP = {
  likes: { value: "cardLikes", change: "cardLikesChange" },
  comments: { value: "cardComments", change: "cardCommentsChange" },
  saves: { value: "cardSaves", change: "cardSavesChange" },
  impressions: { value: "cardImpressions", change: "cardImpressionsChange" },
  reach: { value: "cardReach", change: "cardReachChange" },
  engagement_rate: { value: "cardEngRate", change: "cardEngRateChange" },
};

const CHANGE_TONE_CLASS = {
  neutral: "text-gray-400",
  up: "text-emerald-600",
  down: "text-red-600",
  new: "text-emerald-600",
};

function setText(el, text) {
  if (el) el.textContent = text;
}

function setHtml(el, html) {
  if (el) el.innerHTML = html;
}

function formatMetricValue(metric, value) {
  if (value == null || !Number.isFinite(value)) return "--";
  if (metric === "engagement_rate") return formatPercent(value, 1);
  return formatCompactNumber(Math.round(value));
}

function highlightMetricCard(metric) {
  document.querySelectorAll(".growth-metric-card").forEach((card) => {
    const key = card.getAttribute("data-metric");
    card.classList.toggle("growth-metric-card--active", key === metric && metric !== "score");
  });
}

function setPanelVisibility(els, { loading, empty, error }) {
  els.loadingState?.classList.toggle("hidden", !loading);
  els.emptyState?.classList.toggle("hidden", !empty);
  els.errorState?.classList.toggle("hidden", !error);
}

/**
 * @param {string|null} message
 */
export function renderGrowthError(message) {
  const els = getGrowthElements();
  setPanelVisibility(els, { loading: false, empty: false, error: true });
  if (els.errorState && message) {
    const msgEl = els.errorState.querySelector("[data-growth-error-msg]");
    if (msgEl) msgEl.textContent = message;
  }
}

export function renderGrowthLoading() {
  const els = getGrowthElements();
  setPanelVisibility(els, { loading: true, empty: false, error: false });
}

/**
 * @param {ReturnType<import("./growthMetrics.js").computeGrowthAnalysis>} analysis
 */
export function renderGrowthDashboard(analysis) {
  const els = getGrowthElements();
  const { metric } = getGrowthState();

  setPanelVisibility(els, { loading: false, empty: !analysis.hasCurrentData, error: false });

  setText(els.scoreValue, "--");
  setText(els.scoreBadge, "Coming in Phase 3");
  setText(
    els.scoreHelper,
    "Overall Growth Score will combine reach, impressions, engagement rate, likes, comments, and saves in Phase 3."
  );

  const comparisonSuffix = analysis.window.comparisonLabel;

  for (const [key, refs] of Object.entries(CARD_MAP)) {
    const card = analysis.cards[key];
    setText(els[refs.value], formatMetricValue(key, card?.current ?? null));
    const changeEl = els[refs.change];
    if (changeEl) {
      const change = card?.change || { text: "--", tone: "neutral" };
      changeEl.textContent = `${change.text} ${comparisonSuffix}`;
      changeEl.className = `text-xs mt-1 ${CHANGE_TONE_CLASS[change.tone] || CHANGE_TONE_CLASS.neutral}`;
    }
  }

  highlightMetricCard(metric);

  const isRate = metric === "engagement_rate";
  if (els.mainChart) {
    if (metric === "score") {
      renderChartPlaceholder(
        els.mainChart,
        "Overall Growth Score chart arrives in Phase 3. Select a metric above to view trends."
      );
    } else if (!analysis.hasCurrentData) {
      renderChartPlaceholder(
        els.mainChart,
        "No posted data in this range — try widening the date range or sync Instagram insights on Analytics."
      );
    } else {
      els.mainChart.className = "growth-line-chart-wrap";
      setHtml(els.mainChart, renderGrowthLineChart(analysis.buckets, isRate));
    }
  }

  renderPlatformBreakdown(els.platformBreakdown, analysis.platformBreakdown, isRate);

  const detailsEl = els.coverageDetails;
  if (detailsEl) {
    const lines = analysis.coverage.lines.map((line) => `<li>${line}</li>`).join("");
    const warnings = analysis.coverage.warnings.length
      ? `<p class="text-amber-700 mt-2">${analysis.coverage.warnings.join(" ")}</p>`
      : "";
    detailsEl.innerHTML = `
      <p>Growth uses metrics from <strong>posted</strong> social posts (timeline: <code>posted_at</code>, with <code>scheduled_for</code> fallback when missing). Instagram metrics refresh from Analytics via Sync Insights.</p>
      <ul class="mt-2 space-y-1 text-xs">${lines}</ul>
      ${warnings}
    `;
  }
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

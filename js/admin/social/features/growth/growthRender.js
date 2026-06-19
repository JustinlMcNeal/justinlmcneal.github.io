// Growth tab — dashboard rendering (Phase 3)

import { formatCompactNumber, formatPercent } from "../../utils/formatters.js";
import { getGrowthElements } from "./growthContext.js";
import { getGrowthState } from "./growthState.js";
import {
  renderChartPlaceholder,
  renderComparisonChart,
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
  getGrowthElements().scoreCard?.classList.toggle("growth-score-card--active", metric === "score");
}

function setPanelVisibility(els, { loading, empty, error }) {
  els.loadingState?.classList.toggle("hidden", !loading);
  els.emptyState?.classList.toggle("hidden", !empty);
  els.errorState?.classList.toggle("hidden", !error);
}

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

function renderGrowthScore(els, analysis) {
  const { growthScore } = analysis;
  const trend = growthScore?.trend;

  if (!growthScore?.sufficient || growthScore.score == null) {
    setText(els.scoreValue, "--");
    setText(els.scoreBadge, "Waiting for data");
    els.scoreBadge?.classList.remove("growth-badge--up", "growth-badge--mid", "growth-badge--down");
    els.scoreBadge?.classList.add("growth-badge--neutral");
    setText(els.scoreHelper, "Not enough posted metric data in this period to calculate a score.");
    setText(els.scoreMomentum, "");
    if (els.scoreExplanation) els.scoreExplanation.innerHTML = "";
    return;
  }

  setText(els.scoreValue, String(growthScore.score));
  setText(els.scoreBadge, trend?.label || "—");
  els.scoreBadge?.classList.remove("growth-badge--up", "growth-badge--mid", "growth-badge--down", "growth-badge--neutral");
  els.scoreBadge?.classList.add(trend?.className || "growth-badge--neutral");

  const delta =
    growthScore.scoreDelta != null
      ? ` (${growthScore.scoreDelta > 0 ? "+" : ""}${growthScore.scoreDelta} vs prior score window)`
      : "";
  setText(els.scoreHelper, `${trend?.interpretation || ""}${delta}`);
  setText(els.scoreMomentum, growthScore.momentum || "");

  if (els.scoreExplanation) {
    const weights = (growthScore.weights || [])
      .map((w) => `<li>${w.label} ${w.weight}%</li>`)
      .join("");
    const included = (growthScore.included || [])
      .map((k) => k.replace("_", " "))
      .join(", ");
    const excluded = (growthScore.excluded || [])
      .map((e) => e.label)
      .join(", ");
    const igNote =
      analysis.coverage?.byPlatform?.instagram?.withMetrics > 0 &&
      !(analysis.coverage?.byPlatform?.facebook?.withMetrics) &&
      !(analysis.coverage?.byPlatform?.pinterest?.withMetrics)
        ? `<p class="text-amber-700 text-xs mt-2">Score may reflect Instagram-heavy coverage when other platforms lack insights.</p>`
        : "";

    els.scoreExplanation.innerHTML = `
      <p class="text-xs text-gray-600">Each metric compares this period to the previous period. Growth rates are clamped, normalized to 0–1, then weighted.</p>
      <ul class="text-xs text-gray-600 mt-2 list-disc list-inside">${weights}</ul>
      <p class="text-xs text-gray-500 mt-2"><strong>Included:</strong> ${included || "—"}</p>
      <p class="text-xs text-gray-500"><strong>Excluded:</strong> ${excluded || "none"}</p>
      ${igNote}
    `;
  }
}

function renderInsightsStrip(els, insights) {
  if (!els.insightsStrip) return;
  if (!insights?.length) {
    els.insightsStrip.classList.add("hidden");
    els.insightsStrip.innerHTML = "";
    return;
  }
  els.insightsStrip.classList.remove("hidden");
  els.insightsStrip.innerHTML = insights
    .map((text) => `<div class="growth-insight-item">${text}</div>`)
    .join("");
}

export function renderGrowthDashboard(analysis) {
  const els = getGrowthElements();
  const { metric, compareMetrics } = getGrowthState();

  setPanelVisibility(els, { loading: false, empty: !analysis.hasCurrentData, error: false });

  renderGrowthScore(els, analysis);

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
  const isScore = metric === "score";

  if (els.mainChart) {
    if (!analysis.hasCurrentData) {
      renderChartPlaceholder(
        els.mainChart,
        "No posted data in this range — try widening the date range or sync Instagram insights on Analytics."
      );
    } else if (compareMetrics) {
      els.mainChart.className = "growth-line-chart-wrap";
      setHtml(els.mainChart, renderComparisonChart(analysis.comparisonSeries));
    } else if (isScore && !analysis.growthScore?.sufficient) {
      renderChartPlaceholder(els.mainChart, "Growth Score needs metric data in this period.");
    } else {
      els.mainChart.className = "growth-line-chart-wrap";
      setHtml(els.mainChart, renderGrowthLineChart(analysis.buckets, isRate && !isScore));
    }
  }

  const breakdownIsRate = !isScore && isRate;
  renderPlatformBreakdown(els.platformBreakdown, analysis.platformBreakdown, breakdownIsRate);

  renderInsightsStrip(els, analysis.insights);

  const detailsEl = els.coverageDetails;
  if (detailsEl) {
    const lines = analysis.coverage.lines.map((line) => `<li>${line}</li>`).join("");
    const warnings = analysis.coverage.warnings.length
      ? `<p class="text-amber-700 mt-2">${analysis.coverage.warnings.join(" ")}</p>`
      : "";
    detailsEl.innerHTML = `
      <p>Growth uses metrics from <strong>posted</strong> social posts (timeline: <code>posted_at</code>, with <code>scheduled_for</code> fallback when missing).</p>
      <p class="text-xs text-gray-500 mt-1"><strong>Sync Insights is Instagram-only.</strong> Facebook and Pinterest may show 0 in Platform Breakdown until a future insights sync exists — not a Growth bug.</p>
      <ul class="mt-2 space-y-1 text-xs">${lines}</ul>
      ${warnings}
    `;
  }
}

export function syncGrowthFilterControls() {
  const els = getGrowthElements();
  const { dateRange, platform, metric, compareMetrics } = getGrowthState();

  if (els.filterRange) els.filterRange.value = dateRange;
  if (els.filterPlatform) els.filterPlatform.value = platform;
  if (els.filterMetric) els.filterMetric.value = metric;
  if (els.compareMetrics) els.compareMetrics.checked = compareMetrics;
}

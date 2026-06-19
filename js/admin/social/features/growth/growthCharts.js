// Growth tab — SVG line chart and platform breakdown bars (no Chart.js)

import { formatCompactNumber, formatPercent } from "../../utils/formatters.js";

/** @typedef {import("./growthMetrics.js").computeGrowthAnalysis} GrowthAnalysis */

const PLATFORM_META = {
  instagram: { label: "📸 Instagram", barClass: "from-pink-500 to-purple-500", solidClass: "bg-gradient-to-r from-pink-500 to-purple-500" },
  facebook: { label: "📘 Facebook", barClass: "bg-blue-500", solidClass: "bg-blue-500" },
  pinterest: { label: "📌 Pinterest", barClass: "bg-red-600", solidClass: "bg-red-600" },
};

/**
 * @param {number} value
 * @param {boolean} isRate
 * @returns {string}
 */
function formatChartValue(value, isRate) {
  if (isRate) return formatPercent(value, 1);
  return formatCompactNumber(Math.round(value));
}

/**
 * @param {{ label: string, value: number, postCount: number }[]} buckets
 * @param {boolean} isRate
 * @param {string} [emptyMessage]
 * @returns {string}
 */
export function renderGrowthLineChart(buckets, isRate, emptyMessage) {
  if (!buckets.length) {
    return `<div class="growth-chart-empty">${emptyMessage || "No data in this range."}</div>`;
  }

  const values = buckets.map((b) => (Number.isFinite(b.value) ? b.value : 0));
  const max = Math.max(...values, isRate ? 0.01 : 1);
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 36, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const points = values.map((value, i) => {
    const x = pad.left + (values.length <= 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
    const y = pad.top + innerH - (value / max) * innerH;
    return { x, y, value, bucket: buckets[i] };
  });

  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const yMaxLabel = formatChartValue(max, isRate);
  const yMidLabel = formatChartValue(max / 2, isRate);

  const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const xLabels = points
    .map((p, i) =>
      labelIndexes.has(i)
        ? `<text x="${p.x}" y="${height - 8}" text-anchor="middle" class="growth-chart-axis-label">${p.bucket.label}</text>`
        : ""
    )
    .join("");

  const dots = points
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" class="growth-chart-dot"><title>${p.bucket.label}: ${formatChartValue(p.value, isRate)} · ${p.bucket.postCount} post(s)</title></circle>`
    )
    .join("");

  return `
    <svg class="growth-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Growth trend chart">
      <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${width - pad.right}" y2="${pad.top + innerH}" class="growth-chart-axis" />
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + innerH}" class="growth-chart-axis" />
      <text x="${pad.left - 6}" y="${pad.top + 4}" text-anchor="end" class="growth-chart-axis-label">${yMaxLabel}</text>
      <text x="${pad.left - 6}" y="${pad.top + innerH / 2}" text-anchor="end" class="growth-chart-axis-label">${yMidLabel}</text>
      <text x="${pad.left - 6}" y="${pad.top + innerH}" text-anchor="end" class="growth-chart-axis-label">${isRate ? "0%" : "0"}</text>
      <polyline points="${polyline}" class="growth-chart-line" fill="none" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

/**
 * @param {HTMLElement|null} container
 * @param {ReturnType<import("./growthMetrics.js").computeGrowthAnalysis>["platformBreakdown"]} breakdown
 * @param {boolean} isRate
 */
export function renderPlatformBreakdown(container, breakdown, isRate) {
  if (!container) return;

  const maxTotal = Math.max(
    ...breakdown.map((row) => (Number.isFinite(row.total) ? row.total : 0)),
    isRate ? 0.01 : 1
  );

  container.innerHTML = breakdown
    .map((row) => {
      const meta = PLATFORM_META[row.platform] || { label: row.platform, solidClass: "bg-gray-400" };
      const widthPct = maxTotal > 0 ? (Math.max(0, row.total) / maxTotal) * 100 : 0;
      const display = isRate ? formatPercent(row.total, 1) : formatCompactNumber(Math.round(row.total));
      const limitedClass = row.limited ? " growth-platform-row--limited" : "";
      const barLimitedClass = row.limited ? " growth-platform-bar--limited" : "";

      return `
        <div class="growth-platform-row${limitedClass}">
          <div class="flex justify-between text-xs mb-1">
            <span>${meta.label}</span>
            <span class="text-gray-500">${display}</span>
          </div>
          <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full growth-platform-bar ${meta.solidClass}${barLimitedClass}" style="width: ${widthPct.toFixed(1)}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

/**
 * @param {HTMLElement|null} el
 * @param {string} message
 */
export function renderChartPlaceholder(el, message) {
  if (!el) return;
  el.className = "growth-chart-placeholder growth-chart-message";
  el.innerHTML = `<p>${message}</p>`;
}

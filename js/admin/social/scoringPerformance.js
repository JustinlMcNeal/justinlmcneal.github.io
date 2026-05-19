// /js/admin/social/scoringPerformance.js
// Read-only: engagement by auto-queue priority score quartile

import { isPostedSuccessStatus, POST_SUCCESS_STATUSES } from "./postStatus.js";
import { escapeHtml } from "./utils/html.js";
import {
  formatMetricNumber as fmtNum,
  formatPercent as fmtPct,
} from "./utils/formatters.js";

/** Minimum scored posts for a confident readout */
export const SCORING_PERF_MIN_SAMPLE = 20;

/** Below this, show only a short “not enough data” message */
export const SCORING_PERF_HARD_MIN = 3;

const QUARTILE_LABELS = {
  1: "Top 25%",
  2: "50–75%",
  3: "25–50%",
  4: "Bottom 25%",
  missing: "Missing score",
};

const QUARTILE_ORDER = [1, 2, 3, 4, "missing"];

/**
 * @param {unknown} meta
 * @returns {number | null}
 */
export function extractPriorityScore(meta) {
  if (!meta || typeof meta !== "object") return null;
  const m = meta;
  const raw = m.priority_score ?? m.score_breakdown?.subtotal;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Array<Record<string, unknown>>} posts
 * @returns {{ buckets: Record<string, object>, scoredCount: number, totalPosted: number, hasEngagement: boolean }}
 */
export function buildScoringQuartileReport(posts) {
  const posted = (posts || []).filter((p) => isPostedSuccessStatus(p.status));
  const scored = [];
  const missing = [];

  for (const p of posted) {
    const score = extractPriorityScore(p.selection_metadata);
    if (score == null) {
      missing.push(p);
    } else {
      scored.push({ ...p, _priorityScore: score });
    }
  }

  scored.sort((a, b) => b._priorityScore - a._priorityScore);

  const n = scored.length;
  scored.forEach((p, i) => {
    const q = n > 0 ? Math.min(4, Math.max(1, Math.ceil(((i + 1) / n) * 4))) : 1;
    p._quartile = q;
  });

  const buckets = {};
  for (const key of QUARTILE_ORDER) {
    buckets[key] = {
      label: QUARTILE_LABELS[key],
      count: 0,
      scores: [],
      engagement_rates: [],
      likes: [],
      comments: [],
      saves: [],
      reach: [],
      impressions: [],
    };
  }

  const addMetrics = (bucket, post, score) => {
    bucket.count += 1;
    bucket.scores.push(score);
    if (post.engagement_rate != null && Number.isFinite(Number(post.engagement_rate))) {
      bucket.engagement_rates.push(Number(post.engagement_rate));
    }
    if (post.likes != null) bucket.likes.push(Number(post.likes) || 0);
    if (post.comments != null) bucket.comments.push(Number(post.comments) || 0);
    if (post.saves != null) bucket.saves.push(Number(post.saves) || 0);
    if (post.reach != null) bucket.reach.push(Number(post.reach) || 0);
    if (post.impressions != null) bucket.impressions.push(Number(post.impressions) || 0);
  };

  for (const p of scored) {
    addMetrics(buckets[p._quartile], p, p._priorityScore);
  }
  for (const p of missing) {
    addMetrics(buckets.missing, p, null);
  }

  const hasEngagement = posted.some(
    (p) => p.engagement_rate != null && Number.isFinite(Number(p.engagement_rate))
  );

  const rows = QUARTILE_ORDER.map((key) => {
    const b = buckets[key];
    const avg = (arr) =>
      arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    return {
      key,
      label: b.label,
      count: b.count,
      avg_score: avg(b.scores),
      avg_engagement_rate: avg(b.engagement_rates),
      avg_likes: avg(b.likes),
      avg_comments: avg(b.comments),
      avg_saves: avg(b.saves),
      avg_reach: avg(b.reach),
      avg_impressions: avg(b.impressions),
      directional: b.count > 0 && b.count < 5,
    };
  });

  return {
    rows,
    scoredCount: n,
    totalPosted: posted.length,
    missingScoreCount: missing.length,
    hasEngagement,
  };
}

/**
 * @param {ReturnType<typeof buildScoringQuartileReport>} report
 */
export function renderScoringPerformanceReadout(report) {
  const alertEl = document.getElementById("scoringPerformanceAlert");
  const tableEl = document.getElementById("scoringPerformanceTable");
  if (!tableEl) return;

  const { rows, scoredCount, totalPosted, missingScoreCount, hasEngagement } = report;

  if (alertEl) {
    alertEl.classList.add("hidden");
    alertEl.innerHTML = "";
    if (scoredCount < SCORING_PERF_HARD_MIN) {
      alertEl.classList.remove("hidden");
      alertEl.innerHTML =
        `<strong>Not enough scored posts yet.</strong> Found ${scoredCount} posted row(s) with a priority score ` +
        `(${totalPosted} posted total, ${missingScoreCount} missing score). ` +
        `Aim for at least ${SCORING_PERF_MIN_SAMPLE} scored posts before trusting quartile trends.`;
    } else if (scoredCount < SCORING_PERF_MIN_SAMPLE) {
      alertEl.classList.remove("hidden");
      alertEl.innerHTML =
        `<strong>Directional only.</strong> ${scoredCount} scored posts (recommend ${SCORING_PERF_MIN_SAMPLE}+). ` +
        `Trends may shift as more auto-queue posts accumulate engagement.`;
    }
  }

  if (scoredCount < SCORING_PERF_HARD_MIN) {
    tableEl.innerHTML =
      `<p class="text-sm text-gray-500 text-center py-4">Post more auto-queue content with <code class="text-xs">selection_metadata</code> to compare quartiles.</p>`;
    return;
  }

  const primaryLabel = hasEngagement ? "Avg engagement" : "Avg likes";

  const bodyRows = rows
    .filter((r) => r.count > 0 || r.key === 1)
    .map((r) => {
      const primary = hasEngagement ? r.avg_engagement_rate : r.avg_likes;
      const primaryFmt = hasEngagement ? fmtPct(primary) : fmtNum(primary, 0);
      const note = r.directional ? ' <span class="text-amber-600">(n&lt;5)</span>' : "";
      const secondary = hasEngagement && r.avg_likes != null
        ? ` · ♥ ${fmtNum(r.avg_likes, 0)}`
        : !hasEngagement && r.avg_engagement_rate != null
          ? ` · ${fmtPct(r.avg_engagement_rate)} eng`
          : "";
      return `
        <tr class="border-t border-gray-100 ${r.key === "missing" ? "bg-gray-50" : ""}">
          <td class="py-2 pr-2 font-medium">${escapeHtml(r.label)}${note}</td>
          <td class="py-2 px-2 text-right">${r.count}</td>
          <td class="py-2 px-2 text-right">${fmtNum(r.avg_score)}</td>
          <td class="py-2 pl-2 text-right text-indigo-700 font-medium">${primaryFmt}${secondary}</td>
        </tr>
      `;
    })
    .join("");

  const footnote = !hasEngagement
    ? '<p class="text-xs text-gray-400 mt-2">No engagement_rate on posted rows — using likes as primary metric. Sync Instagram insights for richer data.</p>'
    : '<p class="text-xs text-gray-400 mt-2">Based on posted rows with selection_metadata priority scores (highest score = top quartile).</p>';

  tableEl.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-gray-500 text-left">
            <th class="pb-1">Quartile</th>
            <th class="pb-1 text-right">Posts</th>
            <th class="pb-1 text-right">Avg score</th>
            <th class="pb-1 text-right">${escapeHtml(primaryLabel)}</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    ${footnote}
  `;
}

export async function loadScoringPerformance(getClient) {
  const tableEl = document.getElementById("scoringPerformanceTable");
  if (!tableEl) return;

  tableEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-3">Loading scoring performance…</p>';

  try {
    const client = getClient();
    const { data, error } = await client
      .from("social_posts")
      .select(
        "id, platform, status, posted_at, likes, comments, saves, impressions, reach, engagement_rate, selection_metadata"
      )
      .in("status", POST_SUCCESS_STATUSES)
      .neq("status", "deleted")
      .order("posted_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    const report = buildScoringQuartileReport(data || []);
    renderScoringPerformanceReadout(report);
  } catch (err) {
    console.error("[scoring-performance] Failed to load:", err);
    tableEl.innerHTML =
      `<p class="text-sm text-red-600 text-center py-3">Could not load scoring performance.</p>`;
  }
}

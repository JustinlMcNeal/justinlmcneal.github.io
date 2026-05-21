// Account Learning Summary — data-backed only (Analytics Learning Engine)

import { getTopHashtags, getBestPostingTimes } from "../../postLearning.js";
import { isPostedSuccessStatus, POST_SUCCESS_STATUSES } from "../../postStatus.js";
import { escapeHtml } from "../../utils/html.js";
import { getAnalyticsContext } from "./analyticsContext.js";
import {
  SCORING_PERF_MIN_SAMPLE,
  buildScoringQuartileReport,
} from "./scoringPerformance.js";

export function computeTopEngagementSignal(posts) {
  const withReach = (posts || []).filter((p) => Number(p.reach) > 0);
  if (withReach.length < 3) return null;
  const rate = (key) =>
    withReach.reduce((s, p) => s + (Number(p[key]) || 0) / Number(p.reach), 0) / withReach.length;
  const ranked = [
    { name: "Shares", v: rate("shares") },
    { name: "Saves", v: rate("saves") },
    { name: "Comments", v: rate("comments") },
  ].sort((a, b) => b.v - a.v);
  const top = ranked[0];
  if (!top || top.v <= 0) return null;
  return `${top.name} (strongest per reach, ${withReach.length} posts)`;
}

function confidenceLabel(sampleCount, minData = 3, minConfident = 10) {
  const n = Number(sampleCount) || 0;
  if (n >= minConfident) return { text: "Data-driven", className: "text-emerald-700 bg-emerald-50" };
  if (n >= minData) return { text: "Directional", className: "text-amber-800 bg-amber-50" };
  return { text: "Needs more data", className: "text-gray-600 bg-gray-100" };
}

function formatHour(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function loadAccountLearningSummary() {
  const el = document.getElementById("accountLearningSummaryBody");
  if (!el) return;

  const client = getAnalyticsContext().getClient();

  try {
    const times = await getBestPostingTimes(client);
    const hashtags = await getTopHashtags(client, 5);

    let bestTimeLine = "Not enough data yet";
    let bestDayLine = "Not enough data yet";
    let timeBadge = confidenceLabel(0);

    if (times?.length) {
      const top = times[0];
      const topPosts = Number(top.total_posts) || 0;
      timeBadge = confidenceLabel(
        times.reduce((s, t) => s + (Number(t.total_posts) || 0), 0)
      );
      if (topPosts > 0) {
        bestTimeLine = `${formatHour(top.hour_of_day)} ET · ${parseFloat(top.avg_engagement_rate || 0).toFixed(1)}% avg · n=${topPosts} posts`;
      }

      const bestDay = times.reduce((best, t) => {
        const tRate = parseFloat(t.avg_engagement_rate) || 0;
        const bRate = best ? parseFloat(best.avg_engagement_rate) || 0 : 0;
        const tN = Number(t.total_posts) || 0;
        const bN = best ? Number(best.total_posts) || 0 : 0;
        if (!best || tRate > bRate || (tRate === bRate && tN > bN)) return t;
        return best;
      }, null);

      if (bestDay && Number(bestDay.total_posts) > 0) {
        bestDayLine = `${DAYS[bestDay.day_of_week] ?? "?"} · ${parseFloat(bestDay.avg_engagement_rate || 0).toFixed(1)}% avg · n=${bestDay.total_posts} posts`;
      }
    }

    let hashtagLine = "Not enough data yet";
    let hashtagBadge = confidenceLabel(0);
    if (hashtags?.length) {
      const h = hashtags[0];
      const uses = Number(h.times_used) || 0;
      hashtagBadge = confidenceLabel(uses, 2, 5);
      if (uses > 0) {
        hashtagLine = `#${h.hashtag} · ${parseFloat(h.avg_engagement_rate || 0).toFixed(1)}% avg · ${uses} use(s)`;
        if (uses < 2) {
          hashtagLine += " (Autopilot prefers tags with 2+ uses)";
        }
      }
    }

    const { data: posts } = await client
      .from("social_posts")
      .select(
        "engagement_updated_at, selection_metadata, status, engagement_rate, likes, comments, saves, shares, impressions, reach, posted_at, platform"
      )
      .in("status", POST_SUCCESS_STATUSES)
      .eq("platform", "instagram");

    let lastSyncLine = "Not synced yet";
    if (posts?.length) {
      const withEng = posts.filter((p) => p.engagement_updated_at);
      if (withEng.length) {
        const latest = withEng.reduce((a, b) =>
          new Date(a.engagement_updated_at) > new Date(b.engagement_updated_at) ? a : b
        );
        lastSyncLine = new Date(latest.engagement_updated_at).toLocaleString();
      }
    }

    const posted = (posts || []).filter((p) => isPostedSuccessStatus(p.status));
    const report = buildScoringQuartileReport(posted);
    let scoringLine = "Not enough data yet";
    const topRow = report.rows?.find((r) => r.key === 1);
    const bottomRow = report.rows?.find((r) => r.key === 4);
    if (report.scoredCount >= SCORING_PERF_MIN_SAMPLE && topRow?.count && bottomRow?.count) {
      if (report.hasEngagement && topRow.avg_engagement_rate != null && bottomRow.avg_engagement_rate != null) {
        scoringLine = `Top quartile avg ${Number(topRow.avg_engagement_rate).toFixed(2)}% vs bottom ${Number(bottomRow.avg_engagement_rate).toFixed(2)}% (${report.scoredCount} scored posts)`;
      } else if (!report.hasEngagement && topRow.avg_likes != null && bottomRow.avg_likes != null) {
        scoringLine = `Top quartile avg ${Math.round(topRow.avg_likes)} likes vs bottom ${Math.round(bottomRow.avg_likes)} (${report.scoredCount} scored posts)`;
      }
    } else if (report.scoredCount >= 3) {
      scoringLine = `Directional only (${report.scoredCount} scored posts; need ${SCORING_PERF_MIN_SAMPLE}+ for confident readout)`;
    }

    const topSignalLine = computeTopEngagementSignal(posted) || "Not enough data yet";

    const e = escapeHtml;
    const lastLearningEl = document.getElementById("accountLearningLastUpdate");
    if (lastLearningEl) {
      lastLearningEl.textContent = `Metrics sync: ${lastSyncLine}. Rebuild tables with Update Learnings after posting.`;
    }

    el.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-4">
        <div class="rounded-lg border border-gray-100 p-3">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-xs font-bold text-gray-500 uppercase">Best posting time (engagement)</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${timeBadge.className}">${e(timeBadge.text)}</span>
          </div>
          <p class="text-sm font-medium text-gray-900">${e(bestTimeLine)}</p>
        </div>
        <div class="rounded-lg border border-gray-100 p-3">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-xs font-bold text-gray-500 uppercase">Strongest hashtag</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${hashtagBadge.className}">${e(hashtagBadge.text)}</span>
          </div>
          <p class="text-sm font-medium text-gray-900">${e(hashtagLine)}</p>
        </div>
        <div class="rounded-lg border border-gray-100 p-3">
          <span class="text-xs font-bold text-gray-500 uppercase">Best day (engagement)</span>
          <p class="text-sm font-medium text-gray-900 mt-1">${e(bestDayLine)}</p>
        </div>
        <div class="rounded-lg border border-gray-100 p-3">
          <span class="text-xs font-bold text-gray-500 uppercase">Top ranking signal</span>
          <p class="text-sm font-medium text-gray-900 mt-1">${e(topSignalLine)}</p>
        </div>
        <div class="rounded-lg border border-gray-100 p-3 sm:col-span-2">
          <span class="text-xs font-bold text-gray-500 uppercase">Scoring performance</span>
          <p class="text-sm font-medium text-gray-900 mt-1">${e(scoringLine)}</p>
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-3">Autopilot uses learned hashtag and posting-time tables when enough samples exist. This summary never replaces Sync Insights for live metrics.</p>
    `;
  } catch (err) {
    console.error("[analytics] Account learning summary failed:", err);
    el.innerHTML = `<p class="text-sm text-gray-500">Could not load account summary. Try Refresh on this tab.</p>`;
  }
}

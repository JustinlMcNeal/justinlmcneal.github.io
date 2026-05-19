// Learning insights dashboard

import {
  updateHashtagPerformance,
  updateTimingPerformance,
  updateCaptionPerformance,
  generateRecommendations,
  getTopHashtags,
  getBestPostingTimes,
  getActiveRecommendations,
  getLearnedPatterns,
  checkAndResearchCategories,
} from "../../postLearning.js";
import { isPostedSuccessStatus, POST_SUCCESS_STATUSES } from "../../postStatus.js";
import { getAnalyticsContext } from "./analyticsContext.js";
import { loadCategoryInsightsUI } from "./categoryInsights.js";

export async function loadLearningInsights() {
  const client = getAnalyticsContext().getClient();
  
  try {
    const times = await getBestPostingTimes(client);
    const bestTimeEl = document.getElementById("learningBestTime");
    const bestDayEl = document.getElementById("learningBestDay");
    
    if (times && times.length > 0) {
      const bestTime = times[0];
      if (bestTimeEl) bestTimeEl.textContent = formatHour(bestTime.hour_of_day);
      
      const bestDay = times.reduce((best, t) => {
        const tRate = parseFloat(t.avg_engagement_rate) || 0;
        const bRate = best ? (parseFloat(best.avg_engagement_rate) || 0) : 0;
        if (!best || tRate > bRate) return t;
        return best;
      }, null);
      if (bestDayEl && bestDay) {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        bestDayEl.textContent = days[bestDay.day_of_week] || "Any";
      }
    }
    
    await loadTimingHeatmap(client);
    
    const hashtags = await getTopHashtags(client, 10);
    const hashtagsEl = document.getElementById("learningTopHashtags");
    if (hashtagsEl && hashtags && hashtags.length > 0) {
      hashtagsEl.innerHTML = hashtags.map((h, i) => {
        const engRate = parseFloat(h.avg_engagement_rate) || 0;
        const timesUsed = h.times_used || 0;
        return `
        <div class="flex items-center justify-between py-2 ${i < hashtags.length - 1 ? 'border-b' : ''}">
          <div class="flex items-center gap-2"><span class="text-sm font-medium text-gray-700">#${h.hashtag}</span></div>
          <div class="flex items-center gap-3 text-xs">
            <span class="text-gray-500">${timesUsed} uses</span>
            <span class="${engRate >= 3 ? 'text-green-600' : engRate >= 1 ? 'text-blue-600' : 'text-gray-500'} font-bold">${engRate.toFixed(1)}% eng</span>
          </div>
        </div>`;
      }).join("");
    } else if (hashtagsEl) {
      hashtagsEl.innerHTML = `<div class="text-sm text-gray-500 py-4 text-center"><p>No hashtag data yet</p><p class="text-xs">Post more to see which hashtags perform best</p></div>`;
    }
    
    const recs = await getActiveRecommendations(client);
    const recsEl = document.getElementById("learningRecommendations");
    if (recsEl && recs && recs.length > 0) {
      recsEl.innerHTML = recs.map(r => {
        const confidence = parseFloat(r.confidence) || 0;
        return `
        <div class="flex items-start gap-3 p-3 bg-gradient-to-r ${getPriorityColors(r.priority)} rounded-lg">
          <span class="text-lg">${getCategoryIcon(r.category)}</span>
          <div class="flex-1">
            <div class="text-sm font-medium">${r.title || r.description}</div>
            <div class="text-xs opacity-70 mt-1">Confidence: ${Math.round(confidence * 100)}%</div>
          </div>
        </div>`;
      }).join("");
    } else if (recsEl) {
      recsEl.innerHTML = `<div class="text-center py-6 text-gray-500"><p class="text-sm">No recommendations yet</p><p class="text-xs mt-1">Post more content to receive personalized suggestions</p></div>`;
    }
    
    const patterns = await getLearnedPatterns(client);
    const hashtagCountEl = document.getElementById("learningHashtagCount");
    if (hashtagCountEl && patterns) {
      const hashtagPattern = patterns.find(p => p.pattern_type === "hashtag_count");
      if (hashtagPattern) hashtagCountEl.textContent = `${hashtagPattern.optimal_value}-${Math.min(parseInt(hashtagPattern.optimal_value) + 2, 5)}`;
    }
  } catch (err) {
    console.error("Error loading learning insights:", err);
  }
}

async function loadTimingHeatmap(client) {
  const tbody = document.getElementById("learningTimesBody");
  if (!tbody) return;
  
  try {
    const times = await getBestPostingTimes(client);
    const heatmap = {};
    for (let d = 0; d < 7; d++) heatmap[d] = {};
    if (times) times.forEach(t => { heatmap[t.day_of_week] = heatmap[t.day_of_week] || {}; heatmap[t.day_of_week][t.hour_of_day] = parseFloat(t.avg_engagement_rate) || 0; });
    
    let maxEng = 0;
    Object.values(heatmap).forEach(hours => Object.values(hours).forEach(eng => { if (eng > maxEng) maxEng = eng; }));
    
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hours = [6, 9, 12, 15, 18, 21];
    
    tbody.innerHTML = days.map((day, dayIdx) => {
      const cells = hours.map(hour => {
        const eng = heatmap[dayIdx]?.[hour] || 0;
        const intensity = maxEng > 0 ? eng / maxEng : 0;
        return `<td class="p-2 text-center text-xs ${getHeatmapColor(intensity)}">${eng > 0 ? eng.toFixed(1) + '%' : '-'}</td>`;
      }).join("");
      return `<tr><td class="p-2 text-xs font-medium text-gray-600">${day}</td>${cells}</tr>`;
    }).join("");
  } catch (err) {
    console.error("Error loading timing heatmap:", err);
  }
}

function getHeatmapColor(intensity) {
  if (intensity >= 0.8) return "bg-emerald-500 text-white";
  if (intensity >= 0.6) return "bg-emerald-400 text-white";
  if (intensity >= 0.4) return "bg-emerald-300";
  if (intensity >= 0.2) return "bg-emerald-200";
  if (intensity > 0) return "bg-emerald-100";
  return "bg-gray-50";
}

function formatHour(hour) {
  if (hour === 0) return "12 AM"; if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`; return `${hour - 12} PM`;
}

function getPriorityColors(priority) {
  switch (priority) {
    case "high": return "from-red-50 to-pink-50 text-red-700";
    case "medium": return "from-yellow-50 to-orange-50 text-yellow-700";
    default: return "from-blue-50 to-indigo-50 text-blue-700";
  }
}

function getCategoryIcon(category) {
  switch (category) {
    case "hashtags": return "#️⃣"; case "timing": return "⏰"; case "caption": return "✍️";
    case "content": return "📸"; case "engagement": return "💬"; default: return "💡";
  }
}

export async function processAllPostsForLearning() {
  const client = getAnalyticsContext().getClient();
  
  try {
    const { data: posts, error } = await client
      .from("social_posts")
      .select("*")
      .in("status", POST_SUCCESS_STATUSES)
      .order("posted_at", { ascending: false })
      .limit(100);
    
    if (error) throw error;
    
    let processed = 0;
    for (const post of posts) {
      try {
        if (post.caption) await updateCaptionPerformance(post.caption, post.engagement_rate || 0, post.reach || 0, client);
        processed++;
      } catch (err) { console.warn(`Error processing post ${post.id}:`, err); }
    }
    
    await updateHashtagPerformance();
    await updateTimingPerformance();
    await generateRecommendations(client);
    
    console.log(`Processed ${processed} posts for learning`);
    return processed;
  } catch (err) {
    console.error("Error processing posts for learning:", err);
    throw err;
  }
}
export function initLearningInsights() {
  const analyticsTab = document.querySelector('[data-tab="analytics"]');
  if (analyticsTab) {
    analyticsTab.addEventListener("click", () => {
      setTimeout(() => { loadLearningInsights(); loadCategoryInsightsUI(); }, 100);
    });
  }
  
  const refreshBtn = document.getElementById("btnRefreshLearnings");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Processing...`;
      try {
        await processAllPostsForLearning();
        await loadLearningInsights();
        await loadCategoryInsightsUI();
      } catch (err) { console.error("Failed to refresh learnings:", err); }
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh Learnings`;
    });
  }
  
  const researchBtn = document.getElementById("btnResearchCategories");
  if (researchBtn) {
    const progressHandler = (e) => {
      const { current, total, category } = e.detail;
      researchBtn.innerHTML = `<span class="animate-pulse">🧠</span> Researching ${category}... (${current}/${total})`;
    };
    
    researchBtn.addEventListener("click", async () => {
      researchBtn.classList.add("loading");
      researchBtn.disabled = true;
      researchBtn.innerHTML = `<span class="animate-spin inline-block">⏳</span> Scanning categories...`;
      window.addEventListener("categoryResearchProgress", progressHandler);
      
      try {
        const researched = await checkAndResearchCategories();
        if (researched.length > 0) getAnalyticsContext().showToast(`🧠 AI researched ${researched.length} categories!`, "success");
        else getAnalyticsContext().showToast("No new categories to research (need 3+ posts per category)", "info");
        await loadCategoryInsightsUI();
      } catch (err) {
        console.error("Category research failed:", err);
        getAnalyticsContext().showToast("Research failed. Check console for details.", "error");
      }
      
      window.removeEventListener("categoryResearchProgress", progressHandler);
      researchBtn.classList.remove("loading");
      researchBtn.disabled = false;
      researchBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Research Categories`;
    });
  }
  
  const analyticsContent = document.getElementById("content-analytics");
  if (analyticsContent && !analyticsContent.classList.contains("hidden")) {
    loadLearningInsights();
    loadCategoryInsightsUI();
  }
}
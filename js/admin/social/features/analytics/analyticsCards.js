// Engagement metrics cards, top posts, grid, hashtags

import { getPublicUrl } from "../../api.js";
import { isPostedSuccessStatus, POST_SUCCESS_STATUSES } from "../../postStatus.js";
import { getAnalyticsContext } from "./analyticsContext.js";
import { setText } from "../../utils/dom.js";
import { formatCompactNumber } from "../../utils/formatters.js";

export async function loadEngagementMetrics() {
  try {
    const client = getAnalyticsContext().getClient();
    
    const { data: posts, error } = await client
      .from("social_posts")
      .select("id, likes, comments, saves, impressions, reach, engagement_rate, engagement_updated_at, caption, hashtags, posted_at, status, image_url, permalink")
      .eq("platform", "instagram")
      .in("status", POST_SUCCESS_STATUSES)
      .neq("status", "deleted")
      .not("engagement_updated_at", "is", null)
      .order("engagement_rate", { ascending: false });
    
    if (error) throw error;
    
    const allPosts = (posts || []).filter(p => {
      if (!isPostedSuccessStatus(p.status)) return false;
      if (p.image_url && !p.image_url.startsWith("http")) {
        p.image_url = getPublicUrl(p.image_url);
      }
      return true;
    });
    
    if (allPosts.length === 0) {
      setText("analyticsLikes", "0"); setText("analyticsComments", "0"); setText("analyticsSaves", "0");
      setText("analyticsImpressions", "0"); setText("analyticsReach", "0"); setText("analyticsEngagementRate", "0%");
      const topPostsContainer = document.getElementById("analyticsTopPosts");
      if (topPostsContainer) topPostsContainer.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">No engagement data yet</div>';
      return;
    }
    
    const totals = allPosts.reduce((acc, p) => {
      acc.likes += p.likes || 0; acc.comments += p.comments || 0; acc.saves += p.saves || 0;
      acc.impressions += p.impressions || 0; acc.reach += p.reach || 0;
      return acc;
    }, { likes: 0, comments: 0, saves: 0, impressions: 0, reach: 0 });
    
    const avgEngRate = (allPosts.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) / allPosts.length).toFixed(2);
    
    setText("analyticsLikes", formatCompactNumber(totals.likes)); setText("analyticsComments", formatCompactNumber(totals.comments));
    setText("analyticsSaves", formatCompactNumber(totals.saves)); setText("analyticsImpressions", formatCompactNumber(totals.impressions));
    setText("analyticsReach", formatCompactNumber(totals.reach)); setText("analyticsEngagementRate", avgEngRate + "%");
    
    const lastUpdate = allPosts.reduce((latest, p) => {
      const d = new Date(p.engagement_updated_at); return d > latest ? d : latest;
    }, new Date(0));
    
    const lastSync = document.getElementById("analyticsLastSync");
    if (lastSync && lastUpdate.getTime() > 0) {
      lastSync.textContent = `Last updated: ${lastUpdate.toLocaleDateString()} ${lastUpdate.toLocaleTimeString()}`;
    }
    
    // Top performing posts
    const topPosts = allPosts.slice(0, 5);
    const topPostsContainer = document.getElementById("analyticsTopPosts");
    if (topPostsContainer && topPosts.length > 0) {
      topPostsContainer.innerHTML = topPosts.map((p, idx) => {
        const date = new Date(p.posted_at);
        const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `
          <div class="p-3 flex items-center gap-3 hover:bg-gray-50 cursor-pointer transition-colors" data-post-id="${p.id}" onclick="window.openPostAnalytics && window.openPostAnalytics('${p.id}')">
            <span class="text-lg font-black text-gray-300">#${idx + 1}</span>
            ${p.image_url ? `<img src="${p.image_url}" class="w-10 h-10 rounded object-cover flex-shrink-0">` : ''}
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">${p.caption?.substring(0, 50) || "No caption"}...</div>
              <div class="text-xs text-gray-400">${dateStr}</div>
            </div>
            <div class="flex items-center gap-2 sm:gap-3 text-xs">
              <span class="text-pink-500">❤️ ${p.likes || 0}</span>
              <span class="text-blue-500 hidden sm:inline">💬 ${p.comments || 0}</span>
              <span class="text-yellow-500 hidden sm:inline">🔖 ${p.saves || 0}</span>
              <span class="px-2 py-1 bg-orange-100 text-orange-700 font-bold rounded">${p.engagement_rate || 0}%</span>
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
            </div>
          </div>
        `;
      }).join("");
    }
    
    // All posts grid
    const allPostsGrid = document.getElementById("analyticsAllPosts");
    if (allPostsGrid && allPosts.length > 0) {
      allPostsGrid.innerHTML = allPosts.map(p => {
        const engColor = (p.engagement_rate || 0) >= 5 ? "border-green-500" 
                       : (p.engagement_rate || 0) >= 2 ? "border-blue-500" 
                       : "border-gray-200";
        return `
          <div class="aspect-square relative group cursor-pointer rounded overflow-hidden border-2 ${engColor}" 
               onclick="window.openPostAnalytics && window.openPostAnalytics('${p.id}')">
            ${p.image_url 
              ? `<img src="${p.image_url}" class="w-full h-full object-cover" loading="lazy">` 
              : `<div class="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No img</div>`
            }
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs">
              <span>❤️ ${p.likes || 0}</span>
              <span>${p.engagement_rate || 0}%</span>
            </div>
          </div>
        `;
      }).join("");
    }
    
    // Hashtag performance
    const { data: hashtagData } = await client
      .from("hashtag_performance")
      .select("*")
      .order("avg_engagement_rate", { ascending: false })
      .limit(15);
    
    const hashtagsContainer = document.getElementById("analyticsHashtags");
    if (hashtagsContainer && hashtagData && hashtagData.length > 0) {
      const maxEff = Math.max(...hashtagData.map(h => h.avg_engagement_rate || 0)) || 1;
      hashtagsContainer.innerHTML = `
        <div class="flex flex-wrap gap-2">
          ${hashtagData.map(h => {
            const eff = h.avg_engagement_rate || 0;
            const size = Math.max(0.8, Math.min(1.4, eff / maxEff + 0.8));
            const colors = eff > 3 ? "bg-green-100 text-green-700 border-green-200" 
                         : eff > 1.5 ? "bg-blue-100 text-blue-700 border-blue-200"
                         : "bg-gray-100 text-gray-700 border-gray-200";
            return `
              <span class="inline-flex items-center gap-1 px-2 py-1 border rounded-full ${colors}" style="font-size: ${size}rem">
                #${h.hashtag}
                <span class="text-xs opacity-70">${eff.toFixed(1)}%</span>
              </span>
            `;
          }).join("")}
        </div>
        <p class="text-xs text-gray-400 mt-4">Size and color indicate engagement effectiveness. Green = high performing.</p>
      `;
    }
  } catch (err) {
    console.error("Failed to load engagement metrics:", err);
  }
}
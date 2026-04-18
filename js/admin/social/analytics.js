// /js/admin/social/analytics.js
// Analytics Dashboard, Post Analytics, Learning Insights, Category Insights

import { getPublicUrl } from "./api.js";
import {
  analyzePost,
  updateHashtagPerformance,
  updateTimingPerformance,
  updateCaptionPerformance,
  generateRecommendations,
  getTopHashtags,
  getBestPostingTimes,
  getActiveRecommendations,
  getLearnedPatterns,
  checkAndResearchCategories,
  getAllCategoryInsights
} from "./postLearning.js";

let _state, _els, _showToast, _getClient;
let _loadCalendarPosts, _loadQueuePosts;

export function initAnalytics(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _loadCalendarPosts = deps.loadCalendarPosts;
  _loadQueuePosts = deps.loadQueuePosts;
}

export function setupAnalytics() {
  document.getElementById("btnRefreshAnalytics")?.addEventListener("click", loadAnalytics);
  document.getElementById("btnSyncInstagramInsights")?.addEventListener("click", () => syncInstagramInsights());
}

export async function syncInstagramInsights(specificPostId) {
  const btn = document.getElementById("btnSyncInstagramInsights");
  const spinner = document.getElementById("syncInsightsSpinner");
  
  try {
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove("hidden");
    
    const client = _getClient();
    const { data, error } = await client.functions.invoke("instagram-insights", {
      body: { syncAll: true, daysBack: 30 }
    });
    
    if (error) throw error;
    
    console.log("Insights sync result:", data);
    
    await loadAnalytics();
    await loadEngagementMetrics();
    await _loadCalendarPosts();
    await _loadQueuePosts();
    
    const lastSync = document.getElementById("analyticsLastSync");
    if (lastSync) {
      const deletedMsg = data.deleted > 0 ? `, ${data.deleted} deleted` : "";
      lastSync.textContent = `Last synced: ${new Date().toLocaleTimeString()} • ${data.updated || 0} updated${deletedMsg}`;
    }
  } catch (err) {
    console.error("Failed to sync insights:", err);
    alert("Failed to sync insights: " + (err.message || "Unknown error"));
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add("hidden");
  }
}

async function loadEngagementMetrics() {
  try {
    const client = _getClient();
    
    const { data: posts, error } = await client
      .from("social_posts")
      .select("id, likes, comments, saves, impressions, reach, engagement_rate, engagement_updated_at, caption, hashtags, posted_at, status, image_url, permalink")
      .eq("platform", "instagram")
      .eq("status", "posted")
      .neq("status", "deleted")
      .not("engagement_updated_at", "is", null)
      .order("engagement_rate", { ascending: false });
    
    if (error) throw error;
    
    const allPosts = (posts || []).filter(p => {
      if (p.status !== "posted") return false;
      if (p.image_url && !p.image_url.startsWith("http")) {
        p.image_url = getPublicUrl(p.image_url);
      }
      return true;
    });
    
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const formatNum = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : n.toString();
    
    if (allPosts.length === 0) {
      setEl("analyticsLikes", "0"); setEl("analyticsComments", "0"); setEl("analyticsSaves", "0");
      setEl("analyticsImpressions", "0"); setEl("analyticsReach", "0"); setEl("analyticsEngagementRate", "0%");
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
    
    setEl("analyticsLikes", formatNum(totals.likes)); setEl("analyticsComments", formatNum(totals.comments));
    setEl("analyticsSaves", formatNum(totals.saves)); setEl("analyticsImpressions", formatNum(totals.impressions));
    setEl("analyticsReach", formatNum(totals.reach)); setEl("analyticsEngagementRate", avgEngRate + "%");
    
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

export async function loadAnalytics() {
  try {
    const client = _getClient();
    
    const { data: posts, error } = await client
      .from("social_posts")
      .select("id, platform, status, scheduled_for, posted_at, caption, created_at")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    
    const allPosts = posts || [];
    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    
    const activePosts = allPosts.filter(p => p.status !== "deleted");
    const totalPosts = activePosts.length;
    const published = activePosts.filter(p => p.status === "published" || p.status === "posted").length;
    const thisWeek = activePosts.filter(p => {
      const isPublished = p.status === "published" || p.status === "posted";
      const publishDate = p.posted_at || p.published_at;
      return isPublished && publishDate && new Date(publishDate) >= weekAgo;
    }).length;
    const scheduled = activePosts.filter(p => p.status === "queued" && new Date(p.scheduled_for) > now).length;
    
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    
    setEl("analyticsTotalPosts", totalPosts);
    setEl("analyticsPublished", published);
    setEl("analyticsThisWeek", thisWeek);
    setEl("analyticsScheduled", scheduled);
    
    loadEngagementMetrics();
    
    // Platform breakdown
    const platforms = { instagram: 0, facebook: 0, pinterest: 0 };
    allPosts.forEach(p => { if (platforms[p.platform] !== undefined) platforms[p.platform]++; });
    
    const maxPlatform = Math.max(...Object.values(platforms)) || 1;
    setEl("analyticsInstagramCount", platforms.instagram);
    setEl("analyticsFacebookCount", platforms.facebook);
    setEl("analyticsPinterestCount", platforms.pinterest);
    
    const setBar = (id, count) => { const el = document.getElementById(id); if (el) el.style.width = `${(count / maxPlatform) * 100}%`; };
    setBar("analyticsInstagramBar", platforms.instagram);
    setBar("analyticsFacebookBar", platforms.facebook);
    setBar("analyticsPinterestBar", platforms.pinterest);
    
    // Status breakdown
    const statuses = { queued: 0, published: 0, failed: 0, draft: 0, cancelled: 0 };
    allPosts.forEach(p => { if (statuses[p.status] !== undefined) statuses[p.status]++; });
    setEl("analyticsStatusQueued", statuses.queued);
    setEl("analyticsStatusPublished", statuses.published);
    setEl("analyticsStatusFailed", statuses.failed);
    setEl("analyticsStatusDraft", statuses.draft);
    setEl("analyticsStatusCancelled", statuses.cancelled);
    
    // Time distribution
    const timeSlots = { "Morning (6-12)": 0, "Afternoon (12-17)": 0, "Evening (17-21)": 0, "Night (21-6)": 0 };
    allPosts.forEach(p => {
      const hour = new Date(p.scheduled_for).getHours();
      if (hour >= 6 && hour < 12) timeSlots["Morning (6-12)"]++;
      else if (hour >= 12 && hour < 17) timeSlots["Afternoon (12-17)"]++;
      else if (hour >= 17 && hour < 21) timeSlots["Evening (17-21)"]++;
      else timeSlots["Night (21-6)"]++;
    });
    
    const maxTime = Math.max(...Object.values(timeSlots)) || 1;
    const timeChart = document.getElementById("analyticsTimeChart");
    if (timeChart) {
      timeChart.innerHTML = Object.entries(timeSlots).map(([label, count]) => `
        <div class="flex items-center gap-3">
          <div class="w-32 text-xs text-gray-600 text-right">${label}</div>
          <div class="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all" style="width: ${(count / maxTime) * 100}%"></div>
          </div>
          <div class="w-8 text-xs font-bold text-gray-700">${count}</div>
        </div>
      `).join("");
    }
    
    // Recent activity
    const recentPosts = allPosts.slice(0, 10);
    const activityContainer = document.getElementById("analyticsRecentActivity");
    if (activityContainer) {
      if (recentPosts.length === 0) {
        activityContainer.innerHTML = `<div class="p-4 text-center text-gray-400 text-sm">No posts yet</div>`;
      } else {
        activityContainer.innerHTML = recentPosts.map(p => {
          const date = new Date(p.posted_at || p.published_at || p.scheduled_for);
          const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          const statusColors = {
            published: "bg-green-100 text-green-700", posted: "bg-green-100 text-green-700",
            queued: "bg-blue-100 text-blue-700", failed: "bg-red-100 text-red-700",
            draft: "bg-gray-100 text-gray-700", cancelled: "bg-gray-100 text-gray-400",
            deleted: "bg-gray-200 text-gray-500 line-through"
          };
          const platformIcons = { instagram: "📸", facebook: "📘", pinterest: "📌" };
          return `
            <div class="p-3 flex items-center gap-3 hover:bg-gray-50">
              <span class="text-lg">${platformIcons[p.platform] || "📱"}</span>
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">${p.caption?.substring(0, 50) || "No caption"}...</div>
                <div class="text-xs text-gray-400">${dateStr} at ${timeStr}</div>
              </div>
              <span class="text-xs px-2 py-1 rounded-full ${statusColors[p.status] || statusColors.draft}">${p.status}</span>
            </div>
          `;
        }).join("");
      }
    }
    
    // Tone usage
    const tonePatterns = {
      "😊 Casual": ["Check out", "Just dropped", "Obsessed", "love", "POV:", "cute"],
      "🔥 Urgency": ["Don't miss", "Limited", "Last chance", "Selling fast", "FAST"],
      "💼 Pro": ["Introducing", "Elevate", "Premium", "Discover", "Quality"],
      "🎉 Playful": ["Treat yourself", "match made", "Plot twist", "Tag someone"],
      "💰 Value": ["price", "budget", "deal", "afford", "wallet"],
      "📈 Trending": ["Trending", "everyone", "viral", "hype", "season"],
      "✨ Inspire": ["Be bold", "Confidence", "Express", "Level up"],
      "🪶 Minimal": ["Simple", "Clean", "Less is more", "Effortless"],
    };
    
    const toneCounts = {};
    Object.keys(tonePatterns).forEach(tone => toneCounts[tone] = 0);
    allPosts.forEach(p => {
      if (!p.caption) return;
      const caption = p.caption.toLowerCase();
      Object.entries(tonePatterns).forEach(([tone, patterns]) => {
        if (patterns.some(pat => caption.includes(pat.toLowerCase()))) toneCounts[tone]++;
      });
    });
    
    const toneChart = document.getElementById("analyticsToneChart");
    if (toneChart) {
      toneChart.innerHTML = Object.entries(toneCounts).map(([tone, count]) => `
        <div class="text-center p-3 bg-gray-50 rounded-lg">
          <div class="text-lg mb-1">${tone.split(" ")[0]}</div>
          <div class="text-xl font-black">${count}</div>
          <div class="text-xs text-gray-500">${tone.split(" ")[1]}</div>
        </div>
      `).join("");
    }
  } catch (err) {
    console.error("Failed to load analytics:", err);
  }
}

// ─── Post Analytics Modal ───

export async function openPostAnalytics(postId) {
  const modal = document.getElementById("postAnalyticsModal");
  if (!modal) return;
  
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  
  try {
    const { data: post, error } = await _getClient()
      .from("social_posts")
      .select("*")
      .eq("id", postId)
      .single();
    
    if (error || !post) { console.error("Failed to load post:", error); return; }
    
    const img = modal.querySelector("#postAnalyticsImage img");
    if (img) img.src = post.image_url || "";
    
    const platform = document.getElementById("postAnalyticsPlatform");
    if (platform) {
      platform.textContent = post.platform?.charAt(0).toUpperCase() + post.platform?.slice(1) || "Unknown";
      platform.className = post.platform === "instagram" 
        ? "px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white"
        : "px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white";
    }
    
    const dateEl = document.getElementById("postAnalyticsDate");
    if (dateEl && post.posted_at) {
      const d = new Date(post.posted_at);
      dateEl.textContent = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    }
    
    const caption = document.getElementById("postAnalyticsCaption");
    if (caption) caption.textContent = post.caption || "No caption";
    
    const permalink = document.getElementById("postAnalyticsPermalink");
    if (permalink && post.permalink) { permalink.href = post.permalink; permalink.classList.remove("hidden"); }
    else if (permalink) permalink.classList.add("hidden");
    
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setVal("postAnalyticsLikes", post.likes || 0);
    setVal("postAnalyticsComments", post.comments || 0);
    setVal("postAnalyticsSaves", post.saves || 0);
    setVal("postAnalyticsShares", post.shares || 0);
    setVal("postAnalyticsReach", post.reach || 0);
    setVal("postAnalyticsEngRate", (post.engagement_rate || 0) + "%");
    
    // Performance insights
    const insightsEl = document.getElementById("postAnalyticsInsights");
    if (insightsEl) {
      const insights = [];
      const engRate = post.engagement_rate || 0;
      const saves = post.saves || 0;
      const likes = post.likes || 0;
      const comments = post.comments || 0;
      const reach = post.reach || 0;
      
      if (engRate >= 5) insights.push({ icon: "🔥", text: "Excellent engagement rate! This post is performing above average.", color: "text-green-600" });
      else if (engRate >= 2) insights.push({ icon: "✅", text: "Good engagement rate. Your audience is responding well.", color: "text-blue-600" });
      else if (engRate > 0) insights.push({ icon: "💡", text: "Average engagement. Consider testing different content types.", color: "text-yellow-600" });
      
      if (saves > 0 && saves >= likes * 0.1) insights.push({ icon: "🔖", text: `High save rate! ${saves} saves means people want to revisit this content.`, color: "text-purple-600" });
      if (comments > 0 && comments >= likes * 0.05) insights.push({ icon: "💬", text: `Strong comment activity! This content sparked conversations.`, color: "text-blue-600" });
      if (reach > 0) { const reachRatio = reach > 100 ? "significant" : "growing"; insights.push({ icon: "👥", text: `Reached ${reach} accounts - ${reachRatio} visibility.`, color: "text-gray-600" }); }
      
      if (insights.length === 0) insights.push({ icon: "⏳", text: "Insights will appear once the post gets more engagement.", color: "text-gray-500" });
      
      insightsEl.innerHTML = insights.map(i => `<div class="flex items-start gap-2"><span>${i.icon}</span><span class="${i.color}">${i.text}</span></div>`).join("");
    }
    
    // Hashtags
    const hashtagsSection = document.getElementById("postAnalyticsHashtagsSection");
    const hashtagsEl = document.getElementById("postAnalyticsHashtags");
    if (hashtagsSection && hashtagsEl) {
      const hashtags = post.hashtags || [];
      if (hashtags.length > 0) {
        hashtagsSection.classList.remove("hidden");
        hashtagsEl.innerHTML = hashtags.map(h => `<span class="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">#${h.replace(/^#/, "")}</span>`).join("");
      } else hashtagsSection.classList.add("hidden");
    }
    
    // Timeline
    const timelineEl = document.getElementById("postAnalyticsTimeline");
    if (timelineEl) {
      const events = [];
      if (post.created_at) events.push({ date: new Date(post.created_at), label: "Created", icon: "📝" });
      if (post.scheduled_for) events.push({ date: new Date(post.scheduled_for), label: "Scheduled", icon: "📅" });
      if (post.posted_at) events.push({ date: new Date(post.posted_at), label: "Posted", icon: "✅" });
      if (post.engagement_updated_at) events.push({ date: new Date(post.engagement_updated_at), label: "Last insights sync", icon: "📊" });
      events.sort((a, b) => a.date - b.date);
      timelineEl.innerHTML = events.map(e => `
        <div class="flex items-center gap-3 text-gray-600">
          <span>${e.icon}</span><span class="flex-1">${e.label}</span>
          <span class="text-xs text-gray-400">${e.date.toLocaleDateString()} ${e.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      `).join("");
    }
    
    const viewBtn = document.getElementById("btnViewPostOnPlatform");
    if (viewBtn && post.permalink) { viewBtn.href = post.permalink; viewBtn.classList.remove("hidden"); }
    else if (viewBtn) viewBtn.classList.add("hidden");
    
    modal.dataset.postId = postId;
    
    if (post.engagement_updated_at) {
      const { data: savedAnalysis } = await _getClient()
        .from("post_performance_analysis")
        .select("*")
        .eq("post_id", postId)
        .maybeSingle();
      
      if (savedAnalysis) displayAnalysis(savedAnalysis);
      else runDeepPostAnalysis(postId);
    }
  } catch (err) {
    console.error("Error opening post analytics:", err);
  }
}

// ─── Deep Post Analysis ───

function displayAnalysis(analysis) {
  if (!analysis) return;

  const scoreSection = document.getElementById("postAnalyticsScoreSection");
  if (scoreSection) {
    const overallScore = Math.round(analysis.overall_score || 50);
    const scoreEl = document.getElementById("postAnalyticsScore");
    if (scoreEl) scoreEl.textContent = overallScore + "/100";
    
    const setScore = (id, score) => { const el = document.getElementById(id); if (el) el.textContent = Math.round(score || 0) + "/100"; };
    setScore("postAnalyticsTimingScore", analysis.timing_score);
    setScore("postAnalyticsCaptionScore", analysis.caption_score);
    setScore("postAnalyticsHashtagScore", analysis.hashtag_score);
    setScore("postAnalyticsVisualScore", analysis.visual_score || 70);
    
    if (overallScore >= 70) scoreSection.className = "bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl p-4 text-white";
    else if (overallScore >= 50) scoreSection.className = "bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl p-4 text-white";
    else scoreSection.className = "bg-gradient-to-r from-red-500 to-pink-500 rounded-xl p-4 text-white";
  }
  
  const formatComparison = (value) => {
    const numVal = parseFloat(value) || 0;
    if (numVal > 0) return `<span class="text-green-600">+${numVal.toFixed(0)}%</span>`;
    if (numVal < 0) return `<span class="text-red-600">${numVal.toFixed(0)}%</span>`;
    return `<span class="text-gray-600">0%</span>`;
  };
  
  const setComp = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = formatComparison(val); };
  setComp("postAnalyticsVsAvgEng", analysis.vs_avg_engagement_rate);
  setComp("postAnalyticsVsAvgLikes", analysis.vs_avg_likes);
  setComp("postAnalyticsVsAvgComments", analysis.vs_avg_comments);
  setComp("postAnalyticsVsAvgSaves", analysis.vs_avg_saves);
  
  // Strengths
  const strengthsEl = document.getElementById("postAnalyticsStrengths");
  const strengthsSection = document.getElementById("postAnalyticsStrengthsSection");
  if (strengthsEl && analysis.strengths?.length > 0) {
    strengthsSection.classList.remove("hidden");
    strengthsEl.innerHTML = analysis.strengths.map(s => `<div class="flex items-start gap-2"><span>✅</span><span>${s}</span></div>`).join("");
  } else if (strengthsSection) strengthsSection.classList.add("hidden");
  
  // Weaknesses
  const weaknessesEl = document.getElementById("postAnalyticsWeaknesses");
  const weaknessesSection = document.getElementById("postAnalyticsWeaknessesSection");
  if (weaknessesEl && analysis.weaknesses?.length > 0) {
    weaknessesSection.classList.remove("hidden");
    weaknessesEl.innerHTML = analysis.weaknesses.map(w => `<div class="flex items-start gap-2"><span>❌</span><span>${w}</span></div>`).join("");
  } else if (weaknessesSection) weaknessesSection.classList.add("hidden");
  
  // Recommendations
  const recsEl = document.getElementById("postAnalyticsRecs");
  const recsSection = document.getElementById("postAnalyticsRecsSection");
  if (recsEl && analysis.recommendations?.length > 0) {
    recsSection.classList.remove("hidden");
    recsEl.innerHTML = analysis.recommendations.map(r => `<div class="flex items-start gap-2"><span>💡</span><span>${r}</span></div>`).join("");
  } else if (recsSection) recsSection.classList.add("hidden");
  
  const hashtagAdviceEl = document.getElementById("postAnalyticsHashtagAdvice");
  if (hashtagAdviceEl && analysis.hashtagAdvice) hashtagAdviceEl.innerHTML = `<strong>📌 Tip:</strong> ${analysis.hashtagAdvice}`;
  
  // AI Analysis section
  const aiSection = document.getElementById("postAnalyticsAISection");
  if (aiSection) {
    if (analysis.ai_analysis || analysis.ai_recommendations?.length > 0 || analysis.ai_learnings?.length > 0) {
      aiSection.classList.remove("hidden");
      
      const aiScoreEl = document.getElementById("postAnalyticsAIScore");
      if (aiScoreEl && analysis.ai_overall_score) {
        aiScoreEl.innerHTML = `<span class="text-2xl font-bold">${analysis.ai_overall_score}</span>/100 <span class="text-sm">(${analysis.ai_performance_tier || 'analyzed'})</span>`;
      }
      
      const aiRecsEl = document.getElementById("postAnalyticsAIRecs");
      if (aiRecsEl && analysis.ai_recommendations?.length > 0) {
        aiRecsEl.innerHTML = analysis.ai_recommendations.map(r => `<div class="flex items-start gap-2 text-sm"><span>🤖</span><span>${r}</span></div>`).join("");
      }
      
      const aiLearningsEl = document.getElementById("postAnalyticsAILearnings");
      if (aiLearningsEl && analysis.ai_learnings?.length > 0) {
        aiLearningsEl.innerHTML = analysis.ai_learnings.map(l => `
          <div class="bg-purple-50 rounded-lg p-2 text-sm">
            <div class="font-medium text-purple-800">📚 ${l.pattern}</div>
            ${l.apply_to_future ? `<div class="text-purple-600 text-xs mt-1">→ ${l.apply_to_future}</div>` : ''}
          </div>
        `).join("");
        _showToast(`🧠 AI learned ${analysis.ai_learnings.length} pattern(s) for future posts!`, "success");
      }
    } else aiSection.classList.add("hidden");
  }
}

async function runDeepPostAnalysis(postId) {
  const btn = document.getElementById("btnRunDeepAnalysis");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Analyzing...`;
  }
  
  try {
    const analysis = await analyzePost(postId);
    displayAnalysis(analysis);
  } catch (err) {
    console.error("Error running deep analysis:", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg> Run Deep Analysis`;
    }
  }
}

function closePostAnalytics() {
  const modal = document.getElementById("postAnalyticsModal");
  if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
}

window.openPostAnalytics = openPostAnalytics;

// ─── Learning Insights Dashboard ───

export async function loadLearningInsights() {
  const client = _getClient();
  
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

// ─── Process All Posts for Learning ───

export async function processAllPostsForLearning() {
  const client = _getClient();
  
  try {
    const { data: posts, error } = await client
      .from("social_posts")
      .select("*")
      .eq("status", "posted")
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

// ─── Post Analytics Modal Init ───

export function initPostAnalyticsModal() {
  const modal = document.getElementById("postAnalyticsModal");
  
  document.getElementById("btnClosePostAnalytics")?.addEventListener("click", closePostAnalytics);
  
  if (modal) {
    modal.addEventListener("click", (e) => { if (e.target === modal) closePostAnalytics(); });
  }
  
  document.getElementById("btnRefreshPostAnalytics")?.addEventListener("click", async () => {
    const postId = modal?.dataset.postId;
    if (postId) {
      const refreshBtn = document.getElementById("btnRefreshPostAnalytics");
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Syncing...`;
      try {
        await syncInstagramInsights(postId);
        await openPostAnalytics(postId);
      } catch (err) { console.error("Failed to refresh:", err); }
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh`;
    }
  });
  
  document.getElementById("btnRunDeepAnalysis")?.addEventListener("click", async () => {
    const postId = modal?.dataset.postId;
    if (postId) await runDeepPostAnalysis(postId);
  });
}

// ─── Learning Insights Init ───

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
        if (researched.length > 0) _showToast(`🧠 AI researched ${researched.length} categories!`, "success");
        else _showToast("No new categories to research (need 3+ posts per category)", "info");
        await loadCategoryInsightsUI();
      } catch (err) {
        console.error("Category research failed:", err);
        _showToast("Research failed. Check console for details.", "error");
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

// ─── Category Insights UI ───

export async function loadCategoryInsightsUI() {
  const grid = document.getElementById("categoryInsightsGrid");
  const countEl = document.getElementById("aiLearningsCount");
  const listEl = document.getElementById("allAILearningsList");
  
  if (!grid) return;
  
  try {
    const insights = await getAllCategoryInsights();
    
    if (!insights || insights.length === 0) {
      grid.innerHTML = `
        <div class="text-center py-8 text-gray-400">
          <div class="w-16 h-16 mx-auto mb-3 rounded-full bg-purple-100 flex items-center justify-center"><span class="text-3xl">🔬</span></div>
          <p class="font-medium text-gray-600 mb-1">No category insights yet</p>
          <p class="text-xs text-gray-500 max-w-md mx-auto">AI will automatically research each product category when you have 3+ posted items. Click "Research Categories" to trigger analysis now.</p>
        </div>
      `;
      return;
    }
    
    grid.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">${insights.map(cat => renderCategoryInsightCard(cat)).join("")}</div>`;
    
    if (countEl) countEl.textContent = insights.length;
    
    if (listEl) {
      const allLearnings = [];
      insights.forEach(cat => {
        if (cat.key_insights) {
          cat.key_insights.forEach(insight => {
            allLearnings.push({ type: "category", category: cat.category, insight: insight.insight, apply: insight.apply_how, impact: insight.impact });
          });
        }
      });
      
      if (allLearnings.length > 0) {
        listEl.innerHTML = allLearnings.map(l => `
          <div class="ai-learning-item">
            <div class="flex-shrink-0"><span class="ai-learning-type ${l.type}">${l.type}</span></div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-gray-800">${l.insight}</div>
              <div class="text-xs text-gray-500 mt-1">${l.apply || ""}</div>
              <div class="text-xs text-purple-600 mt-1">📁 ${l.category}</div>
            </div>
            ${l.impact ? `<span class="insight-tag ${l.impact === 'high' ? 'high-impact' : ''}">${l.impact}</span>` : ''}
          </div>
        `).join("");
      } else {
        listEl.innerHTML = `<div class="text-center py-4 text-gray-400 text-sm">No learnings stored yet.</div>`;
      }
    }
    
    document.querySelectorAll(".category-insight-card").forEach(card => {
      card.addEventListener("click", () => {
        const details = card.querySelector(".category-details");
        if (details) { details.classList.toggle("hidden"); card.classList.toggle("expanded"); }
      });
    });
  } catch (err) {
    console.error("Error loading category insights:", err);
    grid.innerHTML = `<div class="text-center py-4 text-red-500">Failed to load insights</div>`;
  }
}

function renderCategoryInsightCard(cat) {
  const categoryIcons = { "bags": "👜", "headwear": "🎩", "beanies": "🧢", "jewelry": "💍", "plushies": "🧸", "accessories": "👛", "default": "📦" };
  const icon = categoryIcons[cat.category?.toLowerCase()] || categoryIcons.default;
  const confidence = cat.confidence || 0;
  const confidenceLevel = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  
  return `
    <div class="category-insight-card">
      <div class="flex items-start gap-3 mb-3">
        <div class="category-icon bg-purple-100">${icon}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-bold text-gray-800 capitalize">${cat.category || "Unknown"}</h3>
            <span class="confidence-badge ${confidenceLevel}">${Math.round(confidence * 100)}% confident</span>
          </div>
          <p class="text-xs text-gray-500 mt-1">${cat.sample_size || 0} posts analyzed</p>
        </div>
      </div>
      <p class="text-sm text-gray-600 mb-3">${cat.summary || "No summary available"}</p>
      <div class="flex flex-wrap gap-1.5 mb-3">
        ${cat.caption_strategy?.tone_that_works ? `<span class="insight-tag caption">${cat.caption_strategy.tone_that_works} tone</span>` : ''}
        ${cat.caption_strategy?.emoji_usage ? `<span class="insight-tag caption">${cat.caption_strategy.emoji_usage} emojis</span>` : ''}
        ${cat.hashtag_strategy?.ideal_count ? `<span class="insight-tag hashtag">${cat.hashtag_strategy.ideal_count} hashtags</span>` : ''}
        ${cat.timing_insights?.best_days?.[0] ? `<span class="insight-tag timing">${cat.timing_insights.best_days[0]}</span>` : ''}
      </div>
      <div class="category-details hidden mt-4 pt-4 border-t">
        ${cat.caption_strategy ? `
          <div class="mb-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Caption Strategy</h4>
            <div class="strategy-grid">
              <div class="strategy-item"><div class="strategy-value">${cat.caption_strategy.ideal_length || '?'}</div><div class="strategy-label">Ideal Length</div></div>
              <div class="strategy-item"><div class="strategy-value">${cat.caption_strategy.tone_that_works || 'Any'}</div><div class="strategy-label">Best Tone</div></div>
              <div class="strategy-item"><div class="strategy-value">${cat.caption_strategy.emoji_usage || 'Moderate'}</div><div class="strategy-label">Emoji Style</div></div>
            </div>
            ${cat.caption_strategy.example_hooks?.length ? `
              <div class="mt-3"><div class="text-xs font-medium text-gray-500 mb-1">Proven Hooks:</div>
              <div class="text-sm text-gray-700 italic">"${cat.caption_strategy.example_hooks.slice(0, 2).join('", "')}"</div></div>` : ''}
          </div>` : ''}
        ${cat.hashtag_strategy?.top_performers?.length ? `
          <div class="mb-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Top Hashtags</h4>
            <div class="flex flex-wrap gap-1">
              ${cat.hashtag_strategy.top_performers.slice(0, 5).map(h => `<span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">${h}</span>`).join('')}
            </div>
          </div>` : ''}
        ${cat.key_insights?.length ? `
          <div class="mb-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Key Insights</h4>
            ${cat.key_insights.slice(0, 3).map(i => `
              <div class="key-insight-item">
                <div class="key-insight-icon ${i.impact || 'medium'}">${i.impact === 'high' ? '🔥' : i.impact === 'medium' ? '💡' : '📌'}</div>
                <div><div class="text-sm font-medium">${i.insight}</div><div class="text-xs text-gray-500 mt-0.5">${i.apply_how || ''}</div></div>
              </div>`).join('')}
          </div>` : ''}
        ${cat.improvement_opportunities?.length ? `
          <div>
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Opportunities</h4>
            <ul class="text-sm text-gray-600 space-y-1">
              ${cat.improvement_opportunities.slice(0, 3).map(o => `<li class="flex items-start gap-2"><span class="text-purple-500">→</span> ${o}</li>`).join('')}
            </ul>
          </div>` : ''}
      </div>
      <div class="text-center mt-2"><span class="text-xs text-gray-400">Click to ${cat.expanded ? 'collapse' : 'expand'}</span></div>
    </div>
  `;
}

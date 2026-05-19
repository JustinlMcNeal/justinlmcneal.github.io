// Analytics overview stats, charts, recent activity

import { isPostedSuccessStatus } from "../../postStatus.js";
import { getAnalyticsContext } from "./analyticsContext.js";
import { setText } from "../../utils/dom.js";
import { loadEngagementMetrics } from "./analyticsCards.js";
import { loadScoringPerformance } from "./scoringPerformance.js";

export async function loadAnalyticsDashboard() {
  try {
    const client = getAnalyticsContext().getClient();
    
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
    const published = activePosts.filter(p => isPostedSuccessStatus(p.status)).length;
    const thisWeek = activePosts.filter(p => {
      const isPublished = isPostedSuccessStatus(p.status);
      const publishDate = p.posted_at || p.published_at;
      return isPublished && publishDate && new Date(publishDate) >= weekAgo;
    }).length;
    const scheduled = activePosts.filter(p => p.status === "queued" && new Date(p.scheduled_for) > now).length;
    
    setText("analyticsTotalPosts", totalPosts);
    setText("analyticsPublished", published);
    setText("analyticsThisWeek", thisWeek);
    setText("analyticsScheduled", scheduled);

    const { getClient } = getAnalyticsContext();
    loadEngagementMetrics();
    loadScoringPerformance(getClient);

    // Platform breakdown
    const platforms = { instagram: 0, facebook: 0, pinterest: 0 };
    allPosts.forEach(p => { if (platforms[p.platform] !== undefined) platforms[p.platform]++; });
    
    const maxPlatform = Math.max(...Object.values(platforms)) || 1;
    setText("analyticsInstagramCount", platforms.instagram);
    setText("analyticsFacebookCount", platforms.facebook);
    setText("analyticsPinterestCount", platforms.pinterest);
    
    const setBar = (id, count) => { const el = document.getElementById(id); if (el) el.style.width = `${(count / maxPlatform) * 100}%`; };
    setBar("analyticsInstagramBar", platforms.instagram);
    setBar("analyticsFacebookBar", platforms.facebook);
    setBar("analyticsPinterestBar", platforms.pinterest);
    
    // Status breakdown
    const statuses = { queued: 0, published: 0, failed: 0, draft: 0, cancelled: 0 };
    allPosts.forEach(p => {
      if (isPostedSuccessStatus(p.status)) statuses.published++;
      else if (statuses[p.status] !== undefined) statuses[p.status]++;
    });
    setText("analyticsStatusQueued", statuses.queued);
    setText("analyticsStatusPublished", statuses.published);
    setText("analyticsStatusFailed", statuses.failed);
    setText("analyticsStatusDraft", statuses.draft);
    setText("analyticsStatusCancelled", statuses.cancelled);
    
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
            posted: "bg-green-100 text-green-700",
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

// Post analytics modal

import { analyzePost } from "../../postLearning.js";
import { getAnalyticsContext } from "./analyticsContext.js";
import { syncInstagramInsights } from "./instagramInsights.js";

/** Reuse cached post_performance_analysis younger than this (ms). */
const DEEP_ANALYSIS_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Avoid duplicate auto-runs when reopening the same post modal quickly. */
const DEEP_ANALYSIS_DEBOUNCE_MS = 60 * 1000;
const deepAnalysisAutoRunAt = new Map();

function setAnalysisStatus(text, tone = "muted") {
  const el = document.getElementById("postAnalyticsAnalysisStatus");
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("text-purple-600/90", "text-amber-700", "text-gray-500");
  if (tone === "amber") el.classList.add("text-amber-700");
  else if (tone === "gray") el.classList.add("text-gray-500");
  else el.classList.add("text-purple-600/90");
}

function isAnalysisStale(updatedAt) {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > DEEP_ANALYSIS_STALE_MS;
}

export async function openPostAnalytics(postId) {
  const modal = document.getElementById("postAnalyticsModal");
  if (!modal) return;
  
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  
  try {
    const { data: post, error } = await getAnalyticsContext().getClient()
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

    const { data: savedAnalysis } = await getAnalyticsContext().getClient()
      .from("post_performance_analysis")
      .select("*")
      .eq("post_id", postId)
      .maybeSingle();

    if (!post.engagement_updated_at) {
      setAnalysisStatus(
        "Sync insights first for live metrics. Run Deep Analysis anytime to build scores.",
        "gray"
      );
      if (savedAnalysis) {
        displayAnalysis(savedAnalysis);
        setAnalysisStatus(
          `Showing saved analysis from ${new Date(savedAnalysis.updated_at).toLocaleString()} (metrics may be outdated).`,
          "amber"
        );
      }
    } else if (savedAnalysis && !isAnalysisStale(savedAnalysis.updated_at)) {
      displayAnalysis(savedAnalysis);
      setAnalysisStatus(
        `Cached analysis · last analyzed ${new Date(savedAnalysis.updated_at).toLocaleString()}`,
        "muted"
      );
    } else {
      const lastAuto = deepAnalysisAutoRunAt.get(postId) || 0;
      const debounced = Date.now() - lastAuto < DEEP_ANALYSIS_DEBOUNCE_MS;
      if (savedAnalysis && debounced) {
        displayAnalysis(savedAnalysis);
        setAnalysisStatus(
          `Cached (stale) · last analyzed ${new Date(savedAnalysis.updated_at).toLocaleString()}. Use Run Deep Analysis to refresh.`,
          "amber"
        );
      } else {
        if (savedAnalysis) {
          setAnalysisStatus("Analysis is stale — refreshing…", "amber");
        } else {
          setAnalysisStatus("No saved analysis — running once…", "muted");
        }
        deepAnalysisAutoRunAt.set(postId, Date.now());
        await runDeepPostAnalysis(postId, { force: false });
      }
    }
  } catch (err) {
    console.error("Error opening post analytics:", err);
  }
}

// ─── Deep Post Analysis ───

function displayAnalysis(analysis) {
  if (!analysis) return;

  if (analysis.updated_at) {
    setAnalysisStatus(
      `Last analyzed ${new Date(analysis.updated_at).toLocaleString()}`,
      "muted"
    );
  }

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
        getAnalyticsContext().showToast(`🧠 AI learned ${analysis.ai_learnings.length} pattern(s) for future posts!`, "success");
      }
    } else aiSection.classList.add("hidden");
  }
}

async function runDeepPostAnalysis(postId, { force = true } = {}) {
  const btn = document.getElementById("btnRunDeepAnalysis");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Analyzing...`;
  }

  if (force) {
    setAnalysisStatus("Running fresh AI analysis…", "muted");
  }

  try {
    const analysis = await analyzePost(postId);
    if (analysis && !analysis.updated_at) {
      analysis.updated_at = new Date().toISOString();
    }
    displayAnalysis(analysis);
    deepAnalysisAutoRunAt.set(postId, Date.now());
  } catch (err) {
    console.error("Error running deep analysis:", err);
    setAnalysisStatus("Deep analysis failed — try again or check console.", "amber");
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
    if (postId) await runDeepPostAnalysis(postId, { force: true });
  });
}

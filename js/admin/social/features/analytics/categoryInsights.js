// Category insights UI

import { getAllCategoryInsights } from "../../postLearning.js";
import { getAnalyticsContext } from "./analyticsContext.js";

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
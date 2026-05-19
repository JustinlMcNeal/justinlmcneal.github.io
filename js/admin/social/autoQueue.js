// /js/admin/social/autoQueue.js
// Auto-Queue & Auto-Repost

import { getSupabaseClient } from "../../shared/supabaseClient.js";

const AUTO_QUEUE_SETTING_KEY = "auto_queue";
const DEFAULT_POSTING_TIMES = ["09:00", "17:00"];
const DEFAULT_CAPTION_TONES = ["casual", "urgency"];
const DEFAULT_SCORING_WEIGHTS = {
  recency: 40,
  category: 25,
  image_freshness: 25,
  inventory_health: 10,
  penalties_enabled: true,
};

let _state, _els, _showToast, _getClient, _SUPABASE_FUNCTIONS_URL;
let _loadStats, _loadAutoQueueStats, _switchTab, _loadQueuePosts;

export function initAutoQueue(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _SUPABASE_FUNCTIONS_URL = deps.SUPABASE_FUNCTIONS_URL;
  _loadStats = deps.loadStats;
  _loadAutoQueueStats = deps.loadAutoQueueStats || loadAutoQueueStats;
  _switchTab = deps.switchTab;
  _loadQueuePosts = deps.loadQueuePosts;
}

export function setupAutoQueue() {
  _els.btnAutoQueue?.addEventListener("click", () => _switchTab("autoqueue"));
  _els.btnPreviewQueue?.addEventListener("click", previewAutoQueue);
  _els.btnGenerateQueue?.addEventListener("click", generateAutoQueue);
  _els.btnConfirmQueue?.addEventListener("click", confirmAutoQueue);

  document.getElementById("btnSaveAutoQueueSettings")?.addEventListener("click", () => saveAutoQueueSettings(true));
  document.getElementById("btnResetScoringDefaults")?.addEventListener("click", resetScoringWeightsForm);
  document.getElementById("btnPreviewRepost")?.addEventListener("click", previewRepost);
  document.getElementById("btnGenerateRepost")?.addEventListener("click", generateRepost);
  document.getElementById("btnConfirmRepost")?.addEventListener("click", confirmRepost);

  loadAutoQueueSettings();
}

export function getAutoQueueSettings() {
  const postingTimes = [];
  if (_els.aqTime1?.checked) postingTimes.push(_els.aqTime1.value);
  if (_els.aqTime2?.checked) postingTimes.push(_els.aqTime2.value);
  if (_els.aqTime3?.checked) postingTimes.push(_els.aqTime3.value);
  if (_els.aqTime4?.checked) postingTimes.push(_els.aqTime4.value);

  const captionTones = [];
  if (_els.aqToneCasual?.checked) captionTones.push("casual");
  if (_els.aqToneUrgency?.checked) captionTones.push("urgency");
  if (_els.aqTonePro?.checked) captionTones.push("professional");
  if (_els.aqTonePlayful?.checked) captionTones.push("playful");
  if (_els.aqToneValue?.checked) captionTones.push("value");
  if (_els.aqToneTrending?.checked) captionTones.push("trending");
  if (_els.aqToneInspirational?.checked) captionTones.push("inspirational");
  if (_els.aqToneMinimalist?.checked) captionTones.push("minimalist");

  const platforms = [];
  const aqPlatformInstagram = document.getElementById("aqPlatformInstagram");
  const aqPlatformFacebook = document.getElementById("aqPlatformFacebook");
  const aqPlatformPinterest = document.getElementById("aqPlatformPinterest");
  if (aqPlatformInstagram?.checked) platforms.push("instagram");
  if (aqPlatformFacebook?.checked) platforms.push("facebook");
  if (aqPlatformPinterest?.checked) platforms.push("pinterest");

  return {
    count: parseInt(_els.aqPostCount?.value || "4", 10),
    platforms: platforms.length ? platforms : ["instagram"],
    postingTimes: postingTimes.length ? postingTimes : DEFAULT_POSTING_TIMES,
    captionTones: captionTones.length ? captionTones : DEFAULT_CAPTION_TONES,
  };
}

function applyPostingTimesToForm(times) {
  const set = new Set(times || []);
  const map = [
    ["aqTime1", "09:00"],
    ["aqTime2", "12:00"],
    ["aqTime3", "17:00"],
    ["aqTime4", "20:00"],
  ];
  for (const [id, value] of map) {
    const el = document.getElementById(id);
    if (el) el.checked = set.has(value);
  }
}

function applyCaptionTonesToForm(tones) {
  const set = new Set(tones || []);
  const map = [
    ["aqToneCasual", "casual"],
    ["aqToneUrgency", "urgency"],
    ["aqTonePro", "professional"],
    ["aqTonePlayful", "playful"],
    ["aqToneValue", "value"],
    ["aqToneTrending", "trending"],
    ["aqToneInspirational", "inspirational"],
    ["aqToneMinimalist", "minimalist"],
  ];
  for (const [id, value] of map) {
    const el = document.getElementById(id);
    if (el) el.checked = set.has(value);
  }
}

function applyPlatformsToForm(platforms) {
  const set = new Set(platforms || []);
  const ig = document.getElementById("aqPlatformInstagram");
  const fb = document.getElementById("aqPlatformFacebook");
  const pin = document.getElementById("aqPlatformPinterest");
  if (ig) ig.checked = set.has("instagram");
  if (fb) fb.checked = set.has("facebook");
  if (pin) pin.checked = set.has("pinterest");
}

function clampScoringWeight(val, fallback) {
  const n = parseInt(String(val ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(0, n));
}

function applyScoringWeightsToForm(weights) {
  const w = weights || DEFAULT_SCORING_WEIGHTS;
  const recency = document.getElementById("aqWeightRecency");
  const category = document.getElementById("aqWeightCategory");
  const imageFreshness = document.getElementById("aqWeightImageFreshness");
  const inventoryHealth = document.getElementById("aqWeightInventoryHealth");
  const penalties = document.getElementById("aqPenaltiesEnabled");
  if (recency) recency.value = String(clampScoringWeight(w.recency, DEFAULT_SCORING_WEIGHTS.recency));
  if (category) category.value = String(clampScoringWeight(w.category, DEFAULT_SCORING_WEIGHTS.category));
  if (imageFreshness) {
    imageFreshness.value = String(clampScoringWeight(w.image_freshness, DEFAULT_SCORING_WEIGHTS.image_freshness));
  }
  if (inventoryHealth) {
    inventoryHealth.value = String(clampScoringWeight(w.inventory_health, DEFAULT_SCORING_WEIGHTS.inventory_health));
  }
  if (penalties) penalties.checked = w.penalties_enabled !== false;
}

function getScoringWeightsFromForm() {
  return {
    recency: clampScoringWeight(
      document.getElementById("aqWeightRecency")?.value,
      DEFAULT_SCORING_WEIGHTS.recency
    ),
    category: clampScoringWeight(
      document.getElementById("aqWeightCategory")?.value,
      DEFAULT_SCORING_WEIGHTS.category
    ),
    image_freshness: clampScoringWeight(
      document.getElementById("aqWeightImageFreshness")?.value,
      DEFAULT_SCORING_WEIGHTS.image_freshness
    ),
    inventory_health: clampScoringWeight(
      document.getElementById("aqWeightInventoryHealth")?.value,
      DEFAULT_SCORING_WEIGHTS.inventory_health
    ),
    penalties_enabled: document.getElementById("aqPenaltiesEnabled")?.checked !== false,
  };
}

function resetScoringWeightsForm() {
  applyScoringWeightsToForm(DEFAULT_SCORING_WEIGHTS);
  _showToast?.("Scoring weights reset to defaults — click Save to persist") ||
    alert("Scoring weights reset to defaults. Click Save Auto-Queue Settings to persist.");
}

function isCompareScoringEnabled() {
  const el = document.getElementById("aqCompareScoring");
  return el ? el.checked : true;
}

export async function loadAutoQueueSettings() {
  try {
    const client = getSupabaseClient();
    const { data: row } = await client
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", AUTO_QUEUE_SETTING_KEY)
      .maybeSingle();

    const saved = row?.setting_value || {};
    if (saved.count && _els.aqPostCount) {
      _els.aqPostCount.value = String(saved.count);
    }
    applyPlatformsToForm(saved.platforms || ["instagram", "facebook"]);
    applyPostingTimesToForm(saved.posting_times || saved.postingTimes || DEFAULT_POSTING_TIMES);
    applyCaptionTonesToForm(saved.caption_tones || saved.captionTones || DEFAULT_CAPTION_TONES);
    applyScoringWeightsToForm(saved.scoring_weights || null);
  } catch (err) {
    console.error("[auto-queue] Failed to load settings:", err);
  }
}

export async function saveAutoQueueSettings(showFeedback = false) {
  try {
    const client = getSupabaseClient();
    const form = getAutoQueueSettings();

    const { data: existing } = await client
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", AUTO_QUEUE_SETTING_KEY)
      .maybeSingle();

    const merged = {
      ...(existing?.setting_value && typeof existing.setting_value === "object" ? existing.setting_value : {}),
      count: form.count,
      platforms: form.platforms,
      posting_times: form.postingTimes,
      caption_tones: form.captionTones,
      scoring_weights: getScoringWeightsFromForm(),
      updated_at: new Date().toISOString(),
    };

    await client.from("social_settings").upsert({
      setting_key: AUTO_QUEUE_SETTING_KEY,
      setting_value: merged,
    }, { onConflict: "setting_key" });

    if (showFeedback) {
      _showToast?.("Auto-queue settings saved") || alert("Auto-queue settings saved");
    }
    return merged;
  } catch (err) {
    console.error("[auto-queue] Failed to save settings:", err);
    if (showFeedback) alert("Failed to save auto-queue settings");
    throw err;
  }
}

async function getAuthHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token}`,
  };
}

function formatPlatformsLabel(platforms) {
  return (platforms || []).join(", ") || "instagram";
}

async function previewAutoQueue() {
  const settings = getAutoQueueSettings();

  _els.btnPreviewQueue.disabled = true;
  _els.btnPreviewQueue.innerHTML = `
    <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Generating...
  `;

  try {
    await saveAutoQueueSettings(false);

    const compareScoring = isCompareScoringEnabled();
    const previewBody = { ...settings, preview: true };
    if (compareScoring) previewBody.compareScoring = true;

    const response = await fetch(`${_SUPABASE_FUNCTIONS_URL}/auto-queue`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify(previewBody),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to preview posts");

    _state.autoQueuePreview = result.posts;
    _state.autoQueuePreviewSettings = result.settings_used || null;
    _state.autoQueuePreviewSkipped = result.skipped_products || [];
    _state.autoQueuePreviewSummary = result.run_summary || null;
    _state.autoQueueScoringComparison = result.scoring_comparison || null;
    _state.autoQueueCompareScoring = compareScoring;
    renderAutoQueuePreview(
      result.posts,
      result.settings_used,
      result.skipped_products,
      result.run_summary,
      compareScoring ? result.scoring_comparison : null,
      compareScoring
    );
  } catch (err) {
    console.error("Preview error:", err);
    alert("Failed to preview: " + err.message);
  } finally {
    _els.btnPreviewQueue.disabled = false;
    _els.btnPreviewQueue.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
      </svg>
      Preview Posts
    `;
  }
}

async function generateAutoQueue() {
  const settings = getAutoQueueSettings();
  const platformLabel = formatPlatformsLabel(settings.platforms);

  const guardNote =
    "Safety guards: skips products already queued; default is one platform per product per run.";
  if (!confirm(`Generate and schedule ${settings.count} product slot(s) for: ${platformLabel}?\n\n${guardNote}`)) return;

  _els.btnGenerateQueue.disabled = true;
  _els.btnGenerateQueue.innerHTML = `
    <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Generating...
  `;

  try {
    await saveAutoQueueSettings(false);

    const response = await fetch(`${_SUPABASE_FUNCTIONS_URL}/auto-queue`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ ...settings, preview: false }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to generate posts");

    const skippedN = result.run_summary?.skipped_count ?? result.skipped_products?.length ?? 0;
    const msg = skippedN > 0
      ? `Scheduled ${result.generated} posts. ${skippedN} product(s) skipped by safety guards.`
      : `Successfully scheduled ${result.generated} posts!`;
    alert(msg);
    await _loadStats();
    await loadAutoQueueStats();
    _switchTab("queue");
  } catch (err) {
    console.error("Generate error:", err);
    alert("Failed to generate: " + err.message);
  } finally {
    _els.btnGenerateQueue.disabled = false;
    _els.btnGenerateQueue.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
      Generate & Schedule
    `;
  }
}

async function confirmAutoQueue() {
  if (!_state.autoQueuePreview?.length) {
    alert("No preview data. Please generate a preview first.");
    return;
  }
  if (!confirm(`Schedule ${_state.autoQueuePreview.length} posts now?`)) return;
  await generateAutoQueue();
  _state.autoQueuePreview = null;
  _state.autoQueuePreviewSettings = null;
  _els.aqPreviewResults?.classList.add("hidden");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatLastPosted(iso) {
  if (!iso) return "Never posted";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Last posted today";
  if (days === 1) return "Last posted 1 day ago";
  return `Last posted ${days} days ago`;
}

function formatGuardLabel(code) {
  const map = {
    zero_stock_no_mto_flag: "Zero stock (not MTO)",
    made_to_order: "Made to order",
    low_stock: "Low stock",
    no_variant_stock_data: "No stock data",
    pending_queue_post: "Already queued",
  };
  return map[code] || String(code || "").replace(/_/g, " ");
}

function formatScoreLabel(code) {
  if (!code) return "";
  const map = {
    never_posted: "Never posted",
    strong_category_performance: "Strong category",
    strong_fresh_pool: "Fresh image pool",
    zero_stock_non_mto: "Zero stock",
    low_stock: "Low stock",
    missing_stock_data: "No stock data",
    no_image_pool: "No image pool",
    weak_image_pipeline: "Weak images",
    category_low_sample: "Low category samples",
  };
  return map[code] || String(code).replace(/_/g, " ");
}

function renderScoringSummary(meta) {
  if (!meta?.score_breakdown && meta?.priority_score == null) return "";

  const lines = [];
  const score = meta.priority_score ?? meta.score_breakdown?.subtotal;
  if (score != null) {
    lines.push(`<span class="text-gray-700"><strong>Score ${Number(score).toFixed(1)}</strong></span>`);
  }
  if (meta.final_reason_summary) {
    lines.push(`<span class="text-gray-600">Why: ${escapeHtml(meta.final_reason_summary)}</span>`);
  } else if (meta.selected_reason) {
    lines.push(`Why: ${escapeHtml(formatScoreLabel(meta.selected_reason) || meta.selected_reason)}`);
  }
  if (meta.top_boost) {
    lines.push(`<span class="text-green-700">↑ ${escapeHtml(formatScoreLabel(meta.top_boost))}</span>`);
  }
  if (meta.top_penalty) {
    lines.push(`<span class="text-red-700">↓ ${escapeHtml(formatScoreLabel(meta.top_penalty))}</span>`);
  }
  const breakdown = meta.score_breakdown;
  if (breakdown) {
    const parts = [
      `recency ${Number(breakdown.recency ?? 0).toFixed(0)}`,
      `cat ${Number(breakdown.category_perf ?? 0).toFixed(0)}`,
      `img ${Number(breakdown.image_freshness ?? 0).toFixed(0)}`,
      `inv ${Number(breakdown.inventory_health ?? 0).toFixed(0)}`,
    ];
    if (breakdown.inventory_penalty > 0) parts.push(`−inv ${Number(breakdown.inventory_penalty).toFixed(0)}`);
    if (breakdown.image_reuse_penalty > 0) parts.push(`−reuse ${Number(breakdown.image_reuse_penalty).toFixed(0)}`);
    lines.push(`<span class="text-gray-500">${parts.join(" · ")}</span>`);
  }
  if (meta.category_sample_size != null && meta.category_sample_size > 0) {
    lines.push(`<span class="text-gray-400">Cat samples: ${meta.category_sample_size}</span>`);
  }
  return lines.length ? lines.join(" · ") : "";
}

function renderSelectionSummary(post) {
  const meta = post.selection_metadata || {};
  const lines = [];

  const scoringLine = renderScoringSummary(meta);
  if (scoringLine) lines.push(scoringLine);

  if (meta.is_resurfaced || post.resurfaced_from) {
    lines.push('<span class="text-orange-600 font-medium">🔄 Resurfaced hit</span>');
  }
  if (meta.scarcity_guard_applied) {
    lines.push('<span class="text-amber-700 font-medium">⚠️ Scarcity copy removed</span>');
  }
  if (Array.isArray(meta.eligibility_warnings) && meta.eligibility_warnings.length) {
    const badges = meta.eligibility_warnings
      .map((w) => `<span class="text-amber-700">${escapeHtml(formatGuardLabel(w))}</span>`)
      .join(", ");
    lines.push(badges);
  }
  if (meta.duplicate_guard_result && meta.duplicate_guard_result !== "passed") {
    lines.push(`Duplicate guard: <span class="font-mono">${escapeHtml(meta.duplicate_guard_result)}</span>`);
  }
  if (meta.image_reuse_guard && meta.image_reuse_guard !== "passed") {
    lines.push(`Image reuse: <span class="font-mono">${escapeHtml(meta.image_reuse_guard)}</span>`);
  }
  if (meta.inventory_status) {
    lines.push(`Inventory: ${escapeHtml(meta.inventory_status)}`);
  }
  if (meta.backorder_status && meta.backorder_status !== "not_applicable") {
    lines.push(`Backorder: ${escapeHtml(meta.backorder_status)}`);
  }
  if (post.image_source) {
    lines.push(`Image: <span class="font-mono">${escapeHtml(post.image_source)}</span>`);
  }
  if (meta.caption_source) {
    lines.push(`Caption: ${escapeHtml(meta.caption_source)} (${escapeHtml(meta.caption_status || "")}, score ${meta.caption_confidence ?? "—"})`);
  }
  if (meta.shot_type) {
    lines.push(`Shot: ${escapeHtml(meta.shot_type)}`);
  }
  if (post.is_carousel && post.carousel_urls?.length) {
    lines.push(`Carousel: ${post.carousel_urls.length} images`);
  }
  lines.push(formatLastPosted(post.last_social_post_at));

  return lines.length ? lines.join(" · ") : "";
}

function renderScoringComparisonPanel(comparison) {
  if (!comparison?.candidates?.length) return "";

  const s = comparison.summary || {};
  const topReasons = (s.top_reasons_for_rank_movement || [])
    .slice(0, 4)
    .map((r) => `${escapeHtml(String(r.reason).replace(/^penalty:|^boost:/, ""))} (${r.count})`)
    .join(", ");

  const rows = comparison.candidates
    .filter((c) => c.selected_in_current_top || c.selected_in_legacy_top || Math.abs(c.rank_delta) >= 2)
    .slice(0, 12)
    .map((c) => {
      const rankCls = c.rank_delta > 0 ? "text-green-700" : c.rank_delta < 0 ? "text-red-700" : "text-gray-600";
      const rankLabel = c.rank_delta > 0 ? `↑${c.rank_delta}` : c.rank_delta < 0 ? `↓${Math.abs(c.rank_delta)}` : "—";
      const selected = c.selected_in_current_top
        ? '<span class="text-green-700 font-medium">selected</span>'
        : c.selected_in_legacy_top
          ? '<span class="text-amber-700">legacy top only</span>'
          : "";
      return `
        <tr class="border-t border-indigo-100">
          <td class="py-1.5 pr-2 font-medium truncate max-w-[120px]">${escapeHtml(c.product_name)}</td>
          <td class="py-1.5 px-2 text-right">${Number(c.current_score).toFixed(1)}</td>
          <td class="py-1.5 px-2 text-right text-gray-500">${Number(c.legacy_score).toFixed(1)}</td>
          <td class="py-1.5 px-2 text-right ${c.score_delta >= 0 ? "text-green-700" : "text-red-700"}">${c.score_delta >= 0 ? "+" : ""}${Number(c.score_delta).toFixed(1)}</td>
          <td class="py-1.5 px-2 text-right">#${c.current_rank}</td>
          <td class="py-1.5 px-2 text-right text-gray-500">#${c.legacy_rank}</td>
          <td class="py-1.5 px-2 text-right ${rankCls}">${rankLabel}</td>
          <td class="py-1.5 pl-2 text-gray-600 truncate max-w-[200px]" title="${escapeHtml(c.why_current_rank_changed)}">${escapeHtml(c.why_current_rank_changed)}</td>
          <td class="py-1.5 pl-1">${selected}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="px-4 py-3 bg-indigo-50 border-b border-indigo-100 text-xs">
      <p class="font-bold text-indigo-900 mb-1">Scoring comparison (3c vs legacy — preview only)</p>
      <p class="text-indigo-800 mb-2">
        Compared ${s.candidates_compared ?? 0} ·
        <span class="text-green-700">↑ ${s.moved_up_by_new_scoring ?? 0}</span> ·
        <span class="text-red-700">↓ ${s.moved_down_by_new_scoring ?? 0}</span> ·
        same ${s.rank_unchanged ?? 0} ·
        skipped ${s.skipped_by_guards ?? 0}
        ${topReasons ? ` · Top drivers: ${topReasons}` : ""}
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead>
            <tr class="text-indigo-700 text-[10px] uppercase">
              <th class="pb-1">Product</th>
              <th class="pb-1 text-right">3c</th>
              <th class="pb-1 text-right">Legacy</th>
              <th class="pb-1 text-right">Δ</th>
              <th class="pb-1 text-right">Rank</th>
              <th class="pb-1 text-right">Was</th>
              <th class="pb-1 text-right">Move</th>
              <th class="pb-1">Why</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPostScoringComparison(comp) {
  if (!comp) return "";
  const rankCls = comp.rank_delta > 0 ? "text-green-700" : comp.rank_delta < 0 ? "text-red-700" : "text-gray-600";
  const rankLabel = comp.rank_delta > 0 ? `↑${comp.rank_delta}` : comp.rank_delta < 0 ? `↓${Math.abs(comp.rank_delta)}` : "same";
  return `<p class="text-[11px] text-indigo-800 mt-1">
    <span class="font-medium">Compare:</span>
    3c ${Number(comp.current_score).toFixed(1)} vs legacy ${Number(comp.legacy_score).toFixed(1)}
    (Δ ${comp.score_delta >= 0 ? "+" : ""}${Number(comp.score_delta).toFixed(1)})
    · rank #${comp.current_rank} <span class="${rankCls}">${rankLabel}</span> from #${comp.legacy_rank}
  </p>`;
}

function renderSkippedPreview(skipped, runSummary) {
  if (!skipped?.length) return "";
  const items = skipped.slice(0, 8).map((s) => {
    const reason = s.skipped_reason || s.skipped_reason || "skipped";
    return `<li class="truncate"><strong>${escapeHtml(s.product_name || s.product_id)}</strong> — ${escapeHtml(formatGuardLabel(reason))}</li>`;
  }).join("");
  const more = skipped.length > 8 ? `<li class="text-gray-400">+${skipped.length - 8} more</li>` : "";
  const summary = runSummary
    ? ` · ${runSummary.pending_queue_blocked || 0} blocked by pending queue`
    : "";
  return `
    <div class="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs">
      <p class="font-medium text-amber-900">Skipped ${skipped.length} product(s)${summary}</p>
      <ul class="mt-1 text-amber-800 list-disc list-inside space-y-0.5">${items}${more}</ul>
    </div>
  `;
}

function formatPreviewRunBanner(settingsUsed, compareEnabled) {
  if (!settingsUsed) return "";
  const w = settingsUsed.scoring_weights || {};
  const parts = [
    `${escapeHtml(settingsUsed.count)} products`,
    escapeHtml((settingsUsed.platforms || []).join(", ")),
    `tones ${escapeHtml((settingsUsed.caption_tones || []).join(", "))}`,
    `times ${escapeHtml((settingsUsed.posting_times || []).join(", "))} ET`,
  ];
  if (settingsUsed.scoring_version) {
    parts.push(`scoring <strong>${escapeHtml(settingsUsed.scoring_version)}</strong>`);
  }
  if (w.recency != null) {
    parts.push(
      `weights R${w.recency}/C${w.category}/I${w.image_freshness}/H${w.inventory_health}`
    );
  }
  parts.push(`penalties <strong>${w.penalties_enabled !== false ? "on" : "off"}</strong>`);
  parts.push(`compare <strong>${compareEnabled ? "on" : "off"}</strong>`);
  if (settingsUsed.allow_multi_platform_per_product === false && (settingsUsed.platforms?.length || 0) > 1) {
    parts.push('<span class="text-amber-700">one platform/product</span>');
  }
  return parts.join(" · ");
}

function renderAutoQueuePreview(posts, settingsUsed, skippedProducts, runSummary, scoringComparison, compareEnabled) {
  const skipped = skippedProducts || [];
  if (!posts?.length && !skipped.length) {
    _els.aqPreviewResults?.classList.add("hidden");
    return;
  }

  _els.aqPreviewResults?.classList.remove("hidden");

  const settingsNote = settingsUsed
    ? `<p class="text-xs text-gray-500 px-4 py-2 bg-gray-50 border-b">Run: ${formatPreviewRunBanner(settingsUsed, compareEnabled)}</p>`
    : "";

  const skippedBlock = renderSkippedPreview(skipped, runSummary);
  const comparisonBlock = renderScoringComparisonPanel(scoringComparison);

  const postsHtml = (posts || []).map((post) => {
    const schedDate = new Date(post.scheduled_for);
    const dateStr = schedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeStr = schedDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const thumb = post.resolved_image_url || post.catalog_image_url;
    const summary = renderSelectionSummary(post);
    const meta = post.selection_metadata || {};
    const detailsJson = escapeHtml(JSON.stringify(meta, null, 2));

    const platformClass = post.platform === "instagram"
      ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white"
      : post.platform === "facebook"
        ? "bg-blue-600 text-white"
        : "bg-pinterest text-white";

    return `
      <div class="p-4 flex gap-4">
        <div class="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
          <img src="${escapeHtml(thumb)}" alt="${escapeHtml(post.product_name)}"
               class="w-full h-full object-cover"
               onerror="this.src='/imgs/placeholder.jpg'">
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2 mb-1">
            <span class="text-xs font-medium px-2 py-0.5 rounded-full ${platformClass}">${escapeHtml(post.platform)}</span>
            <span class="text-xs text-gray-500">${dateStr} at ${timeStr}</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">${escapeHtml(post.tone || meta.caption_tone || "")}</span>
            ${meta.is_resurfaced ? '<span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Resurface</span>' : ""}
            ${meta.scarcity_guard_applied ? '<span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Scarcity guarded</span>' : ""}
            ${(meta.eligibility_warnings || []).includes("zero_stock_no_mto_flag") ? '<span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Zero stock</span>' : ""}
          </div>
          <div class="font-medium text-sm truncate">${escapeHtml(post.product_name)}</div>
          <div class="text-xs text-gray-500 mt-1 line-clamp-2">${escapeHtml(post.caption)}</div>
          ${summary ? `<p class="text-xs text-gray-600 mt-2 leading-relaxed">${summary}</p>` : ""}
          ${renderPostScoringComparison(post.scoring_comparison)}
          ${Object.keys(meta).length ? `<details class="mt-1"><summary class="text-xs text-gray-400 cursor-pointer">Selection metadata</summary><pre class="text-[10px] text-gray-500 mt-1 overflow-x-auto whitespace-pre-wrap">${detailsJson}</pre></details>` : ""}
        </div>
      </div>
    `;
  }).join("");

  _els.aqPreviewList.innerHTML = settingsNote + comparisonBlock + skippedBlock + postsHtml;
}

// ─── Auto-Repost ───

function getRepostSettings() {
  const aqSettings = getAutoQueueSettings();
  return {
    count: parseInt(document.getElementById("repostCount")?.value || "2", 10),
    minDaysOld: parseInt(document.getElementById("repostMinDays")?.value || "30", 10),
    platforms: aqSettings.platforms,
    tones: ["casual", "trending", "value"],
  };
}

async function previewRepost() {
  const btn = document.getElementById("btnPreviewRepost");
  const settings = getRepostSettings();

  btn.disabled = true;
  btn.textContent = "Loading...";

  try {
    const response = await fetch(`${_SUPABASE_FUNCTIONS_URL}/auto-repost`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ ...settings, preview: true }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to preview reposts");

    if (!result.posts?.length) {
      alert("No old posts found to repost. Try reducing the minimum age.");
      return;
    }

    _state.repostPreview = result.posts;
    renderRepostPreview(result.posts);
  } catch (err) {
    console.error("Repost preview error:", err);
    alert("Failed to preview: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "👀 Preview";
  }
}

async function generateRepost() {
  const btn = document.getElementById("btnGenerateRepost");
  const settings = getRepostSettings();

  btn.disabled = true;
  btn.textContent = "Generating...";

  try {
    const response = await fetch(`${_SUPABASE_FUNCTIONS_URL}/auto-repost`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ ...settings, preview: false }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to generate reposts");

    if (result.generated === 0) {
      alert("No old posts found to repost. Try reducing the minimum age.");
    } else {
      alert(`✅ Scheduled ${result.generated} reposts!`);
      await _loadStats();
      if (_state.currentTab === "queue") await _loadQueuePosts();
    }

    document.getElementById("repostPreviewResults")?.classList.add("hidden");
    _state.repostPreview = null;
  } catch (err) {
    console.error("Repost error:", err);
    alert("Failed to generate reposts: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Repost Now";
  }
}

async function confirmRepost() {
  if (!_state.repostPreview?.length) {
    alert("No preview data. Please preview first.");
    return;
  }
  if (!confirm(`Schedule ${_state.repostPreview.length} reposts now?`)) return;
  await generateRepost();
}

function renderRepostPreview(posts) {
  const container = document.getElementById("repostPreviewResults");
  const list = document.getElementById("repostPreviewList");

  if (!posts?.length) {
    container?.classList.add("hidden");
    return;
  }

  container?.classList.remove("hidden");

  list.innerHTML = posts.map((post) => {
    const schedDate = new Date(post.scheduled_for);
    const dateStr = schedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeStr = schedDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const thumb = post.catalog_image_url || post.resolved_image_url || "/imgs/placeholder.jpg";

    return `
      <div class="p-4 flex gap-4">
        <div class="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 relative">
          <img src="${escapeHtml(thumb)}" alt="${escapeHtml(post.product_name)}"
               class="w-full h-full object-cover"
               onerror="this.src='/imgs/placeholder.jpg'">
          <div class="absolute top-0 right-0 bg-orange-500 text-white text-xs px-1 rounded-bl">🔄</div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-medium px-2 py-0.5 rounded-full ${post.platform === "instagram" ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white" : post.platform === "facebook" ? "bg-blue-600 text-white" : "bg-pinterest text-white"}">${escapeHtml(post.platform)}</span>
            <span class="text-xs text-gray-500">${dateStr} at ${timeStr}</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">Repost</span>
          </div>
          <div class="font-medium text-sm truncate">${escapeHtml(post.product_name)}</div>
          <div class="text-xs text-gray-500 mt-1 line-clamp-2">${escapeHtml(post.caption)}</div>
        </div>
      </div>
    `;
  }).join("");
}

export async function loadAutoQueueStats() {
  try {
    const client = getSupabaseClient();

    const { count: total } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null);

    const { count: neverPosted } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null)
      .is("last_social_post_at", null);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { count: ready } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null)
      .or(`last_social_post_at.is.null,last_social_post_at.lt.${fourteenDaysAgo.toISOString()}`);

    const recent = (total || 0) - (ready || 0);

    if (_els.aqStatTotal) _els.aqStatTotal.textContent = total || 0;
    if (_els.aqStatNeverPosted) _els.aqStatNeverPosted.textContent = neverPosted || 0;
    if (_els.aqStatReady) _els.aqStatReady.textContent = ready || 0;
    if (_els.aqStatRecent) _els.aqStatRecent.textContent = recent;
  } catch (err) {
    console.error("Failed to load auto-queue stats:", err);
  }
}
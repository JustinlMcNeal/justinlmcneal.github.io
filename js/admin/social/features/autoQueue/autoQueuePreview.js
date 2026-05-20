// Auto-queue preview rendering (posts, skipped, comparison, metadata)

import { escapeHtml } from "../../utils/html.js";
import { formatScheduleDate, formatScheduleTime } from "../../utils/dates.js";
import { getAutoQueueContext } from "./autoQueueContext.js";

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
    no_approved_image_pool_asset: "No approved Image Pool asset",
    no_default_pinterest_board: "No default Pinterest board",
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
  if (meta.asset_policy) {
    lines.push(`Asset policy: <span class="font-mono">${escapeHtml(meta.asset_policy)}</span>`);
  }
  if (meta.asset_content_type) {
    lines.push(`Content type: ${escapeHtml(meta.asset_content_type)}`);
  }
  if (post.platform === "pinterest" && meta.pinterest_board_id) {
    lines.push(
      `Pinterest board: ${escapeHtml(meta.pinterest_board_name || meta.pinterest_board_id)} ` +
      `(${escapeHtml(meta.board_routing_method || "")}${meta.board_routing_warning ? ", " + escapeHtml(String(meta.board_routing_warning).replace(/_/g, " ")) : ""})`
    );
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
    ? ` · ${runSummary.pending_queue_blocked || 0} blocked by pending queue` +
      (runSummary.no_pool_asset_skipped
        ? ` · ${runSummary.no_pool_asset_skipped} no Image Pool asset`
        : "")
    : "";
  const policyBanner =
    runSummary?.image_asset_policy === "image_pool_only"
      ? `<p class="text-[11px] text-amber-900 mt-1">Catalog/gallery fallback is disabled — only Image Pool assets are used for standard auto-posting.</p>`
      : "";
  return `
    <div class="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs">
      <p class="font-medium text-amber-900">Skipped ${skipped.length} product(s)${summary}</p>
      ${policyBanner}
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
    parts.push('<span class="text-amber-700">one platform/product (round-robin)</span>');
  }
  const dist = settingsUsed.platform_distribution;
  if (dist && typeof dist === "object" && Object.keys(dist).length) {
    const distStr = Object.entries(dist)
      .map(([plat, n]) => `${plat} ${n}`)
      .join(", ");
    parts.push(`dist <strong>${escapeHtml(distStr)}</strong>`);
  }
  return parts.join(" · ");
}

export function renderAutoQueuePreview(posts, settingsUsed, skippedProducts, runSummary, scoringComparison, compareEnabled) {
  const { els } = getAutoQueueContext();
  const skipped = skippedProducts || [];

  if (!posts?.length && !skipped.length) {
    els.aqPreviewResults?.classList.add("hidden");
    return;
  }

  els.aqPreviewResults?.classList.remove("hidden");

  const settingsNote = settingsUsed
    ? `<p class="text-xs text-gray-500 px-4 py-2 bg-gray-50 border-b">Run: ${formatPreviewRunBanner(
        { ...settingsUsed, ...(runSummary || {}) },
        compareEnabled
      )}</p>`
    : "";

  const skippedBlock = renderSkippedPreview(skipped, runSummary);
  const comparisonBlock = renderScoringComparisonPanel(scoringComparison);

  const postsHtml = (posts || []).map((post) => {
    const schedDate = new Date(post.scheduled_for);
    const dateStr = formatScheduleDate(schedDate);
    const timeStr = formatScheduleTime(schedDate);
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

  els.aqPreviewList.innerHTML = settingsNote + comparisonBlock + skippedBlock + postsHtml;
}

export function renderRepostPreview(posts) {
  const container = document.getElementById("repostPreviewResults");
  const list = document.getElementById("repostPreviewList");

  if (!posts?.length) {
    container?.classList.add("hidden");
    return;
  }

  container?.classList.remove("hidden");

  list.innerHTML = posts.map((post) => {
    const schedDate = new Date(post.scheduled_for);
    const dateStr = formatScheduleDate(schedDate);
    const timeStr = formatScheduleTime(schedDate);
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

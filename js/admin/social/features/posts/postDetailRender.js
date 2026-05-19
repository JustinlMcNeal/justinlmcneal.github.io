// Post detail modal — carousel and selection metadata rendering

import { getPublicUrl } from "../../api.js";
import { formatHashtags } from "../../captions.js";
import { isPostedSuccessStatus } from "../../postStatus.js";
import { escapeHtml } from "../../utils/html.js";
import { getPostsContext } from "./postsContext.js";

let _carouselImages = [];
let _carouselIndex = 0;

export function navigateCarousel(dir) {
  if (_carouselImages.length <= 1) return;
  _carouselIndex = (_carouselIndex + dir + _carouselImages.length) % _carouselImages.length;
  renderCarouselSlide();
}

export function renderCarouselSlide() {
  const { els } = getPostsContext();
  els.postDetailImage.src = _carouselImages[_carouselIndex];
  const countEl = document.getElementById("postDetailImageCount");
  if (countEl) countEl.textContent = `${_carouselIndex + 1} / ${_carouselImages.length}`;
  const dotsEl = document.getElementById("postDetailDots");
  if (dotsEl) {
    dotsEl.innerHTML = _carouselImages.map((_, i) =>
      `<span class="w-2 h-2 rounded-full ${i === _carouselIndex ? "bg-white" : "bg-white/50"} transition-colors cursor-pointer" data-idx="${i}"></span>`
    ).join("");
    dotsEl.onclick = (e) => {
      const dot = e.target.closest("[data-idx]");
      if (dot) { _carouselIndex = parseInt(dot.dataset.idx); renderCarouselSlide(); }
    };
  }
}

export function renderPostDetailSelection(post) {
  const el = document.getElementById("postDetailSelection");
  if (!el) return;

  const meta = post.selection_metadata && typeof post.selection_metadata === "object"
    ? post.selection_metadata
    : {};
  const breakdown = meta.score_breakdown;
  const priority = post.priority_score ?? meta.priority_score;
  const hasContent = post.image_source || priority != null || Object.keys(meta).length > 0;

  if (!hasContent) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }

  const lines = [];
  if (meta.is_resurfaced || post.image_source === "resurface") {
    lines.push("<div><span class=\"font-medium text-orange-700\">Resurfaced</span></div>");
  }
  if (meta.final_reason_summary) {
    lines.push(`<div><span class="text-gray-500">Why selected:</span> ${escapeHtml(meta.final_reason_summary)}</div>`);
  }
  if (meta.top_boost) {
    lines.push(`<div><span class="text-gray-500">Top boost:</span> ${escapeHtml(String(meta.top_boost).replace(/_/g, " "))}</div>`);
  }
  if (meta.top_penalty) {
    lines.push(`<div><span class="text-gray-500">Top penalty:</span> ${escapeHtml(String(meta.top_penalty).replace(/_/g, " "))}</div>`);
  }
  if (priority != null) {
    lines.push(`<div><span class="text-gray-500">Priority score:</span> <strong>${Number(priority).toFixed(1)}</strong></div>`);
  }
  if (post.image_source) {
    lines.push(`<div><span class="text-gray-500">Image source:</span> <span class="font-mono">${escapeHtml(post.image_source)}</span></div>`);
  }
  if (meta.reason || meta.selection_reason) {
    lines.push(`<div><span class="text-gray-500">Reason:</span> ${escapeHtml(meta.reason || meta.selection_reason)}</div>`);
  }
  if (breakdown) {
    lines.push(
      `<div><span class="text-gray-500">Score breakdown:</span> ` +
      `recency ${Number(breakdown.recency ?? 0).toFixed(0)}, ` +
      `category ${Number(breakdown.category_perf ?? 0).toFixed(0)}, ` +
      `images ${Number(breakdown.image_freshness ?? 0).toFixed(0)}</div>`
    );
  }
  if (meta.scarcity_guard_applied) {
    lines.push(`<div><span class="text-amber-700 font-medium">Scarcity copy was guarded</span></div>`);
  }
  if (Array.isArray(meta.eligibility_warnings) && meta.eligibility_warnings.length) {
    lines.push(`<div><span class="text-gray-500">Warnings:</span> ${escapeHtml(meta.eligibility_warnings.join(", "))}</div>`);
  }
  if (meta.duplicate_guard_result) {
    lines.push(`<div><span class="text-gray-500">Duplicate guard:</span> ${escapeHtml(meta.duplicate_guard_result)}</div>`);
  }
  if (meta.image_reuse_guard && meta.image_reuse_guard !== "passed") {
    lines.push(`<div><span class="text-gray-500">Image reuse:</span> ${escapeHtml(meta.image_reuse_guard)}</div>`);
  }
  if (meta.inventory_status) {
    lines.push(`<div><span class="text-gray-500">Inventory:</span> ${escapeHtml(meta.inventory_status)}</div>`);
  }
  if (meta.backorder_status && meta.backorder_status !== "not_applicable") {
    lines.push(`<div><span class="text-gray-500">Backorder:</span> ${escapeHtml(meta.backorder_status)}</div>`);
  }
  if (meta.caption_source) {
    lines.push(`<div><span class="text-gray-500">Caption:</span> ${escapeHtml(meta.caption_source)} (${escapeHtml(meta.caption_status || "")})</div>`);
  }

  const detailsHtml = Object.keys(meta).length
    ? `<details class="mt-2"><summary class="text-gray-400 cursor-pointer">Full selection metadata</summary><pre class="text-[10px] text-gray-500 mt-1 overflow-x-auto whitespace-pre-wrap">${escapeHtml(JSON.stringify(meta, null, 2))}</pre></details>`
    : "";

  el.innerHTML = `<div class="font-medium text-gray-700 mb-1">Queue selection</div>${lines.join("")}${detailsHtml}`;
  el.classList.remove("hidden");
}

/**
 * Populate modal fields and show (caller sets state.editingPost).
 */
export function populatePostDetailModal(post) {
  const { state, els } = getPostsContext();

  const mainImageUrl = post.variation?.image_path
    ? getPublicUrl(post.variation.image_path)
    : "/imgs/placeholder.jpg";

  if (post.image_urls?.length > 1) {
    _carouselImages = [...post.image_urls];
  } else {
    _carouselImages = [mainImageUrl];
  }
  _carouselIndex = 0;

  const isCarousel = _carouselImages.length > 1;
  document.getElementById("postDetailPrev")?.classList.toggle("hidden", !isCarousel);
  document.getElementById("postDetailNext")?.classList.toggle("hidden", !isCarousel);
  document.getElementById("postDetailDots")?.classList.toggle("hidden", !isCarousel);
  document.getElementById("postDetailImageCount")?.classList.toggle("hidden", !isCarousel);

  els.postDetailImage.src = _carouselImages[0];
  if (isCarousel) renderCarouselSlide();

  const platformClass = post.platform === "instagram" ? "badge-instagram" : "badge-pinterest";
  els.postDetailPlatform.className = `badge ${platformClass}`;
  els.postDetailPlatform.textContent = `${post.platform === "instagram" ? "📸" : "📌"} ${post.platform}`;

  els.postDetailStatus.className = `badge badge-${post.status}`;
  els.postDetailStatus.textContent = post.status;

  els.postDetailCaption.value = post.caption || "";
  els.postDetailHashtags.value = formatHashtags(post.hashtags || []);

  const scheduledDate = new Date(post.scheduled_for);
  els.postDetailDate.value = scheduledDate.toISOString().split("T")[0];
  els.postDetailTime.value = scheduledDate.toTimeString().substring(0, 5);

  const boardSection = document.getElementById("postDetailBoardSection");
  const boardSelect = document.getElementById("postDetailBoard");
  if (post.platform === "pinterest") {
    boardSection?.classList.remove("hidden");
    if (boardSelect && state.boards?.length) {
      boardSelect.innerHTML = `
        <option value="">Select a board...</option>
        ${state.boards.map(b => `<option value="${b.id}" ${b.id === post.pinterest_board_id ? "selected" : ""}>${b.name}</option>`).join("")}
      `;
    }
  } else {
    boardSection?.classList.add("hidden");
  }

  els.btnPostNow.classList.toggle("hidden", isPostedSuccessStatus(post.status) || post.status === "deleted");

  const viewOnPlatformBtn = document.getElementById("btnViewOnPlatform");
  if (viewOnPlatformBtn) {
    const permalink = post.permalink || post.instagram_permalink;
    if (isPostedSuccessStatus(post.status) && permalink) {
      viewOnPlatformBtn.classList.remove("hidden");
      viewOnPlatformBtn.href = permalink;
      viewOnPlatformBtn.textContent = post.platform === "instagram" ? "📸 View on Instagram"
                                    : post.platform === "pinterest" ? "📌 View on Pinterest"
                                    : post.platform === "facebook" ? "📘 View on Facebook"
                                    : "🔗 View Post";
    } else if (isPostedSuccessStatus(post.status) && post.external_id) {
      viewOnPlatformBtn.classList.remove("hidden");
      if (post.platform === "instagram") {
        viewOnPlatformBtn.href = `https://www.instagram.com/`;
        viewOnPlatformBtn.textContent = "📸 Open Instagram";
      } else {
        viewOnPlatformBtn.classList.add("hidden");
      }
    } else {
      viewOnPlatformBtn.classList.add("hidden");
    }
  }

  renderPostDetailSelection(post);

  const engagementSection = document.getElementById("postDetailEngagement");
  if (engagementSection) {
    if (post.likes !== undefined && post.likes !== null) {
      engagementSection.classList.remove("hidden");
      engagementSection.innerHTML = `
        <div class="flex items-center gap-4 text-sm mt-3 pt-3 border-t">
          <span class="text-pink-500">❤️ ${post.likes || 0}</span>
          <span class="text-blue-500">💬 ${post.comments || 0}</span>
          <span class="text-yellow-500">🔖 ${post.saves || 0}</span>
          <span class="text-green-500">👁️ ${post.impressions || 0}</span>
          <span class="text-purple-500">📊 ${post.engagement_rate || 0}%</span>
        </div>
      `;
    } else {
      engagementSection.classList.add("hidden");
    }
  }

  els.postDetailModal.classList.remove("hidden");
  els.postDetailModal.classList.add("flex");
}

export function closePostDetail() {
  const { state, els } = getPostsContext();
  state.editingPost = null;
  document.getElementById("postDetailSelection")?.classList.add("hidden");
  els.postDetailModal.classList.add("hidden");
  els.postDetailModal.classList.remove("flex");
}

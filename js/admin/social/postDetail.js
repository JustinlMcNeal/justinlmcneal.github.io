// /js/admin/social/postDetail.js
// Post Detail Modal — view/edit/post/delete scheduled posts

import {
  updatePost,
  deletePost,
  recalculateProductPostDate,
  getPublicUrl
} from "./api.js";
import { formatHashtags, parseHashtags } from "./captions.js";

let _state, _els, _showToast, _getClient;
let _postToInstagram, _postToFacebook, _postToPinterest;
let _loadStats, _loadAutoQueueStats, _loadCalendarPosts, _loadQueuePosts, _switchTab;
let _populateBoardDropdown;
let _carouselImages = [];
let _carouselIndex = 0;

export function initPostDetail(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _postToInstagram = deps.postToInstagram;
  _postToFacebook = deps.postToFacebook;
  _postToPinterest = deps.postToPinterest;
  _loadStats = deps.loadStats;
  _loadAutoQueueStats = deps.loadAutoQueueStats;
  _loadCalendarPosts = deps.loadCalendarPosts;
  _loadQueuePosts = deps.loadQueuePosts;
  _switchTab = deps.switchTab;
  _populateBoardDropdown = deps.populateBoardDropdown;
}

export function setupPostDetailModal() {
  _els.btnClosePostDetail?.addEventListener("click", closePostDetail);
  _els.postDetailModal?.addEventListener("click", (e) => {
    if (e.target === _els.postDetailModal) closePostDetail();
  });
  
  _els.btnDeletePost?.addEventListener("click", handleDeletePost);
  _els.btnSavePost?.addEventListener("click", handleSavePost);
  _els.btnPostNow?.addEventListener("click", handlePostNow);

  // Carousel nav
  document.getElementById("postDetailPrev")?.addEventListener("click", () => navigateCarousel(-1));
  document.getElementById("postDetailNext")?.addEventListener("click", () => navigateCarousel(1));
}

function navigateCarousel(dir) {
  if (_carouselImages.length <= 1) return;
  _carouselIndex = (_carouselIndex + dir + _carouselImages.length) % _carouselImages.length;
  renderCarouselSlide();
}

function renderCarouselSlide() {
  _els.postDetailImage.src = _carouselImages[_carouselIndex];
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

export function openPostDetail(post) {
  _state.editingPost = post;
  
  const mainImageUrl = post.variation?.image_path 
    ? getPublicUrl(post.variation.image_path)
    : "/imgs/placeholder.jpg";
  
  // Build carousel image list
  if (post.image_urls?.length > 1) {
    _carouselImages = [...post.image_urls];
  } else {
    _carouselImages = [mainImageUrl];
  }
  _carouselIndex = 0;
  
  // Show/hide carousel controls
  const isCarousel = _carouselImages.length > 1;
  document.getElementById("postDetailPrev")?.classList.toggle("hidden", !isCarousel);
  document.getElementById("postDetailNext")?.classList.toggle("hidden", !isCarousel);
  document.getElementById("postDetailDots")?.classList.toggle("hidden", !isCarousel);
  document.getElementById("postDetailImageCount")?.classList.toggle("hidden", !isCarousel);
  
  _els.postDetailImage.src = _carouselImages[0];
  if (isCarousel) renderCarouselSlide();
  
  const platformClass = post.platform === "instagram" ? "badge-instagram" : "badge-pinterest";
  _els.postDetailPlatform.className = `badge ${platformClass}`;
  _els.postDetailPlatform.textContent = `${post.platform === "instagram" ? "📸" : "📌"} ${post.platform}`;
  
  _els.postDetailStatus.className = `badge badge-${post.status}`;
  _els.postDetailStatus.textContent = post.status;
  
  _els.postDetailCaption.value = post.caption || "";
  _els.postDetailHashtags.value = formatHashtags(post.hashtags || []);
  
  const scheduledDate = new Date(post.scheduled_for);
  _els.postDetailDate.value = scheduledDate.toISOString().split("T")[0];
  _els.postDetailTime.value = scheduledDate.toTimeString().substring(0, 5);
  
  const boardSection = document.getElementById("postDetailBoardSection");
  const boardSelect = document.getElementById("postDetailBoard");
  if (post.platform === "pinterest") {
    boardSection?.classList.remove("hidden");
    if (boardSelect && _state.boards?.length) {
      boardSelect.innerHTML = `
        <option value="">Select a board...</option>
        ${_state.boards.map(b => `<option value="${b.id}" ${b.id === post.pinterest_board_id ? "selected" : ""}>${b.name}</option>`).join("")}
      `;
    }
  } else {
    boardSection?.classList.add("hidden");
  }
  
  _els.btnPostNow.classList.toggle("hidden", post.status === "posted" || post.status === "published" || post.status === "deleted");
  
  const viewOnPlatformBtn = document.getElementById("btnViewOnPlatform");
  if (viewOnPlatformBtn) {
    const permalink = post.permalink || post.instagram_permalink;
    if ((post.status === "posted" || post.status === "published") && permalink) {
      viewOnPlatformBtn.classList.remove("hidden");
      viewOnPlatformBtn.href = permalink;
      viewOnPlatformBtn.textContent = post.platform === "instagram" ? "📸 View on Instagram" 
                                    : post.platform === "pinterest" ? "📌 View on Pinterest"
                                    : post.platform === "facebook" ? "📘 View on Facebook"
                                    : "🔗 View Post";
    } else if ((post.status === "posted" || post.status === "published") && post.external_id) {
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
  
  _els.postDetailModal.classList.remove("hidden");
  _els.postDetailModal.classList.add("flex");
}

function closePostDetail() {
  _state.editingPost = null;
  _els.postDetailModal.classList.add("hidden");
  _els.postDetailModal.classList.remove("flex");
}

async function handleDeletePost() {
  if (!_state.editingPost) return;
  if (!confirm("Delete this post?")) return;
  
  try {
    const productId = _state.editingPost.variation?.asset?.product?.id 
                   || _state.editingPost.variation?.asset?.product_id;
    
    await deletePost(_state.editingPost.id);
    
    if (productId) await recalculateProductPostDate(productId);
    
    closePostDetail();
    await _loadStats();
    
    if (_state.currentTab === "autoqueue") await _loadAutoQueueStats();
    else if (_state.currentTab === "calendar") await _loadCalendarPosts();
    else if (_state.currentTab === "queue") await _loadQueuePosts();
  } catch (err) {
    console.error("Delete post error:", err);
    alert("Failed to delete post");
  }
}

async function handleSavePost() {
  if (!_state.editingPost) return;
  
  try {
    const scheduledFor = new Date(`${_els.postDetailDate.value}T${_els.postDetailTime.value}:00`).toISOString();
    
    const updateData = {
      caption: _els.postDetailCaption.value,
      hashtags: parseHashtags(_els.postDetailHashtags.value),
      scheduled_for: scheduledFor
    };
    
    if (_state.editingPost.platform === "pinterest") {
      const modalBoardSelect = document.getElementById("postDetailBoard");
      if (modalBoardSelect?.value) updateData.pinterest_board_id = modalBoardSelect.value;
    }
    
    await updatePost(_state.editingPost.id, updateData);
    closePostDetail();
    
    if (_state.currentTab === "calendar") await _loadCalendarPosts();
    else if (_state.currentTab === "queue") await _loadQueuePosts();
    
    alert("Post updated!");
  } catch (err) {
    console.error("Save post error:", err);
    alert("Failed to save post");
  }
}

async function handlePostNow() {
  if (!_state.editingPost) return;
  
  const post = _state.editingPost;
  
  let imageUrl = post.image_url;
  if (!imageUrl && post.variation?.image_path) {
    const imagePath = post.variation.image_path;
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      imageUrl = imagePath;
    } else {
      imageUrl = `https://yxdzvzscufkvewecvagq.supabase.co/storage/v1/object/public/social-media/${imagePath}`;
    }
  }
  
  if (!imageUrl) { alert("No image found for this post."); return; }
  
  if (post.platform === "instagram") {
    if (!confirm("Post this to Instagram now?")) return;
    
    const caption = post.caption || "";
    const hashtags = post.hashtags?.join(" ") || "";
    const fullCaption = hashtags ? `${caption}\n\n${hashtags}` : caption;
    
    const result = await _postToInstagram(post.id, imageUrl, fullCaption);
    
    if (result?.success) {
      closePostDetail();
      await new Promise(r => setTimeout(r, 500));
      await _loadStats();
      if (_state.currentTab === "calendar") await _loadCalendarPosts();
      else if (_state.currentTab === "queue") await _loadQueuePosts();
      else await _loadQueuePosts();
    }
  } else if (post.platform === "pinterest") {
    const modalBoardSelect = document.getElementById("postDetailBoard");
    const boardId = modalBoardSelect?.value || post.pinterest_board_id;
    
    if (!boardId) { alert("Please select a Pinterest board."); return; }
    if (!confirm("Post this pin to Pinterest now?")) return;
    
    const result = await _postToPinterest(
      post.id, imageUrl, post.title || "", post.caption || "",
      post.product_url || "", boardId
    );
    
    if (result?.success) {
      _els.postDetailModal?.classList.add("hidden");
      await _loadStats();
      _switchTab(_state.currentTab);
    }
  } else if (post.platform === "facebook") {
    if (!confirm("Post this to Facebook now?")) return;
    
    const caption = post.caption || "";
    const hashtags = post.hashtags?.join(" ") || "";
    const fullCaption = hashtags ? `${caption}\n\n${hashtags}` : caption;
    const linkUrl = post.link_url || post.product_url || null;
    
    const result = await _postToFacebook(post.id, imageUrl, fullCaption, linkUrl);
    
    if (result?.success) {
      closePostDetail();
      await new Promise(r => setTimeout(r, 500));
      await _loadStats();
      if (_state.currentTab === "calendar") await _loadCalendarPosts();
      else if (_state.currentTab === "queue") await _loadQueuePosts();
      else await _loadQueuePosts();
    }
  } else {
    alert(`Posting to ${post.platform} is not supported yet.`);
  }
}

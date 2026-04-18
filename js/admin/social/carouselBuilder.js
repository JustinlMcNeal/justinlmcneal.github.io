// /js/admin/social/carouselBuilder.js
// Carousel Builder — multi-image post creation

import { fetchProductGalleryImages, getPublicUrl } from "./api.js";
import { generateCaption, getHashtagsForProduct, formatHashtags } from "./captions.js";
import { getCategoryInsights } from "./postLearning.js";
import { getSupabaseClient } from "../../shared/supabaseClient.js";

let _state, _els, _showToast, _getClient;

export function initCarouselBuilder(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
}

// ─── Engagement Score (shared) ───

export async function calculateEngagementScore({ caption, hashtags, imageCount = 1, isCarousel = false, productId, scheduleTime }) {
  let score = 50;
  const tips = [];

  const captionLen = caption.length;
  if (captionLen === 0) { score -= 20; tips.push("Add a caption for better engagement"); }
  else if (captionLen >= 100 && captionLen <= 300) score += 15;
  else if (captionLen > 300 && captionLen <= 500) score += 10;
  else if (captionLen > 1000) { score -= 5; tips.push("Long captions may reduce engagement"); }

  const emojiCount = (caption.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu) || []).length;
  if (emojiCount >= 1 && emojiCount <= 5) score += 8;
  else if (emojiCount > 10) { score -= 5; tips.push("Too many emojis can reduce engagement"); }
  else if (emojiCount === 0) tips.push("Add 1-3 emojis for better visibility");

  const hashtagList = hashtags.match(/#\w+/g) || [];
  const hashtagCount = hashtagList.length;
  if (hashtagCount === 0) { score -= 15; tips.push("Add hashtags for discoverability"); }
  else if (hashtagCount >= 3 && hashtagCount <= 10) score += 15;
  else if (hashtagCount > 20) { score -= 10; tips.push("Too many hashtags looks spammy"); }

  if (isCarousel && imageCount >= 2) { score += 10; if (imageCount >= 5) score += 5; }

  const ctaPatterns = /\b(shop|buy|get|grab|check out|link|tap|click|swipe|comment|tag|share|save)\b/i;
  if (ctaPatterns.test(caption)) score += 10;
  else tips.push("Add a call-to-action (shop now, link in bio, etc.)");

  if (caption.includes("?")) score += 5;

  if (scheduleTime) {
    const hour = parseInt(scheduleTime.split(":")[0]);
    if ((hour >= 5 && hour <= 9) || (hour >= 12 && hour <= 14) || (hour >= 19 && hour <= 21)) score += 8;
  }

  score = Math.max(10, Math.min(100, score));
  const bestTip = tips.length > 0 ? tips[0] : "Looking good! Ready to post.";
  return { score, tips, bestTip };
}

export function updateEngagementScoreUI(container, valueEl, labelEl, tipEl, { score, bestTip }) {
  if (!container || !valueEl) return;
  valueEl.textContent = score;
  container.classList.remove("score-low", "score-medium", "score-high");
  if (score >= 75) { container.classList.add("score-high"); labelEl.textContent = "🔥 High Engagement Potential"; }
  else if (score >= 50) { container.classList.add("score-medium"); labelEl.textContent = "📈 Good Engagement Potential"; }
  else { container.classList.add("score-low"); labelEl.textContent = "⚠️ Low Engagement Potential"; }
  tipEl.textContent = bestTip;
}

// ─── Helpers shared with upload modal ───

export function triggerInputEvent(element) {
  if (element) element.dispatchEvent(new Event("input", { bubbles: true }));
}

export function updatePostCountersAndScore() {
  const captionEl = document.getElementById("captionText");
  const hashtagsEl = document.getElementById("hashtagText");
  triggerInputEvent(captionEl);
  triggerInputEvent(hashtagsEl);
  setTimeout(() => calculatePostEngagementScore(), 100);
}

export function updateCarouselCountersAndScore() {
  const captionEl = document.getElementById("carouselCaption");
  const hashtagsEl = document.getElementById("carouselHashtags");
  triggerInputEvent(captionEl);
  triggerInputEvent(hashtagsEl);
  setTimeout(() => calculateCarouselEngagementScore(), 100);
}

export async function calculatePostEngagementScore() {
  const scoreEl = document.getElementById("postEngagementScore");
  const scoreValue = document.getElementById("postScoreValue");
  const scoreLabel = document.getElementById("postScoreLabel");
  const scoreTip = document.getElementById("postScoreTip");
  const scoreContainer = scoreEl?.querySelector(".engagement-score");
  if (!scoreEl) return;

  const caption = document.getElementById("captionText")?.value || "";
  const hashtags = document.getElementById("hashtagText")?.value || "";
  const scheduleTime = document.getElementById("scheduleTime")?.value || "12:00";

  scoreValue.textContent = "...";
  try {
    const score = await calculateEngagementScore({ caption, hashtags, imageCount: 1, isCarousel: false, productId: _state.uploadData?.productId, scheduleTime });
    updateEngagementScoreUI(scoreContainer, scoreValue, scoreLabel, scoreTip, score);
  } catch (err) {
    console.error("[Post] Score calculation error:", err);
    scoreValue.textContent = "?";
    scoreLabel.textContent = "Unable to calculate";
    scoreTip.textContent = "Try refreshing";
  }
}

// ─── Carousel Setup ───

let carouselDraggedIdx = null;
let previewCurrentIdx = 0;
let carouselScoreTimeout = null;

export function setupCarouselBuilder() {
  const dropZone = document.getElementById("carouselDropZone");
  const fileInput = document.getElementById("carouselFileInput");
  const btnNew = document.getElementById("btnNewCarousel");
  const btnClear = document.getElementById("btnClearCarousel");
  const btnPreview = document.getElementById("btnPreviewCarousel");
  const btnSchedule = document.getElementById("btnScheduleCarousel");
  const btnRegenerateCaption = document.getElementById("btnRegenerateCarouselCaption");
  const productSearch = document.getElementById("carouselProductSearch");
  const productDropdown = document.getElementById("carouselProductDropdown");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateInput = document.getElementById("carouselScheduleDate");
  if (dateInput) {
    dateInput.value = tomorrow.toISOString().split("T")[0];
    _state.carousel.scheduleDate = dateInput.value;
  }

  dropZone?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => handleCarouselFiles(e.target.files));

  dropZone?.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("border-purple-500", "bg-purple-50"); });
  dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("border-purple-500", "bg-purple-50"));
  dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-purple-500", "bg-purple-50");
    handleCarouselFiles(e.dataTransfer.files);
  });

  btnNew?.addEventListener("click", resetCarouselBuilder);
  btnClear?.addEventListener("click", () => {
    _state.carousel.images.forEach(img => { if (img.previewUrl) URL.revokeObjectURL(img.previewUrl); });
    _state.carousel.images = [];
    updateCarouselUI();
  });
  btnPreview?.addEventListener("click", previewCarousel);
  btnSchedule?.addEventListener("click", scheduleCarousel);
  btnRegenerateCaption?.addEventListener("click", regenerateCarouselCaption);

  document.querySelectorAll(".carousel-tone-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".carousel-tone-btn").forEach(b => b.classList.remove("bg-purple-100", "border-purple-300"));
      btn.classList.add("bg-purple-100", "border-purple-300");
      _state.carousel.tone = btn.dataset.carouselTone;
      regenerateCarouselCaption();
    });
  });

  productSearch?.addEventListener("focus", () => showCarouselProductDropdown(""));
  productSearch?.addEventListener("click", () => showCarouselProductDropdown(productSearch.value));
  productSearch?.addEventListener("input", (e) => showCarouselProductDropdown(e.target.value));

  document.addEventListener("click", (e) => {
    if (!productSearch?.contains(e.target) && !productDropdown?.contains(e.target)) {
      productDropdown?.classList.add("hidden");
    }
  });

  setupCarouselProductClear();
  setupCarouselPreviewModal();
  setupCarouselCounters();
}

function showCarouselProductDropdown(searchQuery = "") {
  const productDropdown = document.getElementById("carouselProductDropdown");
  const query = searchQuery.toLowerCase().trim();
  let matches;
  if (query.length === 0) matches = _state.products.slice(0, 15);
  else matches = _state.products.filter(p => (p.name || p.title || "").toLowerCase().includes(query)).slice(0, 10);

  if (matches.length === 0) {
    productDropdown.innerHTML = `<div class="p-3 text-center text-gray-400 text-sm">No products found</div>`;
    productDropdown?.classList.remove("hidden");
    return;
  }

  productDropdown.innerHTML = matches.map(p => `
    <div class="p-3 hover:bg-purple-50 cursor-pointer flex items-center gap-3 carousel-product-option" data-id="${p.id}" data-title="${p.name || p.title}">
      <img src="${p.catalog_image_url || p.images?.[0] || '/imgs/placeholder.png'}" class="w-10 h-10 object-cover rounded">
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm truncate">${p.name || p.title}</div>
        <div class="text-xs text-gray-400">${p.slug || p.handle || ""}</div>
      </div>
    </div>
  `).join("");
  productDropdown?.classList.remove("hidden");

  document.querySelectorAll(".carousel-product-option").forEach(opt => {
    opt.addEventListener("click", () => {
      const productSearch = document.getElementById("carouselProductSearch");
      _state.carousel.productId = opt.dataset.id;
      document.getElementById("carouselProductId").value = opt.dataset.id;
      document.getElementById("carouselSelectedProductName").textContent = opt.dataset.title;
      document.getElementById("carouselSelectedProduct").classList.remove("hidden");
      if (productSearch) productSearch.value = "";
      productDropdown?.classList.add("hidden");
      regenerateCarouselCaption();
      loadCarouselProductImages(opt.dataset.id);
    });
  });
}

function setupCarouselProductClear() {
  document.getElementById("btnClearCarouselProduct")?.addEventListener("click", () => {
    _state.carousel.productId = null;
    document.getElementById("carouselProductId").value = "";
    document.getElementById("carouselSelectedProduct").classList.add("hidden");
    document.getElementById("carouselProductImages")?.classList.add("hidden");
    _state.carousel.productGalleryImages = [];
  });

  document.getElementById("btnAddAllProductImages")?.addEventListener("click", () => addAllProductImagesToCarousel());

  document.getElementById("carouselCaption")?.addEventListener("input", (e) => { _state.carousel.caption = e.target.value; });
  document.getElementById("carouselHashtags")?.addEventListener("input", (e) => { _state.carousel.hashtags = e.target.value; });
  document.getElementById("carouselScheduleDate")?.addEventListener("change", (e) => { _state.carousel.scheduleDate = e.target.value; });
  document.getElementById("carouselScheduleTime")?.addEventListener("change", (e) => { _state.carousel.scheduleTime = e.target.value; });
}

async function loadCarouselProductImages(productId) {
  const container = document.getElementById("carouselProductImages");
  const grid = document.getElementById("productImagesGrid");
  const loading = document.getElementById("productImagesLoading");
  const empty = document.getElementById("productImagesEmpty");
  const suggestion = document.getElementById("productImagesSuggestion");
  if (!container || !grid) return;

  container.classList.remove("hidden");
  loading?.classList.remove("hidden");
  empty?.classList.add("hidden");
  suggestion?.classList.add("hidden");
  grid.innerHTML = "";

  try {
    const galleryImages = await fetchProductGalleryImages(productId);
    const product = _state.products.find(p => p.id === productId);
    const allImages = [];
    if (product?.catalog_image_url) allImages.push({ id: 'main', url: product.catalog_image_url, position: 0, isMain: true });
    galleryImages.forEach(img => allImages.push({ id: img.id, url: img.url, position: img.position + 1, isMain: false }));

    loading?.classList.add("hidden");
    if (allImages.length === 0) { empty?.classList.remove("hidden"); return; }

    _state.carousel.productGalleryImages = allImages;
    const suggestionText = generateImageSuggestion(allImages, _state.carousel.images.length);
    if (suggestionText) {
      document.getElementById("productImagesSuggestionText").textContent = suggestionText;
      suggestion?.classList.remove("hidden");
    }
    renderCarouselProductImages(allImages);
  } catch (err) {
    console.error("[Carousel] Error loading product images:", err);
    loading?.classList.add("hidden");
    empty?.classList.remove("hidden");
  }
}

function generateImageSuggestion(images, currentCarouselCount) {
  const remaining = 10 - currentCarouselCount;
  if (images.length === 0) return null;
  if (images.length <= 3) return `Use all ${images.length} images for a complete product showcase!`;
  if (remaining <= 0) return "Carousel is full! Remove some images to add more.";
  const suggested = Math.min(remaining, Math.min(5, images.length));
  if (images.length >= 6) return `Start with the main image + ${suggested - 1} variety shots for best engagement.`;
  return `Add the main image + ${Math.min(suggested - 1, images.length - 1)} angles for a complete look!`;
}

function renderCarouselProductImages(images) {
  const grid = document.getElementById("productImagesGrid");
  if (!grid) return;

  const existingUrls = new Set(_state.carousel.images.filter(img => img.productGalleryUrl).map(img => img.productGalleryUrl));
  grid.innerHTML = images.map((img, idx) => {
    const isSelected = existingUrls.has(img.url);
    const position = isSelected ? getCarouselPositionForUrl(img.url) : null;
    return `
      <div class="carousel-product-img ${isSelected ? 'selected' : ''} ${idx === 0 ? 'ai-suggested' : ''}" data-url="${img.url}" data-id="${img.id}" data-is-main="${img.isMain}">
        <img src="${img.url}" alt="Product image ${idx + 1}" loading="lazy">
        <div class="check-overlay"><svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></div>
        ${position !== null ? `<span class="position-badge">#${position + 1}</span>` : ''}
        ${img.isMain ? '<span class="absolute top-1 left-1 text-xs bg-purple-600 text-white px-1 rounded">Main</span>' : ''}
      </div>
    `;
  }).join("");

  grid.querySelectorAll(".carousel-product-img").forEach(el => {
    el.addEventListener("click", () => toggleProductImageInCarousel(el));
  });
}

function getCarouselPositionForUrl(url) {
  return _state.carousel.images.findIndex(img => img.productGalleryUrl === url);
}

async function toggleProductImageInCarousel(element) {
  const url = element.dataset.url;
  const isSelected = element.classList.contains("selected");
  if (isSelected) {
    const idx = _state.carousel.images.findIndex(img => img.productGalleryUrl === url);
    if (idx !== -1) {
      if (_state.carousel.images[idx].previewUrl && !_state.carousel.images[idx].productGalleryUrl) URL.revokeObjectURL(_state.carousel.images[idx].previewUrl);
      _state.carousel.images.splice(idx, 1);
    }
  } else {
    if (_state.carousel.images.length >= 10) { alert("Maximum 10 images allowed in a carousel"); return; }
    _state.carousel.images.push({ file: null, previewUrl: url, uploadedUrl: url, productGalleryUrl: url });
  }
  updateCarouselUI();
  renderCarouselProductImages(_state.carousel.productGalleryImages);
}

function addAllProductImagesToCarousel() {
  const images = _state.carousel.productGalleryImages || [];
  const remaining = 10 - _state.carousel.images.length;
  if (remaining <= 0) { alert("Carousel is full (10 images max)"); return; }
  const existingUrls = new Set(_state.carousel.images.filter(img => img.productGalleryUrl).map(img => img.productGalleryUrl));
  let added = 0;
  for (const img of images) {
    if (added >= remaining) break;
    if (existingUrls.has(img.url)) continue;
    _state.carousel.images.push({ file: null, previewUrl: img.url, uploadedUrl: img.url, productGalleryUrl: img.url });
    added++;
  }
  if (added > 0) { updateCarouselUI(); renderCarouselProductImages(_state.carousel.productGalleryImages); }
}

async function handleCarouselFiles(files) {
  if (!files || files.length === 0) return;
  const remaining = 10 - _state.carousel.images.length;
  if (remaining <= 0) { alert("Maximum 10 images allowed in a carousel"); return; }
  const filesToAdd = Array.from(files).slice(0, remaining);
  for (const file of filesToAdd) {
    if (!file.type.startsWith("image/")) continue;
    _state.carousel.images.push({ file, previewUrl: URL.createObjectURL(file), uploadedUrl: null });
  }
  updateCarouselUI();
}

function updateCarouselUI() {
  const count = _state.carousel.images.length;
  const countEl = document.getElementById("carouselImageCount");
  const previewGrid = document.getElementById("carouselPreviewGrid");
  const imagesContainer = document.getElementById("carouselImages");
  const statusEl = document.getElementById("carouselStatus");
  const btnPreview = document.getElementById("btnPreviewCarousel");
  const btnSchedule = document.getElementById("btnScheduleCarousel");

  if (countEl) countEl.textContent = `${count}/10 images`;

  if (count > 0) {
    previewGrid?.classList.remove("hidden");
    imagesContainer.innerHTML = _state.carousel.images.map((img, idx) => `
      <div class="carousel-slide relative group aspect-square rounded-lg overflow-hidden border-2 border-gray-200 hover:border-purple-500 transition-all" data-carousel-idx="${idx}" draggable="true">
        ${idx === 0 ? '<div class="cover-badge">📸 COVER</div>' : ''}
        <img src="${img.previewUrl}" class="w-full h-full object-cover cursor-pointer carousel-preview-trigger" data-idx="${idx}">
        <div class="absolute top-1 left-1 w-6 h-6 bg-black/70 text-white text-xs rounded-full flex items-center justify-center font-bold">${idx + 1}</div>
        <button class="carousel-remove-btn absolute top-1 right-1 w-6 h-6 bg-red-500 text-white text-xs rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600" data-idx="${idx}">✕</button>
        <div class="move-buttons">
          <button class="move-btn move-left" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>◀</button>
          <button class="move-btn move-right" data-idx="${idx}" ${idx === count - 1 ? 'disabled' : ''}>▶</button>
        </div>
      </div>
    `).join("");

    setupCarouselDragAndDrop();

    document.querySelectorAll(".carousel-remove-btn").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); removeCarouselImage(parseInt(btn.dataset.idx)); });
    });
    document.querySelectorAll(".move-left").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); const idx = parseInt(btn.dataset.idx); if (idx > 0) moveCarouselImage(idx, idx - 1); });
    });
    document.querySelectorAll(".move-right").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); const idx = parseInt(btn.dataset.idx); if (idx < _state.carousel.images.length - 1) moveCarouselImage(idx, idx + 1); });
    });
    document.querySelectorAll(".carousel-preview-trigger").forEach(img => {
      img.addEventListener("click", (e) => { e.stopPropagation(); openCarouselImagePreview(parseInt(img.dataset.idx)); });
    });
  } else {
    previewGrid?.classList.add("hidden");
  }

  const isValid = count >= 2;
  if (statusEl) {
    if (count === 0) statusEl.textContent = "Add at least 2 images to create a carousel";
    else if (count === 1) statusEl.textContent = "Add 1 more image (minimum 2 required)";
    else { statusEl.textContent = `✓ Ready to schedule (${count} images)`; statusEl.classList.add("text-green-600"); }
    if (!isValid) statusEl.classList.remove("text-green-600");
  }

  if (btnPreview) btnPreview.disabled = !isValid;
  if (btnSchedule) btnSchedule.disabled = !isValid;

  if (_state.carousel.productGalleryImages?.length > 0) renderCarouselProductImages(_state.carousel.productGalleryImages);
}

function setupCarouselDragAndDrop() {
  document.querySelectorAll(".carousel-slide").forEach(slide => {
    slide.addEventListener("dragstart", handleDragStart);
    slide.addEventListener("dragend", handleDragEnd);
    slide.addEventListener("dragover", handleDragOver);
    slide.addEventListener("dragenter", handleDragEnter);
    slide.addEventListener("dragleave", handleDragLeave);
    slide.addEventListener("drop", handleDrop);
  });
}

function handleDragStart(e) {
  carouselDraggedIdx = parseInt(this.dataset.carouselIdx);
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", carouselDraggedIdx);
}
function handleDragEnd() { this.classList.remove("dragging"); document.querySelectorAll(".carousel-slide").forEach(s => s.classList.remove("drag-over")); }
function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
function handleDragEnter(e) { e.preventDefault(); if (parseInt(this.dataset.carouselIdx) !== carouselDraggedIdx) this.classList.add("drag-over"); }
function handleDragLeave() { this.classList.remove("drag-over"); }
function handleDrop(e) {
  e.preventDefault();
  this.classList.remove("drag-over");
  const fromIdx = carouselDraggedIdx;
  const toIdx = parseInt(this.dataset.carouselIdx);
  if (fromIdx !== toIdx && fromIdx !== null) moveCarouselImage(fromIdx, toIdx);
  carouselDraggedIdx = null;
}

function moveCarouselImage(fromIdx, toIdx) {
  const [moved] = _state.carousel.images.splice(fromIdx, 1);
  _state.carousel.images.splice(toIdx, 0, moved);
  updateCarouselUI();
}

function removeCarouselImage(idx) {
  const img = _state.carousel.images[idx];
  if (img?.previewUrl && !img.productGalleryUrl) URL.revokeObjectURL(img.previewUrl);
  _state.carousel.images.splice(idx, 1);
  updateCarouselUI();
}

function openCarouselImagePreview(idx) {
  previewCurrentIdx = idx;
  const modal = document.getElementById("carouselImagePreviewModal");
  const img = document.getElementById("carouselPreviewImage");
  const indexEl = document.getElementById("carouselPreviewIndex");
  const totalEl = document.getElementById("carouselPreviewTotal");
  if (!modal || !img) return;
  img.src = _state.carousel.images[idx].previewUrl;
  indexEl.textContent = idx + 1;
  totalEl.textContent = _state.carousel.images.length;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeCarouselImagePreview() {
  const modal = document.getElementById("carouselImagePreviewModal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
}

function navigateCarouselPreview(direction) {
  const newIdx = previewCurrentIdx + direction;
  if (newIdx >= 0 && newIdx < _state.carousel.images.length) openCarouselImagePreview(newIdx);
}

function setupCarouselPreviewModal() {
  document.getElementById("btnCloseImagePreview")?.addEventListener("click", closeCarouselImagePreview);
  document.getElementById("btnPrevImagePreview")?.addEventListener("click", () => navigateCarouselPreview(-1));
  document.getElementById("btnNextImagePreview")?.addEventListener("click", () => navigateCarouselPreview(1));
  document.getElementById("carouselImagePreviewModal")?.addEventListener("click", (e) => {
    if (e.target.id === "carouselImagePreviewModal") closeCarouselImagePreview();
  });
  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("carouselImagePreviewModal");
    if (modal?.classList.contains("hidden")) return;
    if (e.key === "Escape") closeCarouselImagePreview();
    if (e.key === "ArrowLeft") navigateCarouselPreview(-1);
    if (e.key === "ArrowRight") navigateCarouselPreview(1);
  });
}

function setupCarouselCounters() {
  const captionEl = document.getElementById("carouselCaption");
  const hashtagsEl = document.getElementById("carouselHashtags");
  const captionCountEl = document.getElementById("carouselCaptionCount");
  const hashtagCountEl = document.getElementById("carouselHashtagCount");

  const updateCaptionCount = () => {
    const len = captionEl?.value?.length || 0;
    if (captionCountEl) {
      captionCountEl.textContent = `${len}/2200`;
      captionCountEl.classList.remove("count-warning", "count-error");
      if (len > 2000) captionCountEl.classList.add("count-warning");
      if (len > 2200) captionCountEl.classList.add("count-error");
    }
    debounceCarouselScore();
  };

  const updateHashtagCount = () => {
    const hashtags = hashtagsEl?.value?.match(/#\w+/g) || [];
    const count = hashtags.length;
    if (hashtagCountEl) {
      hashtagCountEl.textContent = `${count}/30 tags`;
      hashtagCountEl.classList.remove("count-warning", "count-error");
      if (count > 25) hashtagCountEl.classList.add("count-warning");
      if (count > 30) hashtagCountEl.classList.add("count-error");
    }
    debounceCarouselScore();
  };

  captionEl?.addEventListener("input", updateCaptionCount);
  hashtagsEl?.addEventListener("input", updateHashtagCount);
  setTimeout(() => { updateCaptionCount(); updateHashtagCount(); }, 100);
  document.getElementById("btnGenerateCarouselHashtags")?.addEventListener("click", generateCarouselHashtags);
  document.getElementById("btnRefreshCarouselScore")?.addEventListener("click", calculateCarouselEngagementScore);
}

function debounceCarouselScore() {
  clearTimeout(carouselScoreTimeout);
  carouselScoreTimeout = setTimeout(() => calculateCarouselEngagementScore(), 1000);
}

async function calculateCarouselEngagementScore() {
  const scoreEl = document.getElementById("carouselEngagementScore");
  const scoreValue = document.getElementById("carouselScoreValue");
  const scoreLabel = document.getElementById("carouselScoreLabel");
  const scoreTip = document.getElementById("carouselScoreTip");
  const scoreContainer = scoreEl?.querySelector(".engagement-score");
  if (!scoreEl) return;

  const caption = document.getElementById("carouselCaption")?.value || "";
  const hashtags = document.getElementById("carouselHashtags")?.value || "";
  const imageCount = _state.carousel.images.length;
  if (!caption && imageCount === 0) { scoreEl.classList.add("hidden"); return; }

  scoreEl.classList.remove("hidden");
  scoreValue.textContent = "...";
  try {
    const score = await calculateEngagementScore({ caption, hashtags, imageCount, isCarousel: true, productId: _state.carousel.productId, scheduleTime: _state.carousel.scheduleTime });
    updateEngagementScoreUI(scoreContainer, scoreValue, scoreLabel, scoreTip, score);
  } catch (err) {
    console.error("[Carousel] Score calculation error:", err);
    scoreValue.textContent = "?";
    scoreLabel.textContent = "Unable to calculate";
    scoreTip.textContent = "Try refreshing";
  }
}

async function generateCarouselHashtags() {
  const btn = document.getElementById("btnGenerateCarouselHashtags");
  const hashtagsEl = document.getElementById("carouselHashtags");
  if (!btn || !hashtagsEl) return;

  const originalText = btn.textContent;
  btn.textContent = "⏳ Generating...";
  btn.disabled = true;

  try {
    const product = _state.carousel.productId ? _state.products.find(p => p.id === _state.carousel.productId) : null;
    const category = product?.category_id ? _state.categories.find(c => c.id === product.category_id) : null;
    const productInfo = product ? { name: product.name, category: category?.name || "accessories" } : { name: "fashion item", category: "accessories" };

    const response = await fetch(`${window.ENV?.SUPABASE_URL}/functions/v1/ai-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${window.ENV?.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ type: "hashtags", productName: productInfo.name, productCategory: productInfo.category, platform: "instagram" })
    });
    const data = await response.json();
    if (data.hashtags) { hashtagsEl.value = data.hashtags; hashtagsEl.dispatchEvent(new Event("input")); _state.carousel.hashtags = data.hashtags; }
  } catch (err) {
    console.error("[Carousel] Failed to generate hashtags:", err);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function resetCarouselBuilder() {
  _state.carousel.images.forEach(img => { if (img.previewUrl && !img.productGalleryUrl) URL.revokeObjectURL(img.previewUrl); });
  _state.carousel = { images: [], productId: null, productGalleryImages: [], tone: "casual", caption: "", hashtags: "", scheduleDate: null, scheduleTime: "12:00" };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const schedDateEl = document.getElementById("carouselScheduleDate");
  const schedTimeEl = document.getElementById("carouselScheduleTime");
  const captionEl = document.getElementById("carouselCaption");
  const hashtagsEl = document.getElementById("carouselHashtags");
  const searchEl = document.getElementById("carouselProductSearch");
  const selectedEl = document.getElementById("carouselSelectedProduct");
  const fileEl = document.getElementById("carouselFileInput");
  const productImagesEl = document.getElementById("carouselProductImages");

  if (schedDateEl) schedDateEl.value = tomorrow.toISOString().split("T")[0];
  if (schedTimeEl) schedTimeEl.value = "12:00";
  if (captionEl) captionEl.value = "";
  if (hashtagsEl) hashtagsEl.value = "#karrykraze #carousel #fashion";
  if (searchEl) searchEl.value = "";
  if (selectedEl) selectedEl.classList.add("hidden");
  if (productImagesEl) productImagesEl.classList.add("hidden");
  if (fileEl) fileEl.value = "";

  document.querySelectorAll(".carousel-tone-btn").forEach(btn => {
    btn.classList.remove("bg-purple-100", "border-purple-300");
    if (btn.dataset.carouselTone === "casual") btn.classList.add("bg-purple-100", "border-purple-300");
  });

  updateCarouselUI();
}

async function regenerateCarouselCaption() {
  const product = _state.products.find(p => p.id === _state.carousel.productId);
  if (product) await loadCarouselRecommendedTone(product);

  if (!product) {
    document.getElementById("carouselCaption").value = "Check out our latest carousel! 📸✨ Swipe through to see more!\n\nShop now at karrykraze.com";
    document.getElementById("carouselHashtags").value = "#karrykraze #carousel #fashion #shopping";
    updateCarouselCountersAndScore();
    return;
  }

  const productData = {
    product_name: product.name || product.title,
    category: product.category?.name || "item",
    link: `https://karrykraze.com/pages/product.html?slug=${product.slug}`
  };

  try {
    const caption = await generateCaption(_state.carousel.tone, productData);
    const hashtags = await getHashtagsForProduct(product);
    const carouselPrefix = "📸 Swipe to see more! ➡️\n\n";
    document.getElementById("carouselCaption").value = carouselPrefix + caption;
    document.getElementById("carouselHashtags").value = formatHashtags(hashtags);
    _state.carousel.caption = document.getElementById("carouselCaption").value;
    _state.carousel.hashtags = document.getElementById("carouselHashtags").value;
    updateCarouselCountersAndScore();
  } catch (err) {
    console.error("[Carousel] Failed to generate caption:", err);
    document.getElementById("carouselCaption").value = "📸 Swipe to see more! ➡️\n\nCheck out " + (product.name || "this amazing product") + "!\n\nShop now at karrykraze.com";
    updateCarouselCountersAndScore();
  }
}

async function loadCarouselRecommendedTone(product) {
  try {
    const category = product.category?.name || _state.categories.find(c => c.id === product.category_id)?.name;
    if (!category) return;
    const insights = await getCategoryInsights(category);
    if (insights?.caption_strategy?.tone_that_works) {
      const recommendedTone = insights.caption_strategy.tone_that_works.toLowerCase();
      const toneMap = {
        "playful": "playful", "fun": "playful", "casual": "casual", "friendly": "casual",
        "urgent": "urgency", "urgency": "urgency", "professional": "professional",
        "minimal": "minimalist", "minimalist": "minimalist", "value": "value", "deal": "value",
        "trending": "trending", "inspirational": "inspirational", "inspiring": "inspirational"
      };
      const mappedTone = toneMap[recommendedTone] || null;
      if (mappedTone) {
        const recEl = document.getElementById("carouselToneRecommendation");
        const recToneEl = document.getElementById("carouselRecommendedTone");
        if (recEl && recToneEl) { recToneEl.textContent = `${recommendedTone} tone works best for ${category}`; recEl.classList.remove("hidden"); }
        document.querySelectorAll(".carousel-tone-btn").forEach(btn => {
          if (btn.dataset.carouselTone === mappedTone) {
            btn.classList.add("ring-2", "ring-purple-500", "ring-offset-1");
            if (!btn.querySelector(".carousel-ai-badge")) btn.insertAdjacentHTML("beforeend", `<span class="carousel-ai-badge ml-1 text-[10px] bg-purple-500 text-white px-1 rounded">AI</span>`);
          } else {
            btn.classList.remove("ring-2", "ring-purple-500", "ring-offset-1");
            btn.querySelector(".carousel-ai-badge")?.remove();
          }
        });
      }
    }
  } catch (err) { console.warn("[Carousel] Failed to load recommended tone:", err); }
}

function previewCarousel() {
  const images = _state.carousel.images;
  const caption = document.getElementById("carouselCaption").value;
  const hashtags = document.getElementById("carouselHashtags").value;
  let currentSlide = 0;

  const previewHtml = `
    <div class="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4" id="carouselPreviewOverlay">
      <div class="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden">
        <div class="p-4 border-b flex items-center justify-between">
          <h3 class="font-bold">Carousel Preview</h3>
          <button id="btnCloseCarouselPreview" class="p-2 hover:bg-gray-100 rounded-lg">✕</button>
        </div>
        <div class="relative">
          <div class="aspect-square bg-gray-100" id="previewSlideContainer">
            <img id="previewSlideImage" src="${images[0]?.previewUrl}" class="w-full h-full object-cover">
          </div>
          <button id="prevSlide" class="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full shadow flex items-center justify-center hover:bg-white">←</button>
          <button id="nextSlide" class="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full shadow flex items-center justify-center hover:bg-white">→</button>
          <div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5" id="slideDots">
            ${images.map((_, i) => `<div class="w-2 h-2 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/50'} slide-dot" data-idx="${i}"></div>`).join("")}
          </div>
        </div>
        <div class="p-4">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-8 h-8 bg-gradient-to-tr from-purple-500 via-pink-500 to-orange-400 rounded-full"></div>
            <span class="font-bold text-sm">karrykraze</span>
          </div>
          <p class="text-sm whitespace-pre-line">${caption}</p>
          <p class="text-sm text-blue-500 mt-2">${hashtags}</p>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", previewHtml);
  const overlay = document.getElementById("carouselPreviewOverlay");
  const slideImg = document.getElementById("previewSlideImage");
  const dots = document.querySelectorAll(".slide-dot");

  function updateSlide() {
    slideImg.src = images[currentSlide]?.previewUrl;
    dots.forEach((dot, i) => { dot.classList.toggle("bg-white", i === currentSlide); dot.classList.toggle("bg-white/50", i !== currentSlide); });
  }

  document.getElementById("prevSlide")?.addEventListener("click", () => { currentSlide = (currentSlide - 1 + images.length) % images.length; updateSlide(); });
  document.getElementById("nextSlide")?.addEventListener("click", () => { currentSlide = (currentSlide + 1) % images.length; updateSlide(); });
  dots.forEach(dot => dot.addEventListener("click", () => { currentSlide = parseInt(dot.dataset.idx); updateSlide(); }));
  document.getElementById("btnCloseCarouselPreview")?.addEventListener("click", () => overlay?.remove());
  overlay?.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

async function scheduleCarousel() {
  const images = _state.carousel.images;
  const caption = document.getElementById("carouselCaption")?.value || "";
  const hashtags = document.getElementById("carouselHashtags")?.value || "";
  const scheduleDate = document.getElementById("carouselScheduleDate")?.value;
  const scheduleTime = document.getElementById("carouselScheduleTime")?.value || "12:00";

  if (images.length < 2) { alert("Please add at least 2 images for a carousel"); return; }
  if (!scheduleDate) { alert("Please select a schedule date"); return; }

  const btnSchedule = document.getElementById("btnScheduleCarousel");
  btnSchedule.disabled = true;
  btnSchedule.textContent = "Uploading...";

  try {
    const client = getSupabaseClient();
    const uploadedUrls = [];

    for (let i = 0; i < images.length; i++) {
      btnSchedule.textContent = `Uploading ${i + 1}/${images.length}...`;
      const img = images[i];
      const filename = `carousel_${Date.now()}_${i}.${img.file.name.split('.').pop()}`;
      const { data: uploadData, error: uploadError } = await client.storage
        .from("social-media")
        .upload(`carousels/${filename}`, img.file, { contentType: img.file.type, upsert: false });
      if (uploadError) throw new Error(`Failed to upload image ${i + 1}: ${uploadError.message}`);
      const publicUrl = getPublicUrl("social-media", `carousels/${filename}`);
      uploadedUrls.push(publicUrl);
    }

    btnSchedule.textContent = "Scheduling...";
    const fullCaption = caption + (hashtags ? "\n\n" + hashtags : "");
    const scheduledFor = `${scheduleDate}T${scheduleTime}:00`;

    const { data: post, error: postError } = await client
      .from("social_posts")
      .insert({ platform: "instagram", media_type: "carousel", image_url: uploadedUrls[0], image_urls: uploadedUrls, caption: fullCaption, product_id: _state.carousel.productId || null, scheduled_for: scheduledFor, status: "queued" })
      .select().single();
    if (postError) throw new Error(`Failed to create post: ${postError.message}`);

    alert(`🎠 Carousel scheduled for ${new Date(scheduledFor).toLocaleString()}!`);
    resetCarouselBuilder();
    loadRecentCarousels();
  } catch (err) {
    console.error("Failed to schedule carousel:", err);
    alert(`Failed to schedule carousel: ${err.message}`);
  } finally {
    btnSchedule.disabled = false;
    btnSchedule.textContent = "Schedule Carousel";
    updateCarouselUI();
  }
}

export async function loadRecentCarousels() {
  try {
    const client = getSupabaseClient();
    const { data: carousels, error } = await client.from("social_posts").select("*").eq("media_type", "carousel").order("created_at", { ascending: false }).limit(10);
    if (error) throw error;

    const container = document.getElementById("recentCarouselsList");
    if (!container) return;

    if (!carousels || carousels.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-gray-400"><svg class="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg><p>No carousels created yet</p><p class="text-xs mt-1">Build your first multi-image post above</p></div>`;
      return;
    }

    container.innerHTML = carousels.map(c => {
      const date = new Date(c.scheduled_for);
      const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const imageCount = c.image_urls?.length || 1;
      const statusColors = { queued: "bg-blue-100 text-blue-700", posted: "bg-green-100 text-green-700", published: "bg-green-100 text-green-700", failed: "bg-red-100 text-red-700", deleted: "bg-gray-200 text-gray-500 line-through" };
      return `
        <div class="p-4 flex items-center gap-4 hover:bg-gray-50">
          <div class="relative"><img src="${c.image_url}" class="w-16 h-16 object-cover rounded-lg"><div class="absolute -bottom-1 -right-1 bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">${imageCount}</div></div>
          <div class="flex-1 min-w-0"><div class="text-sm font-medium truncate">${c.caption?.substring(0, 50) || "No caption"}...</div><div class="text-xs text-gray-400 mt-1">${dateStr} at ${timeStr} • ${imageCount} slides</div></div>
          <span class="text-xs px-2 py-1 rounded-full ${statusColors[c.status] || "bg-gray-100 text-gray-700"}">${c.status}</span>
        </div>
      `;
    }).join("");
  } catch (err) { console.error("Failed to load recent carousels:", err); }
}

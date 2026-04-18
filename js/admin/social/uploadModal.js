// /js/admin/social/uploadModal.js
// Upload Modal — 3-step post creation flow

import {
  fetchProductGalleryImages,
  createAsset,
  createVariations,
  createPosts,
  uploadImage,
  getPublicUrl
} from "./api.js";
import {
  generateCaption,
  getHashtagsForProduct,
  formatHashtags,
  parseHashtags,
  ensureKarryKrazeTag
} from "./captions.js";
import {
  generateVariations,
  getFilePreviewUrl,
  revokePreviewUrl,
  generateFilename,
  getAssetPath,
  getVariationPath
} from "./imageProcessor.js";
import { getCategoryInsights, getPostCreationTips } from "./postLearning.js";
import { getSupabaseClient } from "../../shared/supabaseClient.js";

let _state, _els, _showToast, _getClient;
let _updatePostCountersAndScore, _calculatePostEngagementScore;

export function initUploadModal(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  if (deps.updatePostCountersAndScore) _updatePostCountersAndScore = deps.updatePostCountersAndScore;
  if (deps.calculatePostEngagementScore) _calculatePostEngagementScore = deps.calculatePostEngagementScore;
}

// Allow carousel module to set score functions after init
export function setScoreFunctions({ updatePostCountersAndScore, calculatePostEngagementScore }) {
  _updatePostCountersAndScore = updatePostCountersAndScore;
  _calculatePostEngagementScore = calculatePostEngagementScore;
}

const CROP_RATIOS = {
  square: { width: 1, height: 1, name: 'Square', platform: 'Instagram' },
  portrait: { width: 4, height: 5, name: 'Portrait', platform: 'Instagram' },
  vertical: { width: 2, height: 3, name: 'Vertical', platform: 'Pinterest' },
  tall: { width: 1, height: 2.1, name: 'Tall', platform: 'Pinterest' }
};

export function setupUploadModal() {
  _els.btnUpload?.addEventListener("click", openUploadModal);
  _els.btnCloseUpload?.addEventListener("click", closeUploadModal);
  _els.uploadModal?.addEventListener("click", (e) => {
    if (e.target === _els.uploadModal) closeUploadModal();
  });

  _els.dropZone?.addEventListener("click", () => _els.fileInput.click());
  _els.dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    _els.dropZone.classList.add("drag-over");
  });
  _els.dropZone?.addEventListener("dragleave", () => {
    _els.dropZone.classList.remove("drag-over");
  });
  _els.dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    _els.dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFileSelect(file);
  });

  _els.fileInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFileSelect(file);
  });

  _els.btnChangeImage?.addEventListener("click", (e) => {
    e.stopPropagation();
    _state.uploadData.file = null;
    _state.uploadData.previewUrl = null;
    _state.uploadData.existingAssetId = null;
    _els.fileInput.value = "";
    _els.imagePreview.classList.add("hidden");
    _els.dropZone.classList.remove("hidden");
    _els.fileInput.click();
  });

  setupProductSearch();

  _els.btnPrevStep?.addEventListener("click", prevStep);
  _els.btnNextStep?.addEventListener("click", nextStep);
  _els.btnSchedulePost?.addEventListener("click", schedulePost);

  document.querySelectorAll(".caption-tone-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".caption-tone-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _state.uploadData.tone = btn.dataset.tone;
      regenerateCaption();
    });
  });

  _els.btnRegenerateCaption?.addEventListener("click", regenerateCaption);

  setupPostCounters();

  _els.postPinterest?.addEventListener("change", () => {
    _els.pinterestBoardSelect.classList.toggle("hidden", !_els.postPinterest.checked);
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  _els.scheduleDate.value = tomorrow.toISOString().split("T")[0];
}

export function openUploadModal() {
  resetUploadState();
  _els.uploadModal.classList.remove("hidden");
  _els.uploadModal.classList.add("flex");
}

export function closeUploadModal() {
  _els.uploadModal.classList.add("hidden");
  _els.uploadModal.classList.remove("flex");
  resetUploadState();
}

function resetUploadState() {
  _state.uploadStep = 1;
  _state.uploadData = {
    file: null,
    previewUrl: null,
    existingAssetId: null,
    productId: null,
    variations: [],
    selectedVariants: ["square_1x1", "portrait_4x5", "vertical_2x3"],
    tone: "casual",
    caption: "",
    hashtags: [],
    platforms: ["instagram", "pinterest"],
    boardId: null,
    scheduleDate: null,
    scheduleTime: "12:00"
  };

  _els.fileInput.value = "";
  _els.imagePreview.classList.add("hidden");
  _els.dropZone.classList.remove("hidden");
  _els.productSelect.value = "";
  _els.captionText.value = "";
  _els.hashtagText.value = "";
  _els.varSquare.checked = true;
  _els.varPortrait.checked = true;
  _els.varVertical.checked = true;
  _els.varTall.checked = false;
  _els.postInstagram.checked = true;
  _els.postPinterest.checked = true;
  _els.pinterestBoardSelect.classList.add("hidden");

  if (_els.productSearch) {
    _els.productSearch.value = "";
    _els.productSearch.classList.remove("hidden");
  }
  if (_els.selectedProduct) _els.selectedProduct.classList.add("hidden");
  if (_els.productDropdown) _els.productDropdown.classList.add("hidden");

  const productImagesSection = document.getElementById('productImagesSection');
  if (productImagesSection) productImagesSection.classList.add('hidden');

  resetCropPreviews();

  document.querySelectorAll(".caption-tone-btn").forEach(b => b.classList.remove("active"));
  document.querySelector('.caption-tone-btn[data-tone="casual"]')?.classList.add("active");

  updateStepUI();
}

function handleFileSelect(file) {
  _state.uploadData.file = file;
  _state.uploadData.previewUrl = getFilePreviewUrl(file);
  _els.previewImg.src = _state.uploadData.previewUrl;
  _els.imagePreview.classList.remove("hidden");
  _els.dropZone.classList.add("hidden");
}

function setupProductSearch() {
  if (!_els.productSearch || !_els.productDropdown) return;

  let debounceTimer = null;
  _els.productSearch.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => filterProducts(e.target.value), 200);
  });

  _els.productSearch.addEventListener("focus", () => {
    if (_state.products?.length) filterProducts(_els.productSearch.value);
  });

  document.addEventListener("click", (e) => {
    if (!_els.productSearch.contains(e.target) && !_els.productDropdown.contains(e.target)) {
      _els.productDropdown.classList.add("hidden");
    }
  });

  _els.btnClearProduct?.addEventListener("click", () => {
    _state.uploadData.productId = null;
    _els.productSelect.value = "";
    _els.selectedProduct.classList.add("hidden");
    _els.productSearch.value = "";
    _els.productSearch.classList.remove("hidden");
  });
}

function filterProducts(query) {
  if (!_state.products?.length) {
    _els.productDropdown.innerHTML = '<div class="p-3 text-sm text-gray-400">No products loaded</div>';
    _els.productDropdown.classList.remove("hidden");
    return;
  }

  const filtered = _state.products.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 10);

  if (filtered.length === 0) {
    _els.productDropdown.innerHTML = `
      <div class="p-4 text-center">
        <div class="text-gray-400 text-sm">No products found</div>
        <div class="text-xs text-gray-300 mt-1">Try a different search term</div>
      </div>
    `;
  } else {
    const placeholderImg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect fill="#f3f4f6" width="40" height="40"/><rect x="12" y="12" width="16" height="16" rx="2" fill="#d1d5db"/></svg>');
    _els.productDropdown.innerHTML = filtered.map(p => {
      const imageUrl = p.catalog_image_url || placeholderImg;
      const price = p.price ? `$${parseFloat(p.price).toFixed(2)}` : '';
      return `
        <div class="product-option flex items-center gap-3 p-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0 transition-colors" data-id="${p.id}">
          <img src="${imageUrl}" alt="${p.name}" class="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0" onerror="this.src='${placeholderImg}'">
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm truncate">${p.name}</div>
            <div class="flex items-center gap-2 text-xs text-gray-400">
              ${p.category ? `<span>${p.category}</span>` : ''}
              ${price ? `<span class="text-green-600 font-medium">${price}</span>` : ''}
            </div>
          </div>
          <svg class="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
          </svg>
        </div>
      `;
    }).join("");

    _els.productDropdown.querySelectorAll(".product-option").forEach(option => {
      option.addEventListener("click", () => {
        const productId = option.dataset.id;
        const product = _state.products.find(p => p.id === productId);
        if (product) selectProduct(product);
      });
    });
  }

  _els.productDropdown.classList.remove("hidden");
}

async function selectProduct(product) {
  _state.uploadData.productId = product.id;
  _els.productSelect.value = product.id;

  const placeholderImg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect fill="#f3f4f6" width="40" height="40"/><rect x="12" y="12" width="16" height="16" rx="2" fill="#d1d5db"/></svg>');
  const imageUrl = product.catalog_image_url || placeholderImg;
  const price = product.price ? `$${parseFloat(product.price).toFixed(2)}` : '';

  _els.selectedProduct.innerHTML = `
    <div class="flex items-center gap-3 flex-1">
      <img src="${imageUrl}" alt="${product.name}" class="w-10 h-10 rounded-lg object-cover bg-gray-100" onerror="this.src='${placeholderImg}'">
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm truncate">${product.name}</div>
        ${price ? `<div class="text-xs text-green-600">${price}</div>` : ''}
      </div>
    </div>
    <button id="btnClearProduct" type="button" class="text-gray-400 hover:text-red-500 p-1">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  `;

  _els.selectedProduct.querySelector('#btnClearProduct')?.addEventListener('click', () => clearProductSelection());
  _els.selectedProduct.classList.remove("hidden");
  _els.productSearch.classList.add("hidden");
  _els.productDropdown.classList.add("hidden");

  await loadProductImages(product);
}

function clearProductSelection() {
  _state.uploadData.productId = null;
  _els.productSelect.value = '';
  _els.selectedProduct.classList.add('hidden');
  _els.productSearch.value = '';
  _els.productSearch.classList.remove('hidden');
  const productImagesSection = document.getElementById('productImagesSection');
  if (productImagesSection) productImagesSection.classList.add('hidden');
}

async function loadProductImages(product) {
  const productImagesSection = document.getElementById('productImagesSection');
  const productImagesGrid = document.getElementById('productImagesGrid');
  if (!productImagesSection || !productImagesGrid) return;

  productImagesSection.classList.remove('hidden');
  productImagesGrid.innerHTML = `
    <div class="col-span-full text-center py-4 text-gray-400 text-sm">
      <svg class="w-5 h-5 animate-spin mx-auto mb-2" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
      </svg>
      Loading product images...
    </div>
  `;

  try {
    const allImages = [];
    if (product.catalog_image_url) {
      allImages.push({ url: product.catalog_image_url, label: 'Catalog Image', isPrimary: true });
    }

    const galleryImages = await fetchProductGalleryImages(product.id);
    galleryImages.forEach((img, idx) => {
      allImages.push({ url: img.url, label: `Gallery ${idx + 1}`, isPrimary: false });
    });

    if (allImages.length === 0) {
      productImagesGrid.innerHTML = `
        <div class="col-span-full text-center py-4 text-gray-400 text-sm">
          <svg class="w-8 h-8 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/>
          </svg>
          No images found for this product
        </div>
      `;
      return;
    }

    productImagesGrid.innerHTML = allImages.map((img, idx) => `
      <div class="product-image-option relative group cursor-pointer rounded-lg overflow-hidden border-2 border-transparent hover:border-black transition-all" data-url="${img.url}">
        <img src="${img.url}" alt="${img.label}" class="w-full aspect-square object-cover bg-gray-100">
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <div class="opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full p-1.5 shadow-lg">
            <svg class="w-4 h-4 text-black" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
          </div>
        </div>
        ${img.isPrimary ? '<div class="absolute top-1 left-1 bg-black text-white text-[9px] font-bold px-1.5 py-0.5 rounded">MAIN</div>' : ''}
      </div>
    `).join('');

    productImagesGrid.querySelectorAll('.product-image-option').forEach(option => {
      option.addEventListener('click', async () => {
        await useProductImage(option.dataset.url);
      });
    });
  } catch (error) {
    console.error('Error loading product images:', error);
    productImagesGrid.innerHTML = `<div class="col-span-full text-center py-4 text-red-400 text-sm">Failed to load images</div>`;
  }
}

async function useProductImage(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const fileName = imageUrl.split('/').pop() || 'product-image.jpg';
    const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });

    _state.uploadData.file = file;
    if (_state.uploadData.previewUrl) revokePreviewUrl(_state.uploadData.previewUrl);
    _state.uploadData.previewUrl = getFilePreviewUrl(file);

    _els.previewImg.src = _state.uploadData.previewUrl;
    _els.imagePreview.classList.remove('hidden');
    _els.dropZone.classList.add('hidden');
    _showToast('Product image selected! Click "Next" to continue.', 'success');
  } catch (error) {
    console.error('Error using product image:', error);
    _showToast('Failed to load image. Please try again.', 'error');
  }
}

async function generateCropPreviews() {
  const previewUrl = _state.uploadData.previewUrl;
  if (!previewUrl) return;

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = previewUrl;
    });

    const srcWidth = img.naturalWidth;
    const srcHeight = img.naturalHeight;
    const srcRatio = srcWidth / srcHeight;

    if (_els.imageDimensionInfo) {
      _els.imageDimensionInfo.classList.remove('hidden');
      _els.sourceDimensions.textContent = `${srcWidth} × ${srcHeight}`;
    }

    await Promise.all([
      generateSinglePreview(img, 'square', srcRatio),
      generateSinglePreview(img, 'portrait', srcRatio),
      generateSinglePreview(img, 'vertical', srcRatio),
      generateSinglePreview(img, 'tall', srcRatio)
    ]);

    analyzeImageForCrops(srcWidth, srcHeight, srcRatio);
    await loadStep2Insights();
  } catch (error) {
    console.error('Error generating crop previews:', error);
  }
}

function generateSinglePreview(img, cropType, srcRatio) {
  const ratio = CROP_RATIOS[cropType];
  const targetRatio = ratio.width / ratio.height;
  const canvasId = `preview${cropType.charAt(0).toUpperCase() + cropType.slice(1)}`;
  const placeholderId = `preview${cropType.charAt(0).toUpperCase() + cropType.slice(1)}Placeholder`;
  const canvas = _els[canvasId];
  const placeholder = _els[placeholderId];
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const displaySize = 200;

  if (targetRatio >= 1) {
    canvas.width = displaySize;
    canvas.height = displaySize / targetRatio;
  } else {
    canvas.height = displaySize;
    canvas.width = displaySize * targetRatio;
  }

  let sx, sy, sWidth, sHeight;
  if (srcRatio > targetRatio) {
    sHeight = img.naturalHeight;
    sWidth = sHeight * targetRatio;
    sx = (img.naturalWidth - sWidth) / 2;
    sy = 0;
  } else {
    sWidth = img.naturalWidth;
    sHeight = sWidth / targetRatio;
    sx = 0;
    sy = (img.naturalHeight - sHeight) / 2;
  }

  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
  if (placeholder) placeholder.classList.add('hidden');
  canvas.classList.remove('hidden');
}

function analyzeImageForCrops(srcWidth, srcHeight, srcRatio) {
  const recommendations = [];
  const badges = {
    square: { show: false, type: 'good', text: '✓ Good fit' },
    portrait: { show: false, type: 'best', text: '🔥 Best' },
    vertical: { show: false, type: 'good', text: '✓ Good fit' },
    tall: { show: false, type: 'warn', text: '⚠️ Crop' }
  };

  if (srcRatio >= 0.9 && srcRatio <= 1.1) {
    recommendations.push('Your image is square - great for Instagram feed posts!');
    badges.square = { show: true, type: 'best', text: '🔥 Perfect' };
    badges.portrait = { show: true, type: 'good', text: '✓ Good fit' };
  } else if (srcRatio >= 0.7 && srcRatio < 0.9) {
    recommendations.push('Your image is portrait-oriented - ideal for Instagram portrait posts!');
    badges.portrait = { show: true, type: 'best', text: '🔥 Perfect' };
    badges.vertical = { show: true, type: 'good', text: '✓ Good fit' };
  } else if (srcRatio >= 0.5 && srcRatio < 0.7) {
    recommendations.push('Your vertical image is perfect for Pinterest pins!');
    badges.vertical = { show: true, type: 'best', text: '🔥 Perfect' };
    badges.portrait = { show: true, type: 'good', text: '✓ Good fit' };
  } else if (srcRatio < 0.5) {
    recommendations.push('Your tall image is ideal for Pinterest Idea pins!');
    badges.tall = { show: true, type: 'best', text: '🔥 Perfect' };
    badges.vertical = { show: true, type: 'good', text: '✓ Good fit' };
  } else if (srcRatio > 1.1) {
    recommendations.push('Landscape image detected - square crop will work best. Some content will be cropped for vertical formats.');
    badges.square = { show: true, type: 'good', text: '✓ Best fit' };
    badges.tall = { show: true, type: 'warn', text: '⚠️ Heavy crop' };
  }

  if (srcWidth < 1080 || srcHeight < 1080) {
    recommendations.push('Consider using a higher resolution image (1080px min) for best quality.');
  }

  if (recommendations.length > 0 && _els.imageAnalysisBanner) {
    _els.imageAnalysisBanner.classList.remove('hidden');
    _els.imageAnalysisText.textContent = recommendations[0];
  }

  Object.entries(badges).forEach(([crop, badge]) => {
    const badgeEl = _els[`${crop}Badge`];
    const cardEl = _els[`var${crop.charAt(0).toUpperCase() + crop.slice(1)}Card`];
    if (badgeEl) {
      if (badge.show) {
        badgeEl.classList.remove('hidden');
        const span = badgeEl.querySelector('span');
        if (span) {
          span.textContent = badge.text;
          span.className = 'text-xs px-1.5 py-0.5 rounded-full ';
          if (badge.type === 'best') span.className += 'bg-amber-100 text-amber-700';
          else if (badge.type === 'good') span.className += 'bg-green-100 text-green-700';
          else if (badge.type === 'warn') span.className += 'bg-yellow-100 text-yellow-700';
        }
      } else {
        badgeEl.classList.add('hidden');
      }
    }
    if (cardEl && badge.show && badge.type === 'best') {
      cardEl.classList.add('border-amber-300', 'bg-amber-50/30');
    }
  });
}

async function loadStep2Insights() {
  try {
    const client = _getClient();
    const { data: patterns } = await client
      .from('post_learning_patterns')
      .select('*')
      .in('pattern_key', ['best_format', 'portrait_performance', 'vertical_performance', 'carousel_engagement']);

    const { data: formatStats } = await client
      .from('social_posts')
      .select('variation_type, platform, likes, comments, saves')
      .not('likes', 'is', null);

    let insights = [];
    const carouselPattern = patterns?.find(p => p.pattern_key === 'carousel_engagement');
    if (carouselPattern) {
      insights.push({
        color: 'purple',
        text: `Carousel posts have <strong>${carouselPattern.pattern_value.engagement_boost || '2.4%'}</strong> higher engagement`
      });
    }
    insights.push({ color: 'pink', text: 'Portrait (4:5) posts take up <strong>more screen space</strong> in feeds' });
    insights.push({ color: 'red', text: 'Pinterest vertical pins get <strong>60% more saves</strong> than square' });

    if (_els.step2InsightsContent && insights.length > 0) {
      _els.step2InsightsContent.innerHTML = insights.map(insight => `
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 bg-${insight.color}-400 rounded-full shrink-0"></span>
          <span>${insight.text}</span>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading step 2 insights:', error);
  }
}

function resetCropPreviews() {
  ['Square', 'Portrait', 'Vertical', 'Tall'].forEach(name => {
    const canvas = _els[`preview${name}`];
    const placeholder = _els[`preview${name}Placeholder`];
    const badge = _els[`${name.toLowerCase()}Badge`];
    const card = _els[`var${name}Card`];
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (badge) badge.classList.add('hidden');
    if (card) card.classList.remove('border-amber-300', 'bg-amber-50/30');
  });
  if (_els.imageAnalysisBanner) _els.imageAnalysisBanner.classList.add('hidden');
  if (_els.imageDimensionInfo) _els.imageDimensionInfo.classList.add('hidden');
}

function updateStepUI() {
  const step = _state.uploadStep;
  _els.uploadStep1.classList.add("hidden");
  _els.uploadStep2.classList.add("hidden");
  _els.uploadStep3.classList.add("hidden");
  if (step === 1) _els.uploadStep1.classList.remove("hidden");
  if (step === 2) _els.uploadStep2.classList.remove("hidden");
  if (step === 3) _els.uploadStep3.classList.remove("hidden");

  _els.step1Indicator.className = step >= 1 ? "w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold" : "w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-bold";
  _els.step2Indicator.className = step >= 2 ? "w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold" : "w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-bold";
  _els.step3Indicator.className = step >= 3 ? "w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold" : "w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-bold";

  _els.btnPrevStep.classList.toggle("hidden", step === 1);
  _els.btnNextStep.classList.toggle("hidden", step === 3);
  _els.btnSchedulePost.classList.toggle("hidden", step !== 3);
}

function prevStep() {
  if (_state.uploadStep > 1) {
    _state.uploadStep--;
    updateStepUI();
  }
}

async function nextStep() {
  if (_state.uploadStep === 1) {
    if (!_state.uploadData.file && !_state.uploadData.existingAssetId && !_state.uploadData.previewUrl) {
      alert("Please select an image first");
      return;
    }
    _state.uploadData.productId = _els.productSelect.value || null;
    _state.uploadStep = 2;
    updateStepUI();
    await generateCropPreviews();
  } else if (_state.uploadStep === 2) {
    _state.uploadData.selectedVariants = [];
    if (_els.varSquare.checked) _state.uploadData.selectedVariants.push("square_1x1");
    if (_els.varPortrait.checked) _state.uploadData.selectedVariants.push("portrait_4x5");
    if (_els.varVertical.checked) _state.uploadData.selectedVariants.push("vertical_2x3");
    if (_els.varTall.checked) _state.uploadData.selectedVariants.push("tall_1x2");
    if (!_state.uploadData.selectedVariants.length) {
      alert("Please select at least one variation");
      return;
    }
    _state.uploadStep = 3;
    updateStepUI();
    await regenerateCaption();
    loadAICaptionTips();
    _els.pinterestBoardSelect.classList.toggle("hidden", !_els.postPinterest.checked);
  }
}

async function regenerateCaption() {
  const product = _state.products.find(p => p.id === _state.uploadData.productId);
  const category = product ? _state.categories.find(c => c.id === product.category_id) : null;
  const productData = {
    productName: product?.name || "this item",
    category: category?.name || "collection",
    link: product ? `karrykraze.com/pages/product.html?slug=${product.slug}` : "karrykraze.com"
  };

  const caption = await generateCaption(_state.uploadData.tone, productData);
  _els.captionText.value = caption;
  _state.uploadData.caption = caption;

  const hashtags = await getHashtagsForProduct(product ? { ...product, category } : null);
  const hashtagStr = formatHashtags(ensureKarryKrazeTag(hashtags));
  _els.hashtagText.value = hashtagStr;
  _state.uploadData.hashtags = parseHashtags(hashtagStr);

  if (_updatePostCountersAndScore) _updatePostCountersAndScore();
}

async function loadAICaptionTips() {
  try {
    const tips = await getPostCreationTips();
    const bestTimeEl = document.getElementById("aiTipBestTime");
    if (bestTimeEl) bestTimeEl.textContent = `Best time: ${tips.bestDay} at ${tips.bestTime}`;
    const hashtagsEl = document.getElementById("aiTipBestHashtags");
    if (hashtagsEl && tips.topHashtags.length > 0) {
      const hashtagList = tips.topHashtags.slice(0, 3).map(h => `#${h}`).join(" ");
      hashtagsEl.textContent = `Top hashtags: ${hashtagList}`;
    }
    await loadRecommendedTone();
    const captionInput = document.getElementById("captionText");
    if (captionInput) {
      captionInput.addEventListener("input", () => updateCaptionAnalysis(captionInput.value));
    }
  } catch (err) {
    console.error("Failed to load AI tips:", err);
  }
}

async function loadRecommendedTone() {
  try {
    const product = _state.products.find(p => p.id === _state.uploadData.productId);
    const category = product ? _state.categories.find(c => c.id === product.category_id) : null;
    const categoryName = category?.name || null;
    if (!categoryName) return;

    const insights = await getCategoryInsights(categoryName);
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
        const recEl = document.getElementById("toneRecommendation");
        const recToneEl = document.getElementById("recommendedTone");
        if (recEl && recToneEl) {
          recToneEl.textContent = `${recommendedTone} tone works best for ${categoryName}`;
          recEl.classList.remove("hidden");
        }
        document.querySelectorAll(".caption-tone-btn").forEach(btn => {
          if (btn.dataset.tone === mappedTone) {
            btn.classList.add("ring-2", "ring-purple-500", "ring-offset-1", "bg-purple-50");
            if (!btn.querySelector(".ai-rec-badge")) {
              btn.insertAdjacentHTML("beforeend", `<span class="ai-rec-badge ml-1 text-[10px] bg-purple-500 text-white px-1 rounded">AI</span>`);
            }
          } else {
            btn.classList.remove("ring-2", "ring-purple-500", "ring-offset-1", "bg-purple-50");
            btn.querySelector(".ai-rec-badge")?.remove();
          }
        });
        console.log(`[Tone] AI recommends "${mappedTone}" for ${categoryName} category`);
      }
    }
  } catch (err) {
    console.warn("Failed to load recommended tone:", err);
  }
}

function updateCaptionAnalysis(caption) {
  const tipsContent = document.getElementById("aiCaptionTipsContent");
  if (!tipsContent) return;

  const length = caption.length;
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(caption);
  const hasCTA = /shop|link|tap|click|buy|get yours|order/i.test(caption);
  const hasQuestion = caption.includes("?");
  const tips = [];

  if (length === 0) tips.push({ icon: "📝", text: "Start typing your caption...", status: "neutral" });
  else if (length < 50) tips.push({ icon: "📝", text: `Caption is short (${length} chars) - consider adding more details`, status: "warning" });
  else if (length > 200) tips.push({ icon: "📝", text: `Caption is long (${length} chars) - shorter posts often perform better`, status: "warning" });
  else tips.push({ icon: "✅", text: `Great length! (${length} chars)`, status: "good" });

  if (hasCTA) tips.push({ icon: "✅", text: "Nice! Has a call-to-action", status: "good" });
  else tips.push({ icon: "💡", text: "Add a CTA like 'Shop now' or 'Link in bio'", status: "suggestion" });

  if (hasEmoji) tips.push({ icon: "✅", text: "Good use of emojis!", status: "good" });
  else tips.push({ icon: "💡", text: "Consider adding emojis to boost engagement", status: "suggestion" });

  if (hasQuestion) tips.push({ icon: "✅", text: "Great! Questions boost comments", status: "good" });

  tipsContent.innerHTML = tips.map(t => {
    const color = t.status === "good" ? "text-green-700" : t.status === "warning" ? "text-orange-700" : "text-purple-800";
    return `<div class="flex items-start gap-1"><span>${t.icon}</span><span class="${color}">${t.text}</span></div>`;
  }).join("");
}

async function schedulePost() {
  try {
    _els.btnSchedulePost.disabled = true;
    _els.btnSchedulePost.textContent = "Scheduling...";

    _state.uploadData.caption = _els.captionText.value;
    _state.uploadData.hashtags = parseHashtags(_els.hashtagText.value);
    _state.uploadData.platforms = [];
    if (_els.postInstagram.checked) _state.uploadData.platforms.push("instagram");
    if (_els.postFacebook.checked) _state.uploadData.platforms.push("facebook");
    if (_els.postPinterest.checked) _state.uploadData.platforms.push("pinterest");
    _state.uploadData.boardId = _els.boardSelect.value || null;
    _state.uploadData.scheduleDate = _els.scheduleDate.value;
    _state.uploadData.scheduleTime = _els.scheduleTime.value;

    if (!_state.uploadData.platforms.length) {
      alert("Please select at least one platform");
      return;
    }

    let asset;
    let savedVariations;
    const product = _state.products.find(p => p.id === _state.uploadData.productId);

    if (_state.uploadData.existingAssetId) {
      const client = getSupabaseClient();
      const { data: existingAsset, error: assetError } = await client
        .from("social_assets").select("*").eq("id", _state.uploadData.existingAssetId).single();
      if (assetError) { console.error("Error fetching asset:", assetError); alert("Failed to load asset. Please try again."); return; }
      const { data: variations, error: varError } = await client
        .from("social_variations").select("*").eq("asset_id", _state.uploadData.existingAssetId);
      if (varError) console.error("Error fetching variations:", varError);
      asset = existingAsset;
      savedVariations = variations || [];
      if (!savedVariations.length) { alert("This asset has no variations. Please upload a new image instead."); return; }
    } else if (_state.uploadData.file) {
      const originalFilename = generateFilename(_state.uploadData.file.name, "original");
      const originalPath = getAssetPath(originalFilename);
      await uploadImage(_state.uploadData.file, originalPath);
      asset = await createAsset({
        product_id: _state.uploadData.productId || null,
        original_image_path: originalPath,
        original_filename: _state.uploadData.file.name,
        product_url: product ? `/pages/product.html?slug=${product.slug}` : null,
        is_active: true
      });
      const variations = await generateVariations(_state.uploadData.file, _state.uploadData.selectedVariants);
      const variationRecords = [];
      for (const v of variations) {
        const filename = generateFilename(_state.uploadData.file.name, v.variantType);
        const path = getVariationPath(asset.id, v.variantType, filename);
        await uploadImage(v.blob, path);
        variationRecords.push({
          asset_id: asset.id, platform: v.platform === "instagram" ? "instagram" : "pinterest",
          variant_type: v.variantType, aspect_ratio: v.aspectRatio, image_path: path, width: v.width, height: v.height
        });
      }
      savedVariations = await createVariations(variationRecords);
    } else {
      alert("Please select an image first");
      return;
    }

    const scheduledFor = new Date(`${_state.uploadData.scheduleDate}T${_state.uploadData.scheduleTime}:00`).toISOString();
    const autoApprove = _state.settings.auto_approve?.enabled !== false;
    const postsToCreate = [];

    for (const platform of _state.uploadData.platforms) {
      let variation = savedVariations.find(v => v.platform === platform);
      if (!variation && platform === "facebook") variation = savedVariations.find(v => v.platform === "instagram");
      if (!variation) variation = savedVariations[0];

      postsToCreate.push({
        variation_id: variation.id, platform,
        caption: _state.uploadData.caption, hashtags: _state.uploadData.hashtags,
        link_url: product ? `https://karrykraze.com/pages/product.html?slug=${product.slug}` : "https://karrykraze.com",
        pinterest_board_id: platform === "pinterest" ? _state.uploadData.boardId : null,
        scheduled_for: scheduledFor,
        status: autoApprove ? "queued" : "draft",
        requires_approval: !autoApprove,
        image_url: variation.image_path ? getPublicUrl(variation.image_path) : null
      });
    }

    await createPosts(postsToCreate);
    closeUploadModal();
    alert("Posts scheduled successfully!");
  } catch (err) {
    console.error("Schedule error:", err);
    alert("Failed to schedule post: " + err.message);
  } finally {
    _els.btnSchedulePost.disabled = false;
    _els.btnSchedulePost.textContent = "Schedule Post";
  }
}

// Also export for image pool to use
export function openUploadModalWithAsset(asset) {
  resetUploadState();
  const imageUrl = asset.original_image_path ? getPublicUrl(asset.original_image_path) : null;
  if (imageUrl) {
    _state.uploadData.previewUrl = imageUrl;
    _state.uploadData.existingAssetId = asset.id;
    _els.previewImg.src = imageUrl;
    _els.imagePreview.classList.remove("hidden");
    _els.dropZone.classList.add("hidden");
  }
  if (asset.product_id && asset.product) {
    _state.uploadData.productId = asset.product_id;
    _els.productSelect.value = asset.product_id;
    if (_els.selectedProductName && _els.selectedProduct && _els.productSearch) {
      _els.selectedProductName.textContent = asset.product.name;
      _els.selectedProduct.classList.remove("hidden");
      _els.productSearch.classList.add("hidden");
    }
  }
  _els.uploadModal.classList.remove("hidden");
  _els.uploadModal.classList.add("flex");
}

// Post counters (shared with carousel via engagement score module)
function setupPostCounters() {
  const captionEl = document.getElementById("captionText");
  const hashtagsEl = document.getElementById("hashtagText");
  const captionCountEl = document.getElementById("postCaptionCount");
  const hashtagCountEl = document.getElementById("postHashtagCount");

  const updateCaptionCount = () => {
    const len = captionEl?.value?.length || 0;
    if (captionCountEl) {
      captionCountEl.textContent = `${len}/2200`;
      captionCountEl.classList.remove("count-warning", "count-error");
      if (len > 2000) captionCountEl.classList.add("count-warning");
      if (len > 2200) captionCountEl.classList.add("count-error");
    }
    debouncePostScore();
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
    debouncePostScore();
  };

  captionEl?.addEventListener("input", updateCaptionCount);
  hashtagsEl?.addEventListener("input", updateHashtagCount);
  document.getElementById("btnGeneratePostHashtags")?.addEventListener("click", generatePostHashtags);
  document.getElementById("btnRefreshPostScore")?.addEventListener("click", () => {
    if (_calculatePostEngagementScore) _calculatePostEngagementScore();
  });
}

let postScoreTimeout = null;
function debouncePostScore() {
  clearTimeout(postScoreTimeout);
  postScoreTimeout = setTimeout(() => {
    if (_calculatePostEngagementScore) _calculatePostEngagementScore();
  }, 1000);
}

async function generatePostHashtags() {
  const btn = document.getElementById("btnGeneratePostHashtags");
  const hashtagsEl = document.getElementById("hashtagText");
  if (!btn || !hashtagsEl) return;

  const originalText = btn.textContent;
  btn.textContent = "⏳...";
  btn.disabled = true;

  try {
    const product = _state.uploadData?.productId ? _state.products.find(p => p.id === _state.uploadData.productId) : null;
    const category = product?.category_id ? _state.categories.find(c => c.id === product.category_id) : null;
    const productInfo = product ? { name: product.name, category: category?.name || "accessories" } : { name: "fashion item", category: "accessories" };

    const response = await fetch(`${window.ENV?.SUPABASE_URL}/functions/v1/ai-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${window.ENV?.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ type: "hashtags", productName: productInfo.name, productCategory: productInfo.category, platform: "instagram" })
    });
    const data = await response.json();
    if (data.hashtags) {
      hashtagsEl.value = data.hashtags;
      hashtagsEl.dispatchEvent(new Event("input"));
      _state.uploadData.hashtags = data.hashtags.split(" ");
    }
  } catch (err) {
    console.error("[Post] Failed to generate hashtags:", err);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

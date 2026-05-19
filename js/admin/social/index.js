// /js/admin/social/index.js
// Main orchestrator for Social Media Admin
// Modules: uploadModal, carouselBuilder, autoQueue, autopilot, imagePool, platformSettings, postDetail, analytics

import { getSupabaseClient } from "../../shared/supabaseClient.js";
import { initAdminNav } from "../../shared/adminNav.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config/env.js";
import {
  fetchProducts,
  fetchCategories,
  fetchPosts,
  fetchSettings,
  fetchStats,
  getPublicUrl
} from "./api.js";
import { initCalendar, getCalendarDateRange } from "./calendar.js";

// â”€â”€ Module imports â”€â”€
import { initUploadModal, setupUploadModal, openUploadModalWithAsset, setScoreFunctions } from "./uploadModal.js";
import { initCarouselBuilder, setupCarouselBuilder, loadRecentCarousels, calculateEngagementScore, updateEngagementScoreUI } from "./carouselBuilder.js";
import { initAutoQueue, setupAutoQueue, loadAutoQueueStats } from "./autoQueue.js";
import { initAutopilot, setupAutopilot } from "./autopilot.js";
import { initImagePool, setupImagePool, loadAssets } from "./imagePool.js";
import { initPlatformSettings, setupSettingsModal, applySettings } from "./platformSettings.js";
import { initPostDetail, setupPostDetailModal, openPostDetail } from "./postDetail.js";
import { initAnalytics, setupAnalytics, loadAnalytics, initPostAnalyticsModal, initLearningInsights } from "./analytics.js";
import { initPostsContext } from "./features/posts/postsContext.js";
import { setupQueueFilter } from "./features/posts/queueFilters.js";
import { loadQueuePosts } from "./features/posts/queueList.js";
import { setupCalendarHubView } from "./features/posts/calendarHubView.js";
import { handlePostClick } from "./features/posts/postClickRouting.js";
import { initSocialBootContext } from "./boot/socialBootContext.js";
import { setupTabRouter, switchTab } from "./boot/tabRouter.js";
import { startSocialAdminPage } from "./boot/pageBoot.js";
import { initPlatformsContext } from "./features/platforms/platformsContext.js";
import { registerOAuthRedirectHandlers } from "./features/platforms/oauthHandlers.js";
import { setupPlatformConnectButtons, checkConnectionStatus } from "./features/platforms/platformConnections.js";
import { registerPlatformTestActions } from "./features/platforms/platformTestActions.js";
import { postToInstagram, postToFacebook, postToPinterest } from "./features/platforms/platformPosting.js";
import { initTemplates, setupTemplates, loadTemplates } from "./features/templates/templatesController.js";
import {
  initBoards,
  setupBoards,
  loadBoards,
  renderBoardList,
  populateBoardDropdown,
} from "./features/boards/boardsController.js";

// ============================================
// State
// ============================================

const state = {
  products: [],
  categories: [],
  boards: [],
  templates: [],
  settings: {},
  currentTab: "calendar",
  uploadStep: 1,
  uploadData: {
    file: null,
    previewUrl: null,
    productId: null,
    variations: [],
    selectedVariants: ["square_1x1", "portrait_4x5", "vertical_2x3"],
    tone: "casual",
    caption: "",
    hashtags: [],
    platforms: ["instagram", "facebook"],
    boardId: null,
    scheduleDate: null,
    scheduleTime: "12:00"
  },
  editingPost: null,
  autoQueuePreview: null,
  // Image Pool state
  poolFilter: "all",
  poolContentType: "all",
  poolSearch: "",
  poolAssets: [],
  tagEditAsset: null,
  tagQualityScore: 3,
  tagProductIdValue: null,
  // Carousel state
  carousel: {
    images: [],
    productGalleryImages: [],
    productId: null,
    tone: "casual",
    caption: "",
    hashtags: "",
    scheduleDate: null,
    scheduleTime: "12:00"
  }
};

// ============================================
// Toast Notification
// ============================================

function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.kk-toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = 'kk-toast fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[100] px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 animate-fade-in';

  if (type === 'success') {
    toast.classList.add('bg-green-600', 'text-white');
    toast.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>${message}`;
  } else if (type === 'error') {
    toast.classList.add('bg-red-600', 'text-white');
    toast.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>${message}`;
  } else {
    toast.classList.add('bg-gray-800', 'text-white');
    toast.innerHTML = message;
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// Supabase Client
// ============================================

const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

let supabaseClient = null;
function getClient() {
  if (!supabaseClient) supabaseClient = getSupabaseClient();
  return supabaseClient;
}

initPlatformsContext({
  SUPABASE_FUNCTIONS_URL,
  SUPABASE_ANON_KEY,
  getSupabaseClient,
});
registerOAuthRedirectHandlers();
registerPlatformTestActions();


// ============================================
// DOM Elements
// ============================================

const $ = (id) => document.getElementById(id);

const els = {
  // Stats
  statQueued: $("statQueued"),
  statPostedToday: $("statPostedToday"),
  statInstagram: $("statInstagram"),
  statPinterest: $("statPinterest"),
  // Tabs
  tabContent: $("tabContent"),
  // Calendar
  calendarGrid: $("calendarGrid"),
  calMonth: $("calMonth"),
  calPrev: $("calPrev"),
  calNext: $("calNext"),
  // Queue
  queueList: $("queueList"),
  queueFilter: $("queueFilter"),
  listStatusFilter: $("listStatusFilter"),
  // Assets / Image Pool
  assetGrid: $("assetGrid"),
  assetSearch: $("assetSearch"),
  poolDropZone: $("poolDropZone"),
  poolFileInput: $("poolFileInput"),
  poolUploadProgress: $("poolUploadProgress"),
  poolUploadStatus: $("poolUploadStatus"),
  btnPoolUpload: $("btnPoolUpload"),
  btnBrowseCatalog: $("btnBrowseCatalog"),
  poolFilterBtns: $("poolFilterBtns"),
  poolContentTypeFilter: $("poolContentTypeFilter"),
  tagContentType: $("tagContentType"),
  aqHealthCard: $("aqHealthCard"),
  aqHealthAutopilot: $("aqHealthAutopilot"),
  aqHealthLastAutopilot: $("aqHealthLastAutopilot"),
  aqHealthLastAutoQueue: $("aqHealthLastAutoQueue"),
  aqHealthQueued: $("aqHealthQueued"),
  aqHealthScheduled: $("aqHealthScheduled"),
  aqHealthPoolReady: $("aqHealthPoolReady"),
  aqHealthPoolWarning: $("aqHealthPoolWarning"),
  aqHealthPolicy: $("aqHealthPolicy"),
  aqHealthPreviewNote: $("aqHealthPreviewNote"),
  // Catalog Browser modal
  catalogBrowseModal: $("catalogBrowseModal"),
  catalogBrowseClose: $("catalogBrowseClose"),
  catalogSearchInput: $("catalogSearchInput"),
  catalogCategoryFilter: $("catalogCategoryFilter"),
  catalogBrowseGrid: $("catalogBrowseGrid"),
  catalogSelectedCount: $("catalogSelectedCount"),
  catalogBrowseCancel: $("catalogBrowseCancel"),
  catalogBrowseImport: $("catalogBrowseImport"),
  // Tagging modal
  tagModal: $("tagModal"),
  tagModalClose: $("tagModalClose"),
  tagPreviewImg: $("tagPreviewImg"),
  tagShotType: $("tagShotType"),
  tagProductSearch: $("tagProductSearch"),
  tagProductDropdown: $("tagProductDropdown"),
  tagSelectedProduct: $("tagSelectedProduct"),
  tagSelectedProductName: $("tagSelectedProductName"),
  tagClearProduct: $("tagClearProduct"),
  tagProductId: $("tagProductId"),
  tagQualityStars: $("tagQualityStars"),
  tagQualityLabel: $("tagQualityLabel"),
  tagDeleteBtn: $("tagDeleteBtn"),
  tagCancelBtn: $("tagCancelBtn"),
  tagSaveBtn: $("tagSaveBtn"),
  // Templates
  templateList: $("templateList"),
  // Boards
  boardList: $("boardList"),
  // Upload modal
  uploadModal: $("uploadModal"),
  btnUpload: $("btnUpload"),
  btnCloseUpload: $("btnCloseUpload"),
  dropZone: $("dropZone"),
  fileInput: $("fileInput"),
  imagePreview: $("imagePreview"),
  previewImg: $("previewImg"),
  btnChangeImage: $("btnChangeImage"),
  productSelect: $("productSelect"),
  productSearch: $("productSearch"),
  productDropdown: $("productDropdown"),
  selectedProduct: $("selectedProduct"),
  selectedProductName: $("selectedProductName"),
  btnClearProduct: $("btnClearProduct"),
  // Upload steps
  uploadStep1: $("uploadStep1"),
  uploadStep2: $("uploadStep2"),
  uploadStep3: $("uploadStep3"),
  step1Indicator: $("step1Indicator"),
  step2Indicator: $("step2Indicator"),
  step3Indicator: $("step3Indicator"),
  btnPrevStep: $("btnPrevStep"),
  btnNextStep: $("btnNextStep"),
  btnSchedulePost: $("btnSchedulePost"),
  // Step 2 - variations
  varSquare: $("varSquare"),
  varPortrait: $("varPortrait"),
  varVertical: $("varVertical"),
  varTall: $("varTall"),
  // Step 2 - preview canvases and badges
  previewSquare: $("previewSquare"),
  previewPortrait: $("previewPortrait"),
  previewVertical: $("previewVertical"),
  previewTall: $("previewTall"),
  previewSquarePlaceholder: $("previewSquarePlaceholder"),
  previewPortraitPlaceholder: $("previewPortraitPlaceholder"),
  previewVerticalPlaceholder: $("previewVerticalPlaceholder"),
  previewTallPlaceholder: $("previewTallPlaceholder"),
  squareBadge: $("squareBadge"),
  portraitBadge: $("portraitBadge"),
  verticalBadge: $("verticalBadge"),
  tallBadge: $("tallBadge"),
  varSquareCard: $("varSquareCard"),
  varPortraitCard: $("varPortraitCard"),
  varVerticalCard: $("varVerticalCard"),
  varTallCard: $("varTallCard"),
  imageAnalysisBanner: $("imageAnalysisBanner"),
  imageAnalysisText: $("imageAnalysisText"),
  imageDimensionInfo: $("imageDimensionInfo"),
  sourceDimensions: $("sourceDimensions"),
  step2Insights: $("step2Insights"),
  step2InsightsContent: $("step2InsightsContent"),
  // Step 3 - caption
  captionText: $("captionText"),
  hashtagText: $("hashtagText"),
  btnRegenerateCaption: $("btnRegenerateCaption"),
  postInstagram: $("postInstagram"),
  postFacebook: $("postFacebook"),
  postPinterest: $("postPinterest"),
  pinterestBoardSelect: $("pinterestBoardSelect"),
  boardSelect: $("boardSelect"),
  scheduleDate: $("scheduleDate"),
  scheduleTime: $("scheduleTime"),
  // Settings modal
  settingsModal: $("settingsModal"),
  btnSettings: $("btnSettings"),
  btnCloseSettings: $("btnCloseSettings"),
  btnSaveSettings: $("btnSaveSettings"),
  settingAutoApprove: $("settingAutoApprove"),
  settingDefaultTone: $("settingDefaultTone"),
  settingInstagramEnabled: $("settingInstagramEnabled"),
  settingInstagramTime: $("settingInstagramTime"),
  settingPinterestEnabled: $("settingPinterestEnabled"),
  settingPinterestTime: $("settingPinterestTime"),
  // Post detail modal
  postDetailModal: $("postDetailModal"),
  btnClosePostDetail: $("btnClosePostDetail"),
  postDetailImage: $("postDetailImage"),
  postDetailPlatform: $("postDetailPlatform"),
  postDetailStatus: $("postDetailStatus"),
  postDetailCaption: $("postDetailCaption"),
  postDetailHashtags: $("postDetailHashtags"),
  postDetailDate: $("postDetailDate"),
  postDetailTime: $("postDetailTime"),
  btnDeletePost: $("btnDeletePost"),
  btnPostNow: $("btnPostNow"),
  btnSavePost: $("btnSavePost"),
  // Other
  btnAddTemplate: $("btnAddTemplate"),
  btnAddBoard: $("btnAddBoard"),
  // Auto-Queue
  btnAutoQueue: $("btnAutoQueue"),
  aqPostCount: $("aqPostCount"),
  aqTime1: $("aqTime1"),
  aqTime2: $("aqTime2"),
  aqTime3: $("aqTime3"),
  aqTime4: $("aqTime4"),
  aqToneCasual: $("aqToneCasual"),
  aqToneUrgency: $("aqToneUrgency"),
  aqTonePro: $("aqTonePro"),
  aqTonePlayful: $("aqTonePlayful"),
  aqToneValue: $("aqToneValue"),
  aqToneTrending: $("aqToneTrending"),
  aqToneInspirational: $("aqToneInspirational"),
  aqToneMinimalist: $("aqToneMinimalist"),
  btnPreviewQueue: $("btnPreviewQueue"),
  btnGenerateQueue: $("btnGenerateQueue"),
  btnConfirmQueue: $("btnConfirmQueue"),
  aqPreviewResults: $("aqPreviewResults"),
  aqPreviewList: $("aqPreviewList"),
  aqStatTotal: $("aqStatTotal"),
  aqStatNeverPosted: $("aqStatNeverPosted"),
  aqStatReady: $("aqStatReady"),
  aqStatRecent: $("aqStatRecent")
};

// Calendar instance
let calendar = null;

// ============================================
// Initialize
// ============================================

async function init() {
  try {
    await initAdminNav("Social Media");

    const client = getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) { window.location.href = "/pages/admin/login.html"; return; }

    initSocialBootContext({
      state,
      $,
      tabHandlers: {
        loadCalendarPosts,
        loadQueuePosts,
        loadAssets,
        loadTemplates,
        renderBoardList,
        loadAutoQueueStats,
        loadAnalytics,
        loadRecentCarousels,
      },
    });

    // Wire modules with dependencies (before data loading so callbacks are ready)
    const baseDeps = { state, els, showToast, getClient };

    initPostsContext({ state, els });
    initTemplates({ state, els });
    initBoards({
      state,
      els,
      getSupabaseClient,
      SUPABASE_FUNCTIONS_URL,
      SUPABASE_ANON_KEY,
    });

    initUploadModal({ ...baseDeps, loadStats, switchTab, loadQueuePosts, loadCalendarPosts, populateBoardDropdown });
    setScoreFunctions({ calculateEngagementScore, updateEngagementScoreUI });

    initCarouselBuilder({ ...baseDeps, SUPABASE_FUNCTIONS_URL, loadStats, switchTab, loadQueuePosts, loadCalendarPosts, populateBoardDropdown });

    initAutoQueue({ ...baseDeps, SUPABASE_FUNCTIONS_URL, loadStats, switchTab, loadQueuePosts });
    initAutopilot({ ...baseDeps, loadStats, loadQueuePosts });
    initImagePool({ ...baseDeps, openUploadModalWithAsset });
    initPlatformSettings({ ...baseDeps, loadSettings });
    initPostDetail({
      ...baseDeps,
      postToInstagram, postToFacebook, postToPinterest,
      loadStats, loadAutoQueueStats, loadCalendarPosts, loadQueuePosts,
      switchTab, populateBoardDropdown
    });
    initAnalytics({ ...baseDeps, loadCalendarPosts, loadQueuePosts });

    // Load initial data (after modules are wired so callbacks like applySettings work)
    await Promise.all([
      loadProducts(), loadCategories(), loadBoards(),
      loadSettings(), loadStats(), checkConnectionStatus()
    ]);

    // Setup UI
    setupTabRouter();
    setupUploadModal();
    setupSettingsModal();
    setupPostDetailModal();
    setupCalendarHubView();
    setupCalendar();
    setupQueueFilter();
    setupImagePool();
    setupTemplates();
    setupBoards();
    setupAutoQueue();
    setupAutopilot();
    setupAnalytics();
    setupCarouselBuilder();

    // Show calendar tab by default
    switchTab("calendar");

    setupPlatformConnectButtons();
  } catch (err) {
    console.error("Init error:", err);
    alert("Failed to initialize. Please refresh the page.");
  }
}

// ============================================
// Data Loading
// ============================================

async function loadProducts() {
  state.products = await fetchProducts();
  populateProductSelect();
}

async function loadCategories() {
  state.categories = await fetchCategories();
}


async function loadSettings() {
  state.settings = await fetchSettings();
  applySettings();
}

async function loadStats() {
  const stats = await fetchStats();
  if (els.statQueued) els.statQueued.textContent = stats.queued || 0;
  if (els.statPostedToday) els.statPostedToday.textContent = stats.postedToday || 0;
}

// ============================================
// Calendar
// ============================================

async function loadCalendarPosts() {
  const range = getCalendarDateRange();
  const posts = await fetchPosts({
    startDate: range.start,
    endDate: range.end
  });
  calendar.setPosts(posts);
}

function setupCalendar() {
  calendar = initCalendar(els.calendarGrid, els.calMonth, {
    onPostClick: (post) => handlePostClick(post)
  });
  els.calPrev?.addEventListener("click", () => {
    calendar.prevMonth();
    loadCalendarPosts();
  });
  els.calNext?.addEventListener("click", () => {
    calendar.nextMonth();
    loadCalendarPosts();
  });
}


// ============================================
// Helpers
// ============================================

function populateProductSelect() {
  els.productSelect.innerHTML = `
    <option value="">\u2014 No product link \u2014</option>
    ${state.products.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
  `;
}


// ============================================
// Start
// ============================================

startSocialAdminPage({ init, initPostAnalyticsModal, initLearningInsights });

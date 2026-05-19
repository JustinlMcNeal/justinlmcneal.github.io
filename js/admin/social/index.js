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
  createBoard,
  updateBoard,
  deleteBoard,
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
import { initSocialBootContext } from "./boot/socialBootContext.js";
import { setupTabRouter, switchTab } from "./boot/tabRouter.js";
import { startSocialAdminPage } from "./boot/pageBoot.js";
import { initPlatformsContext } from "./features/platforms/platformsContext.js";
import { registerOAuthRedirectHandlers } from "./features/platforms/oauthHandlers.js";
import { setupPlatformConnectButtons, checkConnectionStatus } from "./features/platforms/platformConnections.js";
import { registerPlatformTestActions } from "./features/platforms/platformTestActions.js";
import { postToInstagram, postToFacebook, postToPinterest } from "./features/platforms/platformPosting.js";
import { initTemplates, setupTemplates, loadTemplates } from "./features/templates/templatesController.js";

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
// Pinterest Boards
// ============================================

async function fetchPinterestBoards() {
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-boards`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const data = await resp.json();
    if (data.success) return data.boards;
    console.error("Failed to fetch Pinterest boards:", data.error, data.debug);
    return [];
  } catch (err) {
    console.error("Pinterest boards fetch error:", err);
    return [];
  }
}

async function populateBoardDropdown(selectElement) {
  if (!selectElement) return;
  selectElement.innerHTML = '<option value="">Loading boards...</option>';
  const boards = await fetchPinterestBoards();
  if (boards.length === 0) {
    selectElement.innerHTML = '<option value="">No boards found - Connect Pinterest first</option>';
    return;
  }
  selectElement.innerHTML = '<option value="">Select a board...</option>';
  boards.forEach(board => {
    const option = document.createElement("option");
    option.value = board.id;
    option.textContent = board.name;
    selectElement.appendChild(option);
  });
}

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

async function loadBoards() {
  const client = getSupabaseClient();
  const { data: pinData } = await client
    .from("social_settings").select("setting_value")
    .eq("setting_key", "pinterest_connected").single();

  if (!pinData?.setting_value?.connected) {
    state.boards = [];
    return;
  }

  state.boards = await fetchPinterestBoards();
  await populateBoardSelect();
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
    onPostClick: (post) => openPostDetail(post)
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
// Boards
// ============================================

function setupBoards() {
  els.btnAddBoard?.addEventListener("click", () => {
    const name = prompt("Enter board name:");
    if (name) addBoard(name);
  });

  document.getElementById("btnSyncBoards")?.addEventListener("click", async () => {
    const btn = document.getElementById("btnSyncBoards");
    btn.disabled = true;
    btn.textContent = "Syncing...";
    try {
      const client = getSupabaseClient();
      const { data: { session } } = await client.auth.getSession();
      const resp = await fetch(`https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/sync-pinterest-boards`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
      });
      const result = await resp.json();
      if (!resp.ok || !result.success) throw new Error(result.error || "Sync failed");
      const msg = `Boards synced!\n\nMatched: ${result.matched?.length || 0}\nCreated: ${result.created?.length || 0}\nTotal mapped: ${result.total_mapped || 0}`;
      alert(msg);
      await loadBoards();
      renderBoardList();
    } catch (err) {
      console.error("Board sync error:", err);
      alert("Failed to sync boards: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "ðŸ“Œ Auto-Sync Boards";
    }
  });
}

async function addBoard(name) {
  try {
    await createBoard({ name, is_default: state.boards.length === 0 });
    await loadBoards();
    renderBoardList();
  } catch (err) {
    console.error("Add board error:", err);
    alert("Failed to add board");
  }
}

function renderBoardList() {
  if (!state.boards.length) {
    els.boardList.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <p>No boards configured yet</p>
        <p class="text-xs mt-1">Add boards to organize your Pinterest pins by category</p>
      </div>
    `;
    return;
  }

  els.boardList.innerHTML = state.boards.map(board => `
    <div class="board-item" data-board-id="${board.id}">
      <div class="flex-1">
        <div class="font-medium">${board.name}</div>
        <div class="text-xs text-gray-400">
          ${board.category?.name ? `Linked to: ${board.category.name}` : "No category linked"}
          ${board.is_default ? " \u2022 Default board" : ""}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <select class="board-category-select text-sm border rounded px-2 py-1" data-board-id="${board.id}">
          <option value="">No category</option>
          ${state.categories.map(c => `
            <option value="${c.id}" ${board.category_id === c.id ? "selected" : ""}>${c.name}</option>
          `).join("")}
        </select>
        <button class="btn-delete-board p-2 hover:bg-red-50 rounded text-red-500" title="Delete">\ud83d\uddd1\ufe0f</button>
      </div>
    </div>
  `).join("");

  // Category select handlers
  els.boardList.querySelectorAll(".board-category-select").forEach(select => {
    select.addEventListener("change", async () => {
      const boardId = select.dataset.boardId;
      const categoryId = select.value || null;
      try {
        await updateBoard(boardId, { category_id: categoryId });
        await loadBoards();
      } catch (err) {
        console.error("Update board error:", err);
      }
    });
  });

  // Delete handlers
  els.boardList.querySelectorAll(".btn-delete-board").forEach(btn => {
    btn.addEventListener("click", async () => {
      const boardId = btn.closest(".board-item").dataset.boardId;
      if (confirm("Delete this board?")) {
        try {
          await deleteBoard(boardId);
          await loadBoards();
          renderBoardList();
        } catch (err) {
          console.error("Delete board error:", err);
          alert("Failed to delete board");
        }
      }
    });
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

async function populateBoardSelect() {
  await populateBoardDropdown(els.boardSelect);
}

// ============================================
// Start
// ============================================

startSocialAdminPage({ init, initPostAnalyticsModal, initLearningInsights });

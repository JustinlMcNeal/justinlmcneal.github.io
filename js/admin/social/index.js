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
  fetchTemplates,
  fetchSettings,
  fetchStats,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createBoard,
  updateBoard,
  deleteBoard,
  getPublicUrl
} from "./api.js";
import { initCalendar, getCalendarDateRange } from "./calendar.js";
import { clearTemplateCache } from "./captions.js";

// ── Module imports ──
import { initUploadModal, setupUploadModal, openUploadModalWithAsset, setScoreFunctions } from "./uploadModal.js";
import { initCarouselBuilder, setupCarouselBuilder, loadRecentCarousels, calculateEngagementScore, updateEngagementScoreUI } from "./carouselBuilder.js";
import { initAutoQueue, setupAutoQueue, loadAutoQueueStats } from "./autoQueue.js";
import { initAutopilot, setupAutopilot } from "./autopilot.js";
import { initImagePool, setupImagePool, loadAssets } from "./imagePool.js";
import { initPlatformSettings, setupSettingsModal, applySettings } from "./platformSettings.js";
import { initPostDetail, setupPostDetailModal, openPostDetail } from "./postDetail.js";
import { initAnalytics, setupAnalytics, loadAnalytics, initPostAnalyticsModal, initLearningInsights } from "./analytics.js";

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

// ============================================
// OAuth Handlers
// ============================================

function handlePinterestOAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code && !params.get("state")?.includes("instagram")) {
    fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ code }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.access_token) {
        alert("Pinterest connected successfully!");
        window.history.replaceState({}, document.title, window.location.pathname);
        location.reload();
      } else {
        console.error("Pinterest OAuth error:", data);
        alert("Failed to connect Pinterest. Check console for details.");
      }
    })
    .catch(err => {
      console.error("Pinterest OAuth fetch error:", err);
      alert("Failed to connect Pinterest. Check console for details.");
    });
  }
}
window.addEventListener("DOMContentLoaded", handlePinterestOAuth);

function handleInstagramOAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const oauthState = params.get("state");
  if (code && oauthState === "instagram") {
    window.history.replaceState({}, document.title, window.location.pathname);
    fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ code }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert(`Instagram connected successfully! Welcome @${data.username}`);
        location.reload();
      } else {
        console.error("Instagram OAuth error:", data);
        if (data.debug) console.log("Debug info:", data.debug);
        alert(`Failed to connect Instagram: ${data.error || "Unknown error"}`);
      }
    })
    .catch(err => {
      console.error("Instagram OAuth fetch error:", err);
      alert("Failed to connect Instagram. Check console for details.");
    });
  }
}
window.addEventListener("DOMContentLoaded", handleInstagramOAuth);

// ============================================
// Platform Posting
// ============================================

async function postToInstagram(postId, imageUrl, caption) {
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ postId, imageUrl, caption }),
    });
    const data = await resp.json();
    if (data.success) { alert("Posted to Instagram successfully!"); return data; }
    else { alert(`Failed to post to Instagram: ${data.error}`); return null; }
  } catch (err) {
    console.error("Instagram post error:", err);
    alert("Failed to post to Instagram. Check console for details.");
    return null;
  }
}

async function postToFacebook(postId, imageUrl, caption, linkUrl = null) {
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/facebook-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ postId, imageUrl, caption, linkUrl }),
    });
    const data = await resp.json();
    if (data.success) { alert("Posted to Facebook successfully!"); return data; }
    else { alert(`Failed to post to Facebook: ${data.error}`); return null; }
  } catch (err) {
    console.error("Facebook post error:", err);
    alert("Failed to post to Facebook. Check console for details.");
    return null;
  }
}

window.testInstagramPost = async function() {
  const client = getSupabaseClient();
  const { data: settings } = await client
    .from("social_settings").select("setting_value")
    .eq("setting_key", "instagram_connected").single();
  if (!settings?.setting_value) { alert("Please connect Instagram first!"); return; }

  const imageUrl = prompt("Enter a public image URL to post to Instagram:\n\n(Must be a publicly accessible image URL)");
  if (!imageUrl) return;
  const caption = prompt("Enter a caption for the post:", "Test post from KarryKraze Social Manager \ud83d\uded2\u2728 #karrykraze #test");
  if (caption === null) return;
  if (!confirm(`Ready to post to Instagram:\n\nImage: ${imageUrl}\nCaption: ${caption}\n\nProceed?`)) return;

  try {
    alert("Posting to Instagram... This may take a few seconds.");
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ postId: null, imageUrl, caption }),
    });
    const data = await resp.json();
    if (data.success) alert(`\ud83c\udf89 Posted to Instagram successfully!\n\nInstagram Media ID: ${data.mediaId}`);
    else alert(`Failed to post: ${data.error}\n\nCheck console for details.`);
  } catch (err) {
    console.error("Test post error:", err);
    alert("Failed to post. Check console for details.");
  }
};

async function postToPinterest(postId, imageUrl, title, description, link, boardId) {
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ postId, imageUrl, title, description, link, boardId }),
    });
    const data = await resp.json();
    if (data.success) { alert("Pin created successfully!"); return data; }
    else { alert(`Failed to post: ${data.error}`); return null; }
  } catch (err) {
    console.error("Pinterest post error:", err);
    alert("Failed to post to Pinterest. Check console for details.");
    return null;
  }
}

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

    // Wire modules with dependencies (before data loading so callbacks are ready)
    const baseDeps = { state, els, showToast, getClient };

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
    setupTabs();
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

    // Pinterest connect button
    const pinBtn = document.getElementById("connect-pinterest");
    if (pinBtn) {
      pinBtn.addEventListener("click", () => {
        const appId = "1542566";
        const redirectUri = encodeURIComponent("https://karrykraze.com/pages/admin/social.html");
        const scope = "pins:read,pins:write,boards:read,boards:write";
        window.location.href = `https://www.pinterest.com/oauth/?response_type=code&client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}`;
      });
    }

    // Instagram connect button
    const igBtn = document.getElementById("connect-instagram");
    if (igBtn) {
      igBtn.addEventListener("click", () => {
        const appId = "2162145877936737";
        const redirectUri = encodeURIComponent("https://karrykraze.com/pages/admin/social.html");
        const scope = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,business_management,pages_show_list";
        const oauthState = "instagram";
        window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${oauthState}`;
      });
    }
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

async function checkConnectionStatus() {
  const client = getSupabaseClient();

  // Check Instagram
  const { data: igData } = await client
    .from("social_settings").select("setting_key, setting_value")
    .in("setting_key", ["instagram_connected", "instagram_username"]);

  const igConnected = igData?.find(s => s.setting_key === "instagram_connected")?.setting_value?.connected;
  const igUsername = igData?.find(s => s.setting_key === "instagram_username")?.setting_value?.username;

  const igStatusIcon = document.getElementById("instagramStatusIcon");
  const igStatusText = document.getElementById("instagramStatusText");
  const igConnectBtn = document.getElementById("connect-instagram");
  const igTestBtn = document.getElementById("instagramTestBtn");

  if (igConnected && igUsername) {
    if (igStatusIcon) igStatusIcon.textContent = "\u25cf";
    if (igStatusIcon) igStatusIcon.classList.replace("text-gray-400", "text-green-500");
    if (igStatusText) igStatusText.textContent = `@${igUsername}`;
    if (igStatusText) igStatusText.classList.replace("text-gray-400", "text-green-600");
    if (igTestBtn) igTestBtn.classList.remove("hidden");
    if (igConnectBtn) {
      igConnectBtn.innerHTML = `
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
        <span class="hidden xs:inline">\u2713</span> Instagram
      `;
      igConnectBtn.classList.remove("from-purple-500", "via-pink-500", "to-orange-500");
      igConnectBtn.classList.add("bg-green-600");
    }
  }

  // Check Pinterest
  const { data: pinData } = await client
    .from("social_settings").select("setting_key, setting_value")
    .in("setting_key", ["pinterest_connected"]);

  const pinConnected = pinData?.find(s => s.setting_key === "pinterest_connected")?.setting_value?.connected;

  const pinStatusIcon = document.getElementById("pinterestStatusIcon");
  const pinStatusText = document.getElementById("pinterestStatusText");
  const pinConnectBtn = document.getElementById("connect-pinterest");

  if (pinConnected) {
    if (pinStatusIcon) pinStatusIcon.textContent = "\u25cf";
    if (pinStatusIcon) pinStatusIcon.classList.replace("text-gray-400", "text-green-500");
    if (pinStatusText) pinStatusText.textContent = "Connected";
    if (pinStatusText) pinStatusText.classList.replace("text-gray-400", "text-green-600");
    if (pinConnectBtn) {
      pinConnectBtn.innerHTML = `
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.406.042-3.442.218-.936 1.407-5.965 1.407-5.965s-.359-.719-.359-1.781c0-1.669.967-2.914 2.171-2.914 1.024 0 1.518.769 1.518 1.69 0 1.03-.655 2.569-.994 3.995-.283 1.195.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.208 0 1.031.397 2.137.893 2.739.098.119.112.223.083.344-.091.378-.293 1.194-.333 1.361-.052.218-.173.265-.4.16-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.966 7.398 6.931 0 4.136-2.608 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
        </svg>
        <span class="hidden xs:inline">\u2713</span> Pinterest
      `;
      pinConnectBtn.classList.remove("bg-pinterest");
      pinConnectBtn.classList.add("bg-green-600");
    }
  }
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
// Queue
// ============================================

function setupQueueFilter() {
  els.queueFilter?.addEventListener("change", loadQueuePosts);
}

async function loadQueuePosts() {
  const platform = els.queueFilter.value;
  const filters = { status: "queued" };
  if (platform !== "all") filters.platform = platform;
  const posts = await fetchPosts(filters);
  renderQueueList(posts);
}

function renderQueueList(posts) {
  if (!posts.length) {
    els.queueList.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <p>No scheduled posts yet</p>
        <button class="mt-2 text-sm text-black font-medium hover:underline" onclick="document.getElementById('btnUpload').click()">
          Create your first post \u2192
        </button>
      </div>
    `;
    return;
  }

  els.queueList.innerHTML = posts.map(post => {
    const imageUrl = post.variation?.image_path
      ? getPublicUrl(post.variation.image_path)
      : "/imgs/placeholder.jpg";

    const scheduledDate = new Date(post.scheduled_for);
    const dateStr = scheduledDate.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric"
    });
    const timeStr = scheduledDate.toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit"
    });

    return `
      <div class="queue-item cursor-pointer" data-post-id="${post.id}">
        <img src="${imageUrl}" alt="" class="queue-item-image">
        <div class="queue-item-content">
          <div class="queue-item-caption">${post.caption || "No caption"}</div>
          <div class="queue-item-meta">
            <span class="badge badge-${post.platform}">${post.platform === "instagram" ? "\ud83d\udcf8" : "\ud83d\udccc"} ${post.platform}</span>
            <span class="ml-2">${dateStr} at ${timeStr}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge badge-${post.status}">${post.status}</span>
        </div>
      </div>
    `;
  }).join("");

  // Add click handlers
  els.queueList.querySelectorAll(".queue-item").forEach(el => {
    el.addEventListener("click", () => {
      const postId = el.dataset.postId;
      const post = posts.find(p => p.id === postId);
      if (post) openPostDetail(post);
    });
  });
}

// ============================================
// Templates
// ============================================

function setupTemplates() {
  document.querySelectorAll(".tone-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tone-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderTemplateList(tab.dataset.tone);
    });
  });
  document.querySelector('.tone-tab[data-tone="casual"]')?.classList.add("active");
  els.btnAddTemplate?.addEventListener("click", () => {
    const activeTone = document.querySelector(".tone-tab.active")?.dataset.tone || "casual";
    const template = prompt("Enter new caption template:\n\nUse placeholders: {product_name}, {category}, {link}");
    if (template) addTemplate(activeTone, template);
  });
}

async function addTemplate(tone, template) {
  try {
    await createTemplate({ tone, template, is_active: true });
    clearTemplateCache();
    await loadTemplates();
  } catch (err) {
    console.error("Add template error:", err);
    alert("Failed to add template");
  }
}

async function loadTemplates() {
  state.templates = await fetchTemplates();
  renderTemplateList();
}

function renderTemplateList(tone = "casual") {
  const filtered = state.templates.filter(t => t.tone === tone);

  if (!filtered.length) {
    els.templateList.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <p>No templates for this tone</p>
      </div>
    `;
    return;
  }

  els.templateList.innerHTML = filtered.map(template => `
    <div class="template-item" data-template-id="${template.id}">
      <div class="template-item-content">${template.template}</div>
      <div class="template-item-actions">
        <button class="btn-edit-template p-2 hover:bg-gray-100 rounded" title="Edit">\u270f\ufe0f</button>
        <button class="btn-delete-template p-2 hover:bg-red-50 rounded text-red-500" title="Delete">\ud83d\uddd1\ufe0f</button>
      </div>
    </div>
  `).join("");

  // Edit handlers
  els.templateList.querySelectorAll(".btn-edit-template").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const templateId = btn.closest(".template-item").dataset.templateId;
      const template = state.templates.find(t => t.id === templateId);
      if (template) {
        const newText = prompt("Edit template:", template.template);
        if (newText && newText !== template.template) editTemplate(templateId, newText);
      }
    });
  });

  // Delete handlers
  els.templateList.querySelectorAll(".btn-delete-template").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const templateId = btn.closest(".template-item").dataset.templateId;
      if (confirm("Delete this template?")) removeTemplate(templateId);
    });
  });
}

async function editTemplate(templateId, newText) {
  try {
    await updateTemplate(templateId, { template: newText });
    clearTemplateCache();
    await loadTemplates();
  } catch (err) {
    console.error("Edit template error:", err);
    alert("Failed to update template");
  }
}

async function removeTemplate(templateId) {
  try {
    await deleteTemplate(templateId);
    clearTemplateCache();
    await loadTemplates();
  } catch (err) {
    console.error("Delete template error:", err);
    alert("Failed to delete template");
  }
}

// ============================================
// Boards
// ============================================

function setupBoards() {
  els.btnAddBoard?.addEventListener("click", () => {
    const name = prompt("Enter board name:");
    if (name) addBoard(name);
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
// Tabs
// ============================================

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  state.currentTab = tab;

  // Update tab buttons
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  // Show/hide panels
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.add("hidden");
  });

  const activePanel = $(`tab-${tab}`);
  if (activePanel) activePanel.classList.remove("hidden");

  // Load data for tab
  switch (tab) {
    case "calendar": loadCalendarPosts(); break;
    case "queue": loadQueuePosts(); break;
    case "assets": loadAssets(); break;
    case "templates": loadTemplates(); break;
    case "boards": renderBoardList(); break;
    case "autoqueue": loadAutoQueueStats(); break;
    case "analytics": loadAnalytics(); break;
    case "carousel": loadRecentCarousels(); break;
  }
}

// ============================================
// Start
// ============================================

document.addEventListener("DOMContentLoaded", () => {
  init();
  initPostAnalyticsModal();
  initLearningInsights();
});

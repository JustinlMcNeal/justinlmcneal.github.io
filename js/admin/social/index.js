// /js/admin/social/index.js
// Main entry point for Social Media Admin

import { getSupabaseClient } from "../../shared/supabaseClient.js";
import { initAdminNav } from "../../shared/adminNav.js";
import {
  fetchProducts,
  fetchProductGalleryImages,
  fetchCategories,
  fetchAssets,
  fetchPosts,
  fetchTemplates,
  fetchBoards,
  fetchSettings,
  fetchStats,
  createAsset,
  createVariations,
  createPosts,
  updatePost,
  deletePost,
  recalculateProductPostDate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createBoard,
  updateBoard,
  deleteBoard,
  updateSetting,
  uploadImage,
  getPublicUrl,
  getHashtagsForCategory
} from "./api.js";
import { initCalendar, getCalendarDateRange } from "./calendar.js";
import {
  generateCaption,
  getHashtagsForProduct,
  formatHashtags,
  parseHashtags,
  ensureKarryKrazeTag,
  clearTemplateCache,
  getTemplatesForTone
} from "./captions.js";
import {
  ASPECT_RATIOS,
  loadImageFromFile,
  generateVariations,
  getFilePreviewUrl,
  revokePreviewUrl,
  generateFilename,
  getAssetPath,
  getVariationPath
} from "./imageProcessor.js";
import {
  BEST_PRACTICES,
  analyzePost,
  updateHashtagPerformance,
  updateTimingPerformance,
  updateCaptionPerformance,
  generateRecommendations,
  getTopHashtags,
  getBestPostingTimes,
  getActiveRecommendations,
  getLearnedPatterns,
  getPostCreationTips,
  checkAndResearchCategories,
  getAllCategoryInsights,
  getCategoryInsights
} from "./postLearning.js";

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
  // Carousel state
  carousel: {
    images: [],       // Array of { file, previewUrl, uploadedUrl, productGalleryUrl }
    productId: null,
    productGalleryImages: [], // Images from selected product for quick selection
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
  // Remove any existing toast
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
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// DOM Elements
// ============================================

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MzQ5NDAsImV4cCI6MjA4MTMxMDk0MH0.cuCteItNo6yFCYcot0Vx7kUOUtV0r-iCwJ_ACAiKGso";
const SUPABASE_FUNCTIONS_URL = "https://yxdzvzscufkvewecvagq.supabase.co/functions/v1";

// Module-level supabase client for use in modal functions
let supabaseClient = null;
function getClient() {
  if (!supabaseClient) {
    supabaseClient = getSupabaseClient();
  }
  return supabaseClient;
}

// Handle Pinterest OAuth redirect
function handlePinterestOAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  // Only handle Pinterest if no Instagram state param is present
  if (code && !params.get("state")?.includes("instagram")) {
    fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-oauth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ code }),
    })
    .then(res => res.json())
    .then(data => {
      console.log("Pinterest token response:", data);
      if (data.access_token) {
        alert("Pinterest connected successfully!");
        // Clear the code from URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Reload to update UI
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

// Handle Instagram OAuth redirect
function handleInstagramOAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  
  // Only handle if state indicates Instagram
  if (code && state === "instagram") {
    // Clear the code from URL immediately to prevent duplicate requests
    window.history.replaceState({}, document.title, window.location.pathname);
    
    fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-oauth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ code }),
    })
    .then(res => res.json())
    .then(data => {
      console.log("Instagram token response:", data);
      if (data.success) {
        alert(`Instagram connected successfully! Welcome @${data.username}`);
        // Reload to update UI
        location.reload();
      } else {
        console.error("Instagram OAuth error:", data);
        // Show more details in console
        if (data.debug) {
          console.log("Debug info:", data.debug);
        }
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

// Post to Instagram
async function postToInstagram(postId, imageUrl, caption) {
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-post`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ postId, imageUrl, caption }),
    });
    
    const data = await resp.json();
    
    if (data.success) {
      alert("Posted to Instagram successfully!");
      return data;
    } else {
      alert(`Failed to post to Instagram: ${data.error}`);
      return null;
    }
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ postId, imageUrl, caption, linkUrl }),
    });
    
    const data = await resp.json();
    
    if (data.success) {
      alert("Posted to Facebook successfully!");
      return data;
    } else {
      alert(`Failed to post to Facebook: ${data.error}`);
      return null;
    }
  } catch (err) {
    console.error("Facebook post error:", err);
    alert("Failed to post to Facebook. Check console for details.");
    return null;
  }
}

// Test posting to Instagram (for development/testing)
window.testInstagramPost = async function() {
  // Check if connected first
  const client = getSupabaseClient();
  const { data: settings } = await client
    .from("social_settings")
    .select("setting_value")
    .eq("setting_key", "instagram_connected")
    .single();
  
  if (!settings?.setting_value) {
    alert("Please connect Instagram first!");
    return;
  }
  
  // Prompt for test image URL and caption
  const imageUrl = prompt(
    "Enter a public image URL to post to Instagram:\n\n" +
    "(Must be a publicly accessible image URL, e.g., from your Supabase storage or website)"
  );
  
  if (!imageUrl) return;
  
  const caption = prompt("Enter a caption for the post:", "Test post from KarryKraze Social Manager 🛒✨ #karrykraze #test");
  
  if (caption === null) return;
  
  if (!confirm(`Ready to post to Instagram:\n\nImage: ${imageUrl}\nCaption: ${caption}\n\nProceed?`)) {
    return;
  }
  
  try {
    // Show loading state
    alert("Posting to Instagram... This may take a few seconds.");
    
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-post`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ 
        postId: null, // No post record for test
        imageUrl, 
        caption 
      }),
    });
    
    const data = await resp.json();
    console.log("Instagram test post response:", data);
    
    if (data.success) {
      alert(`🎉 Posted to Instagram successfully!\n\nInstagram Media ID: ${data.mediaId}`);
    } else {
      alert(`Failed to post: ${data.error}\n\nCheck console for details.`);
    }
  } catch (err) {
    console.error("Test post error:", err);
    alert("Failed to post. Check console for details.");
  }
};

// Post to Pinterest
async function postToPinterest(postId, imageUrl, title, description, link, boardId) {
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-post`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ postId, imageUrl, title, description, link, boardId }),
    });
    
    const data = await resp.json();
    
    if (data.success) {
      alert("Pin created successfully!");
      return data;
    } else {
      alert(`Failed to post: ${data.error}`);
      return null;
    }
  } catch (err) {
    console.error("Pinterest post error:", err);
    alert("Failed to post to Pinterest. Check console for details.");
    return null;
  }
}

// Fetch Pinterest boards from API
async function fetchPinterestBoards() {
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-boards`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    
    const data = await resp.json();
    console.log("Pinterest boards response:", data);
    
    if (data.success) {
      return data.boards;
    } else {
      console.error("Failed to fetch Pinterest boards:", data.error, data.debug);
      return [];
    }
  } catch (err) {
    console.error("Pinterest boards fetch error:", err);
    return [];
  }
}

// Populate board dropdown with Pinterest boards
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
  
  // Assets
  assetGrid: $("assetGrid"),
  assetSearch: $("assetSearch"),
  
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
    // Init admin nav first
    await initAdminNav("Social Media");
    
    // Check auth
    const client = getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      window.location.href = "/pages/admin/login.html";
      return;
    }
    
    // Load initial data
    await Promise.all([
      loadProducts(),
      loadCategories(),
      loadBoards(),
      loadSettings(),
      loadStats(),
      checkConnectionStatus()
    ]);
    
    // Setup UI
    setupTabs();
    setupUploadModal();
    setupSettingsModal();
    setupPostDetailModal();
    setupCalendar();
    setupQueueFilter();
    setupTemplates();
    setupBoards();
    setupAutoQueue();
    setupAutopilot();
    setupAnalytics();
    setupCarouselBuilder();
    
    // Show calendar tab by default
    switchTab("calendar");

    // Pinterest connect button handler
    if (els["connect-pinterest"] || document.getElementById("connect-pinterest")) {
      (els["connect-pinterest"] || document.getElementById("connect-pinterest")).addEventListener("click", () => {
        const appId = "1542566";
        const redirectUri = encodeURIComponent("https://karrykraze.com/pages/admin/social.html");
        const scope = "pins:read,pins:write,boards:read,boards:write";
        const oauthUrl = `https://www.pinterest.com/oauth/?response_type=code&client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}`;
        window.location.href = oauthUrl;
      });
    }

    // Instagram connect button handler (uses Facebook Login for Business accounts)
    const instagramBtn = document.getElementById("connect-instagram");
    if (instagramBtn) {
      instagramBtn.addEventListener("click", () => {
        // Instagram Graph API via Facebook Login (for Business/Creator accounts)
        const appId = "2162145877936737";
        const redirectUri = encodeURIComponent("https://karrykraze.com/pages/admin/social.html");
        // Instagram API with Facebook login permissions
        const scope = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,business_management,pages_show_list";
        const state = "instagram";
        // Force re-authorization to show page selection
        const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;
        window.location.href = oauthUrl;
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
  // Fetch boards from Pinterest API instead of local database
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

// Check connection status for both platforms
async function checkConnectionStatus() {
  const client = getSupabaseClient();
  
  // Check Instagram
  const { data: igData } = await client
    .from("social_settings")
    .select("setting_key, setting_value")
    .in("setting_key", ["instagram_connected", "instagram_username"]);
  
  const igConnected = igData?.find(s => s.setting_key === "instagram_connected")?.setting_value?.connected;
  const igUsername = igData?.find(s => s.setting_key === "instagram_username")?.setting_value?.username;
  
  const igStatusIcon = document.getElementById("instagramStatusIcon");
  const igStatusText = document.getElementById("instagramStatusText");
  const igConnectBtn = document.getElementById("connect-instagram");
  const igTestBtn = document.getElementById("instagramTestBtn");
  
  if (igConnected && igUsername) {
    if (igStatusIcon) igStatusIcon.textContent = "●";
    if (igStatusIcon) igStatusIcon.classList.replace("text-gray-400", "text-green-500");
    if (igStatusText) igStatusText.textContent = `@${igUsername}`;
    if (igStatusText) igStatusText.classList.replace("text-gray-400", "text-green-600");
    if (igTestBtn) igTestBtn.classList.remove("hidden"); // Show test post button
    if (igConnectBtn) {
      igConnectBtn.innerHTML = `
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
        <span class="hidden xs:inline">✓</span> Instagram
      `;
      igConnectBtn.classList.remove("from-purple-500", "via-pink-500", "to-orange-500");
      igConnectBtn.classList.add("bg-green-600");
    }
  }
  
  // Check Pinterest
  const { data: pinData } = await client
    .from("social_settings")
    .select("setting_key, setting_value")
    .in("setting_key", ["pinterest_connected"]);
  
  const pinConnected = pinData?.find(s => s.setting_key === "pinterest_connected")?.setting_value?.connected;
  
  const pinStatusIcon = document.getElementById("pinterestStatusIcon");
  const pinStatusText = document.getElementById("pinterestStatusText");
  const pinConnectBtn = document.getElementById("connect-pinterest");
  
  if (pinConnected) {
    if (pinStatusIcon) pinStatusIcon.textContent = "●";
    if (pinStatusIcon) pinStatusIcon.classList.replace("text-gray-400", "text-green-500");
    if (pinStatusText) pinStatusText.textContent = "Connected";
    if (pinStatusText) pinStatusText.classList.replace("text-gray-400", "text-green-600");
    if (pinConnectBtn) {
      pinConnectBtn.innerHTML = `
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.406.042-3.442.218-.936 1.407-5.965 1.407-5.965s-.359-.719-.359-1.781c0-1.669.967-2.914 2.171-2.914 1.024 0 1.518.769 1.518 1.69 0 1.03-.655 2.569-.994 3.995-.283 1.195.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.208 0 1.031.397 2.137.893 2.739.098.119.112.223.083.344-.091.378-.293 1.194-.333 1.361-.052.218-.173.265-.4.16-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.966 7.398 6.931 0 4.136-2.608 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
        </svg>
        <span class="hidden xs:inline">✓</span> Pinterest
      `;
      pinConnectBtn.classList.remove("bg-pinterest");
      pinConnectBtn.classList.add("bg-green-600");
    }
  }
}

async function loadCalendarPosts() {
  const range = getCalendarDateRange();
  const posts = await fetchPosts({
    startDate: range.start,
    endDate: range.end
  });
  calendar.setPosts(posts);
}

async function loadQueuePosts() {
  const platform = els.queueFilter.value;
  const filters = { status: "queued" };
  if (platform !== "all") {
    filters.platform = platform;
  }
  
  const posts = await fetchPosts(filters);
  renderQueueList(posts);
}

async function loadAssets() {
  const assets = await fetchAssets();
  renderAssetGrid(assets);
}

async function loadTemplates() {
  state.templates = await fetchTemplates();
  renderTemplateList();
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
  if (activePanel) {
    activePanel.classList.remove("hidden");
  }
  
  // Load data for tab
  switch (tab) {
    case "calendar":
      loadCalendarPosts();
      break;
    case "queue":
      loadQueuePosts();
      break;
    case "assets":
      loadAssets();
      break;
    case "templates":
      loadTemplates();
      break;
    case "boards":
      renderBoardList();
      break;
    case "autoqueue":
      loadAutoQueueStats();
      break;
    case "analytics":
      loadAnalytics();
      break;
    case "carousel":
      loadRecentCarousels();
      break;
  }
}

// ============================================
// Calendar
// ============================================

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

function renderQueueList(posts) {
  if (!posts.length) {
    els.queueList.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <p>No scheduled posts yet</p>
        <button class="mt-2 text-sm text-black font-medium hover:underline" onclick="document.getElementById('btnUpload').click()">
          Create your first post →
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
      weekday: "short",
      month: "short",
      day: "numeric"
    });
    const timeStr = scheduledDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    });
    
    return `
      <div class="queue-item cursor-pointer" data-post-id="${post.id}">
        <img src="${imageUrl}" alt="" class="queue-item-image">
        <div class="queue-item-content">
          <div class="queue-item-caption">${post.caption || "No caption"}</div>
          <div class="queue-item-meta">
            <span class="badge badge-${post.platform}">${post.platform === "instagram" ? "📸" : "📌"} ${post.platform}</span>
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
// Assets
// ============================================

function renderAssetGrid(assets) {
  if (!assets.length) {
    els.assetGrid.innerHTML = `
      <div class="col-span-full p-8 text-center text-gray-400">
        <p>No assets uploaded yet</p>
      </div>
    `;
    return;
  }
  
  els.assetGrid.innerHTML = assets.map(asset => {
    console.log("[renderAssetGrid] Asset:", asset.id, "path:", asset.original_image_path);
    const imageUrl = asset.original_image_path 
      ? getPublicUrl(asset.original_image_path)
      : "/imgs/placeholder.jpg";
    console.log("[renderAssetGrid] Generated URL:", imageUrl);
    
    const productName = asset.product?.name || "No product linked";
    
    return `
      <div class="asset-card cursor-pointer hover:ring-2 hover:ring-black transition-all" data-asset-id="${asset.id}">
        <img src="${imageUrl}" alt="${productName}" loading="lazy" onerror="this.src='/imgs/placeholder.jpg'; console.error('Image failed to load:', '${imageUrl}')">
        <div class="asset-card-overlay">
          <div class="asset-card-info">
            <div class="font-medium">${productName}</div>
            <div class="text-xs opacity-75">Click to create post</div>
          </div>
        </div>
      </div>
    `;
  }).join("");
  
  // Add click handlers to asset cards
  els.assetGrid.querySelectorAll(".asset-card").forEach(card => {
    card.addEventListener("click", () => {
      const assetId = card.dataset.assetId;
      const asset = assets.find(a => a.id === assetId);
      if (asset) {
        openUploadModalWithAsset(asset);
      }
    });
  });
}

// Open upload modal pre-populated with an existing asset
function openUploadModalWithAsset(asset) {
  resetUploadState();
  
  // Pre-populate with asset data
  const imageUrl = asset.original_image_path 
    ? getPublicUrl(asset.original_image_path)
    : null;
  
  if (imageUrl) {
    state.uploadData.previewUrl = imageUrl;
    state.uploadData.existingAssetId = asset.id;
    els.previewImg.src = imageUrl;
    els.imagePreview.classList.remove("hidden");
    els.dropZone.classList.add("hidden");
  }
  
  // Set product if linked - use the new searchable UI
  if (asset.product_id && asset.product) {
    state.uploadData.productId = asset.product_id;
    els.productSelect.value = asset.product_id;
    // Update the searchable product UI
    if (els.selectedProductName && els.selectedProduct && els.productSearch) {
      els.selectedProductName.textContent = asset.product.name;
      els.selectedProduct.classList.remove("hidden");
      els.productSearch.classList.add("hidden");
    }
  }
  
  els.uploadModal.classList.remove("hidden");
  els.uploadModal.classList.add("flex");
}

// ============================================
// Templates
// ============================================

function setupTemplates() {
  // Tone tabs
  document.querySelectorAll(".tone-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tone-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderTemplateList(tab.dataset.tone);
    });
  });
  
  // Set casual as default active
  document.querySelector('.tone-tab[data-tone="casual"]')?.classList.add("active");
  
  // Add template button
  els.btnAddTemplate?.addEventListener("click", () => {
    const activeTone = document.querySelector(".tone-tab.active")?.dataset.tone || "casual";
    const template = prompt("Enter new caption template:\n\nUse placeholders: {product_name}, {category}, {link}");
    if (template) {
      addTemplate(activeTone, template);
    }
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
        <button class="btn-edit-template p-2 hover:bg-gray-100 rounded" title="Edit">✏️</button>
        <button class="btn-delete-template p-2 hover:bg-red-50 rounded text-red-500" title="Delete">🗑️</button>
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
        if (newText && newText !== template.template) {
          editTemplate(templateId, newText);
        }
      }
    });
  });
  
  // Delete handlers
  els.templateList.querySelectorAll(".btn-delete-template").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const templateId = btn.closest(".template-item").dataset.templateId;
      if (confirm("Delete this template?")) {
        removeTemplate(templateId);
      }
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
    if (name) {
      addBoard(name);
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
          ${board.is_default ? " • Default board" : ""}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <select class="board-category-select text-sm border rounded px-2 py-1" data-board-id="${board.id}">
          <option value="">No category</option>
          ${state.categories.map(c => `
            <option value="${c.id}" ${board.category_id === c.id ? "selected" : ""}>${c.name}</option>
          `).join("")}
        </select>
        <button class="btn-delete-board p-2 hover:bg-red-50 rounded text-red-500" title="Delete">🗑️</button>
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
// Upload Modal
// ============================================

function setupUploadModal() {
  // Open modal
  els.btnUpload?.addEventListener("click", openUploadModal);
  
  // Close modal
  els.btnCloseUpload?.addEventListener("click", closeUploadModal);
  els.uploadModal?.addEventListener("click", (e) => {
    if (e.target === els.uploadModal) closeUploadModal();
  });
  
  // File drop zone
  els.dropZone?.addEventListener("click", () => els.fileInput.click());
  els.dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropZone.classList.add("drag-over");
  });
  els.dropZone?.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("drag-over");
  });
  els.dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleFileSelect(file);
    }
  });
  
  els.fileInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFileSelect(file);
  });
  
  // Change image button
  els.btnChangeImage?.addEventListener("click", (e) => {
    e.stopPropagation();
    // Reset image state and show drop zone
    state.uploadData.file = null;
    state.uploadData.previewUrl = null;
    state.uploadData.existingAssetId = null;
    els.fileInput.value = "";
    els.imagePreview.classList.add("hidden");
    els.dropZone.classList.remove("hidden");
    els.fileInput.click();
  });
  
  // Searchable product selector
  setupProductSearch();
  
  // Navigation
  els.btnPrevStep?.addEventListener("click", prevStep);
  els.btnNextStep?.addEventListener("click", nextStep);
  els.btnSchedulePost?.addEventListener("click", schedulePost);
  
  // Caption tone buttons
  document.querySelectorAll(".caption-tone-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".caption-tone-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.uploadData.tone = btn.dataset.tone;
      regenerateCaption();
    });
  });
  
  // Regenerate caption
  els.btnRegenerateCaption?.addEventListener("click", regenerateCaption);
  
  // Setup post counters and engagement score
  setupPostCounters();
  
  // Pinterest toggle
  els.postPinterest?.addEventListener("change", () => {
    els.pinterestBoardSelect.classList.toggle("hidden", !els.postPinterest.checked);
  });
  
  // Set default date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  els.scheduleDate.value = tomorrow.toISOString().split("T")[0];
}

function openUploadModal() {
  resetUploadState();
  els.uploadModal.classList.remove("hidden");
  els.uploadModal.classList.add("flex");
}

function closeUploadModal() {
  els.uploadModal.classList.add("hidden");
  els.uploadModal.classList.remove("flex");
  resetUploadState();
}

function resetUploadState() {
  state.uploadStep = 1;
  state.uploadData = {
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
  
  // Reset UI
  els.fileInput.value = "";
  els.imagePreview.classList.add("hidden");
  els.dropZone.classList.remove("hidden"); // Show drop zone again
  els.productSelect.value = "";
  els.captionText.value = "";
  els.hashtagText.value = "";
  els.varSquare.checked = true;
  els.varPortrait.checked = true;
  els.varVertical.checked = true;
  els.varTall.checked = false;
  els.postInstagram.checked = true;
  els.postPinterest.checked = true;
  els.pinterestBoardSelect.classList.add("hidden");
  
  // Reset product search UI
  if (els.productSearch) {
    els.productSearch.value = "";
    els.productSearch.classList.remove("hidden");
  }
  if (els.selectedProduct) {
    els.selectedProduct.classList.add("hidden");
  }
  if (els.productDropdown) {
    els.productDropdown.classList.add("hidden");
  }
  
  // Hide product images section
  const productImagesSection = document.getElementById('productImagesSection');
  if (productImagesSection) {
    productImagesSection.classList.add('hidden');
  }
  
  // Reset crop previews
  resetCropPreviews();
  
  document.querySelectorAll(".caption-tone-btn").forEach(b => b.classList.remove("active"));
  document.querySelector('.caption-tone-btn[data-tone="casual"]')?.classList.add("active");
  
  updateStepUI();
}

function handleFileSelect(file) {
  state.uploadData.file = file;
  state.uploadData.previewUrl = getFilePreviewUrl(file);
  
  els.previewImg.src = state.uploadData.previewUrl;
  els.imagePreview.classList.remove("hidden");
  els.dropZone.classList.add("hidden");
}

function setupProductSearch() {
  if (!els.productSearch || !els.productDropdown) return;
  
  let debounceTimer = null;
  
  // Search input handler
  els.productSearch.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      filterProducts(e.target.value);
    }, 200);
  });
  
  // Focus shows dropdown
  els.productSearch.addEventListener("focus", () => {
    if (state.products?.length) {
      filterProducts(els.productSearch.value);
    }
  });
  
  // Click outside to close
  document.addEventListener("click", (e) => {
    if (!els.productSearch.contains(e.target) && !els.productDropdown.contains(e.target)) {
      els.productDropdown.classList.add("hidden");
    }
  });
  
  // Clear product button
  els.btnClearProduct?.addEventListener("click", () => {
    state.uploadData.productId = null;
    els.productSelect.value = "";
    els.selectedProduct.classList.add("hidden");
    els.productSearch.value = "";
    els.productSearch.classList.remove("hidden");
  });
}

function filterProducts(query) {
  if (!state.products?.length) {
    els.productDropdown.innerHTML = '<div class="p-3 text-sm text-gray-400">No products loaded</div>';
    els.productDropdown.classList.remove("hidden");
    return;
  }
  
  const filtered = state.products.filter(p => 
    p.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 10); // Limit to 10 results
  
  if (filtered.length === 0) {
    els.productDropdown.innerHTML = `
      <div class="p-4 text-center">
        <div class="text-gray-400 text-sm">No products found</div>
        <div class="text-xs text-gray-300 mt-1">Try a different search term</div>
      </div>
    `;
  } else {
    const placeholderImg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect fill="#f3f4f6" width="40" height="40"/><rect x="12" y="12" width="16" height="16" rx="2" fill="#d1d5db"/></svg>');
    els.productDropdown.innerHTML = filtered.map(p => {
      // Use catalog_image_url from the products table
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
    
    // Add click handlers
    els.productDropdown.querySelectorAll(".product-option").forEach(option => {
      option.addEventListener("click", () => {
        const productId = option.dataset.id;
        const product = state.products.find(p => p.id === productId);
        if (product) {
          selectProduct(product);
        }
      });
    });
  }
  
  els.productDropdown.classList.remove("hidden");
}

async function selectProduct(product) {
  state.uploadData.productId = product.id;
  els.productSelect.value = product.id;
  
  // Update selected product display with image
  const placeholderImg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect fill="#f3f4f6" width="40" height="40"/><rect x="12" y="12" width="16" height="16" rx="2" fill="#d1d5db"/></svg>');
  const imageUrl = product.catalog_image_url || placeholderImg;
  const price = product.price ? `$${parseFloat(product.price).toFixed(2)}` : '';
  
  els.selectedProduct.innerHTML = `
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
  
  // Re-attach clear button handler
  els.selectedProduct.querySelector('#btnClearProduct')?.addEventListener('click', () => {
    clearProductSelection();
  });
  
  els.selectedProduct.classList.remove("hidden");
  els.productSearch.classList.add("hidden");
  els.productDropdown.classList.add("hidden");
  
  // Fetch and display product images
  await loadProductImages(product);
}

// Clear product selection and hide product images
function clearProductSelection() {
  state.uploadData.productId = null;
  els.productSelect.value = '';
  els.selectedProduct.classList.add('hidden');
  els.productSearch.value = '';
  els.productSearch.classList.remove('hidden');
  
  // Hide product images section
  const productImagesSection = document.getElementById('productImagesSection');
  if (productImagesSection) {
    productImagesSection.classList.add('hidden');
  }
}

// Load and display product images for selection
async function loadProductImages(product) {
  const productImagesSection = document.getElementById('productImagesSection');
  const productImagesGrid = document.getElementById('productImagesGrid');
  
  if (!productImagesSection || !productImagesGrid) return;
  
  // Show loading state
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
    // Build list of all product images
    const allImages = [];
    
    // Add catalog image first if it exists
    if (product.catalog_image_url) {
      allImages.push({
        url: product.catalog_image_url,
        label: 'Catalog Image',
        isPrimary: true
      });
    }
    
    // Fetch gallery images
    const galleryImages = await fetchProductGalleryImages(product.id);
    galleryImages.forEach((img, idx) => {
      allImages.push({
        url: img.url,
        label: `Gallery ${idx + 1}`,
        isPrimary: false
      });
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
    
    // Render image grid
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
    
    // Add click handlers
    productImagesGrid.querySelectorAll('.product-image-option').forEach(option => {
      option.addEventListener('click', async () => {
        const imageUrl = option.dataset.url;
        await useProductImage(imageUrl);
      });
    });
    
  } catch (error) {
    console.error('Error loading product images:', error);
    productImagesGrid.innerHTML = `
      <div class="col-span-full text-center py-4 text-red-400 text-sm">
        Failed to load images
      </div>
    `;
  }
}

// Use a product image as the post image
async function useProductImage(imageUrl) {
  try {
    // Fetch the image as a blob
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Create a File object from the blob
    const fileName = imageUrl.split('/').pop() || 'product-image.jpg';
    const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
    
    // Update state and preview
    state.uploadData.file = file;
    
    // Revoke old preview URL if exists
    if (state.uploadData.previewUrl) {
      revokePreviewUrl(state.uploadData.previewUrl);
    }
    
    // Create new preview URL
    state.uploadData.previewUrl = getFilePreviewUrl(file);
    
    // Update UI
    els.previewImg.src = state.uploadData.previewUrl;
    els.imagePreview.classList.remove('hidden');
    els.dropZone.classList.add('hidden');
    
    // Show success feedback
    showToast('Product image selected! Click "Next" to continue.', 'success');
    
  } catch (error) {
    console.error('Error using product image:', error);
    showToast('Failed to load image. Please try again.', 'error');
  }
}

// ─────────────────────────────────────────────────────────────
// Step 2: Crop Preview & Analysis
// ─────────────────────────────────────────────────────────────

const CROP_RATIOS = {
  square: { width: 1, height: 1, name: 'Square', platform: 'Instagram' },
  portrait: { width: 4, height: 5, name: 'Portrait', platform: 'Instagram' },
  vertical: { width: 2, height: 3, name: 'Vertical', platform: 'Pinterest' },
  tall: { width: 1, height: 2.1, name: 'Tall', platform: 'Pinterest' }
};

/**
 * Generate crop previews for all formats when entering Step 2
 */
async function generateCropPreviews() {
  const previewUrl = state.uploadData.previewUrl;
  if (!previewUrl) return;
  
  try {
    // Load the source image
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
    
    // Show dimension info
    if (els.imageDimensionInfo) {
      els.imageDimensionInfo.classList.remove('hidden');
      els.sourceDimensions.textContent = `${srcWidth} × ${srcHeight}`;
    }
    
    // Generate each preview
    await Promise.all([
      generateSinglePreview(img, 'square', srcRatio),
      generateSinglePreview(img, 'portrait', srcRatio),
      generateSinglePreview(img, 'vertical', srcRatio),
      generateSinglePreview(img, 'tall', srcRatio)
    ]);
    
    // Analyze and show recommendations
    analyzeImageForCrops(srcWidth, srcHeight, srcRatio);
    
    // Load performance insights
    await loadStep2Insights();
    
  } catch (error) {
    console.error('Error generating crop previews:', error);
  }
}

/**
 * Generate a single crop preview on its canvas
 */
function generateSinglePreview(img, cropType, srcRatio) {
  const ratio = CROP_RATIOS[cropType];
  const targetRatio = ratio.width / ratio.height;
  
  const canvasId = `preview${cropType.charAt(0).toUpperCase() + cropType.slice(1)}`;
  const placeholderId = `preview${cropType.charAt(0).toUpperCase() + cropType.slice(1)}Placeholder`;
  
  const canvas = els[canvasId];
  const placeholder = els[placeholderId];
  
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const displaySize = 200; // Preview size
  
  // Set canvas dimensions based on aspect ratio
  if (targetRatio >= 1) {
    canvas.width = displaySize;
    canvas.height = displaySize / targetRatio;
  } else {
    canvas.height = displaySize;
    canvas.width = displaySize * targetRatio;
  }
  
  // Calculate crop area (center crop)
  let sx, sy, sWidth, sHeight;
  
  if (srcRatio > targetRatio) {
    // Source is wider - crop sides
    sHeight = img.naturalHeight;
    sWidth = sHeight * targetRatio;
    sx = (img.naturalWidth - sWidth) / 2;
    sy = 0;
  } else {
    // Source is taller - crop top/bottom
    sWidth = img.naturalWidth;
    sHeight = sWidth / targetRatio;
    sx = 0;
    sy = (img.naturalHeight - sHeight) / 2;
  }
  
  // Draw cropped preview
  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
  
  // Hide placeholder, show canvas
  if (placeholder) placeholder.classList.add('hidden');
  canvas.classList.remove('hidden');
}

/**
 * Analyze image dimensions and provide recommendations
 */
function analyzeImageForCrops(srcWidth, srcHeight, srcRatio) {
  const recommendations = [];
  const badges = {
    square: { show: false, type: 'good', text: '✓ Good fit' },
    portrait: { show: false, type: 'best', text: '🔥 Best' },
    vertical: { show: false, type: 'good', text: '✓ Good fit' },
    tall: { show: false, type: 'warn', text: '⚠️ Crop' }
  };
  
  // Analyze each crop
  const squareRatio = 1;
  const portraitRatio = 4/5;
  const verticalRatio = 2/3;
  const tallRatio = 1/2.1;
  
  // Determine best fit based on source ratio
  if (srcRatio >= 0.9 && srcRatio <= 1.1) {
    // Square-ish source
    recommendations.push('Your image is square - great for Instagram feed posts!');
    badges.square = { show: true, type: 'best', text: '🔥 Perfect' };
    badges.portrait = { show: true, type: 'good', text: '✓ Good fit' };
  } else if (srcRatio >= 0.7 && srcRatio < 0.9) {
    // Portrait-ish source
    recommendations.push('Your image is portrait-oriented - ideal for Instagram portrait posts!');
    badges.portrait = { show: true, type: 'best', text: '🔥 Perfect' };
    badges.vertical = { show: true, type: 'good', text: '✓ Good fit' };
  } else if (srcRatio >= 0.5 && srcRatio < 0.7) {
    // Vertical-ish source
    recommendations.push('Your vertical image is perfect for Pinterest pins!');
    badges.vertical = { show: true, type: 'best', text: '🔥 Perfect' };
    badges.portrait = { show: true, type: 'good', text: '✓ Good fit' };
  } else if (srcRatio < 0.5) {
    // Very tall source
    recommendations.push('Your tall image is ideal for Pinterest Idea pins!');
    badges.tall = { show: true, type: 'best', text: '🔥 Perfect' };
    badges.vertical = { show: true, type: 'good', text: '✓ Good fit' };
  } else if (srcRatio > 1.1) {
    // Landscape source
    recommendations.push('Landscape image detected - square crop will work best. Some content will be cropped for vertical formats.');
    badges.square = { show: true, type: 'good', text: '✓ Best fit' };
    badges.tall = { show: true, type: 'warn', text: '⚠️ Heavy crop' };
  }
  
  // Resolution warnings
  if (srcWidth < 1080 || srcHeight < 1080) {
    recommendations.push('Consider using a higher resolution image (1080px min) for best quality.');
  }
  
  // Show analysis banner
  if (recommendations.length > 0 && els.imageAnalysisBanner) {
    els.imageAnalysisBanner.classList.remove('hidden');
    els.imageAnalysisText.textContent = recommendations[0];
  }
  
  // Show badges
  Object.entries(badges).forEach(([crop, badge]) => {
    const badgeEl = els[`${crop}Badge`];
    const cardEl = els[`var${crop.charAt(0).toUpperCase() + crop.slice(1)}Card`];
    
    if (badgeEl) {
      if (badge.show) {
        badgeEl.classList.remove('hidden');
        const span = badgeEl.querySelector('span');
        if (span) {
          span.textContent = badge.text;
          // Update badge colors
          span.className = 'text-xs px-1.5 py-0.5 rounded-full ';
          if (badge.type === 'best') {
            span.className += 'bg-amber-100 text-amber-700';
          } else if (badge.type === 'good') {
            span.className += 'bg-green-100 text-green-700';
          } else if (badge.type === 'warn') {
            span.className += 'bg-yellow-100 text-yellow-700';
          }
        }
      } else {
        badgeEl.classList.add('hidden');
      }
    }
    
    // Highlight best cards
    if (cardEl && badge.show && badge.type === 'best') {
      cardEl.classList.add('border-amber-300', 'bg-amber-50/30');
    }
  });
}

/**
 * Load performance insights for Step 2 from learning data
 */
async function loadStep2Insights() {
  try {
    const client = getClient();
    
    // Fetch format performance from learning patterns
    const { data: patterns } = await client
      .from('post_learning_patterns')
      .select('*')
      .in('pattern_key', ['best_format', 'portrait_performance', 'vertical_performance', 'carousel_engagement']);
    
    // Fetch actual post stats by format if available
    const { data: formatStats } = await client
      .from('social_posts')
      .select('variation_type, platform, likes, comments, saves')
      .not('likes', 'is', null);
    
    // Calculate format insights
    let insights = [];
    
    // Add carousel insight from patterns
    const carouselPattern = patterns?.find(p => p.pattern_key === 'carousel_engagement');
    if (carouselPattern) {
      insights.push({
        color: 'purple',
        text: `Carousel posts have <strong>${carouselPattern.pattern_value.engagement_boost || '2.4%'}</strong> higher engagement`
      });
    }
    
    // Add format-specific insights
    insights.push({
      color: 'pink',
      text: 'Portrait (4:5) posts take up <strong>more screen space</strong> in feeds'
    });
    
    insights.push({
      color: 'red',
      text: 'Pinterest vertical pins get <strong>60% more saves</strong> than square'
    });
    
    // Render insights
    if (els.step2InsightsContent && insights.length > 0) {
      els.step2InsightsContent.innerHTML = insights.map(insight => `
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

/**
 * Reset crop previews when modal closes
 */
function resetCropPreviews() {
  ['Square', 'Portrait', 'Vertical', 'Tall'].forEach(name => {
    const canvas = els[`preview${name}`];
    const placeholder = els[`preview${name}Placeholder`];
    const badge = els[`${name.toLowerCase()}Badge`];
    const card = els[`var${name}Card`];
    
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (badge) badge.classList.add('hidden');
    if (card) card.classList.remove('border-amber-300', 'bg-amber-50/30');
  });
  
  if (els.imageAnalysisBanner) els.imageAnalysisBanner.classList.add('hidden');
  if (els.imageDimensionInfo) els.imageDimensionInfo.classList.add('hidden');
}

function updateStepUI() {
  const step = state.uploadStep;
  
  // Hide all steps
  els.uploadStep1.classList.add("hidden");
  els.uploadStep2.classList.add("hidden");
  els.uploadStep3.classList.add("hidden");
  
  // Show current step
  if (step === 1) els.uploadStep1.classList.remove("hidden");
  if (step === 2) els.uploadStep2.classList.remove("hidden");
  if (step === 3) els.uploadStep3.classList.remove("hidden");
  
  // Update indicators
  els.step1Indicator.className = step >= 1 ? "w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold" : "w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-bold";
  els.step2Indicator.className = step >= 2 ? "w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold" : "w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-bold";
  els.step3Indicator.className = step >= 3 ? "w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold" : "w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-bold";
  
  // Update buttons
  els.btnPrevStep.classList.toggle("hidden", step === 1);
  els.btnNextStep.classList.toggle("hidden", step === 3);
  els.btnSchedulePost.classList.toggle("hidden", step !== 3);
}

function prevStep() {
  if (state.uploadStep > 1) {
    state.uploadStep--;
    updateStepUI();
  }
}

async function nextStep() {
  if (state.uploadStep === 1) {
    // Validate file selected OR existing asset
    if (!state.uploadData.file && !state.uploadData.existingAssetId && !state.uploadData.previewUrl) {
      alert("Please select an image first");
      return;
    }
    
    state.uploadData.productId = els.productSelect.value || null;
    state.uploadStep = 2;
    updateStepUI();
    
    // Generate crop previews for Step 2
    await generateCropPreviews();
    
  } else if (state.uploadStep === 2) {
    // Collect selected variants
    state.uploadData.selectedVariants = [];
    if (els.varSquare.checked) state.uploadData.selectedVariants.push("square_1x1");
    if (els.varPortrait.checked) state.uploadData.selectedVariants.push("portrait_4x5");
    if (els.varVertical.checked) state.uploadData.selectedVariants.push("vertical_2x3");
    if (els.varTall.checked) state.uploadData.selectedVariants.push("tall_1x2");
    
    if (!state.uploadData.selectedVariants.length) {
      alert("Please select at least one variation");
      return;
    }
    
    state.uploadStep = 3;
    updateStepUI();
    
    // Generate caption
    await regenerateCaption();
    
    // Load AI tips for caption
    loadAICaptionTips();
    
    // Show Pinterest board selector if Pinterest is selected
    els.pinterestBoardSelect.classList.toggle("hidden", !els.postPinterest.checked);
  }
}

async function regenerateCaption() {
  const product = state.products.find(p => p.id === state.uploadData.productId);
  const category = product ? state.categories.find(c => c.id === product.category_id) : null;
  
  const productData = {
    productName: product?.name || "this item",
    category: category?.name || "collection",
    link: product ? `karrykraze.com/pages/product.html?slug=${product.slug}` : "karrykraze.com"
  };
  
  const caption = await generateCaption(state.uploadData.tone, productData);
  els.captionText.value = caption;
  state.uploadData.caption = caption;
  
  // Get hashtags
  const hashtags = await getHashtagsForProduct(product ? { ...product, category } : null);
  const hashtagStr = formatHashtags(ensureKarryKrazeTag(hashtags));
  els.hashtagText.value = hashtagStr;
  state.uploadData.hashtags = parseHashtags(hashtagStr);
  
  // Update counters and engagement score
  updatePostCountersAndScore();
}

/**
 * Load AI tips based on learned patterns for the caption step
 */
async function loadAICaptionTips() {
  try {
    const tips = await getPostCreationTips();
    
    // Update best time tip
    const bestTimeEl = document.getElementById("aiTipBestTime");
    if (bestTimeEl) {
      bestTimeEl.textContent = `Best time: ${tips.bestDay} at ${tips.bestTime}`;
    }
    
    // Update best hashtags tip
    const hashtagsEl = document.getElementById("aiTipBestHashtags");
    if (hashtagsEl && tips.topHashtags.length > 0) {
      const hashtagList = tips.topHashtags.slice(0, 3).map(h => `#${h}`).join(" ");
      hashtagsEl.textContent = `Top hashtags: ${hashtagList}`;
    }
    
    // Load recommended tone based on category insights
    await loadRecommendedTone();
    
    // Update the tips content dynamically based on current caption
    const captionInput = document.getElementById("captionText");
    if (captionInput) {
      captionInput.addEventListener("input", () => {
        updateCaptionAnalysis(captionInput.value);
      });
    }
    
  } catch (err) {
    console.error("Failed to load AI tips:", err);
  }
}

/**
 * Load and display recommended tone based on category insights
 */
async function loadRecommendedTone() {
  try {
    // Get selected product's category
    const product = state.products.find(p => p.id === state.uploadData.productId);
    const category = product ? state.categories.find(c => c.id === product.category_id) : null;
    const categoryName = category?.name || null;
    
    if (!categoryName) return;
    
    // Get category insights
    const insights = await getCategoryInsights(categoryName);
    
    if (insights?.caption_strategy?.tone_that_works) {
      const recommendedTone = insights.caption_strategy.tone_that_works.toLowerCase();
      
      // Map AI tone to our tone options
      const toneMap = {
        "playful": "playful",
        "fun": "playful",
        "casual": "casual",
        "friendly": "casual",
        "urgent": "urgency",
        "urgency": "urgency",
        "professional": "professional",
        "minimal": "minimalist",
        "minimalist": "minimalist",
        "value": "value",
        "deal": "value",
        "trending": "trending",
        "inspirational": "inspirational",
        "inspiring": "inspirational"
      };
      
      const mappedTone = toneMap[recommendedTone] || null;
      
      if (mappedTone) {
        // Show recommendation message
        const recEl = document.getElementById("toneRecommendation");
        const recToneEl = document.getElementById("recommendedTone");
        if (recEl && recToneEl) {
          recToneEl.textContent = `${recommendedTone} tone works best for ${categoryName}`;
          recEl.classList.remove("hidden");
        }
        
        // Highlight the recommended button
        document.querySelectorAll(".caption-tone-btn").forEach(btn => {
          if (btn.dataset.tone === mappedTone) {
            btn.classList.add("ring-2", "ring-purple-500", "ring-offset-1", "bg-purple-50");
            // Add a small "AI" badge
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

/**
 * Analyze caption in real-time and provide feedback
 */
function updateCaptionAnalysis(caption) {
  const tipsContent = document.getElementById("aiCaptionTipsContent");
  if (!tipsContent) return;
  
  const length = caption.length;
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(caption);
  const hasCTA = /shop|link|tap|click|buy|get yours|order/i.test(caption);
  const hasQuestion = caption.includes("?");
  
  const tips = [];
  
  // Length feedback
  if (length === 0) {
    tips.push({ icon: "📝", text: "Start typing your caption...", status: "neutral" });
  } else if (length < 50) {
    tips.push({ icon: "📝", text: `Caption is short (${length} chars) - consider adding more details`, status: "warning" });
  } else if (length > 200) {
    tips.push({ icon: "📝", text: `Caption is long (${length} chars) - shorter posts often perform better`, status: "warning" });
  } else {
    tips.push({ icon: "✅", text: `Great length! (${length} chars)`, status: "good" });
  }
  
  // CTA feedback
  if (hasCTA) {
    tips.push({ icon: "✅", text: "Nice! Has a call-to-action", status: "good" });
  } else {
    tips.push({ icon: "💡", text: "Add a CTA like 'Shop now' or 'Link in bio'", status: "suggestion" });
  }
  
  // Emoji feedback
  if (hasEmoji) {
    tips.push({ icon: "✅", text: "Good use of emojis!", status: "good" });
  } else {
    tips.push({ icon: "💡", text: "Consider adding emojis to boost engagement", status: "suggestion" });
  }
  
  // Question feedback
  if (hasQuestion) {
    tips.push({ icon: "✅", text: "Great! Questions boost comments", status: "good" });
  }
  
  // Render tips
  tipsContent.innerHTML = tips.map(t => {
    const color = t.status === "good" ? "text-green-700" : 
                  t.status === "warning" ? "text-orange-700" : 
                  "text-purple-800";
    return `
      <div class="flex items-start gap-1">
        <span>${t.icon}</span>
        <span class="${color}">${t.text}</span>
      </div>
    `;
  }).join("");
}

async function schedulePost() {
  try {
    els.btnSchedulePost.disabled = true;
    els.btnSchedulePost.textContent = "Scheduling...";
    
    // Collect final data
    state.uploadData.caption = els.captionText.value;
    state.uploadData.hashtags = parseHashtags(els.hashtagText.value);
    state.uploadData.platforms = [];
    if (els.postInstagram.checked) state.uploadData.platforms.push("instagram");
    if (els.postFacebook.checked) state.uploadData.platforms.push("facebook");
    if (els.postPinterest.checked) state.uploadData.platforms.push("pinterest");
    state.uploadData.boardId = els.boardSelect.value || null;
    state.uploadData.scheduleDate = els.scheduleDate.value;
    state.uploadData.scheduleTime = els.scheduleTime.value;
    
    if (!state.uploadData.platforms.length) {
      alert("Please select at least one platform");
      return;
    }
    
    let asset;
    let savedVariations;
    const product = state.products.find(p => p.id === state.uploadData.productId);
    
    // Check if using existing asset or new upload
    if (state.uploadData.existingAssetId) {
      // Using existing asset - fetch asset and variations separately
      const client = getSupabaseClient();
      
      // Fetch asset
      const { data: existingAsset, error: assetError } = await client
        .from("social_assets")
        .select("*")
        .eq("id", state.uploadData.existingAssetId)
        .single();
      
      if (assetError) {
        console.error("Error fetching asset:", assetError);
        alert("Failed to load asset. Please try again.");
        return;
      }
      
      // Fetch variations separately
      const { data: variations, error: varError } = await client
        .from("social_variations")
        .select("*")
        .eq("asset_id", state.uploadData.existingAssetId);
      
      if (varError) {
        console.error("Error fetching variations:", varError);
      }
      
      asset = existingAsset;
      savedVariations = variations || [];
      
      if (!savedVariations.length) {
        alert("This asset has no variations. Please upload a new image instead.");
        return;
      }
    } else if (state.uploadData.file) {
      // New file upload
      // 1. Upload original image
      const originalFilename = generateFilename(state.uploadData.file.name, "original");
      const originalPath = getAssetPath(originalFilename);
      await uploadImage(state.uploadData.file, originalPath);
      
      // 2. Create asset record
      asset = await createAsset({
        product_id: state.uploadData.productId || null,
        original_image_path: originalPath,
        original_filename: state.uploadData.file.name,
        product_url: product ? `/pages/product.html?slug=${product.slug}` : null,
        is_active: true
      });
      
      // 3. Generate and upload variations
      const variations = await generateVariations(
        state.uploadData.file,
        state.uploadData.selectedVariants
      );
      
      const variationRecords = [];
      for (const v of variations) {
        const filename = generateFilename(state.uploadData.file.name, v.variantType);
        const path = getVariationPath(asset.id, v.variantType, filename);
        
        await uploadImage(v.blob, path);
        
        variationRecords.push({
          asset_id: asset.id,
          platform: v.platform === "instagram" ? "instagram" : "pinterest",
          variant_type: v.variantType,
          aspect_ratio: v.aspectRatio,
          image_path: path,
          width: v.width,
          height: v.height
        });
      }
      
      savedVariations = await createVariations(variationRecords);
    } else {
      alert("Please select an image first");
      return;
    }
    
    // 4. Create posts for each platform
    const scheduledFor = new Date(`${state.uploadData.scheduleDate}T${state.uploadData.scheduleTime}:00`).toISOString();
    const autoApprove = state.settings.auto_approve?.enabled !== false;
    
    const postsToCreate = [];
    
    for (const platform of state.uploadData.platforms) {
      // Find appropriate variation for platform
      // Facebook can use Instagram (square) or Pinterest (vertical) variations
      let variation = savedVariations.find(v => v.platform === platform);
      if (!variation && platform === "facebook") {
        // Facebook can use Instagram variations (square works well)
        variation = savedVariations.find(v => v.platform === "instagram");
      }
      if (!variation) {
        // Fallback to any variation
        variation = savedVariations[0];
      }
      
      postsToCreate.push({
        variation_id: variation.id,
        platform,
        caption: state.uploadData.caption,
        hashtags: state.uploadData.hashtags,
        link_url: product ? `https://karrykraze.com/pages/product.html?slug=${product.slug}` : "https://karrykraze.com",
        pinterest_board_id: platform === "pinterest" ? state.uploadData.boardId : null,
        scheduled_for: scheduledFor,
        status: autoApprove ? "queued" : "draft",
        requires_approval: !autoApprove
      });
    }
    
    await createPosts(postsToCreate);
    
    // Done!
    closeUploadModal();
    await loadStats();
    
    if (state.currentTab === "calendar") {
      await loadCalendarPosts();
    } else if (state.currentTab === "queue") {
      await loadQueuePosts();
    }
    
    alert("Posts scheduled successfully!");
    
  } catch (err) {
    console.error("Schedule error:", err);
    alert("Failed to schedule post: " + err.message);
  } finally {
    els.btnSchedulePost.disabled = false;
    els.btnSchedulePost.textContent = "Schedule Post";
  }
}

// ============================================
// Settings Modal
// ============================================

function setupSettingsModal() {
  els.btnSettings?.addEventListener("click", openSettingsModal);
  els.btnCloseSettings?.addEventListener("click", closeSettingsModal);
  els.settingsModal?.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
  });
  els.btnSaveSettings?.addEventListener("click", saveSettings);
  
  // Facebook Page Settings
  document.getElementById("btnLoadPageInfo")?.addEventListener("click", loadFacebookPageInfo);
  document.getElementById("btnSavePageInfo")?.addEventListener("click", saveFacebookPageInfo);
  
  // Instagram Profile Settings
  document.getElementById("btnLoadInstagramInfo")?.addEventListener("click", loadInstagramProfileInfo);
}

function openSettingsModal() {
  applySettings();
  els.settingsModal.classList.remove("hidden");
  els.settingsModal.classList.add("flex");
}

function closeSettingsModal() {
  els.settingsModal.classList.add("hidden");
  els.settingsModal.classList.remove("flex");
}

function applySettings() {
  const autoApprove = state.settings.auto_approve?.enabled !== false;
  const defaultTone = state.settings.default_tone?.tone || "casual";
  const schedule = state.settings.posting_schedule || {};
  
  els.settingAutoApprove.checked = autoApprove;
  els.settingDefaultTone.value = defaultTone;
  els.settingInstagramEnabled.checked = schedule.instagram?.enabled !== false;
  els.settingInstagramTime.value = schedule.instagram?.times?.[0] || "12:00";
  els.settingPinterestEnabled.checked = schedule.pinterest?.enabled !== false;
  els.settingPinterestTime.value = schedule.pinterest?.times?.[0] || "12:00";
}

async function saveSettings() {
  try {
    await updateSetting("auto_approve", { enabled: els.settingAutoApprove.checked });
    await updateSetting("default_tone", { tone: els.settingDefaultTone.value });
    await updateSetting("posting_schedule", {
      instagram: {
        enabled: els.settingInstagramEnabled.checked,
        posts_per_day: 1,
        times: [els.settingInstagramTime.value]
      },
      pinterest: {
        enabled: els.settingPinterestEnabled.checked,
        posts_per_day: 1,
        times: [els.settingPinterestTime.value]
      }
    });
    
    await loadSettings();
    closeSettingsModal();
    alert("Settings saved!");
  } catch (err) {
    console.error("Save settings error:", err);
    alert("Failed to save settings");
  }
}

// ============================================
// Facebook Page Settings
// ============================================

async function loadFacebookPageInfo() {
  try {
    const btn = document.getElementById("btnLoadPageInfo");
    btn.innerHTML = '<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Loading...';
    
    // Get page token
    const pageTokenSetting = state.settings.facebook_page_token;
    const pageIdSetting = state.settings.facebook_page_id;
    
    if (!pageTokenSetting?.token || !pageIdSetting?.page_id) {
      alert("Facebook Page not connected. Please connect Facebook first.");
      btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
      return;
    }
    
    const pageId = pageIdSetting.page_id;
    const token = pageTokenSetting.token;
    
    // Fetch page info from Facebook
    const resp = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=name,about,description,category&access_token=${token}`);
    const data = await resp.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    // Populate preview fields
    const pageName = data.name || "Your Page";
    document.getElementById("settingPageName").textContent = pageName;
    document.getElementById("settingFbCategory").textContent = data.category || "Business";
    document.getElementById("settingFbInitials").textContent = pageName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    
    // Populate editable fields
    document.getElementById("settingPageAbout").value = data.about || "";
    document.getElementById("settingPageDescription").value = data.description || "";
    
    btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
    console.log("Loaded Facebook page info:", data);
  } catch (err) {
    console.error("Load page info error:", err);
    alert("Failed to load: " + err.message);
    document.getElementById("btnLoadPageInfo").innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
  }
}

async function saveFacebookPageInfo() {
  try {
    const btn = document.getElementById("btnSavePageInfo");
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<svg class="w-3.5 h-3.5 animate-spin inline mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Saving...';
    btn.disabled = true;
    
    // Get page token
    const pageTokenSetting = state.settings.facebook_page_token;
    const pageIdSetting = state.settings.facebook_page_id;
    
    if (!pageTokenSetting?.token || !pageIdSetting?.page_id) {
      alert("Facebook Page not connected.");
      btn.innerHTML = originalHTML;
      btn.disabled = false;
      return;
    }
    
    const pageId = pageIdSetting.page_id;
    const token = pageTokenSetting.token;
    
    const about = document.getElementById("settingPageAbout").value.trim();
    const description = document.getElementById("settingPageDescription").value.trim();
    
    // Update page info via Graph API
    const params = new URLSearchParams();
    params.append("access_token", token);
    if (about) params.append("about", about);
    if (description) params.append("description", description);
    
    const resp = await fetch(`https://graph.facebook.com/v21.0/${pageId}`, {
      method: "POST",
      body: params
    });
    
    const result = await resp.json();
    
    if (result.error) {
      throw new Error(result.error.message);
    }
    
    btn.innerHTML = '<svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Updated!';
    btn.classList.remove("bg-blue-600", "hover:bg-blue-700");
    btn.classList.add("bg-green-600");
    
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.classList.remove("bg-green-600");
      btn.classList.add("bg-blue-600", "hover:bg-blue-700");
      btn.disabled = false;
    }, 2000);
    
    console.log("Updated Facebook page info:", result);
  } catch (err) {
    console.error("Save page info error:", err);
    alert("Failed to update: " + err.message);
    const btn = document.getElementById("btnSavePageInfo");
    btn.innerHTML = '<svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Update Facebook Page';
    btn.disabled = false;
  }
}

// ============================================
// Instagram Profile Settings
// ============================================

async function loadInstagramProfileInfo() {
  try {
    const btn = document.getElementById("btnLoadInstagramInfo");
    btn.innerHTML = '<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Loading...';
    
    // Get Instagram user ID and token
    const igUserIdSetting = state.settings.instagram_user_id;
    const igTokenSetting = state.settings.instagram_access_token;
    
    if (!igUserIdSetting?.user_id || !igTokenSetting?.token) {
      alert("Instagram not connected. Please connect Instagram first.");
      btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
      return;
    }
    
    const userId = igUserIdSetting.user_id;
    const token = igTokenSetting.token;
    
    // Fetch profile info from Instagram Graph API
    const resp = await fetch(`https://graph.facebook.com/v21.0/${userId}?fields=username,name,biography,profile_picture_url,followers_count,follows_count,media_count&access_token=${token}`);
    const data = await resp.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    // Populate avatar
    const avatar = document.getElementById("settingIgAvatar");
    const placeholder = document.getElementById("settingIgAvatarPlaceholder");
    if (data.profile_picture_url) {
      avatar.src = data.profile_picture_url;
      avatar.classList.remove("hidden");
      if (placeholder) placeholder.classList.add("hidden");
    }
    
    // Populate fields
    document.getElementById("settingIgUsername").textContent = data.username ? `@${data.username}` : "@username";
    document.getElementById("settingIgName").textContent = data.name || "Name";
    document.getElementById("settingIgBio").textContent = data.biography || "(No bio set)";
    document.getElementById("settingIgPosts").textContent = data.media_count?.toLocaleString() || "-";
    document.getElementById("settingIgFollowers").textContent = data.followers_count?.toLocaleString() || "-";
    document.getElementById("settingIgFollowing").textContent = data.follows_count?.toLocaleString() || "-";
    
    btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
    console.log("Loaded Instagram profile info:", data);
  } catch (err) {
    console.error("Load Instagram info error:", err);
    alert("Failed to load: " + err.message);
    document.getElementById("btnLoadInstagramInfo").innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
  }
}

// ============================================
// Post Detail Modal
// ============================================

function setupPostDetailModal() {
  els.btnClosePostDetail?.addEventListener("click", closePostDetail);
  els.postDetailModal?.addEventListener("click", (e) => {
    if (e.target === els.postDetailModal) closePostDetail();
  });
  
  els.btnDeletePost?.addEventListener("click", handleDeletePost);
  els.btnSavePost?.addEventListener("click", handleSavePost);
  els.btnPostNow?.addEventListener("click", handlePostNow);
}

function openPostDetail(post) {
  state.editingPost = post;
  
  const imageUrl = post.variation?.image_path 
    ? getPublicUrl(post.variation.image_path)
    : "/imgs/placeholder.jpg";
  
  els.postDetailImage.src = imageUrl;
  
  // Platform badge
  const platformClass = post.platform === "instagram" ? "badge-instagram" : "badge-pinterest";
  els.postDetailPlatform.className = `badge ${platformClass}`;
  els.postDetailPlatform.textContent = `${post.platform === "instagram" ? "📸" : "📌"} ${post.platform}`;
  
  // Status badge
  els.postDetailStatus.className = `badge badge-${post.status}`;
  els.postDetailStatus.textContent = post.status;
  
  // Form fields
  els.postDetailCaption.value = post.caption || "";
  els.postDetailHashtags.value = formatHashtags(post.hashtags || []);
  
  const scheduledDate = new Date(post.scheduled_for);
  els.postDetailDate.value = scheduledDate.toISOString().split("T")[0];
  els.postDetailTime.value = scheduledDate.toTimeString().substring(0, 5);
  
  // Pinterest board selector - show only for Pinterest posts
  const boardSection = document.getElementById("postDetailBoardSection");
  const boardSelect = document.getElementById("postDetailBoard");
  if (post.platform === "pinterest") {
    boardSection?.classList.remove("hidden");
    // Populate board options
    if (boardSelect && state.boards?.length) {
      boardSelect.innerHTML = `
        <option value="">Select a board...</option>
        ${state.boards.map(b => `<option value="${b.id}" ${b.id === post.pinterest_board_id ? "selected" : ""}>${b.name}</option>`).join("")}
      `;
    }
  } else {
    boardSection?.classList.add("hidden");
  }
  
  // Show/hide post now button based on status
  els.btnPostNow.classList.toggle("hidden", post.status === "posted" || post.status === "published" || post.status === "deleted");
  
  // Show/hide "View on Instagram" link
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
      // Fallback: construct Instagram URL from media ID (may not always work)
      viewOnPlatformBtn.classList.remove("hidden");
      if (post.platform === "instagram") {
        // Instagram doesn't support direct media ID URLs easily, but we can try
        viewOnPlatformBtn.href = `https://www.instagram.com/`;
        viewOnPlatformBtn.textContent = "📸 Open Instagram";
      } else {
        viewOnPlatformBtn.classList.add("hidden");
      }
    } else {
      viewOnPlatformBtn.classList.add("hidden");
    }
  }
  
  // Show engagement stats if available
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

function closePostDetail() {
  state.editingPost = null;
  els.postDetailModal.classList.add("hidden");
  els.postDetailModal.classList.remove("flex");
}

async function handleDeletePost() {
  if (!state.editingPost) return;
  
  if (!confirm("Delete this post?")) return;
  
  try {
    // Get product ID before deleting (if linked to a product)
    const productId = state.editingPost.variation?.asset?.product?.id 
                   || state.editingPost.variation?.asset?.product_id;
    
    await deletePost(state.editingPost.id);
    
    // Recalculate the product's last_social_post_at if it was linked to a product
    if (productId) {
      await recalculateProductPostDate(productId);
    }
    
    closePostDetail();
    await loadStats();
    
    // Also refresh auto-queue stats if on that tab
    if (state.currentTab === "autoqueue") {
      await loadAutoQueueStats();
    } else if (state.currentTab === "calendar") {
      await loadCalendarPosts();
    } else if (state.currentTab === "queue") {
      await loadQueuePosts();
    }
  } catch (err) {
    console.error("Delete post error:", err);
    alert("Failed to delete post");
  }
}

async function handleSavePost() {
  if (!state.editingPost) return;
  
  try {
    const scheduledFor = new Date(`${els.postDetailDate.value}T${els.postDetailTime.value}:00`).toISOString();
    
    const updateData = {
      caption: els.postDetailCaption.value,
      hashtags: parseHashtags(els.postDetailHashtags.value),
      scheduled_for: scheduledFor
    };
    
    // Save Pinterest board if applicable
    if (state.editingPost.platform === "pinterest") {
      const modalBoardSelect = document.getElementById("postDetailBoard");
      if (modalBoardSelect?.value) {
        updateData.pinterest_board_id = modalBoardSelect.value;
      }
    }
    
    await updatePost(state.editingPost.id, updateData);
    
    closePostDetail();
    
    if (state.currentTab === "calendar") {
      await loadCalendarPosts();
    } else if (state.currentTab === "queue") {
      await loadQueuePosts();
    }
    
    alert("Post updated!");
  } catch (err) {
    console.error("Save post error:", err);
    alert("Failed to save post");
  }
}

async function handlePostNow() {
  if (!state.editingPost) return;
  
  const post = state.editingPost;
  
  // Get required data - construct public URL from image_path
  let imageUrl = post.image_url;
  if (!imageUrl && post.variation?.image_path) {
    const imagePath = post.variation.image_path;
    // Check if it's already a full URL or a storage path
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      imageUrl = imagePath;
    } else {
      // Construct the public URL from the storage path
      imageUrl = `https://yxdzvzscufkvewecvagq.supabase.co/storage/v1/object/public/social-media/${imagePath}`;
    }
  }
  
  if (!imageUrl) {
    alert("No image found for this post.");
    return;
  }
  
  // Handle based on platform
  if (post.platform === "instagram") {
    // Instagram posting
    if (!confirm("Post this to Instagram now?")) return;
    
    const caption = post.caption || "";
    const hashtags = post.hashtags?.join(" ") || "";
    const fullCaption = hashtags ? `${caption}\n\n${hashtags}` : caption;
    
    console.log("Posting to Instagram with postId:", post.id);
    const result = await postToInstagram(post.id, imageUrl, fullCaption);
    console.log("Instagram post result:", result);
    
    if (result?.success) {
      closePostDetail();
      // Force a small delay to ensure database has updated
      await new Promise(r => setTimeout(r, 500));
      await loadStats();
      // Reload the current view to reflect status change
      console.log("Reloading view:", state.currentTab);
      if (state.currentTab === "calendar") {
        await loadCalendarPosts();
      } else if (state.currentTab === "queue") {
        await loadQueuePosts();
      } else {
        // Fallback - reload queue anyway
        await loadQueuePosts();
      }
    }
  } else if (post.platform === "pinterest") {
    // Pinterest posting - check modal board selector first, then existing value
    const modalBoardSelect = document.getElementById("postDetailBoard");
    const boardId = modalBoardSelect?.value || post.pinterest_board_id;
    
    if (!boardId) {
      alert("Please select a Pinterest board.");
      return;
    }
    
    if (!confirm("Post this pin to Pinterest now?")) return;
    
    const result = await postToPinterest(
      post.id,
      imageUrl,
      post.title || "",
      post.caption || "",
      post.product_url || "",
      boardId
    );
    
    if (result?.success) {
      els.postDetailModal?.classList.add("hidden");
      await loadStats();
      switchTab(state.currentTab);
    }
  } else if (post.platform === "facebook") {
    // Facebook posting
    if (!confirm("Post this to Facebook now?")) return;
    
    const caption = post.caption || "";
    const hashtags = post.hashtags?.join(" ") || "";
    const fullCaption = hashtags ? `${caption}\n\n${hashtags}` : caption;
    const linkUrl = post.link_url || post.product_url || null;
    
    console.log("Posting to Facebook with postId:", post.id);
    const result = await postToFacebook(post.id, imageUrl, fullCaption, linkUrl);
    console.log("Facebook post result:", result);
    
    if (result?.success) {
      closePostDetail();
      await new Promise(r => setTimeout(r, 500));
      await loadStats();
      if (state.currentTab === "calendar") {
        await loadCalendarPosts();
      } else if (state.currentTab === "queue") {
        await loadQueuePosts();
      } else {
        await loadQueuePosts();
      }
    }
  } else {
    alert(`Posting to ${post.platform} is not supported yet.`);
  }
}

// ============================================
// Helpers
// ============================================

function populateProductSelect() {
  els.productSelect.innerHTML = `
    <option value="">— No product link —</option>
    ${state.products.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
  `;
}

async function populateBoardSelect() {
  // Use Pinterest API to fetch boards
  await populateBoardDropdown(els.boardSelect);
}

// ============================================
// Auto-Queue
// ============================================

function setupAutoQueue() {
  els.btnAutoQueue?.addEventListener("click", () => switchTab("autoqueue"));
  els.btnPreviewQueue?.addEventListener("click", previewAutoQueue);
  els.btnGenerateQueue?.addEventListener("click", generateAutoQueue);
  els.btnConfirmQueue?.addEventListener("click", confirmAutoQueue);
  
  // Repost handlers
  document.getElementById("btnPreviewRepost")?.addEventListener("click", previewRepost);
  document.getElementById("btnGenerateRepost")?.addEventListener("click", generateRepost);
  document.getElementById("btnConfirmRepost")?.addEventListener("click", confirmRepost);
}

function getAutoQueueSettings() {
  // Get selected posting times
  const postingTimes = [];
  if (els.aqTime1?.checked) postingTimes.push(els.aqTime1.value);
  if (els.aqTime2?.checked) postingTimes.push(els.aqTime2.value);
  if (els.aqTime3?.checked) postingTimes.push(els.aqTime3.value);
  if (els.aqTime4?.checked) postingTimes.push(els.aqTime4.value);
  
  // Get selected tones (8 styles with 50+ templates)
  const captionTones = [];
  if (els.aqToneCasual?.checked) captionTones.push("casual");
  if (els.aqToneUrgency?.checked) captionTones.push("urgency");
  if (els.aqTonePro?.checked) captionTones.push("professional");
  if (els.aqTonePlayful?.checked) captionTones.push("playful");
  if (els.aqToneValue?.checked) captionTones.push("value");
  if (els.aqToneTrending?.checked) captionTones.push("trending");
  if (els.aqToneInspirational?.checked) captionTones.push("inspirational");
  if (els.aqToneMinimalist?.checked) captionTones.push("minimalist");
  
  // Get selected platforms (now checkboxes, not radio)
  const platforms = [];
  const aqPlatformInstagram = document.getElementById("aqPlatformInstagram");
  const aqPlatformFacebook = document.getElementById("aqPlatformFacebook");
  const aqPlatformPinterest = document.getElementById("aqPlatformPinterest");
  if (aqPlatformInstagram?.checked) platforms.push("instagram");
  if (aqPlatformFacebook?.checked) platforms.push("facebook");
  if (aqPlatformPinterest?.checked) platforms.push("pinterest");
  
  return {
    count: parseInt(els.aqPostCount?.value || "4", 10),
    platforms: platforms.length ? platforms : ["instagram"],
    postingTimes: postingTimes.length ? postingTimes : ["10:00", "18:00"],
    captionTones: captionTones.length ? captionTones : ["casual"]
  };
}

async function previewAutoQueue() {
  const settings = getAutoQueueSettings();
  
  els.btnPreviewQueue.disabled = true;
  els.btnPreviewQueue.innerHTML = `
    <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Generating...
  `;
  
  try {
    const response = await fetch("https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/auto-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({
        ...settings,
        preview: true
      })
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || "Failed to preview posts");
    }
    
    // Store preview data
    state.autoQueuePreview = result.posts;
    
    // Render preview
    renderAutoQueuePreview(result.posts);
    
  } catch (err) {
    console.error("Preview error:", err);
    alert("Failed to preview: " + err.message);
  } finally {
    els.btnPreviewQueue.disabled = false;
    els.btnPreviewQueue.innerHTML = `
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
  
  if (!confirm(`Generate and schedule ${settings.count} posts for ${settings.platform}?`)) {
    return;
  }
  
  els.btnGenerateQueue.disabled = true;
  els.btnGenerateQueue.innerHTML = `
    <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Generating...
  `;
  
  try {
    const response = await fetch("https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/auto-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({
        ...settings,
        preview: false
      })
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || "Failed to generate posts");
    }
    
    alert(`Successfully scheduled ${result.generated} posts!`);
    
    // Refresh stats and queue
    await loadStats();
    await loadAutoQueueStats();
    
    // Switch to queue view
    switchTab("queue");
    
  } catch (err) {
    console.error("Generate error:", err);
    alert("Failed to generate: " + err.message);
  } finally {
    els.btnGenerateQueue.disabled = false;
    els.btnGenerateQueue.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
      Generate & Schedule
    `;
  }
}

async function confirmAutoQueue() {
  // This uses the stored preview data and creates real posts
  if (!state.autoQueuePreview?.length) {
    alert("No preview data. Please generate a preview first.");
    return;
  }
  
  if (!confirm(`Schedule ${state.autoQueuePreview.length} posts now?`)) {
    return;
  }
  
  // Call generate with preview=false, which will create real posts
  await generateAutoQueue();
  
  // Clear preview
  state.autoQueuePreview = null;
  els.aqPreviewResults?.classList.add("hidden");
}

function renderAutoQueuePreview(posts) {
  if (!posts?.length) {
    els.aqPreviewResults?.classList.add("hidden");
    return;
  }
  
  els.aqPreviewResults?.classList.remove("hidden");
  
  els.aqPreviewList.innerHTML = posts.map((post, i) => {
    const schedDate = new Date(post.scheduled_for);
    const dateStr = schedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeStr = schedDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    
    return `
      <div class="p-4 flex gap-4">
        <div class="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
          <img src="${post.catalog_image_url}" alt="${post.product_name}" 
               class="w-full h-full object-cover"
               onerror="this.src='/imgs/placeholder.jpg'">
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-medium px-2 py-0.5 rounded-full ${post.platform === 'instagram' ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' : 'bg-pinterest text-white'}">
              ${post.platform}
            </span>
            <span class="text-xs text-gray-500">${dateStr} at ${timeStr}</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">${post.tone}</span>
          </div>
          <div class="font-medium text-sm truncate">${post.product_name}</div>
          <div class="text-xs text-gray-500 mt-1 line-clamp-2">${post.caption}</div>
        </div>
      </div>
    `;
  }).join("");
}

async function loadAutoQueueStats() {
  try {
    const client = getSupabaseClient();
    
    // Get total active products with images
    const { count: total } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null);
    
    // Get products never posted
    const { count: neverPosted } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null)
      .is("last_social_post_at", null);
    
    // Get products ready to post (not posted in last 14 days)
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const { count: ready } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null)
      .or(`last_social_post_at.is.null,last_social_post_at.lt.${fourteenDaysAgo.toISOString()}`);
    
    // Calculate recently posted
    const recent = (total || 0) - (ready || 0);
    
    // Update UI
    if (els.aqStatTotal) els.aqStatTotal.textContent = total || 0;
    if (els.aqStatNeverPosted) els.aqStatNeverPosted.textContent = neverPosted || 0;
    if (els.aqStatReady) els.aqStatReady.textContent = ready || 0;
    if (els.aqStatRecent) els.aqStatRecent.textContent = recent;
    
  } catch (err) {
    console.error("Failed to load auto-queue stats:", err);
  }
}

// ============================================
// Auto-Repost Old Posts
// ============================================

function getRepostSettings() {
  const aqSettings = getAutoQueueSettings();
  return {
    count: parseInt(document.getElementById("repostCount")?.value || "2", 10),
    minDaysOld: parseInt(document.getElementById("repostMinDays")?.value || "30", 10),
    platforms: aqSettings.platforms,
    tones: ["casual", "trending", "value"], // Repost-friendly tones
  };
}

async function previewRepost() {
  const btn = document.getElementById("btnPreviewRepost");
  const settings = getRepostSettings();
  
  btn.disabled = true;
  btn.textContent = "Loading...";
  
  try {
    const response = await fetch("https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/auto-repost", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({
        ...settings,
        preview: true
      })
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || "Failed to preview reposts");
    }
    
    if (!result.posts?.length) {
      alert("No old posts found to repost. Try reducing the minimum age.");
      return;
    }
    
    // Store preview data
    state.repostPreview = result.posts;
    
    // Render preview
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
    const response = await fetch("https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/auto-repost", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({
        ...settings,
        preview: false
      })
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || "Failed to generate reposts");
    }
    
    if (result.generated === 0) {
      alert("No old posts found to repost. Try reducing the minimum age.");
    } else {
      alert(`✅ Scheduled ${result.generated} reposts!`);
      
      // Refresh stats
      await loadStats();
      if (state.currentTab === "queue") {
        await loadQueuePosts();
      }
    }
    
    // Hide preview
    document.getElementById("repostPreviewResults")?.classList.add("hidden");
    state.repostPreview = null;
    
  } catch (err) {
    console.error("Repost error:", err);
    alert("Failed to generate reposts: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Repost Now";
  }
}

async function confirmRepost() {
  if (!state.repostPreview?.length) {
    alert("No preview data. Please preview first.");
    return;
  }
  
  if (!confirm(`Schedule ${state.repostPreview.length} reposts now?`)) {
    return;
  }
  
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
  
  list.innerHTML = posts.map((post, i) => {
    const schedDate = new Date(post.scheduled_for);
    const dateStr = schedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeStr = schedDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    
    return `
      <div class="p-4 flex gap-4">
        <div class="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 relative">
          <img src="${post.link_url?.replace('/pages/product.html?slug=', '/imgs/products/') + '.jpg'}" alt="${post.product_name}" 
               class="w-full h-full object-cover"
               onerror="this.src='/imgs/placeholder.jpg'">
          <div class="absolute top-0 right-0 bg-orange-500 text-white text-xs px-1 rounded-bl">🔄</div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-medium px-2 py-0.5 rounded-full ${post.platform === 'instagram' ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' : post.platform === 'facebook' ? 'bg-blue-600 text-white' : 'bg-pinterest text-white'}">
              ${post.platform}
            </span>
            <span class="text-xs text-gray-500">${dateStr} at ${timeStr}</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">Repost</span>
          </div>
          <div class="font-medium text-sm truncate">${post.product_name}</div>
          <div class="text-xs text-gray-500 mt-1 line-clamp-2">${post.caption}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================
// Autopilot Mode
// ============================================

function setupAutopilot() {
  const toggle = document.getElementById("autopilotToggle");
  const settings = document.getElementById("autopilotSettings");
  const btnSave = document.getElementById("btnSaveAutopilot");
  const btnRun = document.getElementById("btnRunAutopilot");
  
  // Toggle settings visibility
  toggle?.addEventListener("change", async (e) => {
    settings?.classList.toggle("hidden", !e.target.checked);
    if (e.target.checked || !e.target.checked) {
      // Auto-save when toggling
      await saveAutopilotSettings();
    }
  });
  
  // Save button
  btnSave?.addEventListener("click", saveAutopilotSettings);
  
  // Run now button
  btnRun?.addEventListener("click", runAutopilotNow);
  
  // Load initial state
  loadAutopilotSettings();
}

async function loadAutopilotSettings() {
  try {
    const client = getSupabaseClient();
    
    // Get autopilot settings
    const { data: settingsRow } = await client
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "autopilot")
      .single();
    
    const settings = settingsRow?.setting_value || {
      enabled: false,
      days_ahead: 7,
      posts_per_day: 2,
    };
    
    // Update UI
    const toggle = document.getElementById("autopilotToggle");
    const settingsPanel = document.getElementById("autopilotSettings");
    const daysSelect = document.getElementById("autopilotDaysAhead");
    const postsSelect = document.getElementById("autopilotPostsPerDay");
    const statusEl = document.getElementById("autopilotStatus");
    
    if (toggle) toggle.checked = settings.enabled;
    if (settingsPanel) settingsPanel.classList.toggle("hidden", !settings.enabled);
    if (daysSelect) daysSelect.value = settings.days_ahead || 7;
    if (postsSelect) postsSelect.value = settings.posts_per_day || 2;
    
    // Update status text
    if (statusEl) {
      statusEl.textContent = settings.enabled 
        ? `✅ Active - keeping ${settings.days_ahead} days of posts queued`
        : "❌ Disabled - enable for hands-free posting";
    }
    
    // Get last run info
    const { data: lastRunRow } = await client
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "autopilot_last_run")
      .single();
    
    const lastRunEl = document.getElementById("autopilotLastRun");
    if (lastRunEl && lastRunRow?.setting_value?.ran_at) {
      const runDate = new Date(lastRunRow.setting_value.ran_at);
      lastRunEl.textContent = runDate.toLocaleString();
    }
    
  } catch (err) {
    console.error("Failed to load autopilot settings:", err);
  }
}

async function saveAutopilotSettings() {
  try {
    const client = getSupabaseClient();
    
    const toggle = document.getElementById("autopilotToggle");
    const daysSelect = document.getElementById("autopilotDaysAhead");
    const postsSelect = document.getElementById("autopilotPostsPerDay");
    const statusEl = document.getElementById("autopilotStatus");
    
    // Get current auto-queue settings for platforms and tones
    const aqSettings = getAutoQueueSettings();
    
    const settings = {
      enabled: toggle?.checked || false,
      days_ahead: parseInt(daysSelect?.value || "7", 10),
      posts_per_day: parseInt(postsSelect?.value || "2", 10),
      platforms: aqSettings.platforms,
      tones: aqSettings.captionTones,
      posting_times: aqSettings.postingTimes,
    };
    
    await client
      .from("social_settings")
      .upsert({
        setting_key: "autopilot",
        setting_value: settings,
        updated_at: new Date().toISOString(),
      }, { onConflict: "setting_key" });
    
    // Update status
    if (statusEl) {
      statusEl.textContent = settings.enabled 
        ? `✅ Active - keeping ${settings.days_ahead} days of posts queued`
        : "❌ Disabled - enable for hands-free posting";
    }
    
    console.log("[autopilot] Settings saved:", settings);
    
  } catch (err) {
    console.error("Failed to save autopilot settings:", err);
    alert("Failed to save autopilot settings");
  }
}

async function runAutopilotNow() {
  const btnRun = document.getElementById("btnRunAutopilot");
  
  try {
    btnRun.disabled = true;
    btnRun.textContent = "Running...";
    
    const client = getSupabaseClient();
    const supabaseUrl = "https://yxdzvzscufkvewecvagq.supabase.co";
    
    // Get session for auth
    const { data: { session } } = await client.auth.getSession();
    
    const response = await fetch(`${supabaseUrl}/functions/v1/autopilot-fill`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session?.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || "Failed to run autopilot");
    }
    
    if (result.skipped) {
      alert("Autopilot is disabled. Enable it first!");
    } else if (result.generated === 0) {
      alert(`Queue is full! (${result.current}/${result.target} posts scheduled)`);
    } else {
      alert(`✅ Autopilot generated ${result.generated} new posts!`);
      
      // Refresh stats and reload queue
      await loadStats();
      if (state.currentTab === "queue") {
        await loadQueuePosts();
      }
    }
    
    // Reload autopilot settings to update last run time
    await loadAutopilotSettings();
    
  } catch (err) {
    console.error("Failed to run autopilot:", err);
    alert("Failed to run autopilot: " + err.message);
  } finally {
    btnRun.disabled = false;
    btnRun.textContent = "Run Now";
  }
}

// ============================================
// Carousel Builder
// ============================================

function setupCarouselBuilder() {
  const dropZone = document.getElementById("carouselDropZone");
  const fileInput = document.getElementById("carouselFileInput");
  const btnNew = document.getElementById("btnNewCarousel");
  const btnClear = document.getElementById("btnClearCarousel");
  const btnPreview = document.getElementById("btnPreviewCarousel");
  const btnSchedule = document.getElementById("btnScheduleCarousel");
  const btnRegenerateCaption = document.getElementById("btnRegenerateCarouselCaption");
  const productSearch = document.getElementById("carouselProductSearch");
  const productDropdown = document.getElementById("carouselProductDropdown");
  const btnClearProduct = document.getElementById("btnClearCarouselProduct");
  
  // Set default date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateInput = document.getElementById("carouselScheduleDate");
  if (dateInput) {
    dateInput.value = tomorrow.toISOString().split("T")[0];
    state.carousel.scheduleDate = dateInput.value;
  }
  
  // Drop zone click
  dropZone?.addEventListener("click", () => fileInput?.click());
  
  // File input change
  fileInput?.addEventListener("change", (e) => handleCarouselFiles(e.target.files));
  
  // Drag and drop
  dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-purple-500", "bg-purple-50");
  });
  
  dropZone?.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-purple-500", "bg-purple-50");
  });
  
  dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-purple-500", "bg-purple-50");
    handleCarouselFiles(e.dataTransfer.files);
  });
  
  // New carousel button
  btnNew?.addEventListener("click", resetCarouselBuilder);
  
  // Clear all images
  btnClear?.addEventListener("click", () => {
    state.carousel.images.forEach(img => {
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    });
    state.carousel.images = [];
    updateCarouselUI();
  });
  
  // Preview carousel
  btnPreview?.addEventListener("click", previewCarousel);
  
  // Schedule carousel
  btnSchedule?.addEventListener("click", scheduleCarousel);
  
  // Regenerate caption
  btnRegenerateCaption?.addEventListener("click", regenerateCarouselCaption);
  
  // Caption tone buttons
  document.querySelectorAll(".carousel-tone-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      console.log("[Carousel] Tone button clicked:", btn.dataset.carouselTone);
      document.querySelectorAll(".carousel-tone-btn").forEach(b => {
        b.classList.remove("bg-purple-100", "border-purple-300");
      });
      btn.classList.add("bg-purple-100", "border-purple-300");
      state.carousel.tone = btn.dataset.carouselTone;
      console.log("[Carousel] Calling regenerateCarouselCaption...");
      regenerateCarouselCaption();
    });
  });
  console.log("[Carousel] Setup complete, found", document.querySelectorAll(".carousel-tone-btn").length, "tone buttons");
  
  // Show all products on focus/click
  productSearch?.addEventListener("focus", () => showCarouselProductDropdown(""));
  productSearch?.addEventListener("click", () => showCarouselProductDropdown(productSearch.value));
  
  // Product search on input
  productSearch?.addEventListener("input", (e) => showCarouselProductDropdown(e.target.value));
  
  // Hide dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!productSearch?.contains(e.target) && !productDropdown?.contains(e.target)) {
      productDropdown?.classList.add("hidden");
    }
  });
  
  // Setup other carousel handlers
  setupCarouselProductClear();
  setupCarouselPreviewModal();
  setupCarouselCounters();
}

function showCarouselProductDropdown(searchQuery = "") {
  const productDropdown = document.getElementById("carouselProductDropdown");
  const query = searchQuery.toLowerCase().trim();
  
  console.log("[Carousel] Product search:", query, "Products loaded:", state.products.length);
  
  // Filter products - show all if empty query, otherwise filter
  let matches;
  if (query.length === 0) {
    matches = state.products.slice(0, 15); // Show first 15 products
  } else {
    matches = state.products.filter(p => 
      (p.name || p.title || "").toLowerCase().includes(query)
    ).slice(0, 10);
  }
  
  console.log("[Carousel] Found matches:", matches.length);
  
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
  
  // Add click handlers
  document.querySelectorAll(".carousel-product-option").forEach(opt => {
    opt.addEventListener("click", () => {
      const productSearch = document.getElementById("carouselProductSearch");
      state.carousel.productId = opt.dataset.id;
      document.getElementById("carouselProductId").value = opt.dataset.id;
      document.getElementById("carouselSelectedProductName").textContent = opt.dataset.title;
      document.getElementById("carouselSelectedProduct").classList.remove("hidden");
      if (productSearch) productSearch.value = "";
      productDropdown?.classList.add("hidden");
      regenerateCarouselCaption();
      // Load and display product images
      loadCarouselProductImages(opt.dataset.id);
    });
  });
}
  
function setupCarouselProductClear() {
  const btnClearProduct = document.getElementById("btnClearCarouselProduct");
  
  // Clear product selection
  btnClearProduct?.addEventListener("click", () => {
    state.carousel.productId = null;
    document.getElementById("carouselProductId").value = "";
    document.getElementById("carouselSelectedProduct").classList.add("hidden");
    // Hide product images section
    document.getElementById("carouselProductImages")?.classList.add("hidden");
    state.carousel.productGalleryImages = [];
  });
  
  // Add all product images button
  document.getElementById("btnAddAllProductImages")?.addEventListener("click", () => {
    addAllProductImagesToCarousel();
  });
  
  // Caption input
  document.getElementById("carouselCaption")?.addEventListener("input", (e) => {
    state.carousel.caption = e.target.value;
  });
  
  // Hashtags input
  document.getElementById("carouselHashtags")?.addEventListener("input", (e) => {
    state.carousel.hashtags = e.target.value;
  });
  
  // Schedule date/time
  document.getElementById("carouselScheduleDate")?.addEventListener("change", (e) => {
    state.carousel.scheduleDate = e.target.value;
  });
  
  document.getElementById("carouselScheduleTime")?.addEventListener("change", (e) => {
    state.carousel.scheduleTime = e.target.value;
  });
}

// Load and display product images for carousel selection
async function loadCarouselProductImages(productId) {
  const container = document.getElementById("carouselProductImages");
  const grid = document.getElementById("productImagesGrid");
  const loading = document.getElementById("productImagesLoading");
  const empty = document.getElementById("productImagesEmpty");
  const suggestion = document.getElementById("productImagesSuggestion");
  
  if (!container || !grid) return;
  
  // Show container and loading
  container.classList.remove("hidden");
  loading?.classList.remove("hidden");
  empty?.classList.add("hidden");
  suggestion?.classList.add("hidden");
  grid.innerHTML = "";
  
  try {
    // Fetch product gallery images
    const galleryImages = await fetchProductGalleryImages(productId);
    
    // Also get the product to get the main catalog image
    const product = state.products.find(p => p.id === productId);
    const allImages = [];
    
    // Add main catalog image first if it exists
    if (product?.catalog_image_url) {
      allImages.push({
        id: 'main',
        url: product.catalog_image_url,
        position: 0,
        isMain: true
      });
    }
    
    // Add gallery images
    galleryImages.forEach(img => {
      allImages.push({
        id: img.id,
        url: img.url,
        position: img.position + 1,
        isMain: false
      });
    });
    
    loading?.classList.add("hidden");
    
    if (allImages.length === 0) {
      empty?.classList.remove("hidden");
      return;
    }
    
    // Store in state for reference
    state.carousel.productGalleryImages = allImages;
    
    // Generate AI suggestion (simple heuristics, not vision API)
    const suggestionText = generateImageSuggestion(allImages, state.carousel.images.length);
    if (suggestionText) {
      document.getElementById("productImagesSuggestionText").textContent = suggestionText;
      suggestion?.classList.remove("hidden");
    }
    
    // Render image grid
    renderCarouselProductImages(allImages);
    
  } catch (err) {
    console.error("[Carousel] Error loading product images:", err);
    loading?.classList.add("hidden");
    empty?.classList.remove("hidden");
  }
}

// Generate a simple AI-like suggestion based on heuristics
function generateImageSuggestion(images, currentCarouselCount) {
  const remaining = 10 - currentCarouselCount;
  
  if (images.length === 0) return null;
  
  if (images.length <= 3) {
    return `Use all ${images.length} images for a complete product showcase!`;
  }
  
  if (remaining <= 0) {
    return "Carousel is full! Remove some images to add more.";
  }
  
  const suggested = Math.min(remaining, Math.min(5, images.length));
  
  // Different suggestions based on image count
  if (images.length >= 6) {
    return `Start with the main image + ${suggested - 1} variety shots for best engagement.`;
  }
  
  return `Add the main image + ${Math.min(suggested - 1, images.length - 1)} angles for a complete look!`;
}

// Render product images in the selection grid
function renderCarouselProductImages(images) {
  const grid = document.getElementById("productImagesGrid");
  if (!grid) return;
  
  // Check which URLs are already in carousel
  const existingUrls = new Set(
    state.carousel.images
      .filter(img => img.productGalleryUrl)
      .map(img => img.productGalleryUrl)
  );
  
  grid.innerHTML = images.map((img, idx) => {
    const isSelected = existingUrls.has(img.url);
    const position = isSelected ? getCarouselPositionForUrl(img.url) : null;
    
    return `
      <div class="carousel-product-img ${isSelected ? 'selected' : ''} ${idx === 0 ? 'ai-suggested' : ''}" 
           data-url="${img.url}" 
           data-id="${img.id}"
           data-is-main="${img.isMain}">
        <img src="${img.url}" alt="Product image ${idx + 1}" loading="lazy">
        <div class="check-overlay">
          <svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
        </div>
        ${position !== null ? `<span class="position-badge">#${position + 1}</span>` : ''}
        ${img.isMain ? '<span class="absolute top-1 left-1 text-xs bg-purple-600 text-white px-1 rounded">Main</span>' : ''}
      </div>
    `;
  }).join("");
  
  // Add click handlers
  grid.querySelectorAll(".carousel-product-img").forEach(el => {
    el.addEventListener("click", () => toggleProductImageInCarousel(el));
  });
}

// Get carousel position for a URL
function getCarouselPositionForUrl(url) {
  return state.carousel.images.findIndex(img => img.productGalleryUrl === url);
}

// Toggle product image in/out of carousel
async function toggleProductImageInCarousel(element) {
  const url = element.dataset.url;
  const isSelected = element.classList.contains("selected");
  
  if (isSelected) {
    // Remove from carousel
    const idx = state.carousel.images.findIndex(img => img.productGalleryUrl === url);
    if (idx !== -1) {
      // Revoke object URL if exists
      if (state.carousel.images[idx].previewUrl && !state.carousel.images[idx].productGalleryUrl) {
        URL.revokeObjectURL(state.carousel.images[idx].previewUrl);
      }
      state.carousel.images.splice(idx, 1);
    }
  } else {
    // Add to carousel
    if (state.carousel.images.length >= 10) {
      alert("Maximum 10 images allowed in a carousel");
      return;
    }
    
    state.carousel.images.push({
      file: null,
      previewUrl: url,
      uploadedUrl: url, // Already uploaded
      productGalleryUrl: url // Mark as from product gallery
    });
  }
  
  // Update both UIs
  updateCarouselUI();
  renderCarouselProductImages(state.carousel.productGalleryImages);
}

// Add all product images to carousel
function addAllProductImagesToCarousel() {
  const images = state.carousel.productGalleryImages || [];
  const remaining = 10 - state.carousel.images.length;
  
  if (remaining <= 0) {
    alert("Carousel is full (10 images max)");
    return;
  }
  
  // Get URLs already in carousel
  const existingUrls = new Set(
    state.carousel.images
      .filter(img => img.productGalleryUrl)
      .map(img => img.productGalleryUrl)
  );
  
  // Add images not already in carousel
  let added = 0;
  for (const img of images) {
    if (added >= remaining) break;
    if (existingUrls.has(img.url)) continue;
    
    state.carousel.images.push({
      file: null,
      previewUrl: img.url,
      uploadedUrl: img.url,
      productGalleryUrl: img.url
    });
    added++;
  }
  
  if (added > 0) {
    updateCarouselUI();
    renderCarouselProductImages(state.carousel.productGalleryImages);
  }
}

async function handleCarouselFiles(files) {
  if (!files || files.length === 0) return;
  
  const maxImages = 10;
  const currentCount = state.carousel.images.length;
  const remaining = maxImages - currentCount;
  
  if (remaining <= 0) {
    alert("Maximum 10 images allowed in a carousel");
    return;
  }
  
  const filesToAdd = Array.from(files).slice(0, remaining);
  
  for (const file of filesToAdd) {
    if (!file.type.startsWith("image/")) continue;
    
    const previewUrl = URL.createObjectURL(file);
    state.carousel.images.push({
      file,
      previewUrl,
      uploadedUrl: null
    });
  }
  
  updateCarouselUI();
}

function updateCarouselUI() {
  const count = state.carousel.images.length;
  const countEl = document.getElementById("carouselImageCount");
  const previewGrid = document.getElementById("carouselPreviewGrid");
  const imagesContainer = document.getElementById("carouselImages");
  const statusEl = document.getElementById("carouselStatus");
  const btnPreview = document.getElementById("btnPreviewCarousel");
  const btnSchedule = document.getElementById("btnScheduleCarousel");
  
  if (countEl) countEl.textContent = `${count}/10 images`;
  
  if (count > 0) {
    previewGrid?.classList.remove("hidden");
    
    imagesContainer.innerHTML = state.carousel.images.map((img, idx) => `
      <div class="carousel-slide relative group aspect-square rounded-lg overflow-hidden border-2 border-gray-200 hover:border-purple-500 transition-all" 
           data-carousel-idx="${idx}" 
           draggable="true">
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
    
    // Setup drag and drop
    setupCarouselDragAndDrop();
    
    // Add remove handlers
    document.querySelectorAll(".carousel-remove-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        removeCarouselImage(idx);
      });
    });
    
    // Add move handlers
    document.querySelectorAll(".move-left").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        if (idx > 0) moveCarouselImage(idx, idx - 1);
      });
    });
    
    document.querySelectorAll(".move-right").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        if (idx < state.carousel.images.length - 1) moveCarouselImage(idx, idx + 1);
      });
    });
    
    // Add preview handlers
    document.querySelectorAll(".carousel-preview-trigger").forEach(img => {
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(img.dataset.idx);
        openCarouselImagePreview(idx);
      });
    });
    
  } else {
    previewGrid?.classList.add("hidden");
  }
  
  // Update status and buttons
  const isValid = count >= 2;
  
  if (statusEl) {
    if (count === 0) {
      statusEl.textContent = "Add at least 2 images to create a carousel";
    } else if (count === 1) {
      statusEl.textContent = "Add 1 more image (minimum 2 required)";
    } else {
      statusEl.textContent = `✓ Ready to schedule (${count} images)`;
      statusEl.classList.add("text-green-600");
    }
    
    if (!isValid) {
      statusEl.classList.remove("text-green-600");
    }
  }
  
  if (btnPreview) btnPreview.disabled = !isValid;
  if (btnSchedule) btnSchedule.disabled = !isValid;
  
  // Also update product images selection state if visible
  if (state.carousel.productGalleryImages?.length > 0) {
    renderCarouselProductImages(state.carousel.productGalleryImages);
  }
}

// Setup drag and drop for carousel images
function setupCarouselDragAndDrop() {
  const slides = document.querySelectorAll(".carousel-slide");
  
  slides.forEach(slide => {
    slide.addEventListener("dragstart", handleCarouselDragStart);
    slide.addEventListener("dragend", handleCarouselDragEnd);
    slide.addEventListener("dragover", handleCarouselDragOver);
    slide.addEventListener("dragenter", handleCarouselDragEnter);
    slide.addEventListener("dragleave", handleCarouselDragLeave);
    slide.addEventListener("drop", handleCarouselDrop);
  });
}

let carouselDraggedIdx = null;

function handleCarouselDragStart(e) {
  carouselDraggedIdx = parseInt(this.dataset.carouselIdx);
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", carouselDraggedIdx);
}

function handleCarouselDragEnd(e) {
  this.classList.remove("dragging");
  document.querySelectorAll(".carousel-slide").forEach(s => s.classList.remove("drag-over"));
}

function handleCarouselDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleCarouselDragEnter(e) {
  e.preventDefault();
  if (parseInt(this.dataset.carouselIdx) !== carouselDraggedIdx) {
    this.classList.add("drag-over");
  }
}

function handleCarouselDragLeave(e) {
  this.classList.remove("drag-over");
}

function handleCarouselDrop(e) {
  e.preventDefault();
  this.classList.remove("drag-over");
  
  const fromIdx = carouselDraggedIdx;
  const toIdx = parseInt(this.dataset.carouselIdx);
  
  if (fromIdx !== toIdx && fromIdx !== null) {
    moveCarouselImage(fromIdx, toIdx);
  }
  
  carouselDraggedIdx = null;
}

// Move image from one position to another
function moveCarouselImage(fromIdx, toIdx) {
  const images = state.carousel.images;
  const [moved] = images.splice(fromIdx, 1);
  images.splice(toIdx, 0, moved);
  updateCarouselUI();
}

// Remove image from carousel
function removeCarouselImage(idx) {
  const img = state.carousel.images[idx];
  if (img?.previewUrl && !img.productGalleryUrl) {
    URL.revokeObjectURL(img.previewUrl);
  }
  state.carousel.images.splice(idx, 1);
  updateCarouselUI();
}

// Image preview modal
let previewCurrentIdx = 0;

function openCarouselImagePreview(idx) {
  previewCurrentIdx = idx;
  const modal = document.getElementById("carouselImagePreviewModal");
  const img = document.getElementById("carouselPreviewImage");
  const indexEl = document.getElementById("carouselPreviewIndex");
  const totalEl = document.getElementById("carouselPreviewTotal");
  
  if (!modal || !img) return;
  
  img.src = state.carousel.images[idx].previewUrl;
  indexEl.textContent = idx + 1;
  totalEl.textContent = state.carousel.images.length;
  
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
  if (newIdx >= 0 && newIdx < state.carousel.images.length) {
    openCarouselImagePreview(newIdx);
  }
}

// Setup preview modal handlers
function setupCarouselPreviewModal() {
  document.getElementById("btnCloseImagePreview")?.addEventListener("click", closeCarouselImagePreview);
  document.getElementById("btnPrevImagePreview")?.addEventListener("click", () => navigateCarouselPreview(-1));
  document.getElementById("btnNextImagePreview")?.addEventListener("click", () => navigateCarouselPreview(1));
  
  // Close on background click
  document.getElementById("carouselImagePreviewModal")?.addEventListener("click", (e) => {
    if (e.target.id === "carouselImagePreviewModal") {
      closeCarouselImagePreview();
    }
  });
  
  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("carouselImagePreviewModal");
    if (modal?.classList.contains("hidden")) return;
    
    if (e.key === "Escape") closeCarouselImagePreview();
    if (e.key === "ArrowLeft") navigateCarouselPreview(-1);
    if (e.key === "ArrowRight") navigateCarouselPreview(1);
  });
}

// Caption and hashtag count updates
function setupCarouselCounters() {
  const captionEl = document.getElementById("carouselCaption");
  const hashtagsEl = document.getElementById("carouselHashtags");
  const captionCountEl = document.getElementById("carouselCaptionCount");
  const hashtagCountEl = document.getElementById("carouselHashtagCount");
  
  // Update counts function
  const updateCaptionCount = () => {
    const len = captionEl?.value?.length || 0;
    if (captionCountEl) {
      captionCountEl.textContent = `${len}/2200`;
      captionCountEl.classList.remove("count-warning", "count-error");
      if (len > 2000) captionCountEl.classList.add("count-warning");
      if (len > 2200) captionCountEl.classList.add("count-error");
    }
    // Debounce engagement score update
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
  
  // Initial count update
  setTimeout(() => {
    updateCaptionCount();
    updateHashtagCount();
  }, 100);
  
  // AI generate hashtags button
  document.getElementById("btnGenerateCarouselHashtags")?.addEventListener("click", generateCarouselHashtags);
  
  // Refresh score button
  document.getElementById("btnRefreshCarouselScore")?.addEventListener("click", calculateCarouselEngagementScore);
}

// Debounce for engagement score
let carouselScoreTimeout = null;
function debounceCarouselScore() {
  clearTimeout(carouselScoreTimeout);
  carouselScoreTimeout = setTimeout(() => {
    calculateCarouselEngagementScore();
  }, 1000);
}

// Calculate engagement prediction score for carousel
async function calculateCarouselEngagementScore() {
  const scoreEl = document.getElementById("carouselEngagementScore");
  const scoreValue = document.getElementById("carouselScoreValue");
  const scoreLabel = document.getElementById("carouselScoreLabel");
  const scoreTip = document.getElementById("carouselScoreTip");
  const scoreContainer = scoreEl?.querySelector(".engagement-score");
  
  if (!scoreEl) return;
  
  const caption = document.getElementById("carouselCaption")?.value || "";
  const hashtags = document.getElementById("carouselHashtags")?.value || "";
  const imageCount = state.carousel.images.length;
  
  // Only show if we have some content
  if (!caption && imageCount === 0) {
    scoreEl.classList.add("hidden");
    return;
  }
  
  scoreEl.classList.remove("hidden");
  scoreValue.textContent = "...";
  
  try {
    // Calculate score based on multiple factors
    const score = await calculateEngagementScore({
      caption,
      hashtags,
      imageCount,
      isCarousel: true,
      productId: state.carousel.productId,
      scheduleTime: state.carousel.scheduleTime
    });
    
    updateEngagementScoreUI(scoreContainer, scoreValue, scoreLabel, scoreTip, score);
    
  } catch (err) {
    console.error("[Carousel] Score calculation error:", err);
    scoreValue.textContent = "?";
    scoreLabel.textContent = "Unable to calculate";
    scoreTip.textContent = "Try refreshing";
  }
}

// Universal engagement score calculation
async function calculateEngagementScore({ caption, hashtags, imageCount = 1, isCarousel = false, productId, scheduleTime }) {
  let score = 50; // Base score
  const tips = [];
  
  // Caption length scoring (optimal: 125-150 chars for IG, up to 2200)
  const captionLen = caption.length;
  if (captionLen === 0) {
    score -= 20;
    tips.push("Add a caption for better engagement");
  } else if (captionLen >= 100 && captionLen <= 300) {
    score += 15;
  } else if (captionLen > 300 && captionLen <= 500) {
    score += 10;
  } else if (captionLen > 1000) {
    score -= 5;
    tips.push("Long captions may reduce engagement");
  }
  
  // Emoji check
  const emojiCount = (caption.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu) || []).length;
  if (emojiCount >= 1 && emojiCount <= 5) {
    score += 8;
  } else if (emojiCount > 10) {
    score -= 5;
    tips.push("Too many emojis can reduce engagement");
  } else if (emojiCount === 0) {
    tips.push("Add 1-3 emojis for better visibility");
  }
  
  // Hashtag scoring
  const hashtagList = hashtags.match(/#\w+/g) || [];
  const hashtagCount = hashtagList.length;
  if (hashtagCount === 0) {
    score -= 15;
    tips.push("Add hashtags for discoverability");
  } else if (hashtagCount >= 3 && hashtagCount <= 10) {
    score += 15;
  } else if (hashtagCount > 20) {
    score -= 10;
    tips.push("Too many hashtags looks spammy");
  }
  
  // Carousel bonus
  if (isCarousel && imageCount >= 2) {
    score += 10;
    if (imageCount >= 5) score += 5;
  }
  
  // CTA check (call to action)
  const ctaPatterns = /\b(shop|buy|get|grab|check out|link|tap|click|swipe|comment|tag|share|save)\b/i;
  if (ctaPatterns.test(caption)) {
    score += 10;
  } else {
    tips.push("Add a call-to-action (shop now, link in bio, etc.)");
  }
  
  // Question check (increases comments)
  if (caption.includes("?")) {
    score += 5;
  }
  
  // Time scoring (based on learning data if available)
  if (scheduleTime) {
    const hour = parseInt(scheduleTime.split(":")[0]);
    // Peak hours: 5-9 AM, 12-2 PM, 7-9 PM
    if ((hour >= 5 && hour <= 9) || (hour >= 12 && hour <= 14) || (hour >= 19 && hour <= 21)) {
      score += 8;
    }
  }
  
  // Cap score
  score = Math.max(10, Math.min(100, score));
  
  // Get best tip
  const bestTip = tips.length > 0 ? tips[0] : "Looking good! Ready to post.";
  
  return { score, tips, bestTip };
}

// Update engagement score UI
function updateEngagementScoreUI(container, valueEl, labelEl, tipEl, { score, bestTip }) {
  if (!container || !valueEl) return;
  
  valueEl.textContent = score;
  
  // Remove old classes
  container.classList.remove("score-low", "score-medium", "score-high");
  
  if (score >= 75) {
    container.classList.add("score-high");
    labelEl.textContent = "🔥 High Engagement Potential";
  } else if (score >= 50) {
    container.classList.add("score-medium");
    labelEl.textContent = "📈 Good Engagement Potential";
  } else {
    container.classList.add("score-low");
    labelEl.textContent = "⚠️ Low Engagement Potential";
  }
  
  tipEl.textContent = bestTip;
}

// Generate hashtags using AI
async function generateCarouselHashtags() {
  const btn = document.getElementById("btnGenerateCarouselHashtags");
  const hashtagsEl = document.getElementById("carouselHashtags");
  
  if (!btn || !hashtagsEl) return;
  
  const originalText = btn.textContent;
  btn.textContent = "⏳ Generating...";
  btn.disabled = true;
  
  try {
    // Get product context if selected
    const product = state.carousel.productId 
      ? state.products.find(p => p.id === state.carousel.productId)
      : null;
    
    const category = product?.category_id
      ? state.categories.find(c => c.id === product.category_id)
      : null;
    
    const productInfo = product ? {
      name: product.name,
      category: category?.name || "accessories"
    } : { name: "fashion item", category: "accessories" };
    
    const response = await fetch(`${window.ENV?.SUPABASE_URL}/functions/v1/ai-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${window.ENV?.SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        type: "hashtags",
        productName: productInfo.name,
        productCategory: productInfo.category,
        platform: "instagram"
      })
    });
    
    const data = await response.json();
    
    if (data.hashtags) {
      hashtagsEl.value = data.hashtags;
      hashtagsEl.dispatchEvent(new Event("input"));
      state.carousel.hashtags = data.hashtags;
    }
    
  } catch (err) {
    console.error("[Carousel] Failed to generate hashtags:", err);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Helper to trigger input event on an element
function triggerInputEvent(element) {
  if (element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// Update all post counters and score (call this after setting values programmatically)
function updatePostCountersAndScore() {
  const captionEl = document.getElementById("captionText");
  const hashtagsEl = document.getElementById("hashtagText");
  triggerInputEvent(captionEl);
  triggerInputEvent(hashtagsEl);
  // Immediate score calculation
  setTimeout(() => calculatePostEngagementScore(), 100);
}

// Update all carousel counters and score
function updateCarouselCountersAndScore() {
  const captionEl = document.getElementById("carouselCaption");
  const hashtagsEl = document.getElementById("carouselHashtags");
  triggerInputEvent(captionEl);
  triggerInputEvent(hashtagsEl);
  // Immediate score calculation
  setTimeout(() => calculateCarouselEngagementScore(), 100);
}

// Setup counters and engagement score for regular post creation
function setupPostCounters() {
  const captionEl = document.getElementById("captionText");
  const hashtagsEl = document.getElementById("hashtagText");
  const captionCountEl = document.getElementById("postCaptionCount");
  const hashtagCountEl = document.getElementById("postHashtagCount");
  
  // Update counts function
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
  
  // AI generate hashtags button
  document.getElementById("btnGeneratePostHashtags")?.addEventListener("click", generatePostHashtags);
  
  // Refresh score button
  document.getElementById("btnRefreshPostScore")?.addEventListener("click", calculatePostEngagementScore);
}

// Debounce for post engagement score
let postScoreTimeout = null;
function debouncePostScore() {
  clearTimeout(postScoreTimeout);
  postScoreTimeout = setTimeout(() => {
    calculatePostEngagementScore();
  }, 1000);
}

// Calculate engagement prediction score for regular post
async function calculatePostEngagementScore() {
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
    const score = await calculateEngagementScore({
      caption,
      hashtags,
      imageCount: 1,
      isCarousel: false,
      productId: state.uploadData?.productId,
      scheduleTime
    });
    
    updateEngagementScoreUI(scoreContainer, scoreValue, scoreLabel, scoreTip, score);
    
  } catch (err) {
    console.error("[Post] Score calculation error:", err);
    scoreValue.textContent = "?";
    scoreLabel.textContent = "Unable to calculate";
    scoreTip.textContent = "Try refreshing";
  }
}

// Generate hashtags for regular post using AI
async function generatePostHashtags() {
  const btn = document.getElementById("btnGeneratePostHashtags");
  const hashtagsEl = document.getElementById("hashtagText");
  
  if (!btn || !hashtagsEl) return;
  
  const originalText = btn.textContent;
  btn.textContent = "⏳...";
  btn.disabled = true;
  
  try {
    const product = state.uploadData?.productId 
      ? state.products.find(p => p.id === state.uploadData.productId)
      : null;
    
    const category = product?.category_id
      ? state.categories.find(c => c.id === product.category_id)
      : null;
    
    const productInfo = product ? {
      name: product.name,
      category: category?.name || "accessories"
    } : { name: "fashion item", category: "accessories" };
    
    const response = await fetch(`${window.ENV?.SUPABASE_URL}/functions/v1/ai-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${window.ENV?.SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        type: "hashtags",
        productName: productInfo.name,
        productCategory: productInfo.category,
        platform: "instagram"
      })
    });
    
    const data = await response.json();
    
    if (data.hashtags) {
      hashtagsEl.value = data.hashtags;
      hashtagsEl.dispatchEvent(new Event("input"));
      state.uploadData.hashtags = data.hashtags.split(" ");
    }
    
  } catch (err) {
    console.error("[Post] Failed to generate hashtags:", err);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function resetCarouselBuilder() {
  console.log("[Carousel] Resetting carousel builder");
  
  // Clear existing images
  state.carousel.images.forEach(img => {
    if (img.previewUrl && !img.productGalleryUrl) URL.revokeObjectURL(img.previewUrl);
  });
  
  state.carousel = {
    images: [],
    productId: null,
    productGalleryImages: [],
    tone: "casual",
    caption: "",
    hashtags: "",
    scheduleDate: null,
    scheduleTime: "12:00"
  };
  
  // Reset UI
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
  
  // Reset tone buttons
  document.querySelectorAll(".carousel-tone-btn").forEach(btn => {
    btn.classList.remove("bg-purple-100", "border-purple-300");
    if (btn.dataset.carouselTone === "casual") {
      btn.classList.add("bg-purple-100", "border-purple-300");
    }
  });
  
  updateCarouselUI();
  console.log("[Carousel] Reset complete");
}

async function regenerateCarouselCaption() {
  console.log("[Carousel] Regenerating caption, tone:", state.carousel.tone, "productId:", state.carousel.productId);
  const product = state.products.find(p => p.id === state.carousel.productId);
  
  // Load recommended tone based on category
  if (product) {
    await loadCarouselRecommendedTone(product);
  }
  
  if (!product) {
    console.log("[Carousel] No product selected, using default caption");
    document.getElementById("carouselCaption").value = "Check out our latest carousel! 📸✨ Swipe through to see more!\n\nShop now at karrykraze.com";
    document.getElementById("carouselHashtags").value = "#karrykraze #carousel #fashion #shopping";
    updateCarouselCountersAndScore();
    return;
  }
  
  console.log("[Carousel] Found product:", product.name);
  
  // generateCaption expects (tone, productData)
  const productData = {
    product_name: product.name || product.title,
    category: product.category?.name || "item",
    link: `https://karrykraze.com/pages/product.html?slug=${product.slug}`
  };
  
  try {
    const caption = await generateCaption(state.carousel.tone, productData);
    const hashtags = await getHashtagsForProduct(product);
    
    // Add carousel-specific text
    const carouselPrefix = "📸 Swipe to see more! ➡️\n\n";
    
    document.getElementById("carouselCaption").value = carouselPrefix + caption;
    document.getElementById("carouselHashtags").value = formatHashtags(hashtags);
    
    state.carousel.caption = document.getElementById("carouselCaption").value;
    state.carousel.hashtags = document.getElementById("carouselHashtags").value;
    
    // Update counters and engagement score
    updateCarouselCountersAndScore();
    
    console.log("[Carousel] Caption generated:", caption.substring(0, 50) + "...");
  } catch (err) {
    console.error("[Carousel] Failed to generate caption:", err);
    document.getElementById("carouselCaption").value = "📸 Swipe to see more! ➡️\n\nCheck out " + (product.name || "this amazing product") + "!\n\nShop now at karrykraze.com";
    updateCarouselCountersAndScore();
  }
}

/**
 * Load and display recommended tone for carousel based on category insights
 */
async function loadCarouselRecommendedTone(product) {
  try {
    const category = product.category?.name || state.categories.find(c => c.id === product.category_id)?.name;
    
    if (!category) return;
    
    const insights = await getCategoryInsights(category);
    
    if (insights?.caption_strategy?.tone_that_works) {
      const recommendedTone = insights.caption_strategy.tone_that_works.toLowerCase();
      
      // Map AI tone to our tone options
      const toneMap = {
        "playful": "playful",
        "fun": "playful",
        "casual": "casual",
        "friendly": "casual",
        "urgent": "urgency",
        "urgency": "urgency",
        "professional": "professional",
        "minimal": "minimalist",
        "minimalist": "minimalist",
        "value": "value",
        "deal": "value",
        "trending": "trending",
        "inspirational": "inspirational",
        "inspiring": "inspirational"
      };
      
      const mappedTone = toneMap[recommendedTone] || null;
      
      if (mappedTone) {
        // Show recommendation message
        const recEl = document.getElementById("carouselToneRecommendation");
        const recToneEl = document.getElementById("carouselRecommendedTone");
        if (recEl && recToneEl) {
          recToneEl.textContent = `${recommendedTone} tone works best for ${category}`;
          recEl.classList.remove("hidden");
        }
        
        // Highlight the recommended button
        document.querySelectorAll(".carousel-tone-btn").forEach(btn => {
          if (btn.dataset.carouselTone === mappedTone) {
            btn.classList.add("ring-2", "ring-purple-500", "ring-offset-1");
            if (!btn.querySelector(".carousel-ai-badge")) {
              btn.insertAdjacentHTML("beforeend", `<span class="carousel-ai-badge ml-1 text-[10px] bg-purple-500 text-white px-1 rounded">AI</span>`);
            }
          } else {
            btn.classList.remove("ring-2", "ring-purple-500", "ring-offset-1");
            btn.querySelector(".carousel-ai-badge")?.remove();
          }
        });
        
        console.log(`[Carousel] AI recommends "${mappedTone}" for ${category} category`);
      }
    }
  } catch (err) {
    console.warn("[Carousel] Failed to load recommended tone:", err);
  }
}

function previewCarousel() {
  const images = state.carousel.images;
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
          
          <!-- Navigation arrows -->
          <button id="prevSlide" class="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full shadow flex items-center justify-center hover:bg-white">←</button>
          <button id="nextSlide" class="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full shadow flex items-center justify-center hover:bg-white">→</button>
          
          <!-- Dots indicator -->
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
    dots.forEach((dot, i) => {
      dot.classList.toggle("bg-white", i === currentSlide);
      dot.classList.toggle("bg-white/50", i !== currentSlide);
    });
  }
  
  document.getElementById("prevSlide")?.addEventListener("click", () => {
    currentSlide = (currentSlide - 1 + images.length) % images.length;
    updateSlide();
  });
  
  document.getElementById("nextSlide")?.addEventListener("click", () => {
    currentSlide = (currentSlide + 1) % images.length;
    updateSlide();
  });
  
  dots.forEach(dot => {
    dot.addEventListener("click", () => {
      currentSlide = parseInt(dot.dataset.idx);
      updateSlide();
    });
  });
  
  document.getElementById("btnCloseCarouselPreview")?.addEventListener("click", () => {
    overlay?.remove();
  });
  
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

async function scheduleCarousel() {
  const images = state.carousel.images;
  const caption = document.getElementById("carouselCaption")?.value || "";
  const hashtags = document.getElementById("carouselHashtags")?.value || "";
  const scheduleDate = document.getElementById("carouselScheduleDate")?.value;
  const scheduleTime = document.getElementById("carouselScheduleTime")?.value || "12:00";
  
  if (images.length < 2) {
    alert("Please add at least 2 images for a carousel");
    return;
  }
  
  if (!scheduleDate) {
    alert("Please select a schedule date");
    return;
  }
  
  const btnSchedule = document.getElementById("btnScheduleCarousel");
  btnSchedule.disabled = true;
  btnSchedule.textContent = "Uploading...";
  
  try {
    const client = getSupabaseClient();
    const uploadedUrls = [];
    
    // Upload all images
    for (let i = 0; i < images.length; i++) {
      btnSchedule.textContent = `Uploading ${i + 1}/${images.length}...`;
      
      const img = images[i];
      const filename = `carousel_${Date.now()}_${i}.${img.file.name.split('.').pop()}`;
      
      const { data: uploadData, error: uploadError } = await client.storage
        .from("social-media")
        .upload(`carousels/${filename}`, img.file, {
          contentType: img.file.type,
          upsert: false
        });
      
      if (uploadError) {
        throw new Error(`Failed to upload image ${i + 1}: ${uploadError.message}`);
      }
      
      const publicUrl = getPublicUrl("social-media", `carousels/${filename}`);
      uploadedUrls.push(publicUrl);
    }
    
    btnSchedule.textContent = "Scheduling...";
    
    // Create the scheduled post record
    const fullCaption = caption + (hashtags ? "\n\n" + hashtags : "");
    const scheduledFor = `${scheduleDate}T${scheduleTime}:00`;
    
    const { data: post, error: postError } = await client
      .from("social_posts")
      .insert({
        platform: "instagram",
        media_type: "carousel",
        image_url: uploadedUrls[0], // First image as thumbnail
        image_urls: uploadedUrls,   // All images
        caption: fullCaption,
        product_id: state.carousel.productId || null,
        scheduled_for: scheduledFor,
        status: "queued"
      })
      .select()
      .single();
    
    if (postError) {
      throw new Error(`Failed to create post: ${postError.message}`);
    }
    
    alert(`🎠 Carousel scheduled for ${new Date(scheduledFor).toLocaleString()}!`);
    
    // Reset the builder
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

async function loadRecentCarousels() {
  try {
    const client = getSupabaseClient();
    
    const { data: carousels, error } = await client
      .from("social_posts")
      .select("*")
      .eq("media_type", "carousel")
      .order("created_at", { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    const container = document.getElementById("recentCarouselsList");
    if (!container) return;
    
    if (!carousels || carousels.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-400">
          <svg class="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/>
          </svg>
          <p>No carousels created yet</p>
          <p class="text-xs mt-1">Build your first multi-image post above</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = carousels.map(c => {
      const date = new Date(c.scheduled_for);
      const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const imageCount = c.image_urls?.length || 1;
      
      const statusColors = {
        queued: "bg-blue-100 text-blue-700",
        posted: "bg-green-100 text-green-700",
        published: "bg-green-100 text-green-700",
        failed: "bg-red-100 text-red-700",
        deleted: "bg-gray-200 text-gray-500 line-through"
      };
      
      return `
        <div class="p-4 flex items-center gap-4 hover:bg-gray-50">
          <div class="relative">
            <img src="${c.image_url}" class="w-16 h-16 object-cover rounded-lg">
            <div class="absolute -bottom-1 -right-1 bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">${imageCount}</div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${c.caption?.substring(0, 50) || "No caption"}...</div>
            <div class="text-xs text-gray-400 mt-1">${dateStr} at ${timeStr} • ${imageCount} slides</div>
          </div>
          <span class="text-xs px-2 py-1 rounded-full ${statusColors[c.status] || "bg-gray-100 text-gray-700"}">${c.status}</span>
        </div>
      `;
    }).join("");
    
  } catch (err) {
    console.error("Failed to load recent carousels:", err);
  }
}

// ============================================
// Analytics Dashboard
// ============================================

function setupAnalytics() {
  document.getElementById("btnRefreshAnalytics")?.addEventListener("click", loadAnalytics);
  document.getElementById("btnSyncInstagramInsights")?.addEventListener("click", syncInstagramInsights);
}

async function syncInstagramInsights() {
  const btn = document.getElementById("btnSyncInstagramInsights");
  const spinner = document.getElementById("syncInsightsSpinner");
  
  try {
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove("hidden");
    
    const client = getSupabaseClient();
    const { data, error } = await client.functions.invoke("instagram-insights", {
      body: { syncAll: true, daysBack: 30 }
    });
    
    if (error) throw error;
    
    console.log("Insights sync result:", data);
    
    // Reload ALL views to reflect changes (including deleted posts)
    await loadAnalytics();
    await loadEngagementMetrics();
    
    // Also refresh calendar to show deleted status
    await loadCalendarPosts();
    
    // And queue if there are any changes
    await loadQueuePosts();
    
    // Show success message with deleted count
    const lastSync = document.getElementById("analyticsLastSync");
    if (lastSync) {
      const deletedMsg = data.deleted > 0 ? `, ${data.deleted} deleted` : "";
      lastSync.textContent = `Last synced: ${new Date().toLocaleTimeString()} • ${data.updated || 0} updated${deletedMsg}`;
    }
    
  } catch (err) {
    console.error("Failed to sync insights:", err);
    alert("Failed to sync insights: " + (err.message || "Unknown error"));
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add("hidden");
  }
}

async function loadEngagementMetrics() {
  try {
    const client = getSupabaseClient();
    
    // Fetch Instagram posts with engagement data (exclude deleted posts)
    const { data: posts, error } = await client
      .from("social_posts")
      .select("id, likes, comments, saves, impressions, reach, engagement_rate, engagement_updated_at, caption, hashtags, posted_at, status, image_url, permalink")
      .eq("platform", "instagram")
      .eq("status", "posted")
      .neq("status", "deleted")
      .not("engagement_updated_at", "is", null)
      .order("engagement_rate", { ascending: false });
    
    if (error) throw error;
    
    // Double filter to ensure no deleted posts slip through
    const allPosts = (posts || []).filter(p => p.status === "posted");
    
    console.log(`Engagement metrics: Found ${posts?.length || 0} posts, filtered to ${allPosts.length} (excluding deleted)`);
    
    if (allPosts.length === 0) {
      // Reset UI to zeros if no posts
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setEl("analyticsLikes", "0");
      setEl("analyticsComments", "0");
      setEl("analyticsSaves", "0");
      setEl("analyticsImpressions", "0");
      setEl("analyticsReach", "0");
      setEl("analyticsEngagementRate", "0%");
      
      const topPostsContainer = document.getElementById("analyticsTopPosts");
      if (topPostsContainer) {
        topPostsContainer.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">No engagement data yet</div>';
      }
      return;
    }
    
    // Calculate totals
    const totals = allPosts.reduce((acc, p) => {
      acc.likes += p.likes || 0;
      acc.comments += p.comments || 0;
      acc.saves += p.saves || 0;
      acc.impressions += p.impressions || 0;
      acc.reach += p.reach || 0;
      return acc;
    }, { likes: 0, comments: 0, saves: 0, impressions: 0, reach: 0 });
    
    // Calculate average engagement rate
    const avgEngRate = allPosts.length > 0
      ? (allPosts.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) / allPosts.length).toFixed(2)
      : 0;
    
    // Update UI
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    
    const formatNum = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : n.toString();
    
    setEl("analyticsLikes", formatNum(totals.likes));
    setEl("analyticsComments", formatNum(totals.comments));
    setEl("analyticsSaves", formatNum(totals.saves));
    setEl("analyticsImpressions", formatNum(totals.impressions));
    setEl("analyticsReach", formatNum(totals.reach));
    setEl("analyticsEngagementRate", avgEngRate + "%");
    
    // Find last sync time
    const lastUpdate = allPosts.reduce((latest, p) => {
      const d = new Date(p.engagement_updated_at);
      return d > latest ? d : latest;
    }, new Date(0));
    
    const lastSync = document.getElementById("analyticsLastSync");
    if (lastSync && lastUpdate.getTime() > 0) {
      lastSync.textContent = `Last updated: ${lastUpdate.toLocaleDateString()} ${lastUpdate.toLocaleTimeString()}`;
    }
    
    // Top performing posts - make clickable
    const topPosts = allPosts.slice(0, 5);
    const topPostsContainer = document.getElementById("analyticsTopPosts");
    if (topPostsContainer && topPosts.length > 0) {
      topPostsContainer.innerHTML = topPosts.map((p, idx) => {
        const date = new Date(p.posted_at);
        const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `
          <div class="p-3 flex items-center gap-3 hover:bg-gray-50 cursor-pointer transition-colors" data-post-id="${p.id}" onclick="window.openPostAnalytics && window.openPostAnalytics('${p.id}')">
            <span class="text-lg font-black text-gray-300">#${idx + 1}</span>
            ${p.image_url ? `<img src="${p.image_url}" class="w-10 h-10 rounded object-cover flex-shrink-0">` : ''}
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">${p.caption?.substring(0, 50) || "No caption"}...</div>
              <div class="text-xs text-gray-400">${dateStr}</div>
            </div>
            <div class="flex items-center gap-2 sm:gap-3 text-xs">
              <span class="text-pink-500">❤️ ${p.likes || 0}</span>
              <span class="text-blue-500 hidden sm:inline">💬 ${p.comments || 0}</span>
              <span class="text-yellow-500 hidden sm:inline">🔖 ${p.saves || 0}</span>
              <span class="px-2 py-1 bg-orange-100 text-orange-700 font-bold rounded">${p.engagement_rate || 0}%</span>
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
            </div>
          </div>
        `;
      }).join("");
    }
    
    // All posts grid (thumbnail browser)
    const allPostsGrid = document.getElementById("analyticsAllPosts");
    if (allPostsGrid && allPosts.length > 0) {
      allPostsGrid.innerHTML = allPosts.map(p => {
        const engColor = (p.engagement_rate || 0) >= 5 ? "border-green-500" 
                       : (p.engagement_rate || 0) >= 2 ? "border-blue-500" 
                       : "border-gray-200";
        return `
          <div class="aspect-square relative group cursor-pointer rounded overflow-hidden border-2 ${engColor}" 
               onclick="window.openPostAnalytics && window.openPostAnalytics('${p.id}')">
            ${p.image_url 
              ? `<img src="${p.image_url}" class="w-full h-full object-cover" loading="lazy">` 
              : `<div class="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No img</div>`
            }
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs">
              <span>❤️ ${p.likes || 0}</span>
              <span>${p.engagement_rate || 0}%</span>
            </div>
          </div>
        `;
      }).join("");
    }
    
    // Hashtag performance
    const { data: hashtagData } = await client
      .from("hashtag_performance")
      .select("*")
      .order("avg_engagement_rate", { ascending: false })
      .limit(15);
    
    const hashtagsContainer = document.getElementById("analyticsHashtags");
    if (hashtagsContainer && hashtagData && hashtagData.length > 0) {
      const maxEff = Math.max(...hashtagData.map(h => h.avg_engagement_rate || 0)) || 1;
      hashtagsContainer.innerHTML = `
        <div class="flex flex-wrap gap-2">
          ${hashtagData.map(h => {
            const eff = h.avg_engagement_rate || 0;
            const size = Math.max(0.8, Math.min(1.4, eff / maxEff + 0.8));
            const colors = eff > 3 ? "bg-green-100 text-green-700 border-green-200" 
                         : eff > 1.5 ? "bg-blue-100 text-blue-700 border-blue-200"
                         : "bg-gray-100 text-gray-700 border-gray-200";
            return `
              <span class="inline-flex items-center gap-1 px-2 py-1 border rounded-full ${colors}" style="font-size: ${size}rem">
                #${h.hashtag}
                <span class="text-xs opacity-70">${eff.toFixed(1)}%</span>
              </span>
            `;
          }).join("")}
        </div>
        <p class="text-xs text-gray-400 mt-4">Size and color indicate engagement effectiveness. Green = high performing.</p>
      `;
    }
    
  } catch (err) {
    console.error("Failed to load engagement metrics:", err);
  }
}

async function loadAnalytics() {
  try {
    const client = getSupabaseClient();
    
    // Get all posts with basic info
    // Note: DB may have posted_at or published_at depending on migration status
    const { data: posts, error } = await client
      .from("social_posts")
      .select("id, platform, status, scheduled_for, posted_at, caption, created_at")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    
    const allPosts = posts || [];
    
    // Calculate metrics
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    // Exclude deleted posts from counts
    const activePosts = allPosts.filter(p => p.status !== "deleted");
    const totalPosts = activePosts.length;
    // Support both 'posted' and 'published' status
    const published = activePosts.filter(p => p.status === "published" || p.status === "posted").length;
    const thisWeek = activePosts.filter(p => {
      const isPublished = p.status === "published" || p.status === "posted";
      const publishDate = p.posted_at || p.published_at;
      return isPublished && publishDate && new Date(publishDate) >= weekAgo;
    }).length;
    const scheduled = activePosts.filter(p => 
      p.status === "queued" && 
      new Date(p.scheduled_for) > now
    ).length;
    
    // Update key metrics
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    
    setEl("analyticsTotalPosts", totalPosts);
    setEl("analyticsPublished", published);
    setEl("analyticsThisWeek", thisWeek);
    setEl("analyticsScheduled", scheduled);
    
    // Also load engagement metrics
    loadEngagementMetrics();
    
    // Platform breakdown
    const platforms = { instagram: 0, facebook: 0, pinterest: 0 };
    allPosts.forEach(p => {
      if (platforms[p.platform] !== undefined) {
        platforms[p.platform]++;
      }
    });
    
    const maxPlatform = Math.max(...Object.values(platforms)) || 1;
    
    setEl("analyticsInstagramCount", platforms.instagram);
    setEl("analyticsFacebookCount", platforms.facebook);
    setEl("analyticsPinterestCount", platforms.pinterest);
    
    const setBar = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.style.width = `${(count / maxPlatform) * 100}%`;
    };
    
    setBar("analyticsInstagramBar", platforms.instagram);
    setBar("analyticsFacebookBar", platforms.facebook);
    setBar("analyticsPinterestBar", platforms.pinterest);
    
    // Status breakdown
    const statuses = { queued: 0, published: 0, failed: 0, draft: 0, cancelled: 0 };
    allPosts.forEach(p => {
      if (statuses[p.status] !== undefined) {
        statuses[p.status]++;
      }
    });
    
    setEl("analyticsStatusQueued", statuses.queued);
    setEl("analyticsStatusPublished", statuses.published);
    setEl("analyticsStatusFailed", statuses.failed);
    setEl("analyticsStatusDraft", statuses.draft);
    setEl("analyticsStatusCancelled", statuses.cancelled);
    
    // Posting time distribution
    const timeSlots = {
      "Morning (6-12)": 0,
      "Afternoon (12-17)": 0,
      "Evening (17-21)": 0,
      "Night (21-6)": 0,
    };
    
    allPosts.forEach(p => {
      const hour = new Date(p.scheduled_for).getHours();
      if (hour >= 6 && hour < 12) timeSlots["Morning (6-12)"]++;
      else if (hour >= 12 && hour < 17) timeSlots["Afternoon (12-17)"]++;
      else if (hour >= 17 && hour < 21) timeSlots["Evening (17-21)"]++;
      else timeSlots["Night (21-6)"]++;
    });
    
    const maxTime = Math.max(...Object.values(timeSlots)) || 1;
    const timeChart = document.getElementById("analyticsTimeChart");
    if (timeChart) {
      timeChart.innerHTML = Object.entries(timeSlots).map(([label, count]) => `
        <div class="flex items-center gap-3">
          <div class="w-32 text-xs text-gray-600 text-right">${label}</div>
          <div class="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all" 
                 style="width: ${(count / maxTime) * 100}%"></div>
          </div>
          <div class="w-8 text-xs font-bold text-gray-700">${count}</div>
        </div>
      `).join("");
    }
    
    // Recent activity
    const recentPosts = allPosts.slice(0, 10);
    const activityContainer = document.getElementById("analyticsRecentActivity");
    if (activityContainer) {
      if (recentPosts.length === 0) {
        activityContainer.innerHTML = `<div class="p-4 text-center text-gray-400 text-sm">No posts yet</div>`;
      } else {
        activityContainer.innerHTML = recentPosts.map(p => {
          const date = new Date(p.posted_at || p.published_at || p.scheduled_for);
          const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          
          const statusColors = {
            published: "bg-green-100 text-green-700",
            posted: "bg-green-100 text-green-700",
            queued: "bg-blue-100 text-blue-700",
            failed: "bg-red-100 text-red-700",
            draft: "bg-gray-100 text-gray-700",
            cancelled: "bg-gray-100 text-gray-400",
            deleted: "bg-gray-200 text-gray-500 line-through"
          };
          
          const platformIcons = {
            instagram: "📸",
            facebook: "📘",
            pinterest: "📌",
          };
          
          return `
            <div class="p-3 flex items-center gap-3 hover:bg-gray-50">
              <span class="text-lg">${platformIcons[p.platform] || "📱"}</span>
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">${p.caption?.substring(0, 50) || "No caption"}...</div>
                <div class="text-xs text-gray-400">${dateStr} at ${timeStr}</div>
              </div>
              <span class="text-xs px-2 py-1 rounded-full ${statusColors[p.status] || statusColors.draft}">${p.status}</span>
            </div>
          `;
        }).join("");
      }
    }
    
    // Tone usage (estimate from caption patterns)
    const tonePatterns = {
      "😊 Casual": ["Check out", "Just dropped", "Obsessed", "love", "POV:", "cute"],
      "🔥 Urgency": ["Don't miss", "Limited", "Last chance", "Selling fast", "FAST"],
      "💼 Pro": ["Introducing", "Elevate", "Premium", "Discover", "Quality"],
      "🎉 Playful": ["Treat yourself", "match made", "Plot twist", "Tag someone"],
      "💰 Value": ["price", "budget", "deal", "afford", "wallet"],
      "📈 Trending": ["Trending", "everyone", "viral", "hype", "season"],
      "✨ Inspire": ["Be bold", "Confidence", "Express", "Level up"],
      "🪶 Minimal": ["Simple", "Clean", "Less is more", "Effortless"],
    };
    
    const toneCounts = {};
    Object.keys(tonePatterns).forEach(tone => toneCounts[tone] = 0);
    
    allPosts.forEach(p => {
      if (!p.caption) return;
      const caption = p.caption.toLowerCase();
      Object.entries(tonePatterns).forEach(([tone, patterns]) => {
        if (patterns.some(pat => caption.includes(pat.toLowerCase()))) {
          toneCounts[tone]++;
        }
      });
    });
    
    const maxTone = Math.max(...Object.values(toneCounts)) || 1;
    const toneChart = document.getElementById("analyticsToneChart");
    if (toneChart) {
      toneChart.innerHTML = Object.entries(toneCounts).map(([tone, count]) => `
        <div class="text-center p-3 bg-gray-50 rounded-lg">
          <div class="text-lg mb-1">${tone.split(" ")[0]}</div>
          <div class="text-xl font-black">${count}</div>
          <div class="text-xs text-gray-500">${tone.split(" ")[1]}</div>
        </div>
      `).join("");
    }
    
  } catch (err) {
    console.error("Failed to load analytics:", err);
  }
}

// ============================================
// Post Analytics Modal
// ============================================

async function openPostAnalytics(postId) {
  const modal = document.getElementById("postAnalyticsModal");
  if (!modal) return;
  
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  
  try {
    // Fetch post data
    const { data: post, error } = await getClient()
      .from("social_posts")
      .select("*")
      .eq("id", postId)
      .single();
    
    if (error || !post) {
      console.error("Failed to load post:", error);
      return;
    }
    
    // Populate modal
    const img = modal.querySelector("#postAnalyticsImage img");
    if (img) img.src = post.image_url || "";
    
    const platform = document.getElementById("postAnalyticsPlatform");
    if (platform) {
      platform.textContent = post.platform?.charAt(0).toUpperCase() + post.platform?.slice(1) || "Unknown";
      platform.className = post.platform === "instagram" 
        ? "px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white"
        : "px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white";
    }
    
    const dateEl = document.getElementById("postAnalyticsDate");
    if (dateEl && post.posted_at) {
      const d = new Date(post.posted_at);
      dateEl.textContent = d.toLocaleDateString("en-US", { 
        weekday: "short", month: "short", day: "numeric", year: "numeric", 
        hour: "numeric", minute: "2-digit" 
      });
    }
    
    const caption = document.getElementById("postAnalyticsCaption");
    if (caption) caption.textContent = post.caption || "No caption";
    
    const permalink = document.getElementById("postAnalyticsPermalink");
    if (permalink && post.permalink) {
      permalink.href = post.permalink;
      permalink.classList.remove("hidden");
    } else if (permalink) {
      permalink.classList.add("hidden");
    }
    
    // Metrics
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    
    setVal("postAnalyticsLikes", post.likes || 0);
    setVal("postAnalyticsComments", post.comments || 0);
    setVal("postAnalyticsSaves", post.saves || 0);
    setVal("postAnalyticsShares", post.shares || 0);
    setVal("postAnalyticsReach", post.reach || 0);
    setVal("postAnalyticsEngRate", (post.engagement_rate || 0) + "%");
    
    // Performance insights
    const insightsEl = document.getElementById("postAnalyticsInsights");
    if (insightsEl) {
      const insights = [];
      const likes = post.likes || 0;
      const comments = post.comments || 0;
      const saves = post.saves || 0;
      const reach = post.reach || 0;
      const engRate = post.engagement_rate || 0;
      
      // Engagement analysis
      if (engRate >= 5) {
        insights.push({ icon: "🔥", text: "Excellent engagement rate! This post is performing above average.", color: "text-green-600" });
      } else if (engRate >= 2) {
        insights.push({ icon: "✅", text: "Good engagement rate. Your audience is responding well.", color: "text-blue-600" });
      } else if (engRate > 0) {
        insights.push({ icon: "💡", text: "Average engagement. Consider testing different content types.", color: "text-yellow-600" });
      }
      
      // Saves insight
      if (saves > 0 && saves >= likes * 0.1) {
        insights.push({ icon: "🔖", text: `High save rate! ${saves} saves means people want to revisit this content.`, color: "text-purple-600" });
      }
      
      // Comments insight
      if (comments > 0 && comments >= likes * 0.05) {
        insights.push({ icon: "💬", text: `Strong comment activity! This content sparked conversations.`, color: "text-blue-600" });
      }
      
      // Reach insight
      if (reach > 0) {
        const reachRatio = reach > 100 ? "significant" : "growing";
        insights.push({ icon: "👥", text: `Reached ${reach} accounts - ${reachRatio} visibility.`, color: "text-gray-600" });
      }
      
      if (insights.length === 0) {
        insights.push({ icon: "⏳", text: "Insights will appear once the post gets more engagement.", color: "text-gray-500" });
      }
      
      insightsEl.innerHTML = insights.map(i => `
        <div class="flex items-start gap-2">
          <span>${i.icon}</span>
          <span class="${i.color}">${i.text}</span>
        </div>
      `).join("");
    }
    
    // Hashtags
    const hashtagsSection = document.getElementById("postAnalyticsHashtagsSection");
    const hashtagsEl = document.getElementById("postAnalyticsHashtags");
    if (hashtagsSection && hashtagsEl) {
      const hashtags = post.hashtags || [];
      if (hashtags.length > 0) {
        hashtagsSection.classList.remove("hidden");
        hashtagsEl.innerHTML = hashtags.map(h => `
          <span class="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">#${h.replace(/^#/, "")}</span>
        `).join("");
      } else {
        hashtagsSection.classList.add("hidden");
      }
    }
    
    // Timeline
    const timelineEl = document.getElementById("postAnalyticsTimeline");
    if (timelineEl) {
      const events = [];
      
      if (post.created_at) {
        const d = new Date(post.created_at);
        events.push({ date: d, label: "Created", icon: "📝" });
      }
      if (post.scheduled_for) {
        const d = new Date(post.scheduled_for);
        events.push({ date: d, label: "Scheduled", icon: "📅" });
      }
      if (post.posted_at) {
        const d = new Date(post.posted_at);
        events.push({ date: d, label: "Posted", icon: "✅" });
      }
      if (post.engagement_updated_at) {
        const d = new Date(post.engagement_updated_at);
        events.push({ date: d, label: "Last insights sync", icon: "📊" });
      }
      
      events.sort((a, b) => a.date - b.date);
      
      timelineEl.innerHTML = events.map(e => `
        <div class="flex items-center gap-3 text-gray-600">
          <span>${e.icon}</span>
          <span class="flex-1">${e.label}</span>
          <span class="text-xs text-gray-400">${e.date.toLocaleDateString()} ${e.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      `).join("");
    }
    
    // View on platform button
    const viewBtn = document.getElementById("btnViewPostOnPlatform");
    if (viewBtn && post.permalink) {
      viewBtn.href = post.permalink;
      viewBtn.classList.remove("hidden");
    } else if (viewBtn) {
      viewBtn.classList.add("hidden");
    }
    
    // Store current post ID for refresh
    modal.dataset.postId = postId;
    
  } catch (err) {
    console.error("Error opening post analytics:", err);
  }
}

// ============================================
// Deep Post Analysis
// ============================================

async function runDeepPostAnalysis(postId) {
  const modal = document.getElementById("postAnalyticsModal");
  if (!modal) return;
  
  const btn = document.getElementById("btnRunDeepAnalysis");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Analyzing...`;
  }
  
  try {
    const analysis = await analyzePost(postId);
    
    if (!analysis) {
      console.warn("No analysis returned for post");
      return;
    }
    
    // Update score section
    const scoreSection = document.getElementById("postAnalyticsScoreSection");
    if (scoreSection) {
      const overallScore = Math.round(analysis.overall_score || 50);
      const scoreEl = document.getElementById("postAnalyticsScore");
      if (scoreEl) scoreEl.textContent = overallScore + "/100";
      
      // Update sub-scores
      const setScore = (id, score) => {
        const el = document.getElementById(id);
        if (el) el.textContent = Math.round(score || 0) + "/100";
      };
      
      setScore("postAnalyticsTimingScore", analysis.timing_score);
      setScore("postAnalyticsCaptionScore", analysis.caption_score);
      setScore("postAnalyticsHashtagScore", analysis.hashtag_score);
      setScore("postAnalyticsVisualScore", analysis.visual_score || 70);
      
      // Color the score section based on performance
      if (overallScore >= 70) {
        scoreSection.className = "bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl p-4 text-white";
      } else if (overallScore >= 50) {
        scoreSection.className = "bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl p-4 text-white";
      } else {
        scoreSection.className = "bg-gradient-to-r from-red-500 to-pink-500 rounded-xl p-4 text-white";
      }
    }
    
    // Update comparison section
    const formatComparison = (value) => {
      const numVal = parseFloat(value) || 0;
      if (numVal > 0) return `<span class="text-green-600">+${numVal.toFixed(0)}%</span>`;
      if (numVal < 0) return `<span class="text-red-600">${numVal.toFixed(0)}%</span>`;
      return `<span class="text-gray-600">0%</span>`;
    };
    
    const setComp = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = formatComparison(val);
    };
    
    setComp("postAnalyticsVsAvgEng", analysis.vs_avg_engagement_rate);
    setComp("postAnalyticsVsAvgLikes", analysis.vs_avg_likes);
    setComp("postAnalyticsVsAvgComments", analysis.vs_avg_comments);
    setComp("postAnalyticsVsAvgSaves", analysis.vs_avg_saves);
    
    // Update strengths
    const strengthsEl = document.getElementById("postAnalyticsStrengths");
    const strengthsSection = document.getElementById("postAnalyticsStrengthsSection");
    if (strengthsEl && analysis.strengths?.length > 0) {
      strengthsSection.classList.remove("hidden");
      strengthsEl.innerHTML = analysis.strengths.map(s => `
        <div class="flex items-start gap-2">
          <span>✅</span>
          <span>${s}</span>
        </div>
      `).join("");
    } else if (strengthsSection) {
      strengthsSection.classList.add("hidden");
    }
    
    // Update weaknesses
    const weaknessesEl = document.getElementById("postAnalyticsWeaknesses");
    const weaknessesSection = document.getElementById("postAnalyticsWeaknessesSection");
    if (weaknessesEl && analysis.weaknesses?.length > 0) {
      weaknessesSection.classList.remove("hidden");
      weaknessesEl.innerHTML = analysis.weaknesses.map(w => `
        <div class="flex items-start gap-2">
          <span>❌</span>
          <span>${w}</span>
        </div>
      `).join("");
    } else if (weaknessesSection) {
      weaknessesSection.classList.add("hidden");
    }
    
    // Update recommendations
    const recsEl = document.getElementById("postAnalyticsRecs");
    const recsSection = document.getElementById("postAnalyticsRecsSection");
    if (recsEl && analysis.recommendations?.length > 0) {
      recsSection.classList.remove("hidden");
      recsEl.innerHTML = analysis.recommendations.map(r => `
        <div class="flex items-start gap-2">
          <span>💡</span>
          <span>${r}</span>
        </div>
      `).join("");
    } else if (recsSection) {
      recsSection.classList.add("hidden");
    }
    
    // Update hashtag advice
    const hashtagAdviceEl = document.getElementById("postAnalyticsHashtagAdvice");
    if (hashtagAdviceEl && analysis.hashtagAdvice) {
      hashtagAdviceEl.innerHTML = `<strong>📌 Tip:</strong> ${analysis.hashtagAdvice}`;
    }
    
    // Update AI Analysis section (if available)
    const aiSection = document.getElementById("postAnalyticsAISection");
    if (aiSection) {
      if (analysis.ai_analysis || analysis.ai_recommendations?.length > 0 || analysis.ai_learnings?.length > 0) {
        aiSection.classList.remove("hidden");
        
        // AI Score
        const aiScoreEl = document.getElementById("postAnalyticsAIScore");
        if (aiScoreEl && analysis.ai_overall_score) {
          aiScoreEl.innerHTML = `<span class="text-2xl font-bold">${analysis.ai_overall_score}</span>/100 <span class="text-sm">(${analysis.ai_performance_tier || 'analyzed'})</span>`;
        }
        
        // AI Recommendations
        const aiRecsEl = document.getElementById("postAnalyticsAIRecs");
        if (aiRecsEl && analysis.ai_recommendations?.length > 0) {
          aiRecsEl.innerHTML = analysis.ai_recommendations.map(r => `
            <div class="flex items-start gap-2 text-sm">
              <span>🤖</span>
              <span>${r}</span>
            </div>
          `).join("");
        }
        
        // AI Learnings
        const aiLearningsEl = document.getElementById("postAnalyticsAILearnings");
        if (aiLearningsEl && analysis.ai_learnings?.length > 0) {
          aiLearningsEl.innerHTML = analysis.ai_learnings.map(l => `
            <div class="bg-purple-50 rounded-lg p-2 text-sm">
              <div class="font-medium text-purple-800">📚 ${l.pattern}</div>
              ${l.apply_to_future ? `<div class="text-purple-600 text-xs mt-1">→ ${l.apply_to_future}</div>` : ''}
            </div>
          `).join("");
          
          showToast(`🧠 AI learned ${analysis.ai_learnings.length} pattern(s) for future posts!`, "success");
        }
      } else {
        aiSection.classList.add("hidden");
      }
    }
    
  } catch (err) {
    console.error("Error running deep analysis:", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg> Run Deep Analysis`;
    }
  }
}

// ============================================
// Learning Insights Dashboard
// ============================================

async function loadLearningInsights() {
  const client = getClient();
  
  try {
    // Load best posting times
    const times = await getBestPostingTimes(client);
    const bestTimeEl = document.getElementById("learningBestTime");
    const bestDayEl = document.getElementById("learningBestDay");
    
    if (times && times.length > 0) {
      const bestTime = times[0];
      if (bestTimeEl) bestTimeEl.textContent = formatHour(bestTime.hour_of_day);
      
      // Find best day
      const bestDay = times.reduce((best, t) => {
        const tRate = parseFloat(t.avg_engagement_rate) || 0;
        const bRate = best ? (parseFloat(best.avg_engagement_rate) || 0) : 0;
        if (!best || tRate > bRate) return t;
        return best;
      }, null);
      if (bestDayEl && bestDay) {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        bestDayEl.textContent = days[bestDay.day_of_week] || "Any";
      }
    }
    
    // Load timing heatmap
    await loadTimingHeatmap(client);
    
    // Load top hashtags
    const hashtags = await getTopHashtags(client, 10);
    const hashtagsEl = document.getElementById("learningTopHashtags");
    if (hashtagsEl && hashtags && hashtags.length > 0) {
      hashtagsEl.innerHTML = hashtags.map((h, i) => {
        const engRate = parseFloat(h.avg_engagement_rate) || 0;
        const timesUsed = h.times_used || 0;
        return `
        <div class="flex items-center justify-between py-2 ${i < hashtags.length - 1 ? 'border-b' : ''}">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-700">#${h.hashtag}</span>
          </div>
          <div class="flex items-center gap-3 text-xs">
            <span class="text-gray-500">${timesUsed} uses</span>
            <span class="${engRate >= 3 ? 'text-green-600' : engRate >= 1 ? 'text-blue-600' : 'text-gray-500'} font-bold">
              ${engRate.toFixed(1)}% eng
            </span>
          </div>
        </div>
      `;
      }).join("");
    } else if (hashtagsEl) {
      hashtagsEl.innerHTML = `
        <div class="text-sm text-gray-500 py-4 text-center">
          <p>No hashtag data yet</p>
          <p class="text-xs">Post more to see which hashtags perform best</p>
        </div>
      `;
    }
    
    // Load recommendations
    const recs = await getActiveRecommendations(client);
    const recsEl = document.getElementById("learningRecommendations");
    if (recsEl && recs && recs.length > 0) {
      recsEl.innerHTML = recs.map(r => {
        const confidence = parseFloat(r.confidence) || 0;
        return `
        <div class="flex items-start gap-3 p-3 bg-gradient-to-r ${getPriorityColors(r.priority)} rounded-lg">
          <span class="text-lg">${getCategoryIcon(r.category)}</span>
          <div class="flex-1">
            <div class="text-sm font-medium">${r.title || r.description}</div>
            <div class="text-xs opacity-70 mt-1">Confidence: ${Math.round(confidence * 100)}%</div>
          </div>
        </div>
      `;
      }).join("");
    } else if (recsEl) {
      recsEl.innerHTML = `
        <div class="text-center py-6 text-gray-500">
          <p class="text-sm">No recommendations yet</p>
          <p class="text-xs mt-1">Post more content to receive personalized suggestions</p>
        </div>
      `;
    }
    
    // Load optimal hashtag count from patterns
    const patterns = await getLearnedPatterns(client);
    const hashtagCountEl = document.getElementById("learningHashtagCount");
    if (hashtagCountEl && patterns) {
      const hashtagPattern = patterns.find(p => p.pattern_type === "hashtag_count");
      if (hashtagPattern) {
        hashtagCountEl.textContent = `${hashtagPattern.optimal_value}-${Math.min(parseInt(hashtagPattern.optimal_value) + 2, 5)}`;
      }
    }
    
  } catch (err) {
    console.error("Error loading learning insights:", err);
  }
}

async function loadTimingHeatmap(client) {
  const tbody = document.getElementById("learningTimesBody");
  if (!tbody) return;
  
  try {
    const times = await getBestPostingTimes(client);
    
    // Create heatmap data structure: { day: { hour: engagement } }
    const heatmap = {};
    for (let d = 0; d < 7; d++) {
      heatmap[d] = {};
    }
    
    if (times) {
      times.forEach(t => {
        heatmap[t.day_of_week] = heatmap[t.day_of_week] || {};
        heatmap[t.day_of_week][t.hour_of_day] = parseFloat(t.avg_engagement_rate) || 0;
      });
    }
    
    // Find max engagement for color scaling
    let maxEng = 0;
    Object.values(heatmap).forEach(hours => {
      Object.values(hours).forEach(eng => {
        if (eng > maxEng) maxEng = eng;
      });
    });
    
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hours = [6, 9, 12, 15, 18, 21]; // 6am, 9am, 12pm, 3pm, 6pm, 9pm
    
    tbody.innerHTML = days.map((day, dayIdx) => {
      const cells = hours.map(hour => {
        const eng = heatmap[dayIdx]?.[hour] || 0;
        const intensity = maxEng > 0 ? eng / maxEng : 0;
        const bgColor = getHeatmapColor(intensity);
        return `<td class="p-2 text-center text-xs ${bgColor}">${eng > 0 ? eng.toFixed(1) + '%' : '-'}</td>`;
      }).join("");
      
      return `<tr><td class="p-2 text-xs font-medium text-gray-600">${day}</td>${cells}</tr>`;
    }).join("");
    
  } catch (err) {
    console.error("Error loading timing heatmap:", err);
  }
}

function getHeatmapColor(intensity) {
  if (intensity >= 0.8) return "bg-emerald-500 text-white";
  if (intensity >= 0.6) return "bg-emerald-400 text-white";
  if (intensity >= 0.4) return "bg-emerald-300";
  if (intensity >= 0.2) return "bg-emerald-200";
  if (intensity > 0) return "bg-emerald-100";
  return "bg-gray-50";
}

function formatHour(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function getPriorityColors(priority) {
  switch (priority) {
    case "high": return "from-red-50 to-pink-50 text-red-700";
    case "medium": return "from-yellow-50 to-orange-50 text-yellow-700";
    default: return "from-blue-50 to-indigo-50 text-blue-700";
  }
}

function getCategoryIcon(category) {
  switch (category) {
    case "hashtags": return "#️⃣";
    case "timing": return "⏰";
    case "caption": return "✍️";
    case "content": return "📸";
    case "engagement": return "💬";
    default: return "💡";
  }
}

// ============================================
// Process All Posts for Learning
// ============================================

async function processAllPostsForLearning() {
  const client = getClient();
  
  try {
    // Get all posted content
    const { data: posts, error } = await client
      .from("social_posts")
      .select("*")
      .eq("status", "posted")
      .order("posted_at", { ascending: false })
      .limit(100);
    
    if (error) throw error;
    
    let processed = 0;
    for (const post of posts) {
      try {
        // Update hashtag performance
        if (post.hashtags && post.hashtags.length > 0) {
          await updateHashtagPerformance(post.hashtags, post.engagement_rate || 0, post.reach || 0, client);
        }
        
        // Update timing performance
        if (post.posted_at) {
          const postedDate = new Date(post.posted_at);
          await updateTimingPerformance(
            postedDate.getDay(),
            postedDate.getHours(),
            post.engagement_rate || 0,
            post.reach || 0,
            client
          );
        }
        
        // Update caption performance
        if (post.caption) {
          await updateCaptionPerformance(post.caption, post.engagement_rate || 0, post.reach || 0, client);
        }
        
        processed++;
      } catch (err) {
        console.warn(`Error processing post ${post.id}:`, err);
      }
    }
    
    // Generate new recommendations based on all data
    await generateRecommendations(client);
    
    console.log(`Processed ${processed} posts for learning`);
    return processed;
    
  } catch (err) {
    console.error("Error processing posts for learning:", err);
    throw err;
  }
}

function closePostAnalytics() {
  const modal = document.getElementById("postAnalyticsModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

// Expose globally
window.openPostAnalytics = openPostAnalytics;

// Initialize modal event listeners
function initPostAnalyticsModal() {
  const closeBtn = document.getElementById("btnClosePostAnalytics");
  if (closeBtn) {
    closeBtn.addEventListener("click", closePostAnalytics);
  }
  
  const modal = document.getElementById("postAnalyticsModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closePostAnalytics();
    });
  }
  
  const refreshBtn = document.getElementById("btnRefreshPostAnalytics");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      const postId = modal?.dataset.postId;
      if (postId) {
        // Sync insights for this specific post
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Syncing...`;
        
        try {
          await syncInstagramInsights(postId);
          await openPostAnalytics(postId);
        } catch (err) {
          console.error("Failed to refresh:", err);
        }
        
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh`;
      }
    });
  }
  
  // Deep Analysis button
  const deepAnalysisBtn = document.getElementById("btnRunDeepAnalysis");
  if (deepAnalysisBtn) {
    deepAnalysisBtn.addEventListener("click", async () => {
      const postId = modal?.dataset.postId;
      if (postId) {
        await runDeepPostAnalysis(postId);
      }
    });
  }
}

// Initialize Learning Insights Dashboard
function initLearningInsights() {
  // Load insights when analytics tab is shown
  const analyticsTab = document.querySelector('[data-tab="analytics"]');
  if (analyticsTab) {
    analyticsTab.addEventListener("click", () => {
      // Delay to ensure tab is switched
      setTimeout(() => {
        loadLearningInsights();
        loadCategoryInsightsUI();
      }, 100);
    });
  }
  
  // Refresh learning insights button
  const refreshBtn = document.getElementById("btnRefreshLearnings");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Processing...`;
      
      try {
        await processAllPostsForLearning();
        await loadLearningInsights();
        await loadCategoryInsightsUI();
      } catch (err) {
        console.error("Failed to refresh learnings:", err);
      }
      
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh Learnings`;
    });
  }
  
  // Research Categories button
  const researchBtn = document.getElementById("btnResearchCategories");
  if (researchBtn) {
    // Progress listener
    const progressHandler = (e) => {
      const { current, total, category } = e.detail;
      researchBtn.innerHTML = `
        <span class="animate-pulse">🧠</span> 
        Researching ${category}... (${current}/${total})`;
    };
    
    researchBtn.addEventListener("click", async () => {
      researchBtn.classList.add("loading");
      researchBtn.disabled = true;
      researchBtn.innerHTML = `<span class="animate-spin inline-block">⏳</span> Scanning categories...`;
      
      // Listen for progress updates
      window.addEventListener("categoryResearchProgress", progressHandler);
      
      try {
        const researched = await checkAndResearchCategories();
        if (researched.length > 0) {
          showToast(`🧠 AI researched ${researched.length} categories!`, "success");
        } else {
          showToast("No new categories to research (need 3+ posts per category)", "info");
        }
        await loadCategoryInsightsUI();
      } catch (err) {
        console.error("Category research failed:", err);
        showToast("Research failed. Check console for details.", "error");
      }
      
      // Cleanup
      window.removeEventListener("categoryResearchProgress", progressHandler);
      researchBtn.classList.remove("loading");
      researchBtn.disabled = false;
      researchBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Research Categories`;
    });
  }
  
  // Load initial insights if on analytics tab
  const analyticsContent = document.getElementById("content-analytics");
  if (analyticsContent && !analyticsContent.classList.contains("hidden")) {
    loadLearningInsights();
    loadCategoryInsightsUI();
  }
}

// ============================================
// Category Insights UI
// ============================================

async function loadCategoryInsightsUI() {
  const grid = document.getElementById("categoryInsightsGrid");
  const countEl = document.getElementById("aiLearningsCount");
  const listEl = document.getElementById("allAILearningsList");
  
  if (!grid) return;
  
  try {
    const insights = await getAllCategoryInsights();
    
    if (!insights || insights.length === 0) {
      grid.innerHTML = `
        <div class="text-center py-8 text-gray-400">
          <div class="w-16 h-16 mx-auto mb-3 rounded-full bg-purple-100 flex items-center justify-center">
            <span class="text-3xl">🔬</span>
          </div>
          <p class="font-medium text-gray-600 mb-1">No category insights yet</p>
          <p class="text-xs text-gray-500 max-w-md mx-auto">
            AI will automatically research each product category when you have 3+ posted items. 
            Click "Research Categories" to trigger analysis now.
          </p>
        </div>
      `;
      return;
    }
    
    // Render category cards
    grid.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        ${insights.map(cat => renderCategoryInsightCard(cat)).join("")}
      </div>
    `;
    
    // Update learnings count
    if (countEl) {
      countEl.textContent = insights.length;
    }
    
    // Render all learnings list
    if (listEl) {
      const allLearnings = [];
      insights.forEach(cat => {
        if (cat.key_insights) {
          cat.key_insights.forEach(insight => {
            allLearnings.push({
              type: "category",
              category: cat.category,
              insight: insight.insight,
              apply: insight.apply_how,
              impact: insight.impact
            });
          });
        }
      });
      
      if (allLearnings.length > 0) {
        listEl.innerHTML = allLearnings.map(l => `
          <div class="ai-learning-item">
            <div class="flex-shrink-0">
              <span class="ai-learning-type ${l.type}">${l.type}</span>
            </div>
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
    
    // Add click handlers for expanding cards
    document.querySelectorAll(".category-insight-card").forEach(card => {
      card.addEventListener("click", () => {
        const details = card.querySelector(".category-details");
        if (details) {
          details.classList.toggle("hidden");
          card.classList.toggle("expanded");
        }
      });
    });
    
  } catch (err) {
    console.error("Error loading category insights:", err);
    grid.innerHTML = `<div class="text-center py-4 text-red-500">Failed to load insights</div>`;
  }
}

function renderCategoryInsightCard(cat) {
  const categoryIcons = {
    "bags": "👜",
    "headwear": "🎩",
    "beanies": "🧢",
    "jewelry": "💍",
    "plushies": "🧸",
    "accessories": "👛",
    "default": "📦"
  };
  
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
            <span class="confidence-badge ${confidenceLevel}">
              ${Math.round(confidence * 100)}% confident
            </span>
          </div>
          <p class="text-xs text-gray-500 mt-1">${cat.sample_size || 0} posts analyzed</p>
        </div>
      </div>
      
      <p class="text-sm text-gray-600 mb-3">${cat.summary || "No summary available"}</p>
      
      <!-- Quick Tags -->
      <div class="flex flex-wrap gap-1.5 mb-3">
        ${cat.caption_strategy?.tone_that_works ? `<span class="insight-tag caption">${cat.caption_strategy.tone_that_works} tone</span>` : ''}
        ${cat.caption_strategy?.emoji_usage ? `<span class="insight-tag caption">${cat.caption_strategy.emoji_usage} emojis</span>` : ''}
        ${cat.hashtag_strategy?.ideal_count ? `<span class="insight-tag hashtag">${cat.hashtag_strategy.ideal_count} hashtags</span>` : ''}
        ${cat.timing_insights?.best_days?.[0] ? `<span class="insight-tag timing">${cat.timing_insights.best_days[0]}</span>` : ''}
      </div>
      
      <!-- Expandable Details -->
      <div class="category-details hidden mt-4 pt-4 border-t">
        ${cat.caption_strategy ? `
          <div class="mb-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Caption Strategy</h4>
            <div class="strategy-grid">
              <div class="strategy-item">
                <div class="strategy-value">${cat.caption_strategy.ideal_length || '?'}</div>
                <div class="strategy-label">Ideal Length</div>
              </div>
              <div class="strategy-item">
                <div class="strategy-value">${cat.caption_strategy.tone_that_works || 'Any'}</div>
                <div class="strategy-label">Best Tone</div>
              </div>
              <div class="strategy-item">
                <div class="strategy-value">${cat.caption_strategy.emoji_usage || 'Moderate'}</div>
                <div class="strategy-label">Emoji Style</div>
              </div>
            </div>
            ${cat.caption_strategy.example_hooks?.length ? `
              <div class="mt-3">
                <div class="text-xs font-medium text-gray-500 mb-1">Proven Hooks:</div>
                <div class="text-sm text-gray-700 italic">"${cat.caption_strategy.example_hooks.slice(0, 2).join('", "')}"</div>
              </div>
            ` : ''}
          </div>
        ` : ''}
        
        ${cat.hashtag_strategy?.top_performers?.length ? `
          <div class="mb-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Top Hashtags</h4>
            <div class="flex flex-wrap gap-1">
              ${cat.hashtag_strategy.top_performers.slice(0, 5).map(h => `
                <span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">${h}</span>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${cat.key_insights?.length ? `
          <div class="mb-4">
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Key Insights</h4>
            ${cat.key_insights.slice(0, 3).map(i => `
              <div class="key-insight-item">
                <div class="key-insight-icon ${i.impact || 'medium'}">
                  ${i.impact === 'high' ? '🔥' : i.impact === 'medium' ? '💡' : '📌'}
                </div>
                <div>
                  <div class="text-sm font-medium">${i.insight}</div>
                  <div class="text-xs text-gray-500 mt-0.5">${i.apply_how || ''}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        ${cat.improvement_opportunities?.length ? `
          <div>
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-2">Opportunities</h4>
            <ul class="text-sm text-gray-600 space-y-1">
              ${cat.improvement_opportunities.slice(0, 3).map(o => `<li class="flex items-start gap-2"><span class="text-purple-500">→</span> ${o}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
      
      <div class="text-center mt-2">
        <span class="text-xs text-gray-400">Click to ${cat.expanded ? 'collapse' : 'expand'}</span>
      </div>
    </div>
  `;
}

// ============================================
// Start
// ============================================

document.addEventListener("DOMContentLoaded", () => {
  init();
  initPostAnalyticsModal();
  initLearningInsights();
});

// /js/admin/social/index.js
// Main entry point for Social Media Admin

import { getSupabaseClient } from "../../shared/supabaseClient.js";
import { initAdminNav } from "../../shared/adminNav.js";
import {
  fetchProducts,
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
    images: [],       // Array of { file, previewUrl, uploadedUrl }
    productId: null,
    tone: "casual",
    caption: "",
    hashtags: "",
    scheduleDate: null,
    scheduleTime: "12:00"
  }
};

// ============================================
// DOM Elements
// ============================================

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MzQ5NDAsImV4cCI6MjA4MTMxMDk0MH0.cuCteItNo6yFCYcot0Vx7kUOUtV0r-iCwJ_ACAiKGso";
const SUPABASE_FUNCTIONS_URL = "https://yxdzvzscufkvewecvagq.supabase.co/functions/v1";

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
        // Instagram API with Facebook login permissions (including pages_manage_posts for Facebook posting)
        const scope = "instagram_basic,instagram_content_publish,pages_read_engagement,pages_manage_posts,business_management,pages_show_list";
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
      const imageUrl = p.images?.[0] || placeholderImg;
      const price = p.price ? `$${parseFloat(p.price).toFixed(2)}` : '';
      return `
        <div class="product-option flex items-center gap-3 p-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0 transition-colors" data-id="${p.id}">
          <img src="${imageUrl}" alt="${p.name}" class="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0">
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

function selectProduct(product) {
  state.uploadData.productId = product.id;
  els.productSelect.value = product.id;
  
  // Update selected product display with image
  const placeholderImg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect fill="#f3f4f6" width="40" height="40"/><rect x="12" y="12" width="16" height="16" rx="2" fill="#d1d5db"/></svg>');
  const imageUrl = product.images?.[0] || placeholderImg;
  const price = product.price ? `$${parseFloat(product.price).toFixed(2)}` : '';
  
  els.selectedProduct.innerHTML = `
    <div class="flex items-center gap-3 flex-1">
      <img src="${imageUrl}" alt="${product.name}" class="w-10 h-10 rounded-lg object-cover bg-gray-100">
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
    state.uploadData.productId = null;
    els.productSelect.value = '';
    els.selectedProduct.classList.add('hidden');
    els.productSearch.value = '';
    els.productSearch.classList.remove('hidden');
  });
  
  els.selectedProduct.classList.remove("hidden");
  els.productSearch.classList.add("hidden");
  els.productDropdown.classList.add("hidden");
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
  els.btnPostNow.classList.toggle("hidden", post.status === "posted" || post.status === "published");
  
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
      <div class="relative group aspect-square" data-carousel-idx="${idx}">
        <img src="${img.previewUrl}" class="w-full h-full object-cover rounded-lg border-2 border-transparent hover:border-purple-500 transition-colors">
        <div class="absolute top-1 left-1 w-5 h-5 bg-black/70 text-white text-xs rounded-full flex items-center justify-center font-bold">${idx + 1}</div>
        <button class="carousel-remove-btn absolute top-1 right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" data-idx="${idx}">✕</button>
      </div>
    `).join("");
    
    // Add remove handlers
    document.querySelectorAll(".carousel-remove-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        const img = state.carousel.images[idx];
        if (img?.previewUrl) URL.revokeObjectURL(img.previewUrl);
        state.carousel.images.splice(idx, 1);
        updateCarouselUI();
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
}

function resetCarouselBuilder() {
  console.log("[Carousel] Resetting carousel builder");
  
  // Clear existing images
  state.carousel.images.forEach(img => {
    if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
  });
  
  state.carousel = {
    images: [],
    productId: null,
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
  
  if (schedDateEl) schedDateEl.value = tomorrow.toISOString().split("T")[0];
  if (schedTimeEl) schedTimeEl.value = "12:00";
  if (captionEl) captionEl.value = "";
  if (hashtagsEl) hashtagsEl.value = "#karrykraze #carousel #fashion";
  if (searchEl) searchEl.value = "";
  if (selectedEl) selectedEl.classList.add("hidden");
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
  
  if (!product) {
    console.log("[Carousel] No product selected, using default caption");
    document.getElementById("carouselCaption").value = "Check out our latest carousel! 📸✨ Swipe through to see more!\n\nShop now at karrykraze.com";
    document.getElementById("carouselHashtags").value = "#karrykraze #carousel #fashion #shopping";
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
    
    console.log("[Carousel] Caption generated:", caption.substring(0, 50) + "...");
  } catch (err) {
    console.error("[Carousel] Failed to generate caption:", err);
    document.getElementById("carouselCaption").value = "📸 Swipe to see more! ➡️\n\nCheck out " + (product.name || "this amazing product") + "!\n\nShop now at karrykraze.com";
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
        failed: "bg-red-100 text-red-700"
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
    
    // Reload analytics to show updated data
    await loadAnalytics();
    await loadEngagementMetrics();
    
    // Show success message
    const lastSync = document.getElementById("analyticsLastSync");
    if (lastSync) {
      lastSync.textContent = `Last synced: ${new Date().toLocaleTimeString()} • ${data.updated || 0} posts updated`;
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
    
    // Fetch Instagram posts with engagement data
    const { data: posts, error } = await client
      .from("social_posts")
      .select("id, likes, comments, saves, impressions, reach, engagement_rate, engagement_updated_at, caption, hashtags, posted_at")
      .eq("platform", "instagram")
      .eq("status", "posted")
      .not("engagement_updated_at", "is", null)
      .order("engagement_rate", { ascending: false });
    
    if (error) throw error;
    
    const allPosts = posts || [];
    
    if (allPosts.length === 0) {
      return; // No engagement data yet
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
    
    // Top performing posts
    const topPosts = allPosts.slice(0, 5);
    const topPostsContainer = document.getElementById("analyticsTopPosts");
    if (topPostsContainer && topPosts.length > 0) {
      topPostsContainer.innerHTML = topPosts.map((p, idx) => {
        const date = new Date(p.posted_at);
        const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `
          <div class="p-3 flex items-center gap-3 hover:bg-gray-50">
            <span class="text-lg font-black text-gray-300">#${idx + 1}</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">${p.caption?.substring(0, 60) || "No caption"}...</div>
              <div class="text-xs text-gray-400">${dateStr}</div>
            </div>
            <div class="flex items-center gap-3 text-xs">
              <span class="text-pink-500">❤️ ${p.likes || 0}</span>
              <span class="text-blue-500">💬 ${p.comments || 0}</span>
              <span class="text-yellow-500">🔖 ${p.saves || 0}</span>
              <span class="px-2 py-1 bg-orange-100 text-orange-700 font-bold rounded">${p.engagement_rate || 0}%</span>
            </div>
          </div>
        `;
      }).join("");
    }
    
    // Hashtag performance
    const { data: hashtagData } = await client
      .from("hashtag_performance")
      .select("*")
      .eq("platform", "instagram")
      .order("avg_effectiveness", { ascending: false })
      .limit(15);
    
    const hashtagsContainer = document.getElementById("analyticsHashtags");
    if (hashtagsContainer && hashtagData && hashtagData.length > 0) {
      const maxEff = Math.max(...hashtagData.map(h => h.avg_effectiveness || 0)) || 1;
      hashtagsContainer.innerHTML = `
        <div class="flex flex-wrap gap-2">
          ${hashtagData.map(h => {
            const eff = h.avg_effectiveness || 0;
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
    
    const totalPosts = allPosts.length;
    // Support both 'posted' and 'published' status
    const published = allPosts.filter(p => p.status === "published" || p.status === "posted").length;
    const thisWeek = allPosts.filter(p => {
      const isPublished = p.status === "published" || p.status === "posted";
      const publishDate = p.posted_at || p.published_at;
      return isPublished && publishDate && new Date(publishDate) >= weekAgo;
    }).length;
    const scheduled = allPosts.filter(p => 
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
// Start
// ============================================

document.addEventListener("DOMContentLoaded", init);

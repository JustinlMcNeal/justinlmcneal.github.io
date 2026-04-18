// /js/admin/social/autoQueue.js
// Auto-Queue & Auto-Repost

import { getSupabaseClient } from "../../shared/supabaseClient.js";

let _state, _els, _showToast, _getClient, _SUPABASE_FUNCTIONS_URL;
let _loadStats, _loadAutoQueueStats, _switchTab, _loadQueuePosts;

export function initAutoQueue(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _SUPABASE_FUNCTIONS_URL = deps.SUPABASE_FUNCTIONS_URL;
  _loadStats = deps.loadStats;
  _loadAutoQueueStats = deps.loadAutoQueueStats || loadAutoQueueStats;
  _switchTab = deps.switchTab;
  _loadQueuePosts = deps.loadQueuePosts;
}

export function setupAutoQueue() {
  _els.btnAutoQueue?.addEventListener("click", () => _switchTab("autoqueue"));
  _els.btnPreviewQueue?.addEventListener("click", previewAutoQueue);
  _els.btnGenerateQueue?.addEventListener("click", generateAutoQueue);
  _els.btnConfirmQueue?.addEventListener("click", confirmAutoQueue);
  
  document.getElementById("btnPreviewRepost")?.addEventListener("click", previewRepost);
  document.getElementById("btnGenerateRepost")?.addEventListener("click", generateRepost);
  document.getElementById("btnConfirmRepost")?.addEventListener("click", confirmRepost);
}

export function getAutoQueueSettings() {
  const postingTimes = [];
  if (_els.aqTime1?.checked) postingTimes.push(_els.aqTime1.value);
  if (_els.aqTime2?.checked) postingTimes.push(_els.aqTime2.value);
  if (_els.aqTime3?.checked) postingTimes.push(_els.aqTime3.value);
  if (_els.aqTime4?.checked) postingTimes.push(_els.aqTime4.value);
  
  const captionTones = [];
  if (_els.aqToneCasual?.checked) captionTones.push("casual");
  if (_els.aqToneUrgency?.checked) captionTones.push("urgency");
  if (_els.aqTonePro?.checked) captionTones.push("professional");
  if (_els.aqTonePlayful?.checked) captionTones.push("playful");
  if (_els.aqToneValue?.checked) captionTones.push("value");
  if (_els.aqToneTrending?.checked) captionTones.push("trending");
  if (_els.aqToneInspirational?.checked) captionTones.push("inspirational");
  if (_els.aqToneMinimalist?.checked) captionTones.push("minimalist");
  
  const platforms = [];
  const aqPlatformInstagram = document.getElementById("aqPlatformInstagram");
  const aqPlatformFacebook = document.getElementById("aqPlatformFacebook");
  const aqPlatformPinterest = document.getElementById("aqPlatformPinterest");
  if (aqPlatformInstagram?.checked) platforms.push("instagram");
  if (aqPlatformFacebook?.checked) platforms.push("facebook");
  if (aqPlatformPinterest?.checked) platforms.push("pinterest");
  
  return {
    count: parseInt(_els.aqPostCount?.value || "4", 10),
    platforms: platforms.length ? platforms : ["instagram"],
    postingTimes: postingTimes.length ? postingTimes : ["10:00", "18:00"],
    captionTones: captionTones.length ? captionTones : ["casual"]
  };
}

async function previewAutoQueue() {
  const settings = getAutoQueueSettings();
  
  _els.btnPreviewQueue.disabled = true;
  _els.btnPreviewQueue.innerHTML = `
    <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Generating...
  `;
  
  try {
    const response = await fetch(`${_SUPABASE_FUNCTIONS_URL}/auto-queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({ ...settings, preview: true })
    });
    
    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to preview posts");
    
    _state.autoQueuePreview = result.posts;
    renderAutoQueuePreview(result.posts);
  } catch (err) {
    console.error("Preview error:", err);
    alert("Failed to preview: " + err.message);
  } finally {
    _els.btnPreviewQueue.disabled = false;
    _els.btnPreviewQueue.innerHTML = `
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
  
  if (!confirm(`Generate and schedule ${settings.count} posts for ${settings.platform}?`)) return;
  
  _els.btnGenerateQueue.disabled = true;
  _els.btnGenerateQueue.innerHTML = `
    <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Generating...
  `;
  
  try {
    const response = await fetch(`${_SUPABASE_FUNCTIONS_URL}/auto-queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({ ...settings, preview: false })
    });
    
    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to generate posts");
    
    alert(`Successfully scheduled ${result.generated} posts!`);
    await _loadStats();
    await loadAutoQueueStats();
    _switchTab("queue");
  } catch (err) {
    console.error("Generate error:", err);
    alert("Failed to generate: " + err.message);
  } finally {
    _els.btnGenerateQueue.disabled = false;
    _els.btnGenerateQueue.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
      Generate & Schedule
    `;
  }
}

async function confirmAutoQueue() {
  if (!_state.autoQueuePreview?.length) {
    alert("No preview data. Please generate a preview first.");
    return;
  }
  if (!confirm(`Schedule ${_state.autoQueuePreview.length} posts now?`)) return;
  await generateAutoQueue();
  _state.autoQueuePreview = null;
  _els.aqPreviewResults?.classList.add("hidden");
}

function renderAutoQueuePreview(posts) {
  if (!posts?.length) {
    _els.aqPreviewResults?.classList.add("hidden");
    return;
  }
  
  _els.aqPreviewResults?.classList.remove("hidden");
  
  _els.aqPreviewList.innerHTML = posts.map((post, i) => {
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

export async function loadAutoQueueStats() {
  try {
    const client = getSupabaseClient();
    
    const { count: total } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null);
    
    const { count: neverPosted } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null)
      .is("last_social_post_at", null);
    
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const { count: ready } = await client
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("catalog_image_url", "is", null)
      .or(`last_social_post_at.is.null,last_social_post_at.lt.${fourteenDaysAgo.toISOString()}`);
    
    const recent = (total || 0) - (ready || 0);
    
    if (_els.aqStatTotal) _els.aqStatTotal.textContent = total || 0;
    if (_els.aqStatNeverPosted) _els.aqStatNeverPosted.textContent = neverPosted || 0;
    if (_els.aqStatReady) _els.aqStatReady.textContent = ready || 0;
    if (_els.aqStatRecent) _els.aqStatRecent.textContent = recent;
  } catch (err) {
    console.error("Failed to load auto-queue stats:", err);
  }
}

// ─── Auto-Repost ───

function getRepostSettings() {
  const aqSettings = getAutoQueueSettings();
  return {
    count: parseInt(document.getElementById("repostCount")?.value || "2", 10),
    minDaysOld: parseInt(document.getElementById("repostMinDays")?.value || "30", 10),
    platforms: aqSettings.platforms,
    tones: ["casual", "trending", "value"],
  };
}

async function previewRepost() {
  const btn = document.getElementById("btnPreviewRepost");
  const settings = getRepostSettings();
  
  btn.disabled = true;
  btn.textContent = "Loading...";
  
  try {
    const response = await fetch(`${_SUPABASE_FUNCTIONS_URL}/auto-repost`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({ ...settings, preview: true })
    });
    
    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to preview reposts");
    
    if (!result.posts?.length) {
      alert("No old posts found to repost. Try reducing the minimum age.");
      return;
    }
    
    _state.repostPreview = result.posts;
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
    const response = await fetch(`${_SUPABASE_FUNCTIONS_URL}/auto-repost`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({ ...settings, preview: false })
    });
    
    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to generate reposts");
    
    if (result.generated === 0) {
      alert("No old posts found to repost. Try reducing the minimum age.");
    } else {
      alert(`✅ Scheduled ${result.generated} reposts!`);
      await _loadStats();
      if (_state.currentTab === "queue") await _loadQueuePosts();
    }
    
    document.getElementById("repostPreviewResults")?.classList.add("hidden");
    _state.repostPreview = null;
  } catch (err) {
    console.error("Repost error:", err);
    alert("Failed to generate reposts: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Repost Now";
  }
}

async function confirmRepost() {
  if (!_state.repostPreview?.length) {
    alert("No preview data. Please preview first.");
    return;
  }
  if (!confirm(`Schedule ${_state.repostPreview.length} reposts now?`)) return;
  await generateRepost();
}

function renderRepostPreview(posts) {
  const container = document.getElementById("repostPreviewResults");
  const list = document.getElementById("repostPreviewList");
  
  if (!posts?.length) { container?.classList.add("hidden"); return; }
  
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

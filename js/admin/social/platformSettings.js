// /js/admin/social/platformSettings.js
// Settings Modal, Facebook & Instagram profile settings

import { updateSetting, getPublicUrl } from "./api.js";

let _state, _els, _showToast, _getClient;
let _loadSettings;

export function initPlatformSettings(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _loadSettings = deps.loadSettings;
}

export function setupSettingsModal() {
  _els.btnSettings?.addEventListener("click", openSettingsModal);
  _els.btnCloseSettings?.addEventListener("click", closeSettingsModal);
  _els.settingsModal?.addEventListener("click", (e) => {
    if (e.target === _els.settingsModal) closeSettingsModal();
  });
  _els.btnSaveSettings?.addEventListener("click", saveSettings);
  
  document.getElementById("btnLoadPageInfo")?.addEventListener("click", loadFacebookPageInfo);
  document.getElementById("btnSavePageInfo")?.addEventListener("click", saveFacebookPageInfo);
  
  window.handleFbProfilePicUpload = handleFbProfilePicUpload;
  
  document.getElementById("btnLoadInstagramInfo")?.addEventListener("click", loadInstagramProfileInfo);
}

function openSettingsModal() {
  applySettings();
  _els.settingsModal.classList.remove("hidden");
  _els.settingsModal.classList.add("flex");
}

function closeSettingsModal() {
  _els.settingsModal.classList.add("hidden");
  _els.settingsModal.classList.remove("flex");
}

export function applySettings() {
  const autoApprove = _state.settings.auto_approve?.enabled !== false;
  const defaultTone = _state.settings.default_tone?.tone || "casual";
  const schedule = _state.settings.posting_schedule || {};
  
  _els.settingAutoApprove.checked = autoApprove;
  _els.settingDefaultTone.value = defaultTone;
  _els.settingInstagramEnabled.checked = schedule.instagram?.enabled !== false;
  _els.settingInstagramTime.value = schedule.instagram?.times?.[0] || "12:00";
  _els.settingPinterestEnabled.checked = schedule.pinterest?.enabled !== false;
  _els.settingPinterestTime.value = schedule.pinterest?.times?.[0] || "12:00";
}

async function saveSettings() {
  try {
    await updateSetting("auto_approve", { enabled: _els.settingAutoApprove.checked });
    await updateSetting("default_tone", { tone: _els.settingDefaultTone.value });
    await updateSetting("posting_schedule", {
      instagram: {
        enabled: _els.settingInstagramEnabled.checked,
        posts_per_day: 1,
        times: [_els.settingInstagramTime.value]
      },
      pinterest: {
        enabled: _els.settingPinterestEnabled.checked,
        posts_per_day: 1,
        times: [_els.settingPinterestTime.value]
      }
    });
    
    await _loadSettings();
    closeSettingsModal();
    alert("Settings saved!");
  } catch (err) {
    console.error("Save settings error:", err);
    alert("Failed to save settings");
  }
}

// ─── Facebook Page Settings ───

async function loadFacebookPageInfo() {
  try {
    const btn = document.getElementById("btnLoadPageInfo");
    btn.innerHTML = '<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Loading...';
    
    const pageTokenSetting = _state.settings.facebook_page_token;
    const pageIdSetting = _state.settings.facebook_page_id;
    
    if (!pageTokenSetting?.token || !pageIdSetting?.page_id) {
      alert("Facebook Page not connected. Please connect Facebook first.");
      btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
      return;
    }
    
    const pageId = pageIdSetting.page_id;
    const token = pageTokenSetting.token;
    
    const resp = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=name,about,description,category&access_token=${token}`);
    const data = await resp.json();
    
    if (data.error) throw new Error(data.error.message);
    
    const pageName = data.name || "Your Page";
    document.getElementById("settingPageName").textContent = pageName;
    document.getElementById("settingFbCategory").textContent = data.category || "Business";
    document.getElementById("settingFbInitials").textContent = pageName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    
    document.getElementById("settingPageAbout").value = data.about || "";
    document.getElementById("settingPageDescription").value = data.description || "";
    
    btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
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
    
    const pageTokenSetting = _state.settings.facebook_page_token;
    const pageIdSetting = _state.settings.facebook_page_id;
    
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
    
    const params = new URLSearchParams();
    params.append("access_token", token);
    if (about) params.append("about", about);
    if (description) params.append("description", description);
    
    const resp = await fetch(`https://graph.facebook.com/v21.0/${pageId}`, {
      method: "POST",
      body: params
    });
    
    const result = await resp.json();
    if (result.error) throw new Error(result.error.message);
    
    btn.innerHTML = '<svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Updated!';
    btn.classList.remove("bg-blue-600", "hover:bg-blue-700");
    btn.classList.add("bg-green-600");
    
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.classList.remove("bg-green-600");
      btn.classList.add("bg-blue-600", "hover:bg-blue-700");
      btn.disabled = false;
    }, 2000);
  } catch (err) {
    console.error("Save page info error:", err);
    alert("Failed to update: " + err.message);
    const btn = document.getElementById("btnSavePageInfo");
    btn.innerHTML = '<svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Update Facebook Page';
    btn.disabled = false;
  }
}

async function handleFbProfilePicUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) { alert('Please select an image file'); return; }
  if (file.size > 10 * 1024 * 1024) { alert('Image must be less than 10MB'); return; }
  
  const progressEl = document.getElementById("fbProfilePicProgress");
  const progressText = document.getElementById("fbProfilePicProgressText");
  const avatarImg = document.getElementById("settingFbAvatar");
  const initialsEl = document.getElementById("settingFbInitials");
  
  try {
    progressEl.classList.remove("hidden");
    progressText.textContent = "Uploading to Facebook...";
    
    const pageTokenSetting = _state.settings.facebook_page_token;
    const pageIdSetting = _state.settings.facebook_page_id;
    
    if (!pageTokenSetting?.token || !pageIdSetting?.page_id) throw new Error("Facebook Page not connected");
    
    const pageId = pageIdSetting.page_id;
    const token = pageTokenSetting.token;
    
    const formData = new FormData();
    formData.append('source', file);
    formData.append('access_token', token);
    
    const resp = await fetch(`https://graph.facebook.com/v21.0/${pageId}/picture`, {
      method: 'POST',
      body: formData
    });
    
    const result = await resp.json();
    if (result.error) throw new Error(result.error.message);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      avatarImg.src = e.target.result;
      avatarImg.classList.remove("hidden");
      initialsEl.classList.add("hidden");
    };
    reader.readAsDataURL(file);
    
    progressText.textContent = "✓ Profile picture updated!";
    setTimeout(() => { progressEl.classList.add("hidden"); }, 2000);
  } catch (err) {
    console.error("Profile pic upload error:", err);
    progressText.textContent = "❌ " + err.message;
    setTimeout(() => { progressEl.classList.add("hidden"); }, 3000);
  }
  
  event.target.value = '';
}

// ─── Instagram Profile Settings ───

async function loadInstagramProfileInfo() {
  try {
    const btn = document.getElementById("btnLoadInstagramInfo");
    btn.innerHTML = '<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Loading...';
    
    const igUserIdSetting = _state.settings.instagram_user_id;
    const igTokenSetting = _state.settings.instagram_access_token;
    
    if (!igUserIdSetting?.user_id || !igTokenSetting?.token) {
      alert("Instagram not connected. Please connect Instagram first.");
      btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
      return;
    }
    
    const userId = igUserIdSetting.user_id;
    const token = igTokenSetting.token;
    
    const resp = await fetch(`https://graph.facebook.com/v21.0/${userId}?fields=username,name,biography,profile_picture_url,followers_count,follows_count,media_count&access_token=${token}`);
    const data = await resp.json();
    
    if (data.error) throw new Error(data.error.message);
    
    const avatar = document.getElementById("settingIgAvatar");
    const placeholder = document.getElementById("settingIgAvatarPlaceholder");
    if (data.profile_picture_url) {
      avatar.src = data.profile_picture_url;
      avatar.classList.remove("hidden");
      if (placeholder) placeholder.classList.add("hidden");
    }
    
    document.getElementById("settingIgUsername").textContent = data.username ? `@${data.username}` : "@username";
    document.getElementById("settingIgName").textContent = data.name || "Name";
    document.getElementById("settingIgBio").textContent = data.biography || "(No bio set)";
    document.getElementById("settingIgPosts").textContent = data.media_count?.toLocaleString() || "-";
    document.getElementById("settingIgFollowers").textContent = data.followers_count?.toLocaleString() || "-";
    document.getElementById("settingIgFollowing").textContent = data.follows_count?.toLocaleString() || "-";
    
    btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
  } catch (err) {
    console.error("Load Instagram info error:", err);
    alert("Failed to load: " + err.message);
    document.getElementById("btnLoadInstagramInfo").innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
  }
}

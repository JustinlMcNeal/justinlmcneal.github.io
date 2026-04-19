// /js/admin/social/autopilot.js
// Autopilot Mode — hands-free scheduling

import { getSupabaseClient } from "../../shared/supabaseClient.js";

let _state, _els, _showToast, _getClient;
let _loadStats, _loadQueuePosts;

export function initAutopilot(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _loadStats = deps.loadStats;
  _loadQueuePosts = deps.loadQueuePosts;
}

export function setupAutopilot() {
  const toggle = document.getElementById("autopilotToggle");
  const settings = document.getElementById("autopilotSettings");
  const btnSave = document.getElementById("btnSaveAutopilot");
  const btnRun = document.getElementById("btnRunAutopilot");
  
  toggle?.addEventListener("change", async (e) => {
    settings?.classList.toggle("hidden", !e.target.checked);
    await saveAutopilotSettings();
  });
  
  btnSave?.addEventListener("click", saveAutopilotSettings);
  btnRun?.addEventListener("click", runAutopilotNow);
  
  loadAutopilotSettings();
}

export async function loadAutopilotSettings() {
  try {
    const client = getSupabaseClient();
    
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
    
    const toggle = document.getElementById("autopilotToggle");
    const settingsPanel = document.getElementById("autopilotSettings");
    const daysSelect = document.getElementById("autopilotDaysAhead");
    const postsSelect = document.getElementById("autopilotPostsPerDay");
    const statusEl = document.getElementById("autopilotStatus");
    
    if (toggle) toggle.checked = settings.enabled;
    if (settingsPanel) settingsPanel.classList.toggle("hidden", !settings.enabled);
    if (daysSelect) daysSelect.value = settings.days_ahead || 7;
    if (postsSelect) postsSelect.value = settings.posts_per_day || 2;
    
    // Restore platform checkboxes
    const platforms = settings.platforms || ["instagram"];
    const igCb = document.getElementById("autopilotPlatformInstagram");
    const fbCb = document.getElementById("autopilotPlatformFacebook");
    const pinCb = document.getElementById("autopilotPlatformPinterest");
    if (igCb) igCb.checked = platforms.includes("instagram");
    if (fbCb) fbCb.checked = platforms.includes("facebook");
    if (pinCb) pinCb.checked = platforms.includes("pinterest");
    
    if (statusEl) {
      statusEl.textContent = settings.enabled 
        ? `✅ Active - keeping ${settings.days_ahead} days of posts queued`
        : "❌ Disabled - enable for hands-free posting";
    }
    
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
    
    // Read platforms from autopilot's own checkboxes
    const platforms = [];
    if (document.getElementById("autopilotPlatformInstagram")?.checked) platforms.push("instagram");
    if (document.getElementById("autopilotPlatformFacebook")?.checked) platforms.push("facebook");
    if (document.getElementById("autopilotPlatformPinterest")?.checked) platforms.push("pinterest");
    
    const settings = {
      enabled: toggle?.checked || false,
      days_ahead: parseInt(daysSelect?.value || "7", 10),
      posts_per_day: parseInt(postsSelect?.value || "2", 10),
      platforms: platforms.length ? platforms : ["instagram"],
      tones: ["casual", "urgency"],
      posting_times: ["10:00", "18:00"],
    };
    
    await client
      .from("social_settings")
      .upsert({
        setting_key: "autopilot",
        setting_value: settings,
        updated_at: new Date().toISOString(),
      }, { onConflict: "setting_key" });
    
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
    
    if (!response.ok) throw new Error(result.error || "Failed to run autopilot");
    
    if (result.skipped) {
      alert("Autopilot is disabled. Enable it first!");
    } else if (result.generated === 0) {
      alert(`Queue is full! (${result.current}/${result.target} posts scheduled)`);
    } else {
      alert(`✅ Autopilot generated ${result.generated} new posts!`);
      await _loadStats();
      if (_state.currentTab === "queue") await _loadQueuePosts();
    }
    
    await loadAutopilotSettings();
  } catch (err) {
    console.error("Failed to run autopilot:", err);
    alert("Failed to run autopilot: " + err.message);
  } finally {
    btnRun.disabled = false;
    btnRun.textContent = "Run Now";
  }
}

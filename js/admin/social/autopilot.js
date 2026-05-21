// /js/admin/social/autopilot.js
// Autopilot Mode — hands-free scheduling

import { getSupabaseClient } from "../../shared/supabaseClient.js";
import {
  assessAutopilotPlatformHealth,
  fetchTokenHealthSettings,
  hasBlockingAutopilotTokenIssues,
} from "./features/platforms/tokenHealth.js";

let _state, _els, _showToast, _getClient;
let _loadStats, _loadQueuePosts, _loadAutomationHealth;

export function initAutopilot(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _loadStats = deps.loadStats;
  _loadQueuePosts = deps.loadQueuePosts;
  _loadAutomationHealth = deps.loadAutomationHealth;
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

  ["autopilotPlatformInstagram", "autopilotPlatformFacebook", "autopilotPlatformPinterest"].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener("change", () => {
        updateAutopilotTokenWarningsFromForm();
      });
    }
  );

  loadAutopilotSettings();
}

function formatResurfaceMixLine(lastRun) {
  const resurfaced = lastRun?.resurfaced_count ?? lastRun?.run_summary?.resurfaced_count;
  const newCount = lastRun?.new_product_count ?? lastRun?.run_summary?.new_product_count;
  if (resurfaced == null && newCount == null) return "";
  const r = Number(resurfaced) || 0;
  const n = newCount != null ? Number(newCount) : null;
  if (r > 0 && n != null) return ` · ${n} new, ${r} resurfaced`;
  if (r > 0) return ` · ${r} resurfaced`;
  if (lastRun?.resurface_enabled === false) return " · resurface off";
  const skip = lastRun?.resurface_skipped_reason ?? lastRun?.run_summary?.resurface_skipped_reason;
  if (lastRun?.resurface_enabled !== false && skip === "no_eligible_winners") {
    return " · resurface on, no winners";
  }
  return "";
}

function formatAutopilotLastRunLabel(lastRun) {
  if (!lastRun?.ran_at) return null;
  const runDate = new Date(lastRun.ran_at);
  let text = runDate.toLocaleString();
  const created = lastRun.posts_created ?? lastRun.generated;
  if (created != null) text += ` · ${created} post(s)`;
  text += formatResurfaceMixLine(lastRun);
  if (lastRun.status) text += ` · ${lastRun.status}`;
  if (lastRun.reason === "queue_full") text += " (at target)";
  if (lastRun.reason === "no_candidates") text += " (none created)";
  return text;
}

/** Build user-facing Run Now alert from autopilot-fill JSON (never call deficit>0 "full"). */
function formatRunNowAlert(result) {
  if (result.skipped && result.reason === "disabled") {
    return "Autopilot is disabled. Enable it first.";
  }

  const current = result.current_count ?? result.current ?? 0;
  const target = result.target_count ?? result.target ?? 0;
  const deficit = result.deficit ?? Math.max(0, target - current);
  const generated = result.posts_created ?? result.generated ?? 0;

  if (!result.success) {
    return result.error || result.message || "Autopilot failed";
  }

  if (result.reason === "queue_full" || (deficit <= 0 && generated === 0 && result.status === "no_op")) {
    return `Queue is at target for the autopilot window (${current}/${target} posts scheduled). No new posts needed.`;
  }

  if (deficit > 0 && generated > 0) {
    const resurfaced = result.resurfaced_count ?? result.run_summary?.resurfaced_count ?? 0;
    const newCount =
      result.new_product_count ??
      result.run_summary?.new_product_count ??
      Math.max(0, generated - resurfaced);
    const mix =
      resurfaced > 0
        ? `Created ${generated} post(s): ${newCount} new, ${resurfaced} resurfaced.`
        : result.resurface_enabled === false
          ? `Created ${generated} post(s) (resurface disabled).`
          : `Created ${generated} new post(s).`;
    return `${mix} Window fill: ${current + generated}/${target} (was ${current}/${target}, needed ${deficit}).`;
  }

  if (deficit > 0 && generated === 0) {
    const built = result.posts_built ?? result.run_summary?.posts_built;
    const detail =
      result.message ||
      (built
        ? `Auto-queue built ${built} post(s) but saved 0 (database insert failed).`
        : "Auto-queue did not create any posts. Try Auto-Queue Preview for skip reasons.");
    return `No posts were created (${current}/${target} in window; need ${deficit} more).\n\n${detail}`;
  }

  return result.message || "Autopilot finished.";
}

async function updateAutopilotTokenWarningsFromForm() {
  const toggle = document.getElementById("autopilotToggle");
  const warningEl = document.getElementById("autopilotTokenWarning");
  const platformWarnEl = document.getElementById("autopilotPlatformWarnings");
  if (!warningEl && !platformWarnEl) return;

  const enabled = toggle?.checked === true;
  const platforms = [];
  if (document.getElementById("autopilotPlatformInstagram")?.checked) platforms.push("instagram");
  if (document.getElementById("autopilotPlatformFacebook")?.checked) platforms.push("facebook");
  if (document.getElementById("autopilotPlatformPinterest")?.checked) platforms.push("pinterest");

  try {
    const client = getSupabaseClient();
    const tokenSettings = await fetchTokenHealthSettings(client);
    const assessments = assessAutopilotPlatformHealth({ platforms }, tokenSettings);
    const blocked = enabled && hasBlockingAutopilotTokenIssues(assessments);

    warningEl?.classList.toggle("hidden", !blocked);
    if (warningEl && blocked) {
      warningEl.textContent =
        "⚠ Autopilot is on, but one or more selected platforms cannot publish. Reconnect using the Connect buttons in the page header before queued posts will go live.";
    }

    if (platformWarnEl) {
      const lines = assessments
        .filter((a) => !a.canPublish)
        .map((a) => `• ${a.displayName}: ${a.statusLine}${a.action ? ` — ${a.action}` : ""}`);
      platformWarnEl.textContent = lines.length ? lines.join("\n") : "";
      platformWarnEl.classList.toggle("hidden", !enabled || lines.length === 0);
    }
  } catch (err) {
    console.warn("[autopilot] Token warning check failed:", err);
  }
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
      resurface_in_autopilot: true,
      resurface_min_age_days: 30,
      resurface_max_per_run: 1,
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

    const platforms = settings.platforms || ["instagram"];
    const igCb = document.getElementById("autopilotPlatformInstagram");
    const fbCb = document.getElementById("autopilotPlatformFacebook");
    const pinCb = document.getElementById("autopilotPlatformPinterest");
    if (igCb) igCb.checked = platforms.includes("instagram");
    if (fbCb) fbCb.checked = platforms.includes("facebook");
    if (pinCb) pinCb.checked = platforms.includes("pinterest");

    const resurfaceEnabled = document.getElementById("autopilotResurfaceEnabled");
    const resurfaceMinAge = document.getElementById("autopilotResurfaceMinAge");
    const resurfaceMax = document.getElementById("autopilotResurfaceMaxPerRun");
    const resurfaceNote = document.getElementById("autopilotResurfacePolicyNote");
    if (resurfaceEnabled) {
      resurfaceEnabled.checked = settings.resurface_in_autopilot !== false;
    }
    if (resurfaceMinAge) {
      resurfaceMinAge.value = String(settings.resurface_min_age_days ?? 30);
    }
    if (resurfaceMax) {
      resurfaceMax.value = String(settings.resurface_max_per_run ?? 1);
    }
    if (resurfaceNote) {
      const on = settings.resurface_in_autopilot !== false;
      const max = settings.resurface_max_per_run ?? 1;
      const age = settings.resurface_min_age_days ?? 30;
      resurfaceNote.textContent = on
        ? `Cap: ${max} per run · min ${age} days · above-median engagement`
        : "Autopilot resurface is off — only new product picks";
    }

    if (statusEl) {
      statusEl.textContent = settings.enabled
        ? `✅ Active - keeping ${settings.days_ahead} days of posts queued`
        : "❌ Disabled - enable for hands-free posting";
    }

    await updateAutopilotTokenWarningsFromForm();

    const { data: lastRunRow } = await client
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "autopilot_last_run")
      .single();

    const lastRunEl = document.getElementById("autopilotLastRun");
    const label = formatAutopilotLastRunLabel(lastRunRow?.setting_value);
    if (lastRunEl) lastRunEl.textContent = label || "Never";
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

    const platforms = [];
    if (document.getElementById("autopilotPlatformInstagram")?.checked) platforms.push("instagram");
    if (document.getElementById("autopilotPlatformFacebook")?.checked) platforms.push("facebook");
    if (document.getElementById("autopilotPlatformPinterest")?.checked) platforms.push("pinterest");

    const resurfaceOn = document.getElementById("autopilotResurfaceEnabled")?.checked !== false;
    const resurfaceMinAge = parseInt(
      document.getElementById("autopilotResurfaceMinAge")?.value || "30",
      10
    );
    const resurfaceMax = parseInt(
      document.getElementById("autopilotResurfaceMaxPerRun")?.value || "1",
      10
    );

    const settings = {
      enabled: toggle?.checked || false,
      days_ahead: parseInt(daysSelect?.value || "7", 10),
      posts_per_day: parseInt(postsSelect?.value || "2", 10),
      platforms: platforms.length ? platforms : ["instagram"],
      tones: ["casual", "urgency"],
      posting_times: ["10:00", "18:00"],
      resurface_in_autopilot: resurfaceOn,
      resurface_min_age_days: resurfaceMinAge,
      resurface_max_per_run: Math.max(0, Math.min(3, resurfaceMax)),
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

    await updateAutopilotTokenWarningsFromForm();
    await _loadAutomationHealth?.();

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
        Authorization: `Bearer ${session?.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "manual" }),
    });

    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Failed to run autopilot");

    alert(formatRunNowAlert(result));

    const generated = result.posts_created ?? result.generated ?? 0;
    if (generated > 0) {
      await _loadStats();
      if (_state.currentTab === "calendar" || _state.currentTab === "queue") await _loadQueuePosts();
    }

    await loadAutopilotSettings();
    await _loadAutomationHealth?.();
  } catch (err) {
    console.error("Failed to run autopilot:", err);
    alert("Failed to run autopilot: " + err.message);
  } finally {
    btnRun.disabled = false;
    btnRun.textContent = "Run Now";
  }
}

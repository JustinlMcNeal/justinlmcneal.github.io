// Auto-queue settings load/save and form normalization

import { getSupabaseClient } from "../../../../shared/supabaseClient.js";
import { getAutoQueueContext } from "./autoQueueContext.js";
import {
  applyScoringWeightsToForm,
  getScoringWeightsFromForm,
} from "./scoringControls.js";

export const AUTO_QUEUE_SETTING_KEY = "auto_queue";
export const DEFAULT_POSTING_TIMES = ["09:00", "17:00"];
export const DEFAULT_CAPTION_TONES = ["casual", "urgency"];

function applyPostingTimesToForm(times) {
  const set = new Set(times || []);
  const map = [
    ["aqTime1", "09:00"],
    ["aqTime2", "12:00"],
    ["aqTime3", "17:00"],
    ["aqTime4", "20:00"],
  ];
  for (const [id, value] of map) {
    const el = document.getElementById(id);
    if (el) el.checked = set.has(value);
  }
}

function applyCaptionTonesToForm(tones) {
  const set = new Set(tones || []);
  const map = [
    ["aqToneCasual", "casual"],
    ["aqToneUrgency", "urgency"],
    ["aqTonePro", "professional"],
    ["aqTonePlayful", "playful"],
    ["aqToneValue", "value"],
    ["aqToneTrending", "trending"],
    ["aqToneInspirational", "inspirational"],
    ["aqToneMinimalist", "minimalist"],
  ];
  for (const [id, value] of map) {
    const el = document.getElementById(id);
    if (el) el.checked = set.has(value);
  }
}

function applyPlatformsToForm(platforms) {
  const set = new Set(platforms || []);
  const ig = document.getElementById("aqPlatformInstagram");
  const fb = document.getElementById("aqPlatformFacebook");
  const pin = document.getElementById("aqPlatformPinterest");
  if (ig) ig.checked = set.has("instagram");
  if (fb) fb.checked = set.has("facebook");
  if (pin) pin.checked = set.has("pinterest");
}

export function getAutoQueueSettings() {
  const { els } = getAutoQueueContext();

  const postingTimes = [];
  if (els.aqTime1?.checked) postingTimes.push(els.aqTime1.value);
  if (els.aqTime2?.checked) postingTimes.push(els.aqTime2.value);
  if (els.aqTime3?.checked) postingTimes.push(els.aqTime3.value);
  if (els.aqTime4?.checked) postingTimes.push(els.aqTime4.value);

  const captionTones = [];
  if (els.aqToneCasual?.checked) captionTones.push("casual");
  if (els.aqToneUrgency?.checked) captionTones.push("urgency");
  if (els.aqTonePro?.checked) captionTones.push("professional");
  if (els.aqTonePlayful?.checked) captionTones.push("playful");
  if (els.aqToneValue?.checked) captionTones.push("value");
  if (els.aqToneTrending?.checked) captionTones.push("trending");
  if (els.aqToneInspirational?.checked) captionTones.push("inspirational");
  if (els.aqToneMinimalist?.checked) captionTones.push("minimalist");

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
    postingTimes: postingTimes.length ? postingTimes : DEFAULT_POSTING_TIMES,
    captionTones: captionTones.length ? captionTones : DEFAULT_CAPTION_TONES,
  };
}

export async function loadAutoQueueSettings() {
  const { els } = getAutoQueueContext();

  try {
    const client = getSupabaseClient();
    const { data: row } = await client
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", AUTO_QUEUE_SETTING_KEY)
      .maybeSingle();

    const saved = row?.setting_value || {};
    if (saved.count && els.aqPostCount) {
      els.aqPostCount.value = String(saved.count);
    }
    applyPlatformsToForm(saved.platforms || ["instagram", "facebook"]);
    applyPostingTimesToForm(saved.posting_times || saved.postingTimes || DEFAULT_POSTING_TIMES);
    applyCaptionTonesToForm(saved.caption_tones || saved.captionTones || DEFAULT_CAPTION_TONES);
    applyScoringWeightsToForm(saved.scoring_weights || null);
  } catch (err) {
    console.error("[auto-queue] Failed to load settings:", err);
  }
}

export async function saveAutoQueueSettings(showFeedback = false) {
  const { showToast } = getAutoQueueContext();

  try {
    const client = getSupabaseClient();
    const form = getAutoQueueSettings();

    const { data: existing } = await client
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", AUTO_QUEUE_SETTING_KEY)
      .maybeSingle();

    const merged = {
      ...(existing?.setting_value && typeof existing.setting_value === "object" ? existing.setting_value : {}),
      count: form.count,
      platforms: form.platforms,
      posting_times: form.postingTimes,
      caption_tones: form.captionTones,
      scoring_weights: getScoringWeightsFromForm(),
      image_asset_policy: "image_pool_only",
      allow_catalog_fallback: false,
      updated_at: new Date().toISOString(),
    };

    await client.from("social_settings").upsert({
      setting_key: AUTO_QUEUE_SETTING_KEY,
      setting_value: merged,
    }, { onConflict: "setting_key" });

    if (showFeedback) {
      showToast?.("Auto-queue settings saved") || alert("Auto-queue settings saved");
    }
    return merged;
  } catch (err) {
    console.error("[auto-queue] Failed to save settings:", err);
    if (showFeedback) alert("Failed to save auto-queue settings");
    throw err;
  }
}

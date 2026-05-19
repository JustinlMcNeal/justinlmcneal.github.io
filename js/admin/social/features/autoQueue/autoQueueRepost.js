// Auto-repost preview and generate

import { getAutoQueueContext } from "./autoQueueContext.js";
import { getAuthHeaders } from "./autoQueueAuth.js";
import { getAutoQueueSettings } from "./autoQueueSettings.js";
import { renderRepostPreview } from "./autoQueuePreview.js";

function getRepostSettings() {
  const aqSettings = getAutoQueueSettings();
  return {
    count: parseInt(document.getElementById("repostCount")?.value || "2", 10),
    minDaysOld: parseInt(document.getElementById("repostMinDays")?.value || "30", 10),
    platforms: aqSettings.platforms,
    tones: ["casual", "trending", "value"],
  };
}

export async function previewRepost() {
  const btn = document.getElementById("btnPreviewRepost");
  const settings = getRepostSettings();
  const { state, SUPABASE_FUNCTIONS_URL } = getAutoQueueContext();

  btn.disabled = true;
  btn.textContent = "Loading...";

  try {
    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/auto-repost`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ ...settings, preview: true }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to preview reposts");

    if (!result.posts?.length) {
      alert("No old posts found to repost. Try reducing the minimum age.");
      return;
    }

    state.repostPreview = result.posts;
    renderRepostPreview(result.posts);
  } catch (err) {
    console.error("Repost preview error:", err);
    alert("Failed to preview: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "👀 Preview";
  }
}

export async function generateRepost() {
  const btn = document.getElementById("btnGenerateRepost");
  const settings = getRepostSettings();
  const { state, SUPABASE_FUNCTIONS_URL, loadStats, loadQueuePosts } = getAutoQueueContext();

  btn.disabled = true;
  btn.textContent = "Generating...";

  try {
    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/auto-repost`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ ...settings, preview: false }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to generate reposts");

    if (result.generated === 0) {
      alert("No old posts found to repost. Try reducing the minimum age.");
    } else {
      alert(`✅ Scheduled ${result.generated} reposts!`);
      await loadStats();
      if (state.currentTab === "queue") await loadQueuePosts();
    }

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

export async function confirmRepost() {
  const { state } = getAutoQueueContext();

  if (!state.repostPreview?.length) {
    alert("No preview data. Please preview first.");
    return;
  }
  if (!confirm(`Schedule ${state.repostPreview.length} reposts now?`)) return;
  await generateRepost();
}

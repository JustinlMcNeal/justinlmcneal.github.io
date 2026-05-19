// Auto-queue preview / generate / confirm actions

import { getAutoQueueContext } from "./autoQueueContext.js";
import { getAuthHeaders } from "./autoQueueAuth.js";
import {
  getAutoQueueSettings,
  saveAutoQueueSettings,
} from "./autoQueueSettings.js";
import { isCompareScoringEnabled } from "./scoringControls.js";
import { renderAutoQueuePreview } from "./autoQueuePreview.js";
import { loadAutoQueueStats } from "./autoQueueStats.js";
import { loadAutomationHealth } from "./autoQueueAutomationHealth.js";

function formatPlatformsLabel(platforms) {
  return (platforms || []).join(", ") || "instagram";
}

export async function previewAutoQueue() {
  const { els, state, SUPABASE_FUNCTIONS_URL } = getAutoQueueContext();
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
    await saveAutoQueueSettings(false);

    const compareScoring = isCompareScoringEnabled();
    const previewBody = { ...settings, preview: true };
    if (compareScoring) previewBody.compareScoring = true;

    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/auto-queue`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify(previewBody),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to preview posts");

    state.autoQueuePreview = result.posts;
    state.autoQueuePreviewSettings = result.settings_used || null;
    state.autoQueuePreviewSkipped = result.skipped_products || [];
    state.autoQueuePreviewSummary = result.run_summary || null;
    state.autoQueueScoringComparison = result.scoring_comparison || null;
    state.autoQueueCompareScoring = compareScoring;
    renderAutoQueuePreview(
      result.posts,
      result.settings_used,
      result.skipped_products,
      result.run_summary,
      compareScoring ? result.scoring_comparison : null,
      compareScoring
    );
    await loadAutomationHealth();
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

export async function generateAutoQueue() {
  const { els, switchTab, loadStats } = getAutoQueueContext();
  const settings = getAutoQueueSettings();
  const platformLabel = formatPlatformsLabel(settings.platforms);

  const guardNote =
    "Safety guards: skips products already queued; default is one platform per product per run.";
  if (!confirm(`Generate and schedule ${settings.count} product slot(s) for: ${platformLabel}?\n\n${guardNote}`)) return;

  els.btnGenerateQueue.disabled = true;
  els.btnGenerateQueue.innerHTML = `
    <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Generating...
  `;

  try {
    await saveAutoQueueSettings(false);

    const { SUPABASE_FUNCTIONS_URL } = getAutoQueueContext();
    const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/auto-queue`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ ...settings, preview: false }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Failed to generate posts");

    const skippedN = result.run_summary?.skipped_count ?? result.skipped_products?.length ?? 0;
    const msg = skippedN > 0
      ? `Scheduled ${result.generated} posts. ${skippedN} product(s) skipped by safety guards.`
      : `Successfully scheduled ${result.generated} posts!`;
    alert(msg);
    await loadStats();
    await loadAutoQueueStats();
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

export async function confirmAutoQueue() {
  const { state, els } = getAutoQueueContext();

  if (!state.autoQueuePreview?.length) {
    alert("No preview data. Please generate a preview first.");
    return;
  }
  if (!confirm(`Schedule ${state.autoQueuePreview.length} posts now?`)) return;
  await generateAutoQueue();
  state.autoQueuePreview = null;
  state.autoQueuePreviewSettings = null;
  els.aqPreviewResults?.classList.add("hidden");
}

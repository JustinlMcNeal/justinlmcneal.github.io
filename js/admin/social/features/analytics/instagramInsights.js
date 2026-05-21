// Instagram insights sync

import { getAnalyticsContext } from "./analyticsContext.js";
import { reloadAnalyticsTab } from "./analyticsReload.js";
import { loadEngagementMetrics } from "./analyticsCards.js";

export async function syncInstagramInsights(specificPostId) {
  const btn = document.getElementById("btnSyncInstagramInsights");
  const spinner = document.getElementById("syncInsightsSpinner");
  const { getClient, loadCalendarPosts, loadQueuePosts } = getAnalyticsContext();

  try {
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove("hidden");

    const client = getClient();
    const { data, error } = await client.functions.invoke("instagram-insights", {
      body: { syncAll: true, daysBack: 30 },
    });

    if (error) throw error;

    console.log("Insights sync result:", data);

    const updated = Number(data?.updated) || 0;
    const failed = Number(data?.failed) || 0;
    const deleted = Number(data?.deleted) || 0;
    const errors = Array.isArray(data?.errors) ? data.errors : [];

    if (data?.success === false) {
      throw new Error(data.error || data.message || "Insights sync failed");
    }

    await reloadAnalyticsTab();
    await loadEngagementMetrics();
    await loadCalendarPosts();
    await loadQueuePosts();

    const lastSync = document.getElementById("analyticsLastSync");
    if (lastSync) {
      const parts = [
        `Last sync: ${new Date().toLocaleString()}`,
        `${updated} post(s) updated`,
      ];
      if (deleted > 0) parts.push(`${deleted} removed on Instagram`);
      if (failed > 0) parts.push(`${failed} failed`);
      lastSync.textContent = parts.join(" · ");
      if (failed > 0) {
        lastSync.classList.add("text-amber-600");
      } else {
        lastSync.classList.remove("text-amber-600");
      }
    }

    const { showToast } = getAnalyticsContext();
    if (updated === 0 && failed === 0) {
      showToast?.(data?.message || "No Instagram posts needed an insights update.", "info");
    } else if (failed > 0) {
      const hint = errors[0] ? ` First error: ${errors[0]}` : "";
      showToast?.(
        `Synced ${updated} post(s); ${failed} failed.${hint} Check token/permissions if failures persist.`,
        "warning"
      );
    } else {
      showToast?.(
        `Insights synced: ${updated} post(s) updated.${deleted ? ` ${deleted} marked deleted.` : ""} Learning tables refreshed.`,
        "success"
      );
    }
  } catch (err) {
    console.error("Failed to sync insights:", err);
    const msg = err.message || "Unknown error";
    alert(
      `Failed to sync Instagram insights.\n\n${msg}\n\nIf this mentions permissions, reconnect Instagram with insights access.`
    );
    const lastSync = document.getElementById("analyticsLastSync");
    if (lastSync) {
      lastSync.textContent = `Last sync failed: ${new Date().toLocaleString()}`;
      lastSync.classList.add("text-red-600");
    }
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add("hidden");
  }
}

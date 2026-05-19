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

    await reloadAnalyticsTab();
    await loadEngagementMetrics();
    await loadCalendarPosts();
    await loadQueuePosts();

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

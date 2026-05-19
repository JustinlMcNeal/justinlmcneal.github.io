// Auto-queue product stats cards

import { getSupabaseClient } from "../../../../shared/supabaseClient.js";
import { getAutoQueueContext } from "./autoQueueContext.js";
import { loadAutomationHealth } from "./autoQueueAutomationHealth.js";

export async function loadAutoQueueStats() {
  const { els } = getAutoQueueContext();

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

    if (els.aqStatTotal) els.aqStatTotal.textContent = total || 0;
    if (els.aqStatNeverPosted) els.aqStatNeverPosted.textContent = neverPosted || 0;
    if (els.aqStatReady) els.aqStatReady.textContent = ready || 0;
    if (els.aqStatRecent) els.aqStatRecent.textContent = recent;
  } catch (err) {
    console.error("Failed to load auto-queue stats:", err);
  }

  await loadAutomationHealth();
}

// Automation health summary (Auto-Queue tab) — truthful DB-backed fields only

import { getSupabaseClient } from "../../../../shared/supabaseClient.js";
import { getAutoQueueContext } from "./autoQueueContext.js";

function formatRelativeTime(iso) {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return d.toLocaleString();
}

function setText(el, text) {
  if (el) el.textContent = text;
}

export async function loadAutomationHealth() {
  const { els, state } = getAutoQueueContext();
  if (!els.aqHealthCard) return;

  try {
    const client = getSupabaseClient();

    const { data: settingsRows } = await client
      .from("social_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["autopilot", "autopilot_last_run", "auto_queue_last_run", "auto_queue"]);

    const byKey = Object.fromEntries((settingsRows || []).map((r) => [r.setting_key, r.setting_value]));
    const autopilotOn = byKey.autopilot?.enabled === true;
    const autoQueueSettings = byKey.auto_queue || {};
    const imagePolicy =
      autoQueueSettings.image_asset_policy === "legacy_pipeline" ||
      autoQueueSettings.allow_catalog_fallback === true
        ? "legacy_pipeline"
        : "image_pool_only";

    setText(els.aqHealthAutopilot, autopilotOn ? "Enabled" : "Disabled");
    els.aqHealthAutopilot?.classList.toggle("text-green-700", autopilotOn);
    els.aqHealthAutopilot?.classList.toggle("text-gray-600", !autopilotOn);

    const autopilotRun = byKey.autopilot_last_run;
    const autoQueueRun = byKey.auto_queue_last_run;
    const lastAutopilot = autopilotRun?.ran_at || null;
    const lastAutoQueue = autoQueueRun?.ran_at || null;

    let autopilotDetail = formatRelativeTime(lastAutopilot);
    if (autopilotRun?.generated != null) {
      autopilotDetail += ` · ${autopilotRun.generated} post(s)`;
    }
    if (autopilotRun?.no_pool_asset_skipped > 0) {
      autopilotDetail += ` · ${autopilotRun.no_pool_asset_skipped} skipped (no pool)`;
    }
    setText(els.aqHealthLastAutopilot, autopilotDetail);

    let queueRunDetail = formatRelativeTime(lastAutoQueue);
    if (autoQueueRun?.preview) queueRunDetail += " (preview)";
    if (autoQueueRun?.run_summary?.no_pool_asset_skipped > 0) {
      queueRunDetail += ` · ${autoQueueRun.run_summary.no_pool_asset_skipped} no pool asset`;
    }
    setText(els.aqHealthLastAutoQueue, queueRunDetail);

    const [{ count: queued }, { count: scheduled }] = await Promise.all([
      client.from("social_posts").select("*", { count: "exact", head: true }).eq("status", "queued"),
      client.from("social_posts").select("*", { count: "exact", head: true }).eq("status", "scheduled"),
    ]);

    setText(els.aqHealthQueued, String(queued ?? 0));
    setText(els.aqHealthScheduled, String(scheduled ?? 0));

    const { count: poolReady } = await client
      .from("social_assets")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("product_id", "is", null)
      .not("shot_type", "is", null);

    setText(els.aqHealthPoolReady, String(poolReady ?? 0));

    const policyNote =
      imagePolicy === "image_pool_only"
        ? "Standard auto-posting uses Image Pool assets only (no catalog/gallery fallback)."
        : "Legacy pipeline: catalog/gallery/AI fallback enabled via settings.";
    setText(els.aqHealthPolicy, policyNote);

    const poolWarn = (poolReady ?? 0) < 4;
    els.aqHealthPoolWarning?.classList.toggle("hidden", !poolWarn);

    let previewNote = "";
    if (state?.autoQueuePreviewSummary) {
      const s = state.autoQueuePreviewSummary;
      previewNote = `Last preview this session: ${s.eligible_count ?? 0} post(s), ${s.no_pool_asset_skipped ?? 0} skipped (no pool).`;
    }
    setText(els.aqHealthPreviewNote, previewNote);
    els.aqHealthPreviewNote?.classList.toggle("hidden", !previewNote);
  } catch (err) {
    console.error("[auto-queue] Automation health load failed:", err);
    setText(els.aqHealthAutopilot, "—");
    setText(els.aqHealthPolicy, "Could not load automation health.");
  }
}

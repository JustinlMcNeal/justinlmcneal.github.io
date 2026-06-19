// Automation health summary (Auto-Queue tab) — truthful DB-backed fields only

import { getSupabaseClient } from "../../../../shared/supabaseClient.js";
import {
  assessAutopilotPlatformHealth,
  assessPlatformPublishHealth,
  escapeHtml,
  fetchLatestFailedPost,
  fetchTokenHealthSettings,
  hasBlockingAutopilotTokenIssues,
  renderTokenHealthListHtml,
  sanitizePublishError,
} from "../platforms/tokenHealth.js";
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

function setHtml(el, html) {
  if (el) el.innerHTML = html;
}

export async function loadAutomationHealth() {
  const { els, state } = getAutoQueueContext();
  if (!els.aqHealthCard) return;

  try {
    const client = getSupabaseClient();

    const { data: settingsRows } = await client
      .from("social_settings")
      .select("setting_key, setting_value")
      .in("setting_key", [
        "autopilot",
        "autopilot_last_run",
        "auto_queue_last_run",
        "auto_queue",
      ]);

    const byKey = Object.fromEntries((settingsRows || []).map((r) => [r.setting_key, r.setting_value]));
    const autopilotSettings = byKey.autopilot || {};
    const autopilotOn = autopilotSettings.enabled === true;
    const autoQueueSettings = byKey.auto_queue || {};
    const imagePolicy =
      autoQueueSettings.image_asset_policy === "legacy_pipeline" ||
      autoQueueSettings.allow_catalog_fallback === true
        ? "legacy_pipeline"
        : "image_pool_only";

    let autopilotLabel = autopilotOn ? "Enabled" : "Disabled";
    if (autopilotOn) {
      const tokenSettings = await fetchTokenHealthSettings(client);
      const platformHealth = assessAutopilotPlatformHealth(autopilotSettings, tokenSettings);
      if (hasBlockingAutopilotTokenIssues(platformHealth)) {
        autopilotLabel = "Enabled — publish blocked";
      }
    }

    setText(els.aqHealthAutopilot, autopilotLabel);
    els.aqHealthAutopilot?.classList.toggle("text-green-700", autopilotOn && autopilotLabel === "Enabled");
    els.aqHealthAutopilot?.classList.toggle("text-amber-700", autopilotOn && autopilotLabel.includes("blocked"));
    els.aqHealthAutopilot?.classList.toggle("text-gray-600", !autopilotOn);

    const autopilotRun = byKey.autopilot_last_run;
    const autoQueueRun = byKey.auto_queue_last_run;
    const lastAutopilot = autopilotRun?.ran_at || null;
    const lastAutoQueue = autoQueueRun?.ran_at || null;

    const generatedCount =
      autopilotRun?.posts_created ?? autopilotRun?.generated ?? null;

    let autopilotDetail = formatRelativeTime(lastAutopilot);
    if (generatedCount != null) {
      autopilotDetail += ` · ${generatedCount} post(s)`;
    }
    if (autopilotRun?.status) {
      autopilotDetail += ` · ${autopilotRun.status}`;
    }
    if (autopilotRun?.reason === "queue_full") {
      autopilotDetail += " (at target)";
    } else if (autopilotRun?.reason === "no_candidates") {
      autopilotDetail += " (none created)";
    }
    if (autopilotRun?.target_count != null && autopilotRun?.current_count != null) {
      autopilotDetail += ` · ${autopilotRun.current_count}/${autopilotRun.target_count} in window`;
    }
    if (autopilotRun?.volume_mode) {
      autopilotDetail += ` · ${autopilotRun.volume_mode}`;
    }
    if (autopilotRun?.posts_requested != null) {
      autopilotDetail += ` · req ${autopilotRun.posts_requested}`;
    }
    if (autopilotRun?.no_pool_asset_skipped > 0) {
      autopilotDetail += ` · ${autopilotRun.no_pool_asset_skipped} skipped (no pool)`;
    }
    const resurfaced =
      autopilotRun?.resurfaced_count ?? autopilotRun?.run_summary?.resurfaced_count;
    const newProducts =
      autopilotRun?.new_product_count ?? autopilotRun?.run_summary?.new_product_count;
    if (resurfaced != null && Number(resurfaced) > 0) {
      autopilotDetail += ` · ${newProducts ?? "?"} new, ${resurfaced} resurfaced`;
    } else if (autopilotSettings.resurface_in_autopilot === false) {
      autopilotDetail += " · resurface disabled";
    } else if (
      autopilotRun?.resurface_skipped_reason === "no_eligible_winners" ||
      autopilotRun?.run_summary?.resurface_skipped_reason === "no_eligible_winners"
    ) {
      autopilotDetail += " · resurface on, no winners";
    }
    setText(els.aqHealthLastAutopilot, autopilotDetail);

    const underfillEl = document.getElementById("aqHealthUnderfillWarning");
    const runDeficit = Number(autopilotRun?.deficit) || 0;
    const runCreated = Number(generatedCount) || 0;
    const deficitRemaining =
      autopilotRun?.deficit_remaining != null
        ? Number(autopilotRun.deficit_remaining)
        : Math.max(0, runDeficit - runCreated);
    const showUnderfill =
      autopilotOn &&
      autopilotRun?.status === "success" &&
      runDeficit > 0 &&
      deficitRemaining > 0;

    underfillEl?.classList.toggle("hidden", !showUnderfill);
    if (underfillEl && showUnderfill) {
      let underfillMsg = `Window under-filled — created ${runCreated}, need ${runDeficit} more (${deficitRemaining} still short).`;
      if (autopilotRun?.posts_requested != null) {
        underfillMsg += ` Requested ${autopilotRun.posts_requested}.`;
      }
      if (autopilotRun?.volume_mode) {
        underfillMsg += ` Mode: ${autopilotRun.volume_mode}.`;
      }
      setText(underfillEl, underfillMsg);
    }

    const resurfaceHealthEl = document.getElementById("aqHealthResurface");
    if (resurfaceHealthEl) {
      const enabled = autopilotSettings.resurface_in_autopilot !== false;
      const max = autopilotSettings.resurface_max_per_run ?? 1;
      const age = autopilotSettings.resurface_min_age_days ?? 30;
      let resurfaceLine = enabled
        ? `Resurface strategy: on (max ${max}/run, min ${age}d)`
        : "Resurface strategy: off";
      if (autopilotRun?.ran_at && enabled && Number(resurfaced || 0) === 0 && generatedCount > 0) {
        resurfaceLine += " · last run: no resurfaced slots used";
      }
      setText(resurfaceHealthEl, resurfaceLine);
    }

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

    const tokenSettings = await fetchTokenHealthSettings(client);
    const platformHealth = assessAutopilotPlatformHealth(autopilotSettings, tokenSettings);
    const tokenBlocking = autopilotOn && hasBlockingAutopilotTokenIssues(platformHealth);

    els.aqHealthTokenWarning?.classList.toggle("hidden", !tokenBlocking);
    if (els.aqHealthTokenWarning && tokenBlocking) {
      setText(
        els.aqHealthTokenWarning,
        "Autopilot is active, but selected platforms cannot publish until tokens are refreshed. Use the Connect buttons in the page header to reconnect."
      );
    }

    if (els.aqHealthTokenList) {
      const listLabel = autopilotOn
        ? "Publish readiness (autopilot platforms):"
        : "Platform tokens (reconnect via header Connect buttons):";
      setHtml(
        els.aqHealthTokenList,
        `<p class="text-xs font-medium text-gray-600 mb-1">${escapeHtml(listLabel)}</p>${renderTokenHealthListHtml(
          autopilotOn
            ? platformHealth
            : ["instagram", "facebook", "pinterest"].map((p) =>
                assessPlatformPublishHealth(p, tokenSettings)
              )
        )}`
      );
    }

    const latestFailed = await fetchLatestFailedPost(client);
    const showFailure = Boolean(latestFailed?.error_message);
    els.aqHealthRecentFailure?.classList.toggle("hidden", !showFailure);
    if (els.aqHealthRecentFailure && latestFailed) {
      const when = latestFailed.updated_at || latestFailed.scheduled_for;
      const whenStr = when ? formatRelativeTime(when) : "recently";
      const err = sanitizePublishError(latestFailed.error_message);
      let action = "Review platform connection and retry after reconnecting.";
      if (/instagram token expired/i.test(err)) action = "Reconnect Instagram in the header.";
      else if (/pinterest token expired/i.test(err)) action = "Reconnect Pinterest in the header.";
      else if (/not connected/i.test(err)) action = "Reconnect the platform shown below.";

      setHtml(
        els.aqHealthRecentFailure,
        `<p class="text-xs font-medium text-red-900 mb-1">Latest publish failure (${escapeHtml(whenStr)})</p>
         <p class="text-xs text-red-800"><strong>${escapeHtml(latestFailed.platform || "unknown")}</strong>: ${escapeHtml(err)}</p>
         <p class="text-xs text-amber-900 mt-1">${escapeHtml(action)}</p>`
      );
    }
  } catch (err) {
    console.error("[auto-queue] Automation health load failed:", err);
    setText(els.aqHealthAutopilot, "—");
    setText(els.aqHealthPolicy, "Could not load automation health.");
    els.aqHealthTokenWarning?.classList.add("hidden");
    els.aqHealthRecentFailure?.classList.add("hidden");
    document.getElementById("aqHealthUnderfillWarning")?.classList.add("hidden");
  }
}

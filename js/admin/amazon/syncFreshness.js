import { qs } from "./dom.js";
import { fetchAmazonSyncSummary } from "./api.js";

function formatSyncDate(value) {
  if (!value) return "Never";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSuccessfulRun(run) {
  const status = String(run.status || "");
  return status === "success" || status === "partial_success";
}

/**
 * @param {Array<Record<string, unknown>>} runs
 */
function summarizeSyncRuns(runs) {
  let scheduled = null;
  let manual = null;
  let latestFailed = null;

  for (const run of runs) {
    const syncType = String(run.sync_type || "");
    if (!latestFailed && run.status === "failed") {
      latestFailed = run;
    }
    if (!scheduled && syncType === "incremental" && isSuccessfulRun(run)) {
      scheduled = run;
    }
    if (!manual && syncType === "manual" && isSuccessfulRun(run)) {
      manual = run;
    }
  }

  return { scheduled, manual, latestFailed };
}

export async function refreshAmazonSyncFreshness() {
  const el = qs("#amazonSyncFreshness");
  if (!el) return;

  try {
    const runs = await fetchAmazonSyncSummary();
    const { scheduled, manual, latestFailed } = summarizeSyncRuns(runs);

    const parts = [
      `Last scheduled sync: ${formatSyncDate(scheduled?.finished_at || scheduled?.created_at)}`,
      `Last manual sync: ${formatSyncDate(manual?.finished_at || manual?.created_at)}`,
    ];

    el.textContent = parts.join(" · ");

    if (latestFailed) {
      el.title = `Latest failed sync: ${formatSyncDate(latestFailed.finished_at || latestFailed.created_at)}`;
    } else {
      el.removeAttribute("title");
    }
  } catch {
    el.textContent = "Sync history unavailable.";
    el.removeAttribute("title");
  }
}

export function initAmazonSyncFreshness() {
  refreshAmazonSyncFreshness().catch(() => {});

  return {
    refresh: refreshAmazonSyncFreshness,
  };
}

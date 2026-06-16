/**
 * KK Universal Storage — Inventory admin page entry (Phase 5 — parcel receive visibility).
 */

import { initAdminNav } from "/js/shared/adminNav.js";
import { requireAdmin } from "/js/shared/guard.js";
import { initDom, getDom } from "./dom.js";
import { renderKpis } from "./renderers/renderKpis.js";
import { renderChannelStatus } from "./renderers/renderChannelStatus.js";
import { renderLedger } from "./renderers/renderLedger.js";
import { renderIssues } from "./renderers/renderIssues.js";
import { renderParcelSummary } from "./renderers/renderParcelSummary.js";
import { renderBundleRules } from "./renderers/renderBundle.js";
import { fetchBundlePreviewData } from "./api/bundlePreviewApi.js";
import {
  initInventoryEvents,
  initHeaderActions,
  refreshInventoryTable,
  refreshInventoryLedger,
  renderInventoryTabs,
  renderInventoryAlerts,
} from "./events.js";
import { initAdjustModal } from "./ui/adjustModal.js";
import { state, setAdminOk, loadLiveData } from "./state.js";

function buildLoginRedirect() {
  const next = `${location.pathname}${location.search}`;
  return `/pages/admin/login.html?next=${encodeURIComponent(next)}`;
}

async function refreshBundlePreviewPanel() {
  const { bundleMount } = getDom();
  renderBundleRules(bundleMount, { loading: true });
  try {
    const data = await fetchBundlePreviewData();
    renderBundleRules(bundleMount, {
      summaries: data.summaries,
      likeVariants: data.likeVariants,
      isLive: true,
    });
  } catch (err) {
    renderBundleRules(bundleMount, {
      error: err instanceof Error ? err.message : String(err),
      isLive: false,
    });
  }
}

function renderLivePanels() {
  const { channelStatusMount, kpiMount, ledgerMount, issuesMount, parcelSummaryMount } = getDom();

  renderChannelStatus(channelStatusMount, state.channelStatus, {
    loading: state.channelStatusLoading,
    error: state.channelStatusError,
    isLive: state.channelStatusLive,
  });

  renderKpis(kpiMount, state.kpis, {
    loading: state.kpiLoading,
    error: state.kpiError,
    isLive: state.kpiLive,
  });

  renderParcelSummary(parcelSummaryMount, state.parcelSummary, {
    loading: state.parcelSummaryLoading,
    error: state.parcelSummaryError,
    isLive: state.parcelSummaryLive,
  });

  renderLedger(ledgerMount, state.ledgerEntries, {
    loading: state.ledgerLoading,
    error: state.ledgerError,
    isLive: state.ledgerLive,
    filter: state.ledgerFilter,
  });

  renderIssues(issuesMount, state.issueRows, {
    loading: state.issuesLoading,
    error: state.issuesError,
    isLive: state.issuesLive,
    workflowFilter: state.issuesWorkflowFilter,
    postMapQueueCount: state.postMapQueueActiveCount,
  });
}

async function init() {
  initDom();
  initHeaderActions();

  const { channelStatusMount, kpiMount, ledgerMount, issuesMount, parcelSummaryMount, bundleMount } = getDom();

  renderChannelStatus(channelStatusMount, null, { loading: true });
  renderKpis(kpiMount, null, { loading: true });
  renderParcelSummary(parcelSummaryMount, null, { loading: true });
  renderLedger(ledgerMount, null, { loading: true });
  renderIssues(issuesMount, null, { loading: true });
  renderBundleRules(bundleMount);

  initInventoryEvents();
  initAdjustModal();

  await initAdminNav("Inventory");

  const check = await requireAdmin();
  if (!check.ok) {
    console.warn("[inventory] blocked:", check.reason);
    location.replace(buildLoginRedirect());
    return;
  }

  setAdminOk(true);

  await loadLiveData();
  renderLivePanels();
  await refreshBundlePreviewPanel();
  getDom().bundleMount?.addEventListener("inventory:bundle-preview-refresh", () => {
    void refreshBundlePreviewPanel();
  });
  renderInventoryTabs();
  renderInventoryAlerts();
  refreshInventoryTable();
  refreshInventoryLedger();

  const { maybeOpenDashboardFromUrl } = await import("./services/returnsRestockDashboardBootstrap.js");
  await maybeOpenDashboardFromUrl();
}

init().catch((err) => {
  console.error("[inventory] init failed:", err);
  const { channelStatusMount, kpiMount, ledgerMount, issuesMount, parcelSummaryMount } = getDom();
  renderChannelStatus(channelStatusMount, null, {
    error: err instanceof Error ? err.message : String(err),
    isLive: false,
  });
  renderKpis(kpiMount, null, {
    error: err instanceof Error ? err.message : String(err),
    isLive: false,
  });
  renderParcelSummary(parcelSummaryMount, null, {
    error: err instanceof Error ? err.message : String(err),
    isLive: false,
  });
  renderLedger(ledgerMount, null, {
    error: err instanceof Error ? err.message : String(err),
    isLive: false,
  });
  renderIssues(issuesMount, null, {
    error: err instanceof Error ? err.message : String(err),
    isLive: false,
  });
});

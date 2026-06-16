/**

 * Refresh all inventory panels after a write (Phase 4).

 */



import { state, loadLiveData, loadInventoryIssuesPanel, setPostMapQueueActiveCount } from "../state.js";

import { getDom } from "../dom.js";

import { renderKpis } from "../renderers/renderKpis.js";

import { renderChannelStatus } from "../renderers/renderChannelStatus.js";

import { renderLedger } from "../renderers/renderLedger.js";

import { renderIssues } from "../renderers/renderIssues.js";

import { renderParcelSummary } from "../renderers/renderParcelSummary.js";

import {

  refreshInventoryTable,

  refreshInventoryLedger,

  renderInventoryTabs,

  renderInventoryAlerts,

} from "../events.js";



export function renderInventoryPanels() {

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



  renderInventoryTabs();

  renderInventoryAlerts();

  refreshInventoryTable();

  refreshInventoryLedger();

}



export async function refreshInventoryAfterAdjustment() {

  await loadLiveData();

  renderInventoryPanels();

}



/** After mapping/finalize — refresh issues + queue only (no workspace/snapshot RPC pile-up). */
export async function refreshInventoryAfterIssueStateChange() {
  await loadInventoryIssuesPanel();
  try {
    const { fetchPostMapQueueCounts } = await import("../api/postMapQueueApi.js");
    setPostMapQueueActiveCount((await fetchPostMapQueueCounts()).active);
  } catch {
    setPostMapQueueActiveCount(0);
  }
  renderInventoryPanels();
}


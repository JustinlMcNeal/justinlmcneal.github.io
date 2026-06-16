/**
 * Inventory admin page state (Phase 3A–5 — live reads, manual adjust, parcel visibility).
 */

import { KPI_DATA, LEDGER_ENTRIES, INVENTORY_ROWS, INVENTORY_ISSUES } from "./mockData.js";
import {
  fetchInventoryKpis,
  fetchRecentLedgerEntries,
  fetchInventoryWorkspace,
  fetchInventoryIssues,
  fetchIssueSnapshotRefreshedAt,
  withFetchTimeout,
} from "./api/inventoryApi.js";
import { fetchParcelReceiveSummary } from "./api/parcelReceiveApi.js";
import { fetchChannelStatus, mockChannelStatus } from "./api/channelStatusApi.js";
import { buildInventoryAlerts } from "./services/buildAlerts.js";
import { filterIssuesByWorkflow } from "./services/issueWorkflow.js";
import { formatLedgerTime } from "./utils/formatters.js";
import { MOCK_PARCEL_SUMMARY } from "./services/mapParcelSummary.js";

/** @typedef {typeof KPI_DATA} KpiData */

/**
 * @typedef {Object} LedgerEntry
 * @property {string} id
 * @property {string} time
 * @property {string} product
 * @property {string} change
 * @property {string} reason
 * @property {string} [reasonKey]
 * @property {string} source
 * @property {string} reference
 */

/**
 * @typedef {Object} InventoryIssueRow
 * @property {string} id
 * @property {string} type
 * @property {string} label
 * @property {string} severity
 * @property {string} description
 * @property {number} affectedCount
 * @property {string} [source]
 * @property {string} [reference]
 * @property {'open'|'reviewed'|'snoozed'|'resolved'|'ignored'} [workflowStatus]
 * @property {string|null} [snoozedUntil]
 * @property {string|null} [resolutionNote]
 * @property {string|null} [issueStateId]
 * @property {boolean} [isActiveWorkflow]
 * @property {boolean} [isSnoozedActive]
 */

/** @type {import('./services/mapWorkspaceRow.js').InventoryRow[]} */
const mockInventoryRows = INVENTORY_ROWS.map((row) => ({
  ...row,
  updatedAtMs: 0,
  ebaySku: "",
  ebayListingId: "",
  amazonAsin: "",
  amazonSellerSku: "",
  ebayListingStatus: "",
  amazonListingStatus: "",
}));

export const state = {
  adminOk: false,
  kpis: { ...KPI_DATA },
  kpiLoading: false,
  kpiError: null,
  kpiLive: false,
  ledgerEntries: [...LEDGER_ENTRIES],
  ledgerLoading: false,
  ledgerError: null,
  ledgerLive: false,
  inventoryRows: [...mockInventoryRows],
  workspaceLoading: false,
  workspaceError: null,
  workspaceLive: false,
  issueRows: [...INVENTORY_ISSUES],
  issueRowsAll: [...INVENTORY_ISSUES],
  issuesWorkflowFilter: /** @type {'active'|'reviewed'|'snoozed'|'resolved'} */ ("active"),
  issuesLoading: false,
  issuesError: null,
  issuesLive: false,
  alerts: [],
  channelStatus: mockChannelStatus(),
  channelStatusLoading: false,
  channelStatusError: null,
  channelStatusLive: false,
  parcelSummary: { ...MOCK_PARCEL_SUMMARY },
  parcelSummaryLoading: false,
  parcelSummaryError: null,
  parcelSummaryLive: false,
  ledgerFilter: "all",
  postMapQueueActiveCount: 0,
  issueSnapshotRefreshedAt: /** @type {string|null} */ (null),
};

export function setAdminOk(ok) {
  state.adminOk = ok;
}

export function setKpiLoading(loading) {
  state.kpiLoading = loading;
}

export function setKpiError(message) {
  state.kpiError = message;
}

export function setKpis(kpis, isLive = true) {
  state.kpis = kpis;
  state.kpiLive = isLive;
}

export function setLedgerLoading(loading) {
  state.ledgerLoading = loading;
}

export function setLedgerError(message) {
  state.ledgerError = message;
}

export function setLedgerEntries(entries, isLive = true) {
  state.ledgerEntries = entries;
  state.ledgerLive = isLive;
}

export function setWorkspaceLoading(loading) {
  state.workspaceLoading = loading;
}

export function setWorkspaceError(message) {
  state.workspaceError = message;
}

export function setInventoryRows(rows, isLive = true) {
  state.inventoryRows = rows;
  state.workspaceLive = isLive;
}

export function setIssuesLoading(loading) {
  state.issuesLoading = loading;
}

export function setIssuesError(message) {
  state.issuesError = message;
}

export function setIssueRows(rows, isLive = true) {
  state.issueRowsAll = rows;
  state.issueRows = filterIssuesByWorkflow(rows, state.issuesWorkflowFilter);
  state.issuesLive = isLive;
  state.alerts = buildInventoryAlerts(rows, isLive);
}

/** @param {'active'|'reviewed'|'snoozed'|'resolved'} filter */
export function setIssuesWorkflowFilter(filter) {
  state.issuesWorkflowFilter = filter;
  state.issueRows = filterIssuesByWorkflow(state.issueRowsAll, filter);
}

/** @param {string} issueType @returns {import('./state.js').InventoryIssueRow|undefined} */
export function findIssueByType(issueType) {
  return state.issueRowsAll.find((row) => row.type === issueType);
}

export function setChannelStatusLoading(loading) {
  state.channelStatusLoading = loading;
}

export function setChannelStatusError(message) {
  state.channelStatusError = message;
}

/** @param {import('./api/channelStatusApi.js').ChannelStatusData} status @param {boolean} [isLive] */
export function setChannelStatus(status, isLive = true) {
  state.channelStatus = status;
  state.channelStatusLive = isLive;
}

export function setParcelSummaryLoading(loading) {
  state.parcelSummaryLoading = loading;
}

export function setParcelSummaryError(message) {
  state.parcelSummaryError = message;
}

/** @param {import('./services/mapParcelSummary.js').ParcelReceiveSummary} summary @param {boolean} [isLive] */
export function setParcelSummary(summary, isLive = true) {
  state.parcelSummary = summary;
  state.parcelSummaryLive = isLive;
}

/** @param {'all'|'parcel'} filter */
export function setLedgerFilter(filter) {
  state.ledgerFilter = filter;
}

/** @param {number} count */
export function setPostMapQueueActiveCount(count) {
  state.postMapQueueActiveCount = count;
}

function useMockKpis(reason) {
  console.warn("[inventory] KPI live read failed — using mock fallback:", reason);
  setKpis({ ...KPI_DATA }, false);
  setKpiError(reason);
}

function useMockLedger(reason) {
  console.warn("[inventory] Ledger live read failed — using mock fallback:", reason);
  setLedgerEntries([...LEDGER_ENTRIES], false);
  setLedgerError(reason);
}

function useMockWorkspace(reason) {
  console.warn("[inventory] Workspace live read failed — using mock fallback:", reason);
  setInventoryRows([...mockInventoryRows], false);
  setWorkspaceError(reason);
}

function useMockIssues(reason) {
  console.warn("[inventory] Issues live read failed — using mock fallback:", reason);
  setIssueRows([...INVENTORY_ISSUES], false);
  setIssuesError(reason);
}

function useMockChannelStatus(reason) {
  console.warn("[inventory] Channel status live read failed — using fallback:", reason);
  setChannelStatus(mockChannelStatus(), false);
  setChannelStatusError(reason);
}

function useMockParcelSummary(reason) {
  console.warn("[inventory] Parcel summary live read failed — using fallback:", reason);
  setParcelSummary({ ...MOCK_PARCEL_SUMMARY }, false);
  setParcelSummaryError(reason);
}

export async function loadInventoryIssuesPanel() {
  setIssuesLoading(true);
  setIssuesError(null);

  const ISSUES_TIMEOUT_MS = 45000;

  try {
    const rows = await withFetchTimeout(
      fetchInventoryIssues(),
      ISSUES_TIMEOUT_MS,
      "Inventory issues",
    );
    setIssueRows(rows, true);
    setIssuesError(null);
  } catch (err) {
    useMockIssues(err instanceof Error ? err.message : String(err));
  } finally {
    setIssuesLoading(false);
  }
}

export async function loadLiveData() {
  setKpiLoading(true);
  setLedgerLoading(true);
  setWorkspaceLoading(true);
  setIssuesLoading(true);
  setChannelStatusLoading(true);
  setParcelSummaryLoading(true);
  setKpiError(null);
  setLedgerError(null);
  setWorkspaceError(null);
  setIssuesError(null);
  setChannelStatusError(null);
  setParcelSummaryError(null);

  const CORE_TIMEOUT_MS = 25000;

  const [kpiResult, ledgerResult, workspaceResult, channelResult, parcelResult] =
    await Promise.allSettled([
      withFetchTimeout(fetchInventoryKpis(), CORE_TIMEOUT_MS, "Inventory KPIs"),
      withFetchTimeout(fetchRecentLedgerEntries({ limit: 40 }), CORE_TIMEOUT_MS, "Inventory ledger"),
      withFetchTimeout(fetchInventoryWorkspace(), 45000, "Inventory workspace"),
      withFetchTimeout(fetchChannelStatus(), CORE_TIMEOUT_MS, "Channel status"),
      withFetchTimeout(fetchParcelReceiveSummary(), CORE_TIMEOUT_MS, "Parcel summary"),
    ]);

  setKpiLoading(false);
  setLedgerLoading(false);
  setWorkspaceLoading(false);
  setChannelStatusLoading(false);
  setParcelSummaryLoading(false);

  if (kpiResult.status === "fulfilled") {
    setKpis(kpiResult.value, true);
    setKpiError(null);
  } else {
    useMockKpis(
      kpiResult.reason instanceof Error ? kpiResult.reason.message : String(kpiResult.reason),
    );
  }

  if (ledgerResult.status === "fulfilled") {
    setLedgerEntries(
      ledgerResult.value.map((entry) => ({
        ...entry,
        time: formatLedgerTime(entry.time),
      })),
      true,
    );
    setLedgerError(null);
  } else {
    useMockLedger(
      ledgerResult.reason instanceof Error ? ledgerResult.reason.message : String(ledgerResult.reason),
    );
  }

  if (workspaceResult.status === "fulfilled") {
    setInventoryRows(workspaceResult.value, true);
    setWorkspaceError(null);
  } else {
    useMockWorkspace(
      workspaceResult.reason instanceof Error
        ? workspaceResult.reason.message
        : String(workspaceResult.reason),
    );
  }

  if (channelResult.status === "fulfilled") {
    setChannelStatus(channelResult.value, true);
    setChannelStatusError(null);
  } else {
    useMockChannelStatus(
      channelResult.reason instanceof Error
        ? channelResult.reason.message
        : String(channelResult.reason),
    );
  }

  if (parcelResult.status === "fulfilled") {
    setParcelSummary(parcelResult.value, true);
    setParcelSummaryError(null);
  } else {
    useMockParcelSummary(
      parcelResult.reason instanceof Error
        ? parcelResult.reason.message
        : String(parcelResult.reason),
    );
  }

  // Issues view is the heaviest query — load after core panels to avoid connection pile-up.
  await new Promise((resolve) => setTimeout(resolve, 400));
  await loadInventoryIssuesPanel();
  state.issueSnapshotRefreshedAt = await fetchIssueSnapshotRefreshedAt().catch(() => null);

  try {
    const { fetchPostMapQueueCounts } = await import("./api/postMapQueueApi.js");
    setPostMapQueueActiveCount((await fetchPostMapQueueCounts()).active);
  } catch {
    setPostMapQueueActiveCount(0);
  }
}

/** Lighter refresh after mapping/finalize — skips channel/parcel; includes ledger. */
export async function reloadInventoryAfterMappingChange() {
  setKpiLoading(true);
  setWorkspaceLoading(true);
  setLedgerLoading(true);
  setKpiError(null);
  setWorkspaceError(null);
  setLedgerError(null);

  const CORE_TIMEOUT_MS = 20000;

  const [kpiResult, workspaceResult, ledgerResult] = await Promise.allSettled([
    withFetchTimeout(fetchInventoryKpis(), CORE_TIMEOUT_MS, "Inventory KPIs"),
    withFetchTimeout(fetchInventoryWorkspace(), 35000, "Inventory workspace"),
    withFetchTimeout(fetchRecentLedgerEntries({ limit: 40 }), CORE_TIMEOUT_MS, "Inventory ledger"),
  ]);

  setKpiLoading(false);
  setWorkspaceLoading(false);
  setLedgerLoading(false);

  if (kpiResult.status === "fulfilled") {
    setKpis(kpiResult.value, true);
    setKpiError(null);
  } else {
    useMockKpis(
      kpiResult.reason instanceof Error ? kpiResult.reason.message : String(kpiResult.reason),
    );
  }

  if (workspaceResult.status === "fulfilled") {
    setInventoryRows(workspaceResult.value, true);
    setWorkspaceError(null);
  } else {
    useMockWorkspace(
      workspaceResult.reason instanceof Error
        ? workspaceResult.reason.message
        : String(workspaceResult.reason),
    );
  }

  if (ledgerResult.status === "fulfilled") {
    setLedgerEntries(
      ledgerResult.value.map((entry) => ({
        ...entry,
        time: formatLedgerTime(entry.time),
      })),
      true,
    );
    setLedgerError(null);
  } else {
    useMockLedger(
      ledgerResult.reason instanceof Error ? ledgerResult.reason.message : String(ledgerResult.reason),
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  await loadInventoryIssuesPanel();

  try {
    const { fetchPostMapQueueCounts } = await import("./api/postMapQueueApi.js");
    setPostMapQueueActiveCount((await fetchPostMapQueueCounts()).active);
  } catch {
    setPostMapQueueActiveCount(0);
  }
}

export const loadReadOnlyPanels = loadLiveData;

/**
 * Returns dashboard paginated worklist controller (Phase 10X).
 */

import {
  fetchReturnsRestockDashboardWorklistPage,
  buildWorklistPageParams,
} from "../api/returnsRestockDashboardApi.js";

/** @typedef {import('./returnsRestockDashboardPresets.js').DashboardFilterState & {
 *   groupedView?: boolean;
 *   pageSize?: number;
 *   offset?: number;
 * }} DashboardPageState */

/**
 * @param {DashboardPageState} state
 * @param {{ seekTarget?: boolean }} [opts]
 */
export async function loadWorklistPage(state, opts = {}) {
  const params = buildWorklistPageParams(state, {
    offset: state.offset ?? 0,
    limit: state.pageSize ?? 50,
    seekTarget: opts.seekTarget ?? false,
  });
  return fetchReturnsRestockDashboardWorklistPage(params);
}

/** @param {DashboardPageState} state */
export function hasTargetKeys(state) {
  return Boolean(
    state.reservationId || state.orderId || state.observationId || state.restockActionId,
  );
}

/**
 * @param {Awaited<ReturnType<typeof loadWorklistPage>>} page
 * @param {DashboardPageState} state
 * @param {boolean} seekApplied
 */
export function resolveTargetHighlight(page, state, seekApplied = false) {
  if (page.targetFound && page.targetRow) {
    return {
      highlightRowId: page.targetRow.rowId,
      offset: page.offset,
      notFoundMessage: null,
      showLoadTarget: false,
      targetOffset: page.targetOffset,
    };
  }
  if (hasTargetKeys(state) && !page.targetFound) {
    return {
      highlightRowId: null,
      offset: state.offset ?? 0,
      notFoundMessage: `Target not found in filtered worklist. It may be completed, snoozed, or outside current filters.`,
      showLoadTarget: false,
      targetOffset: null,
    };
  }
  if (page.targetFound && page.targetOffset != null && page.targetOffset !== (state.offset ?? 0) && !seekApplied) {
    return {
      highlightRowId: null,
      offset: state.offset ?? 0,
      notFoundMessage: null,
      showLoadTarget: true,
      targetOffset: page.targetOffset,
    };
  }
  return {
    highlightRowId: null,
    offset: state.offset ?? 0,
    notFoundMessage: null,
    showLoadTarget: false,
    targetOffset: null,
  };
}

/** @param {Record<string, unknown>|null|undefined} buckets */
export function channelOptionsFromBuckets(buckets) {
  const by = buckets?.by_channel;
  if (!by || typeof by !== "object") return [];
  return Object.keys(by).sort();
}

/** @param {Record<string, unknown>|null|undefined} buckets */
export function statusOptionsFromBuckets(buckets) {
  const by = buckets?.by_status;
  if (!by || typeof by !== "object") return [];
  return Object.keys(by).sort();
}

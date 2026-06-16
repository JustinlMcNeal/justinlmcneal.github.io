/**
 * Returns dashboard URL deep-link parse/build (Phase 10V).
 */

export const DASHBOARD_OPEN_PARAM = "returns_dashboard";

const TAB_ALIASES = {
  followups: "followup",
  followup: "followup",
  ready: "ready",
  ready_to_restock: "ready",
  returns: "returns",
  return: "returns",
  rma: "returns",
  audit: "audit",
  worklist: "worklist",
};

/** @param {string|null|undefined} raw */
export function normalizeDashboardTab(raw) {
  if (!raw) return "worklist";
  return TAB_ALIASES[raw.toLowerCase()] || raw;
}

/**
 * @param {string} [search]
 * @returns {import('./returnsRestockDashboardPresets.js').DashboardFilterState|null}
 */
export function parseDashboardParams(search = location.search) {
  const p = new URLSearchParams(search);
  if (p.get(DASHBOARD_OPEN_PARAM) !== "1") return null;

  return {
    tab: normalizeDashboardTab(p.get("tab")),
    channel: p.get("channel") || "",
    status: p.get("status") || "",
    search: p.get("q") || "",
    staleOnly: p.get("stale_only") === "1",
    priorityMax: p.get("priority") || "",
    rowType: p.get("row_type") || "",
    reservationId: p.get("reservation_id") || "",
    orderId: p.get("order_id") || "",
    observationId: p.get("observation_id") || "",
    restockActionId: p.get("restock_action_id") || p.get("followup_id") || "",
    pageSize: Number(p.get("page_size")) || 50,
    offset: p.get("page")
      ? (Math.max(Number(p.get("page")) || 1, 1) - 1) * (Number(p.get("page_size")) || 50)
      : Number(p.get("offset") || 0),
  };
}

/**
 * @param {Partial<import('./returnsRestockDashboardPresets.js').DashboardFilterState>} state
 * @param {{ absolute?: boolean }} [opts]
 */
export function buildDashboardUrl(state, opts = {}) {
  const p = new URLSearchParams();
  p.set(DASHBOARD_OPEN_PARAM, "1");
  if (state.tab && state.tab !== "worklist") p.set("tab", state.tab);
  if (state.channel) p.set("channel", state.channel);
  if (state.status) p.set("status", state.status);
  if (state.search) p.set("q", state.search);
  if (state.staleOnly) p.set("stale_only", "1");
  if (state.priorityMax) p.set("priority", state.priorityMax);
  if (state.rowType) p.set("row_type", state.rowType);
  if (state.reservationId) p.set("reservation_id", state.reservationId);
  if (state.orderId) p.set("order_id", state.orderId);
  if (state.observationId) p.set("observation_id", state.observationId);
  if (state.restockActionId) p.set("restock_action_id", state.restockActionId);
  if (state.pageSize && state.pageSize !== 50) p.set("page_size", String(state.pageSize));
  if (state.offset && state.pageSize) {
    const page = Math.floor(state.offset / state.pageSize) + 1;
    if (page > 1) p.set("page", String(page));
  }

  const qs = p.toString();
  const path = "/pages/admin/inventory.html";
  if (opts.absolute) return `${location.origin}${path}?${qs}`;
  return `${path}?${qs}`;
}

/** Sync browser URL without reload. */
export function replaceDashboardUrl(state) {
  const url = buildDashboardUrl(state);
  history.replaceState(null, "", url);
}

/**
 * @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>[]} rows
 * @param {Partial<import('./returnsRestockDashboardPresets.js').DashboardFilterState>} target
 */
export function findHighlightTarget(rows, target) {
  if (target.restockActionId) {
    const hit = rows.find((r) => r.restockActionId === target.restockActionId);
    if (hit) return { row: hit, reason: null };
  }
  if (target.reservationId) {
    const hit = rows.find((r) => r.reservationId === target.reservationId);
    if (hit) return { row: hit, reason: null };
  }
  if (target.observationId) {
    const hit = rows.find((r) => r.observationId === target.observationId);
    if (hit) return { row: hit, reason: null };
  }
  if (target.orderId) {
    const hit = rows.find((r) => r.sourceOrderId === target.orderId);
    if (hit) return { row: hit, reason: null };
  }

  const idHint =
    target.restockActionId ||
    target.reservationId ||
    target.observationId ||
    target.orderId ||
    "";
  if (idHint) {
    return {
      row: null,
      reason: `Target row not found (${idHint}). It may be completed, snoozed, or outside the current worklist window.`,
    };
  }
  return { row: null, reason: null };
}

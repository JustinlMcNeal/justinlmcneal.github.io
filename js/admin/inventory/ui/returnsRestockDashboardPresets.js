/**
 * Returns dashboard filter presets (Phase 10V — static + localStorage user presets).
 */

/** @typedef {{
 *   tab: string;
 *   channel: string;
 *   status: string;
 *   search: string;
 *   staleOnly: boolean;
 *   priorityMax: string;
 *   rowType: string;
 *   reservationId?: string;
 *   orderId?: string;
 *   observationId?: string;
 *   restockActionId?: string;
 * }} DashboardFilterState */

const LS_KEY = "inventory_returns_dashboard_presets_v1";

/** @type {Array<{ id: string; label: string; builtin: true } & DashboardFilterState>} */
export const STATIC_PRESETS = [
  {
    id: "ready",
    label: "Ready to Restock",
    builtin: true,
    tab: "ready",
    channel: "",
    status: "",
    search: "",
    staleOnly: false,
    priorityMax: "",
    rowType: "",
  },
  {
    id: "physical",
    label: "Needs Physical Confirmation",
    builtin: true,
    tab: "worklist",
    channel: "",
    status: "needs_physical_confirmation",
    search: "",
    staleOnly: false,
    priorityMax: "",
    rowType: "restock_assist",
  },
  {
    id: "stale",
    label: "Stale Observations",
    builtin: true,
    tab: "worklist",
    channel: "",
    status: "",
    search: "",
    staleOnly: true,
    priorityMax: "",
    rowType: "",
  },
  {
    id: "followups",
    label: "Open Channel Follow-Ups",
    builtin: true,
    tab: "followup",
    channel: "",
    status: "",
    search: "",
    staleOnly: false,
    priorityMax: "",
    rowType: "",
  },
  {
    id: "manual",
    label: "Manual Review",
    builtin: true,
    tab: "worklist",
    channel: "",
    status: "",
    search: "",
    staleOnly: false,
    priorityMax: "",
    rowType: "manual_review",
  },
  {
    id: "recent",
    label: "Recent Restocks",
    builtin: true,
    tab: "audit",
    channel: "",
    status: "",
    search: "",
    staleOnly: false,
    priorityMax: "",
    rowType: "",
  },
  {
    id: "amazon",
    label: "Amazon Attention",
    builtin: true,
    tab: "worklist",
    channel: "amazon",
    status: "",
    search: "",
    staleOnly: false,
    priorityMax: "250",
    rowType: "",
  },
  {
    id: "ebay",
    label: "eBay Attention",
    builtin: true,
    tab: "worklist",
    channel: "ebay",
    status: "",
    search: "",
    staleOnly: false,
    priorityMax: "250",
    rowType: "",
  },
];

/** @returns {Array<{ id: string; label: string; builtin?: boolean } & DashboardFilterState>} */
export function loadAllPresets() {
  return [...STATIC_PRESETS, ...loadUserPresets()];
}

/** @returns {Array<{ id: string; label: string; builtin?: boolean } & DashboardFilterState>} */
export function loadUserPresets() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p?.id && p?.label);
  } catch {
    return [];
  }
}

/** @param {DashboardFilterState & { label: string }} preset */
export function saveUserPreset(preset) {
  const existing = loadUserPresets();
  const id = `user_${Date.now()}`;
  const entry = { ...preset, id, builtin: false };
  localStorage.setItem(LS_KEY, JSON.stringify([entry, ...existing].slice(0, 12)));
  return entry;
}

/** @param {string} id */
export function deleteUserPreset(id) {
  const next = loadUserPresets().filter((p) => p.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

/** @param {string} id */
export function getPresetById(id) {
  return loadAllPresets().find((p) => p.id === id) ?? null;
}

/** @param {DashboardFilterState} current */
export function promptSaveCurrentPreset(current) {
  const label = window.prompt("Preset name:");
  if (!label?.trim()) return null;
  return saveUserPreset({ ...current, label: label.trim() });
}

/** @param {(id: string) => string} esc */
export function renderPresetButtonsHtml(esc) {
  return loadAllPresets()
    .map(
      (p) =>
        `<button type="button" data-rrd-preset="${esc(p.id)}" class="text-[8px] font-black uppercase border border-violet-300 text-violet-900 bg-violet-50 px-2 py-0.5 rounded hover:bg-violet-100">${esc(p.label)}</button>`,
    )
    .join("");
}

import { qs, qsa, show, hide } from "./dom.js";
import { closeAmazonModals } from "./modals.js";

const STORAGE_KEY = "kk-amazon-listings-table-settings-v1";

/** @typedef {"comfortable" | "compact"} AmazonTableDensity */

/**
 * @typedef {{
 *   density: AmazonTableDensity,
 *   columns: Record<string, boolean>,
 * }} AmazonTableSettings
 */

/** @type {Array<{ id: string, label: string, locked?: boolean, defaultVisible?: boolean, breakpoint?: "xl" | "2xl" }>} */
export const AMAZON_LISTING_TABLE_COLUMNS = [
  { id: "select", label: "Select", locked: true },
  { id: "product", label: "Product (title, variant, SKU, ASIN, actions)", locked: true },
  { id: "price", label: "Price", defaultVisible: true },
  { id: "amazonFee", label: "Amazon Fee", defaultVisible: true, breakpoint: "xl" },
  { id: "profit", label: "Est. Profit", defaultVisible: true },
  { id: "fulfillment", label: "Fulfillment", defaultVisible: true, breakpoint: "xl" },
  { id: "inventory", label: "Inventory", defaultVisible: true },
  { id: "fbaReserved", label: "FBA Reserved", defaultVisible: false, breakpoint: "2xl" },
  { id: "fbaInbound", label: "FBA Inbound", defaultVisible: false, breakpoint: "2xl" },
  { id: "status", label: "Status", defaultVisible: true },
  { id: "lastSynced", label: "Last Synced", defaultVisible: true, breakpoint: "xl" },
];

const TOGGLEABLE_COLUMNS = AMAZON_LISTING_TABLE_COLUMNS.filter((col) => !col.locked);

/** @returns {AmazonTableSettings} */
export function defaultAmazonTableSettings() {
  /** @type {Record<string, boolean>} */
  const columns = {};
  for (const col of TOGGLEABLE_COLUMNS) {
    columns[col.id] = col.defaultVisible !== false;
  }
  return { density: "comfortable", columns };
}

/** @param {unknown} value @returns {AmazonTableSettings} */
function normalizeSettings(value) {
  const defaults = defaultAmazonTableSettings();
  if (!value || typeof value !== "object") return defaults;

  const raw = /** @type {Record<string, unknown>} */ (value);
  const density = raw.density === "compact" ? "compact" : "comfortable";
  /** @type {Record<string, boolean>} */
  const columns = { ...defaults.columns };

  if (raw.columns && typeof raw.columns === "object") {
    const saved = /** @type {Record<string, unknown>} */ (raw.columns);
    for (const col of TOGGLEABLE_COLUMNS) {
      if (typeof saved[col.id] === "boolean") {
        columns[col.id] = saved[col.id];
      }
    }
  }

  return { density, columns };
}

/** @returns {AmazonTableSettings} */
export function loadAmazonTableSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAmazonTableSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaultAmazonTableSettings();
  }
}

/** @param {AmazonTableSettings} settings */
export function saveAmazonTableSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** @type {AmazonTableSettings} */
let currentSettings = defaultAmazonTableSettings();

/** @returns {AmazonTableSettings} */
export function getAmazonTableSettings() {
  return {
    density: currentSettings.density,
    columns: { ...currentSettings.columns },
  };
}

/** @param {Partial<AmazonTableSettings>} patch */
export function patchAmazonTableSettings(patch) {
  currentSettings = normalizeSettings({
    ...currentSettings,
    ...patch,
    columns: {
      ...currentSettings.columns,
      ...(patch.columns || {}),
    },
  });
  saveAmazonTableSettings(currentSettings);
  applyAmazonTableSettings();
}

/** @param {AmazonTableSettings} settings */
export function setAmazonTableSettings(settings) {
  currentSettings = normalizeSettings(settings);
  saveAmazonTableSettings(currentSettings);
  applyAmazonTableSettings();
}

export function resetAmazonTableSettings() {
  setAmazonTableSettings(defaultAmazonTableSettings());
}

/** @param {string} columnId @param {AmazonTableSettings} settings */
function isColumnVisible(columnId, settings) {
  const col = AMAZON_LISTING_TABLE_COLUMNS.find((entry) => entry.id === columnId);
  if (!col || col.locked) return true;
  return settings.columns[columnId] !== false;
}

/** @param {AmazonTableSettings} settings */
export function applyAmazonTableSettings(settings = currentSettings) {
  currentSettings = normalizeSettings(settings);

  const table = qs("#amazonListingsTable");
  if (table) {
    table.classList.toggle("amazon-table-density-compact", currentSettings.density === "compact");
    table.classList.toggle("amazon-table-density-comfortable", currentSettings.density !== "compact");
  }

  qsa("[data-amazon-col]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const columnId = el.dataset.amazonCol || "";
    const col = AMAZON_LISTING_TABLE_COLUMNS.find((entry) => entry.id === columnId);
    if (!col) return;

    const visible = isColumnVisible(columnId, currentSettings);
    el.classList.toggle("amazon-col-hidden", !visible);
    el.classList.toggle(
      "amazon-col-force-show",
      visible && Boolean(col.breakpoint) && col.defaultVisible === false,
    );
  });

  qsa("[data-amazon-mobile-col]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const columnId = el.dataset.amazonMobileCol || "";
    const visible = isColumnVisible(columnId, currentSettings);
    el.classList.toggle("hidden", !visible);
  });
}

function syncModalControls() {
  const densityComfortable = qs("#amazonTableDensityComfortable");
  const densityCompact = qs("#amazonTableDensityCompact");
  if (densityComfortable instanceof HTMLInputElement) {
    densityComfortable.checked = currentSettings.density === "comfortable";
  }
  if (densityCompact instanceof HTMLInputElement) {
    densityCompact.checked = currentSettings.density === "compact";
  }

  for (const col of TOGGLEABLE_COLUMNS) {
    const input = qs(`#amazonTableCol_${col.id}`);
    if (input instanceof HTMLInputElement) {
      input.checked = currentSettings.columns[col.id] !== false;
    }
  }
}

function readModalControls() {
  const densityCompact = qs("#amazonTableDensityCompact");
  /** @type {AmazonTableDensity} */
  const density = densityCompact instanceof HTMLInputElement && densityCompact.checked
    ? "compact"
    : "comfortable";

  /** @type {Record<string, boolean>} */
  const columns = {};
  for (const col of TOGGLEABLE_COLUMNS) {
    const input = qs(`#amazonTableCol_${col.id}`);
    columns[col.id] = input instanceof HTMLInputElement ? input.checked : col.defaultVisible !== false;
  }

  return { density, columns };
}

function renderColumnCheckboxes() {
  const container = qs("#amazonTableColumnList");
  if (!container) return;

  container.innerHTML = TOGGLEABLE_COLUMNS.map((col) => {
    const hint = col.breakpoint
      ? `<span class="text-[10px] text-gray-400 font-medium"> · shows at ${col.breakpoint}+ when enabled</span>`
      : "";
    return `
      <label class="flex items-start gap-2 py-1.5 cursor-pointer">
        <input
          type="checkbox"
          id="amazonTableCol_${col.id}"
          data-amazon-table-col="${col.id}"
          class="mt-0.5 w-4 h-4 border-2 border-black rounded-sm"
        />
        <span class="text-xs font-medium leading-snug">${col.label}${hint}</span>
      </label>
    `;
  }).join("");
}

/** @param {HTMLElement | null | undefined} trigger */
export function openAmazonTableSettingsModal(trigger) {
  const modal = qs("#amazonTableSettingsModal");
  if (!modal) return;

  closeAmazonModals();
  syncModalControls();
  show(modal);
  modal.setAttribute("aria-hidden", "false");

  const title = modal.querySelector("h2[id]");
  if (title instanceof HTMLElement) {
    title.setAttribute("tabindex", "-1");
    title.focus({ preventScroll: true });
  }

  if (trigger instanceof HTMLElement) {
    modal.dataset.lastTrigger = trigger.id || "";
  }
}

function closeTableSettingsModal() {
  const modal = qs("#amazonTableSettingsModal");
  if (!modal || modal.classList.contains("hidden")) return;
  hide(modal);
  modal.setAttribute("aria-hidden", "true");
}

/**
 * @param {{ onChange?: () => void }} [options]
 */
export function initAmazonTableSettings(options = {}) {
  currentSettings = loadAmazonTableSettings();
  renderColumnCheckboxes();
  applyAmazonTableSettings();

  const openBtn = qs('[data-action="table-settings"]');

  if (openBtn instanceof HTMLButtonElement) {
    openBtn.disabled = false;
    openBtn.removeAttribute("aria-disabled");
    openBtn.classList.remove("bg-gray-50", "text-gray-400", "cursor-not-allowed");
    openBtn.classList.add("bg-white", "text-black", "hover:bg-gray-50");
    openBtn.title = "Table density and column visibility";
  }

  openBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    openAmazonTableSettingsModal(openBtn instanceof HTMLElement ? openBtn : null);
  });

  qs('[data-action="apply-table-settings"]')?.addEventListener("click", (event) => {
    event.preventDefault();
    setAmazonTableSettings(readModalControls());
    options.onChange?.();
    closeTableSettingsModal();
  });

  qs('[data-action="reset-table-settings"]')?.addEventListener("click", (event) => {
    event.preventDefault();
    resetAmazonTableSettings();
    syncModalControls();
    options.onChange?.();
  });

  return {
    applySettings: applyAmazonTableSettings,
    getSettings: getAmazonTableSettings,
    openModal: openAmazonTableSettingsModal,
  };
}

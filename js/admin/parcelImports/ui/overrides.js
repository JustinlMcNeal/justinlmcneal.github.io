/** Charge override section — editable local state (Phase 2). */

import { getDom, queryOverrideField } from "../dom.js";
import {
  getState,
  setOverrideValidation,
  updateOverrideField,
} from "../state.js";
import { formatCny, formatGrams } from "../parser/normalizers.js";
import {
  isOverrideDirty,
  OVERRIDE_ERROR_RE,
  validateOverrides,
} from "../validation/overrideValidators.js";
import { renderCpiPreviewFromState } from "./cpiPreviewPanel.js";

const DASH = "—";
let listenersBound = false;

const INPUT_DIRTY_CLASSES = ["border-amber-500", "bg-amber-50/40"];
const INPUT_WARN_CLASSES = ["border-red-300", "bg-red-50/30"];
const INPUT_STATE_CLASSES = [...INPUT_DIRTY_CLASSES, ...INPUT_WARN_CLASSES];

/**
 * @param {object | null} parcel
 */
export function renderChargeOverrides(parcel) {
  if (!parcel) return;
  renderXlsColumn(parcel);
  renderOverrideInputs();
  refreshOverrideUi();
}

export function clearChargeOverrides() {
  const xlsKeys = [
    "parcelWeightXls",
    "chargedWeightXls",
    "shipmentFeeXls",
    "serviceFeeXls",
    "insuranceXls",
    "totalChargeXls",
    "fxRateXls",
    "usdXls",
  ];
  xlsKeys.forEach((key) => setXlsText(key, DASH));

  const inputKeys = [
    "parcelWeightGrams",
    "chargedWeightGrams",
    "shipmentFeeCny",
    "serviceFeeCny",
    "insuranceCny",
    "totalParcelChargeCny",
    "effectiveFxRate",
    "usdEquivalent",
  ];
  inputKeys.forEach((key) => setInputValue(key, null));
  setInsuranceSelect(null);

  const { overrideValidationEl } = getDom();
  if (overrideValidationEl) {
    overrideValidationEl.textContent = "";
    overrideValidationEl.classList.add("hidden");
  }
}

export function initOverrideListeners() {
  if (listenersBound) return;
  const { overridesRoot } = getDom();
  if (!overridesRoot) return;

  overridesRoot.addEventListener("input", onOverrideEvent);
  overridesRoot.addEventListener("change", onOverrideEvent);
  listenersBound = true;
}

function onOverrideEvent(e) {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
  const key = el.getAttribute("data-override-key");
  if (!key) return;

  if (e.type === "input" && el instanceof HTMLInputElement && isPartialDecimalEntry(el.value)) {
    refreshOverrideUi();
    return;
  }

  const value = parseOverrideInput(key, el);
  updateOverrideField(key, value);
  maybeDeriveFxRate(key);
  refreshOverrideUi();
}

/** @param {string} changedKey */
function maybeDeriveFxRate(changedKey) {
  if (!["totalParcelChargeCny", "usdEquivalent"].includes(changedKey)) return;
  const { overrides } = getState();
  if (overrides?.effectiveFxRate != null) return;
  const total = overrides?.totalParcelChargeCny;
  const usd = overrides?.usdEquivalent;
  if (total != null && total > 0 && usd != null && usd > 0) {
    const derived = total / usd;
    updateOverrideField("effectiveFxRate", derived);
    setInputValue("effectiveFxRate", derived);
  }
}

/**
 * @param {string} key
 * @param {HTMLInputElement | HTMLSelectElement} el
 */
function parseOverrideInput(key, el) {
  if (key === "insuranceYes") {
    const v = el.value;
    if (v === "yes") return true;
    if (v === "no") return false;
    return null;
  }
  return parseDecimalInput(el.value);
}

/** @param {string} raw */
function isPartialDecimalEntry(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed) return false;
  return /^-?\d+[.,]$/.test(trimmed.replace(/,/g, "."));
}

/** @param {string} raw */
function parseDecimalInput(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, ".");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function renderOverrideInputs() {
  const { overrides } = getState();
  if (!overrides) return;

  setInputValue("parcelWeightGrams", overrides.parcelWeightGrams);
  setInputValue("chargedWeightGrams", overrides.chargedWeightGrams);
  setInputValue("shipmentFeeCny", overrides.shipmentFeeCny);
  setInputValue("serviceFeeCny", overrides.serviceFeeCny);
  setInsuranceSelect(overrides.insuranceYes);
  setInputValue("insuranceCny", overrides.insuranceCny);
  setInputValue("totalParcelChargeCny", overrides.totalParcelChargeCny);
  setInputValue("effectiveFxRate", overrides.effectiveFxRate);
  setInputValue("usdEquivalent", overrides.usdEquivalent);
}

/**
 * @param {object} parcel
 */
function renderXlsColumn(parcel) {
  setXlsText(
    "parcelWeightXls",
    formatGrams(parcel.parcelWeightGrams),
  );
  setXlsText(
    "chargedWeightXls",
    parcel.chargedWeightGrams != null
      ? formatGrams(parcel.chargedWeightGrams)
      : DASH,
  );
  setXlsText("shipmentFeeXls", formatCny(parcel.shipmentFeeCny));
  setXlsText("serviceFeeXls", formatCny(parcel.serviceFeeCny));
  setXlsText("insuranceXls", formatInsuranceXls(parcel));
  setXlsText("totalChargeXls", formatTotalXls(parcel));
  setXlsText("fxRateXls", DASH);
  setXlsText("usdXls", DASH);
}

function formatInsuranceXls(parcel) {
  if (parcel.insuranceYes) return "Yes";
  if (parcel.insuranceYes === false) return "No";
  if (parcel.insuranceCny != null) return formatCny(parcel.insuranceCny);
  return parcel.insuranceLabel || DASH;
}

/**
 * @param {object} parcel
 */
function formatTotalXls(parcel) {
  if (parcel.totalParcelChargeCny != null) {
    return formatCny(parcel.totalParcelChargeCny);
  }
  if (parcel.shipmentFeeCny != null) return formatCny(parcel.shipmentFeeCny);
  return DASH;
}

function refreshOverrideUi() {
  const state = getState();
  const validation = validateOverrides(
    state.overrides,
    state.xlsBaseline,
  );
  setOverrideValidation(validation);

  applyFieldChrome("parcelWeightGrams", validation);
  applyFieldChrome("chargedWeightGrams", validation);
  applyFieldChrome("shipmentFeeCny", validation);
  applyFieldChrome("serviceFeeCny", validation);
  applyFieldChrome("insuranceYes", validation);
  applyFieldChrome("insuranceCny", validation);
  applyFieldChrome("totalParcelChargeCny", validation);
  applyFieldChrome("effectiveFxRate", validation);
  applyFieldChrome("usdEquivalent", validation);

  syncChargedWeightRowUi();
  renderGlobalOverrideMessages(validation);
  renderCpiPreviewFromState();
}

function applyFieldChrome(key, validation) {
  const { overrides, xlsBaseline } = getState();
  const dirty =
    overrides?.dirtyFields?.[key] ||
    isOverrideDirty(key, overrides?.[key], xlsBaseline?.[key]);
  const msgs = validation.fieldMessages[key] || [];
  const hasError = msgs.some((m) => OVERRIDE_ERROR_RE.test(m));

  const wrap = document.querySelector(`[data-override-wrap="${key}"]`);
  const edited = document.querySelector(`[data-override-edited="${key}"]`);
  const msgEl = document.querySelector(`[data-override-msg="${key}"]`);
  const input = document.querySelector(`[data-override-key="${key}"]`);

  if (edited) {
    edited.classList.toggle("hidden", !dirty);
  }
  if (wrap) {
    wrap.classList.toggle("border-amber-500", dirty && !hasError);
    wrap.classList.toggle("bg-amber-50/30", dirty && !hasError);
  }
  if (
    input &&
    (input instanceof HTMLInputElement || input instanceof HTMLSelectElement)
  ) {
    input.classList.remove(...INPUT_STATE_CLASSES);
    if (hasError) input.classList.add(...INPUT_WARN_CLASSES);
    else if (dirty) input.classList.add(...INPUT_DIRTY_CLASSES);
  }
  if (msgEl) {
    if (msgs.length) {
      msgEl.textContent = msgs.join(" ");
      msgEl.classList.remove("hidden");
      msgEl.classList.toggle("text-red-700", hasError);
      msgEl.classList.toggle("text-amber-800", !hasError);
    } else {
      msgEl.textContent = "";
      msgEl.classList.add("hidden");
    }
  }
}

function syncChargedWeightRowUi() {
  const { overrides, xlsBaseline } = getState();
  const { chargedWeightRow, chargedWeightHint, chargedWeightMissingNote } =
    getDom();

  const pw = overrides?.parcelWeightGrams;
  const cw = overrides?.chargedWeightGrams;
  const xlsCw = xlsBaseline?.chargedWeightGrams;

  const hasOverrideCharged = cw != null && cw > 0;
  const volumeApply =
    hasOverrideCharged && pw != null && pw > 0 && cw > pw;

  if (chargedWeightRow) {
    chargedWeightRow.classList.toggle("bg-amber-50/80", volumeApply);
    chargedWeightRow.classList.toggle("border", volumeApply);
    chargedWeightRow.classList.toggle("border-amber-200", volumeApply);
    chargedWeightRow.classList.toggle("rounded-xl", volumeApply);
  }
  if (chargedWeightHint) {
    chargedWeightHint.hidden = !volumeApply;
    if (volumeApply) {
      chargedWeightHint.textContent =
        "Volume weight likely applied — charged weight exceeds parcel weight.";
    }
  }
  if (chargedWeightMissingNote) {
    const showMissing = !hasOverrideCharged && xlsCw == null;
    chargedWeightMissingNote.hidden = !showMissing;
    if (showMissing) {
      chargedWeightMissingNote.textContent = "Not provided by export — enter actual charged weight.";
    }
  }
}

/**
 * @param {{ fieldMessages: object, globalWarnings: string[] }} validation
 */
function renderGlobalOverrideMessages(validation) {
  const { overrideValidationEl } = getDom();
  if (!overrideValidationEl) return;

  const lines = [...validation.globalWarnings];
  if (!lines.length) {
    overrideValidationEl.hidden = true;
    overrideValidationEl.innerHTML = "";
    return;
  }

  overrideValidationEl.hidden = false;
  overrideValidationEl.innerHTML = lines
    .map((l) => `<p class="text-[11px] text-amber-900">• ${escapeHtml(l)}</p>`)
    .join("");
}

/**
 * @param {string} key
 * @param {number | null} value
 */
function setInputValue(key, value) {
  const el = document.querySelector(`[data-override-key="${key}"]`);
  if (!el || !(el instanceof HTMLInputElement)) return;
  if (document.activeElement === el) return;
  el.value = value == null || !Number.isFinite(value) ? "" : String(value);
}

/**
 * @param {boolean | null} value
 */
function setInsuranceSelect(value) {
  const el = document.querySelector('[data-override-key="insuranceYes"]');
  if (!el || !(el instanceof HTMLSelectElement)) return;
  if (value === true) el.value = "yes";
  else if (value === false) el.value = "no";
  else el.value = "unknown";
}

function setXlsText(fieldKey, text) {
  const el = queryOverrideField(fieldKey);
  if (el) el.textContent = text ?? DASH;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

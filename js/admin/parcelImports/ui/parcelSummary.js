/** Render parsed parcel into summary data-field hooks. */

import { querySummaryField } from "../dom.js";
import { getState } from "../state.js";
import {
  formatCny,
  formatGrams,
  formatPcs,
  normalizeText,
} from "../parser/normalizers.js";

/**
 * @param {object | null} parcel
 * @param {{ name?: string }} [fileMeta]
 */
const SUMMARY_KEYS = [
  "parcelId",
  "sourceFileName",
  "importDate",
  "source",
  "totalItems",
  "parcelWeightGrams",
  "chargedWeightGrams",
  "totalItemFeeCny",
  "shipmentFeeCny",
  "insurance",
  "totalParcelChargeCny",
];

export function clearParcelSummary() {
  SUMMARY_KEYS.forEach((key) => setField(key, "—"));
  setField("status", "");
  const badges = document.getElementById("parcelSummaryStatusBadges");
  if (badges) badges.classList.add("hidden");
}

/**
 * Merge charge overrides into the Upload-tab summary so edits show immediately
 * (not only after Save Draft / reload).
 */
export function syncParcelSummaryFromOverrides() {
  const { parcel, overrides, currentFile } = getState();
  if (!parcel) return;

  const effective = {
    ...parcel,
    parcelWeightGrams:
      overrides?.parcelWeightGrams ?? parcel.parcelWeightGrams,
    chargedWeightGrams:
      overrides?.chargedWeightGrams ?? parcel.chargedWeightGrams,
    shipmentFeeCny: overrides?.shipmentFeeCny ?? parcel.shipmentFeeCny,
    insuranceYes:
      overrides?.insuranceYes !== undefined && overrides?.insuranceYes !== null
        ? overrides.insuranceYes
        : parcel.insuranceYes,
    insuranceCny: overrides?.insuranceCny ?? parcel.insuranceCny,
    totalParcelChargeCny:
      overrides?.totalParcelChargeCny ??
      parcel.totalParcelChargeCny ??
      (parcel.shipmentFeeCny != null ? parcel.shipmentFeeCny : null),
  };

  renderParcelSummary(effective, {
    name: parcel.sourceFileName || currentFile?.name,
  });
}

export function renderParcelSummary(parcel, fileMeta = {}) {
  if (!parcel) return;

  const badges = document.getElementById("parcelSummaryStatusBadges");
  if (badges) badges.classList.remove("hidden");

  setField("parcelId", parcel.parcelId || "—");
  setField("sourceFileName", parcel.sourceFileName || fileMeta.name || "—");
  setField("importDate", parcel.importedAt || "—");
  setField("source", "Baestao HTML-table export");
  setField("totalItems", formatPcs(parcel.totalItems));
  setField("parcelWeightGrams", formatGrams(parcel.parcelWeightGrams));
  setField("chargedWeightGrams", formatGrams(parcel.chargedWeightGrams));
  setField("totalItemFeeCny", formatCny(parcel.totalItemFeeCny));
  setField("shipmentFeeCny", formatCny(parcel.shipmentFeeCny));
  setField(
    "insurance",
    parcel.insuranceYes
      ? "Yes"
      : parcel.insuranceYes === false
        ? "No"
        : parcel.insuranceCny != null
          ? formatCny(parcel.insuranceCny)
          : parcel.insuranceLabel || "—",
  );
  const totalCharge =
    parcel.totalParcelChargeCny != null
      ? parcel.totalParcelChargeCny
      : parcel.shipmentFeeCny != null
        ? parcel.shipmentFeeCny
        : null;
  setField("totalParcelChargeCny", formatCny(totalCharge));
  const status = parcel.status
    ? String(parcel.status).replace(/_/g, " ")
    : "Needs Review";
  setField("status", status);
}

function setField(key, value) {
  const el = querySummaryField(key);
  if (!el) return;
  const text = value == null ? "—" : String(value);
  if (key === "status") {
    if (!text || text === "—") {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<span class="text-[10px] font-black uppercase tracking-wide text-amber-900 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">${escapeHtml(text)}</span>`;
    return;
  }
  if (key === "parcelId") {
    el.textContent = text;
    el.classList.add("font-mono", "font-bold");
    return;
  }
  el.textContent = normalizeText(text) || "—";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

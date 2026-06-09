/** Render parsed parcel into summary data-field hooks. */

import { querySummaryField } from "../dom.js";
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
];

export function clearParcelSummary() {
  SUMMARY_KEYS.forEach((key) => setField(key, "—"));
  setField("status", "");
  const badges = document.getElementById("parcelSummaryStatusBadges");
  if (badges) badges.classList.add("hidden");
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
      : parcel.insuranceCny != null
        ? formatCny(parcel.insuranceCny)
        : parcel.insuranceLabel || "—",
  );
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

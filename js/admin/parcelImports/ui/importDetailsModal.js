/** Lightweight import details / audit modal (Phase 13). */

import {
  fetchImportSmokeCounts,
  fetchParcelImportHeader,
} from "../api/parcelImportsApi.js";
import { getDom } from "../dom.js";
import { getState } from "../state.js";

let modalListenersBound = false;

export function initImportDetailsModal() {
  const { detailsModal, detailsCloseBtns } = getDom();
  if (!detailsModal || modalListenersBound) return;

  detailsCloseBtns?.forEach((btn) => {
    btn.addEventListener("click", () => closeImportDetailsModal());
  });

  detailsModal.addEventListener("click", (event) => {
    if (event.target === detailsModal) closeImportDetailsModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !detailsModal.classList.contains("hidden")) {
      closeImportDetailsModal();
    }
  });

  modalListenersBound = true;
}

export function closeImportDetailsModal() {
  const { detailsModal } = getDom();
  if (detailsModal) detailsModal.classList.add("hidden");
  document.body.classList.remove("overflow-hidden");
}

/** @param {string} importId */
export async function openImportDetailsModal(importId) {
  const state = getState();
  if (!state.sessionReady || !state.adminOk) {
    throw new Error("Admin session required.");
  }

  const { detailsModal, detailsBodyEl, detailsTitleEl } = getDom();
  if (!detailsModal || !detailsBodyEl) return;

  detailsTitleEl.textContent = "Import details";
  detailsBodyEl.innerHTML =
    '<p class="text-sm text-gray-500">Loading import details…</p>';
  detailsModal.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");

  try {
    const [header, audit] = await Promise.all([
      fetchParcelImportHeader(importId),
      fetchImportSmokeCounts(importId),
    ]);
    detailsTitleEl.textContent = `Parcel ${header.parcel_id || importId}`;
    detailsBodyEl.innerHTML = renderDetailsHtml(header, audit.events ?? []);
  } catch (err) {
    detailsBodyEl.innerHTML = `<p class="text-sm text-red-700">Failed to load details: ${escapeHtml(err?.message || "Unknown error")}</p>`;
  }
}

/** @param {object} header @param {object[]} events */
function renderDetailsHtml(header, events) {
  const rows = [
    ["Parcel ID", header.parcel_id || "—"],
    ["Import ID", header.id],
    ["Status", String(header.status || "—").replace(/_/g, " ")],
    ["Source file", header.source_file_name || "—"],
    ["Imported at", formatDate(header.imported_at)],
    ["Approved at", formatDate(header.approved_at)],
    ["Expense linked", header.expense_id ? `Yes (${header.expense_id})` : "No"],
    [
      "Inventory received",
      header.inventory_received_at
        ? `Yes (${formatDate(header.inventory_received_at)})`
        : "No",
    ],
    ["Products affected", header.products_affected_count ?? "—"],
    ["Rows needing mapping", header.rows_needing_mapping_count ?? "—"],
    ["Rows excluded", header.rows_excluded_count ?? "—"],
    ["Total charge (CNY)", header.actual_total_charge_cny ?? "—"],
    ["FX rate", header.effective_fx_rate ?? "—"],
    ["USD equivalent", header.usd_equivalent ?? "—"],
  ];

  const summary = rows
    .map(
      ([label, value]) => `
      <div class="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-1 sm:gap-3 py-1.5 border-b border-gray-100 text-sm">
        <dt class="font-bold text-gray-600">${escapeHtml(label)}</dt>
        <dd class="text-gray-900 break-all">${escapeHtml(String(value))}</dd>
      </div>`,
    )
    .join("");

  const timeline = events.length
    ? events
        .map((event) => {
          const when = formatDate(event.created_at);
          const type = String(event.event_type || "event").replace(/_/g, " ");
          const msg = event.event_message || "";
          return `<li class="py-2 border-b border-gray-100 text-sm">
            <span class="font-bold text-gray-800">${escapeHtml(type)}</span>
            <span class="text-gray-500 text-xs ml-2">${escapeHtml(when)}</span>
            ${msg ? `<p class="text-gray-700 mt-0.5">${escapeHtml(msg)}</p>` : ""}
          </li>`;
        })
        .join("")
    : '<li class="py-2 text-sm text-gray-500">No events recorded.</li>';

  return `
    <dl class="space-y-0">${summary}</dl>
    <h3 class="text-sm font-black uppercase tracking-wide text-gray-700 mt-6 mb-2">Timeline</h3>
    <ul class="divide-y divide-gray-100">${timeline}</ul>`;
}

/** @param {string | null | undefined} value */
function formatDate(value) {
  if (!value) return "—";
  return String(value).replace("T", " ").slice(0, 19);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

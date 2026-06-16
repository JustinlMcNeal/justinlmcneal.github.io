/**
 * Audit History panel for Marketplace Restock Assist Queue (Phase 10S — read-only).
 */

import { esc } from "../utils/formatters.js";
import {
  AUDIT_ACTION_LABELS,
  fetchMarketplaceRestockAudit,
} from "../api/marketplaceRestockAssistAnalyticsApi.js";
import { buildLineItemsOrdersUrl, channelFromOrderId } from "../constants/orderLinks.js";
import { showInventoryToast } from "../events.js";
import { fetchRestockFollowupByLedgerId } from "../api/restockFollowupApi.js";
import { openRestockFollowupChecklistModal } from "./restockFollowupChecklist.js";

/** @type {Object} */
let auditFilters = {
  actionType: "",
  sourceChannel: "",
  componentSearch: "",
  orderId: "",
  since: "",
  until: "",
};

/** @type {ReturnType<typeof fetchMarketplaceRestockAudit> extends Promise<infer R> ? R : never[]} */
let auditRows = [];

function formatTs(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistAnalyticsApi.js').mapAuditRow>} row */
function auditRowHtml(row) {
  const orderUrl =
    row.sourceOrderId &&
    buildLineItemsOrdersUrl({
      sessionId: row.sourceOrderId,
      lineId: row.sourceOrderItemId || undefined,
      channel: channelFromOrderId(row.sourceOrderId) || row.sourceChannel || undefined,
      tab: "overview",
    });
  const label = AUDIT_ACTION_LABELS[row.actionType] || row.actionType;

  return `
    <div class="border-b border-gray-100 p-3 text-[11px] space-y-0.5">
      <div class="flex flex-wrap justify-between gap-1">
        <span class="font-black uppercase text-[10px] text-indigo-900">${esc(label)}</span>
        <span class="text-[9px] text-gray-500">${esc(formatTs(row.createdAt))}</span>
      </div>
      <p class="font-bold">${esc(row.parentBundleTitle || "—")} → ${esc(row.componentTitle || "—")}</p>
      <p class="text-[10px] text-gray-600 font-mono">
        ${esc(row.componentSku || "—")}
        ${row.qty != null ? ` · qty ${row.qty}` : ""}
        ${row.sourceChannel ? ` · ${esc(row.sourceChannel)}` : ""}
      </p>
      <p class="text-[9px] text-gray-500">
        ${row.observationId ? `obs ${esc(row.observationId.slice(0, 8))}…` : ""}
        ${row.ledgerId ? ` · ledger ${esc(row.ledgerId.slice(0, 8))}…` : ""}
        ${row.createdBy ? ` · admin ${esc(row.createdBy.slice(0, 8))}…` : ""}
      </p>
      ${row.note ? `<p class="text-[9px] italic text-gray-600">${esc(row.note)}</p>` : ""}
      ${
        row.actionType === "restock_confirmed" && row.ledgerId
          ? `<button type="button" data-audit-followup="${esc(row.ledgerId)}" class="text-[9px] font-black uppercase text-emerald-800 hover:underline">View follow-up</button>`
          : ""
      }
      ${
        orderUrl
          ? `<a href="${esc(orderUrl)}" target="_blank" rel="noopener" class="text-[9px] font-black uppercase text-teal-800 hover:underline">Order line</a>`
          : ""
      }
    </div>`;
}

function filtersHtml() {
  const actionOpts = Object.entries(AUDIT_ACTION_LABELS)
    .map(
      ([v, l]) =>
        `<option value="${esc(v)}" ${auditFilters.actionType === v ? "selected" : ""}>${esc(l)}</option>`,
    )
    .join("");

  return `
    <div class="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-2 text-[10px] items-end">
      <label class="flex flex-col gap-0.5">
        <span class="text-[8px] font-black uppercase text-gray-500">Action</span>
        <select data-audit-filter-action class="border px-1 py-0.5 text-[10px]">
          <option value="">All</option>${actionOpts}
        </select>
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-[8px] font-black uppercase text-gray-500">Channel</span>
        <select data-audit-filter-channel class="border px-1 py-0.5 text-[10px]">
          <option value="">All</option>
          <option value="ebay" ${auditFilters.sourceChannel === "ebay" ? "selected" : ""}>eBay</option>
          <option value="amazon" ${auditFilters.sourceChannel === "amazon" ? "selected" : ""}>Amazon</option>
        </select>
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-[8px] font-black uppercase text-gray-500">SKU / Title</span>
        <input type="text" data-audit-filter-component value="${esc(auditFilters.componentSearch)}" class="border px-1 py-0.5 text-[10px] w-28" placeholder="search" />
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-[8px] font-black uppercase text-gray-500">Order ID</span>
        <input type="text" data-audit-filter-order value="${esc(auditFilters.orderId)}" class="border px-1 py-0.5 text-[10px] w-28" />
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-[8px] font-black uppercase text-gray-500">Since</span>
        <input type="date" data-audit-filter-since value="${esc(auditFilters.since)}" class="border px-1 py-0.5 text-[10px]" />
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-[8px] font-black uppercase text-gray-500">Until</span>
        <input type="date" data-audit-filter-until value="${esc(auditFilters.until)}" class="border px-1 py-0.5 text-[10px]" />
      </label>
      <button type="button" data-audit-apply class="border border-indigo-700 text-indigo-900 px-2 py-1 font-black uppercase">Apply</button>
    </div>`;
}

/** @param {HTMLElement} mount */
function wireAuditPanel(mount) {
  mount.querySelectorAll("[data-audit-followup]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ledgerId = btn.getAttribute("data-audit-followup");
      if (!ledgerId) return;
      try {
        const c = await fetchRestockFollowupByLedgerId(ledgerId);
        if (c?.restockActionId) await openRestockFollowupChecklistModal(c.restockActionId);
        else showInventoryToast("Follow-up not found for this restock.", { variant: "info" });
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });
  });

  mount.querySelector("[data-audit-apply]")?.addEventListener("click", async () => {
    auditFilters = {
      actionType: mount.querySelector("[data-audit-filter-action]")?.value || "",
      sourceChannel: mount.querySelector("[data-audit-filter-channel]")?.value || "",
      componentSearch: mount.querySelector("[data-audit-filter-component]")?.value?.trim() || "",
      orderId: mount.querySelector("[data-audit-filter-order]")?.value?.trim() || "",
      since: mount.querySelector("[data-audit-filter-since]")?.value || "",
      until: mount.querySelector("[data-audit-filter-until]")?.value || "",
    };
    try {
      await reloadAuditPanel(mount);
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });
}

/** @param {HTMLElement} mount @param {string} [reservationId] */
export async function reloadAuditPanel(mount, reservationId) {
  auditRows = await fetchMarketplaceRestockAudit({
    actionType: auditFilters.actionType || undefined,
    sourceChannel: auditFilters.sourceChannel || undefined,
    componentSearch: auditFilters.componentSearch || undefined,
    orderId: auditFilters.orderId || undefined,
    since: auditFilters.since ? `${auditFilters.since}T00:00:00.000Z` : undefined,
    until: auditFilters.until ? `${auditFilters.until}T23:59:59.999Z` : undefined,
    reservationId: reservationId || undefined,
  });
  const list = mount.querySelector("#rsqAuditList");
  if (list) {
    list.innerHTML = auditRows.length
      ? auditRows.map((r) => auditRowHtml(r)).join("")
      : `<p class="p-4 text-sm text-gray-500">No audit entries match filters.</p>`;
    list.querySelectorAll("[data-audit-followup]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ledgerId = btn.getAttribute("data-audit-followup");
        if (!ledgerId) return;
        try {
          const c = await fetchRestockFollowupByLedgerId(ledgerId);
          if (c?.restockActionId) await openRestockFollowupChecklistModal(c.restockActionId);
          else showInventoryToast("Follow-up not found for this restock.", { variant: "info" });
        } catch (err) {
          showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
        }
      });
    });
  }
}

export function renderAuditPanelHtml() {
  return `
    ${filtersHtml()}
    <div class="overflow-y-auto flex-1 min-h-0" id="rsqAuditList">
      <p class="p-4 text-sm text-gray-500">Loading audit history…</p>
    </div>`;
}

/** @param {HTMLElement} mount @param {string} [reservationId] */
export async function initAuditPanel(mount, reservationId) {
  wireAuditPanel(mount);
  await reloadAuditPanel(mount, reservationId);
}

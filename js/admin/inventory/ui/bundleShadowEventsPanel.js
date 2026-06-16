/**
 * Recent bundle shadow events viewer (Phase 10D).
 */

import { esc } from "../utils/formatters.js";
import { fetchRecentShadowEvents } from "../api/bundleShadowApi.js";

/** @typedef {import('../api/bundleShadowApi.js').ShadowEventRow} ShadowEventRow */

const EVENT_LABELS = {
  checkout_simulation: "Simulation",
  reservation_shadow: "Reservation shadow",
  finalize_shadow: "Finalize shadow",
};

/** @param {ShadowEventRow[]} rows @param {string} filter */
function renderEventRows(rows, filter) {
  const filtered = filter === "all"
    ? rows
    : rows.filter((r) => r.eventType === filter);

  if (!filtered.length) {
    return `<p class="text-[10px] text-gray-400">No shadow events for this filter.</p>`;
  }

  return `<ul class="space-y-2 max-h-48 overflow-y-auto">${filtered
    .map((r) => {
      const typeLabel = EVENT_LABELS[r.eventType] || r.eventType;
      const orderRef = r.sourceOrderId
        ? `${esc(r.sourceOrderId.slice(0, 20))}${r.sourceOrderId.length > 20 ? "…" : ""}`
        : "—";
      const resultCls = r.canFulfillVirtual ? "text-green-800" : "text-red-800";
      return `
        <li class="text-[10px] border border-gray-100 rounded p-2">
          <div class="flex flex-wrap justify-between gap-1">
            <span class="font-black uppercase text-violet-800">${esc(typeLabel)}</span>
            <span class="text-gray-400">${esc(r.createdAt)}</span>
          </div>
          <p class="font-bold">${esc(r.bundleLabel)} · qty ${r.quantity}</p>
          <p class="text-gray-600">Order: ${orderRef}${r.sourceOrderItemId ? ` · line ${esc(r.sourceOrderItemId.slice(0, 12))}` : ""}</p>
          <p class="${resultCls}">Result: ${esc(r.simulationResultCode.replace(/_/g, " "))}</p>
          ${
            r.independentStockWarning
              ? `<p class="text-amber-800">Independent stock warning</p>`
              : ""
          }
        </li>`;
    })
    .join("")}</ul>`;
}

/** @param {ShadowEventRow[]} rows */
export function renderShadowEventsSection(rows) {
  return `
    <section class="border border-gray-200 rounded-lg p-3 mt-2" data-shadow-events-section>
      <div class="flex flex-wrap justify-between gap-2 items-center mb-2">
        <h3 class="text-[10px] font-black uppercase text-gray-400">Recent shadow events</h3>
        <select data-shadow-event-filter class="border border-gray-300 rounded px-2 py-0.5 text-[10px]">
          <option value="all">All</option>
          <option value="checkout_simulation">Simulation</option>
          <option value="reservation_shadow">Reservation shadow</option>
          <option value="finalize_shadow">Finalize shadow</option>
        </select>
      </div>
      <div data-shadow-events-list>${renderEventRows(rows, "all")}</div>
      <p class="text-[9px] text-gray-400 mt-2">Shadow events only — no inventory side effects.</p>
    </section>`;
}

/** @param {HTMLElement} container @param {ShadowEventRow[]} rows */
export function wireShadowEventsFilter(container, rows) {
  const section = container.querySelector("[data-shadow-events-section]");
  const list = section?.querySelector("[data-shadow-events-list]");
  const filter = section?.querySelector("[data-shadow-event-filter]");
  if (!(list instanceof HTMLElement) || !(filter instanceof HTMLSelectElement)) return;

  filter.addEventListener("change", () => {
    list.innerHTML = renderEventRows(rows, filter.value);
  });
}

/** @param {HTMLElement} container */
export async function mountShadowEventsSection(container) {
  const mount = container.querySelector("#bundleShadowEventsMount");
  if (!mount) return;
  try {
    const rows = await fetchRecentShadowEvents(30);
    mount.innerHTML = renderShadowEventsSection(rows);
    wireShadowEventsFilter(container, rows);
  } catch (err) {
    mount.innerHTML = `<p class="text-[10px] text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

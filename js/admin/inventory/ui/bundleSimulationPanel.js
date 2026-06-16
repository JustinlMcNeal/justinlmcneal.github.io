/**
 * Virtual bundle sale simulation UI (Phase 10C — read-only + optional shadow log).
 */

import { esc } from "../utils/formatters.js";
import {
  simulateVirtualBundleOrder,
  recordBundleShadowEvent,
} from "../api/bundleShadowApi.js";
import { showInventoryToast } from "../events.js";

/** @typedef {import('../api/bundleShadowApi.js').BundleSimulationResult} SimResult */

/** @type {SimResult|null} */
let lastSimulation = null;
/** @type {Record<string, unknown>|null} */
let lastSimulationRaw = null;

function closeSimulationPanel() {
  const el = document.querySelector("[data-bundle-simulation-panel]");
  if (el) el.remove();
  lastSimulation = null;
  lastSimulationRaw = null;
}

/** @param {SimResult} sim */
function renderSimulationHtml(sim) {
  const passFail = sim.canFulfillVirtual
    ? `<span class="text-green-800 font-black uppercase text-[10px]">PASS — can fulfill virtually</span>`
    : `<span class="text-red-800 font-black uppercase text-[10px]">FAIL — ${esc(sim.result.replace(/_/g, " "))}</span>`;

  const componentRows = sim.components.length
    ? sim.components
        .map(
          (c) => `
        <tr class="text-[10px] border-b border-gray-100">
          <td class="py-1 font-mono">${esc(c.componentSku)}</td>
          <td class="py-1 text-right">${c.componentAvailable}</td>
          <td class="py-1 text-right">${c.componentQtyPerBundle}</td>
          <td class="py-1 text-right">${c.requiredQty}</td>
          <td class="py-1 text-right ${c.shortageQty > 0 ? "text-red-700 font-bold" : ""}">${c.shortageQty}</td>
          <td class="py-1 text-right">${c.wouldReserveQty}</td>
          <td class="py-1 text-right">${c.wouldFinalizeQty}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="text-[10px] text-gray-400 py-2">No component rows</td></tr>`;

  return `
    <div data-bundle-simulation-panel class="border border-violet-300 bg-violet-50 rounded-lg p-3 space-y-2 mt-2">
      <div class="flex flex-wrap justify-between gap-2 items-start">
        <div>
          <p class="text-[9px] font-black uppercase text-violet-800">Simulation only</p>
          <p class="text-[11px] font-bold">${esc(sim.bundleLabel)} · qty ${sim.requestedQuantity}</p>
          <p class="text-[10px] text-gray-600">No stock or reservations changed.</p>
        </div>
        ${passFail}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div><span class="text-gray-500">Bundle avail</span><br><strong>${sim.bundleAvailable}</strong></div>
        <div><span class="text-gray-500">Virtual avail</span><br><strong>${sim.virtualAvailability ?? "—"}</strong></div>
        <div><span class="text-gray-500">Global mode</span><br><strong>${esc(sim.globalMode)}</strong></div>
        <div><span class="text-gray-500">Bundle mode</span><br><strong>${esc(sim.bundleMode)}</strong></div>
      </div>
      ${
        sim.independentStockWarning
          ? `<p class="text-[10px] text-amber-900 bg-amber-100 border border-amber-200 rounded p-2">Independent stock warning: bundle has ${sim.bundleOnHand} on-hand separate from virtual components.</p>`
          : ""
      }
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="text-[9px] font-black uppercase text-gray-500">
            <tr>
              <th>Component</th><th class="text-right">Avail</th><th class="text-right">Per bundle</th>
              <th class="text-right">Required</th><th class="text-right">Shortage</th>
              <th class="text-right">Would reserve</th><th class="text-right">Would finalize</th>
            </tr>
          </thead>
          <tbody>${componentRows}</tbody>
        </table>
      </div>
      ${
        sim.previewReservations.length
          ? `<details class="text-[10px]"><summary class="font-black uppercase cursor-pointer text-gray-600">Preview reservations (${sim.previewReservations.length})</summary><pre class="mt-1 text-[9px] overflow-x-auto bg-white p-2 rounded border">${esc(JSON.stringify(sim.previewReservations, null, 2))}</pre></details>`
          : ""
      }
      ${
        sim.previewLedger.length
          ? `<details class="text-[10px]"><summary class="font-black uppercase cursor-pointer text-gray-600">Preview ledger (${sim.previewLedger.length})</summary><pre class="mt-1 text-[9px] overflow-x-auto bg-white p-2 rounded border">${esc(JSON.stringify(sim.previewLedger, null, 2))}</pre></details>`
          : ""
      }
      <div class="flex flex-wrap gap-2">
        <button type="button" data-save-shadow-simulation class="border-2 border-violet-700 text-violet-900 px-3 py-1.5 text-[10px] font-black uppercase">Save Simulation</button>
        <button type="button" data-close-simulation class="text-[10px] font-black uppercase text-gray-500">Close</button>
      </div>
    </div>`;
}

/**
 * @param {string} bundleVariantId
 * @param {string} bundleLabel
 * @param {HTMLElement} anchorCard
 */
export async function runBundleSimulationPrompt(bundleVariantId, bundleLabel, anchorCard) {
  const qtyStr = window.prompt(`Simulate sale quantity for ${bundleLabel}:`, "1");
  if (qtyStr === null) return;
  const qty = Number(qtyStr);
  if (!Number.isFinite(qty) || qty <= 0) {
    showInventoryToast("Enter a positive quantity.", { variant: "error" });
    return;
  }

  closeSimulationPanel();
  const loading = document.createElement("p");
  loading.className = "text-[10px] text-gray-500 mt-2";
  loading.textContent = "Running simulation…";
  anchorCard.appendChild(loading);

  try {
    const raw = await simulateVirtualBundleOrder(bundleVariantId, qty);
    lastSimulation = raw;
    lastSimulationRaw = raw.raw ?? null;
    loading.remove();
    const wrap = document.createElement("div");
    wrap.innerHTML = renderSimulationHtml(raw);
    anchorCard.appendChild(wrap.firstElementChild);

    anchorCard.querySelector("[data-close-simulation]")?.addEventListener("click", closeSimulationPanel);
    anchorCard.querySelector("[data-save-shadow-simulation]")?.addEventListener("click", async () => {
      if (!lastSimulation || !lastSimulationRaw) return;
      try {
        await recordBundleShadowEvent({
          eventType: "checkout_simulation",
          bundleVariantId: lastSimulation.bundleVariantId,
          quantity: lastSimulation.requestedQuantity,
          simulationResult: lastSimulationRaw,
        });
        showInventoryToast("Shadow simulation saved (no inventory change).", { variant: "success" });
        const modalBody = document.querySelector("[data-bundle-preview-body]");
        if (modalBody instanceof HTMLElement) {
          const { mountShadowEventsSection } = await import("./bundleShadowEventsPanel.js");
          await mountShadowEventsSection(modalBody);
        }
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });
  } catch (err) {
    loading.remove();
    showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
  }
}

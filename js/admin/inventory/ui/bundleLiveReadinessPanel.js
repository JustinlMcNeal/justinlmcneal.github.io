/**
 * Live readiness checklist, independent stock ack, live request UI (Phase 10E).
 */

import { esc } from "../utils/formatters.js";
import {
  acknowledgeIndependentStock,
  enableBundleLiveMode,
  enableBundleVirtual,
  enableGlobalBundleLiveMode,
  requestBundleLiveEnablement,
  revertBundleLiveMode,
  setAllowPerBundleLive,
} from "../api/bundleShadowApi.js";
import { showInventoryToast } from "../events.js";

/** @typedef {import('../api/bundleShadowApi.js').CutoverReadinessRow} ReadinessRow */

/** @param {ReadinessRow} r */
export function renderShadowEvidenceSummary(r) {
  return `
    <div class="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded p-2 mt-2">
      <p class="font-black uppercase text-[9px] text-gray-400 mb-1">Shadow evidence</p>
      <p>Total ${r.shadowEventCount} · sim ${r.simulationCount} · reserve ${r.reservationShadowCount} · finalize ${r.finalizeShadowCount}</p>
      <p>Shortage events ${r.shortageShadowCount}${r.lastShadowResult ? ` · last result ${esc(r.lastShadowResult.replace(/_/g, " "))}` : ""}</p>
      ${r.lastShadowEventAt ? `<p class="text-gray-400">Last event ${esc(String(r.lastShadowEventAt).slice(0, 19))}</p>` : ""}
    </div>`;
}

/** @param {ReadinessRow} r */
export function renderBundleLiveReadinessCard(r) {
  const liveRequested = r.bundleMode === "live_requested";
  const isLive = r.bundleMode === "live";
  const ackNeeded = r.hasIndependentStockWarning && !r.independentStockAcknowledged;

  return `
    <div class="border border-dashed border-gray-300 rounded p-2 mt-2 space-y-2" data-live-readiness="${esc(r.bundleVariantId)}">
      <p class="text-[9px] font-black uppercase text-gray-500">Live readiness (Phase 10F)</p>
      ${renderShadowEvidenceSummary(r)}
      <p class="text-[10px] text-gray-600">
        Live request: ${r.isReadyForLiveRequest ? "eligible" : "blocked"}
        · full live: ${r.isReadyForLive ? "ready" : "blocked"}
        · deduction enabled: <strong>${r.liveDeductionEnabled ? "yes" : "no"}</strong>
      </p>
      ${
        isLive
          ? `<p class="text-[10px] text-red-900 bg-red-50 border border-red-200 rounded p-2">Live — bundle sales reserve and finalize component inventory.</p>`
          : liveRequested
            ? `<p class="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">Live requested — admin must explicitly enable live to start component deduction.</p>`
            : ""
      }
      ${
        ackNeeded
          ? `<div class="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 space-y-2">
          <p>This bundle has independent stock and virtual component rules.</p>
          <p>Live virtual mode will treat component stock as the sellable source.</p>
          <p>Confirm how independent bundle stock should be handled before live enablement.</p>
          <textarea data-independent-ack-note rows="2" class="w-full border border-amber-300 rounded p-1 text-[10px]" placeholder="Optional note"></textarea>
          <button type="button" data-ack-independent-stock class="border-2 border-amber-700 text-amber-900 px-2 py-1 text-[9px] font-black uppercase">Acknowledge independent stock</button>
        </div>`
          : r.independentStockAcknowledged
            ? `<p class="text-[10px] text-green-800">Independent stock acknowledged.</p>`
            : ""
      }
      ${
        !r.isVirtualEnabled
          ? `<button type="button" data-enable-virtual-bundle class="text-[9px] font-black uppercase text-indigo-700">Enable virtual bundle flag</button>`
          : ""
      }
      <button type="button" data-request-live-bundle
        class="w-full border-2 ${r.isReadyForLiveRequest && !liveRequested && !isLive ? "border-red-600 text-red-800" : "border-gray-300 text-gray-400"} px-3 py-1.5 text-[10px] font-black uppercase"
        ${r.isReadyForLiveRequest && !liveRequested && !isLive ? "" : "disabled"}>
        Request live enablement
      </button>
      ${
        liveRequested && r.isReadyForLive && r.globalMode === "live"
          ? `<button type="button" data-enable-live-bundle
            class="w-full border-2 border-red-700 bg-red-600 text-white px-3 py-1.5 text-[10px] font-black uppercase mt-1">
            Enable live (component reserve/finalize)
          </button>`
          : liveRequested && r.isReadyForLive
            ? `<p class="text-[10px] text-gray-400">Enable global live mode before enabling this bundle.</p>`
            : ""
      }
      ${
        isLive
          ? `<div class="flex flex-wrap gap-2 mt-1">
          <button type="button" data-revert-live-bundle data-target="shadow"
            class="border-2 border-gray-600 text-gray-800 px-2 py-1 text-[9px] font-black uppercase">Revert to shadow</button>
          <button type="button" data-revert-live-bundle data-target="preview_only"
            class="border-2 border-gray-400 text-gray-600 px-2 py-1 text-[9px] font-black uppercase">Revert to preview</button>
        </div>`
          : ""
      }
      ${
        r.blockerReasons.length
          ? `<p class="text-[10px] text-gray-400">Blockers: ${esc(r.blockerReasons.join(", "))}</p>`
          : ""
      }
    </div>`;
}

/** @param {ReadinessRow[]} rows */
export function renderReadinessSection(rows) {
  if (!rows.length) {
    return `<p class="text-[10px] text-gray-400">No virtual bundles configured for readiness check.</p>`;
  }
  return `
    <section class="border border-gray-200 rounded-lg p-3 mt-2">
      <h3 class="text-[10px] font-black uppercase text-gray-400 mb-2">Cutover readiness checklist</h3>
      <ul class="space-y-2">${rows
        .map(
          (r) => `
        <li class="text-[10px] text-gray-600 border-b border-gray-100 pb-2 last:border-0">
          <span class="font-bold">${esc(r.bundleLabel)}</span>
          · mode ${esc(r.bundleMode)}
          · live request ${r.isReadyForLiveRequest ? "ok" : "blocked"}
          · events ${r.shadowEventCount}
          ${r.shortageShadowCount > 0 ? `<span class="text-amber-800"> · ${r.shortageShadowCount} shortage shadow(s)</span>` : ""}
          ${r.blockerReasons.length ? `<span class="block text-gray-400">${esc(r.blockerReasons.join(", "))}</span>` : ""}
        </li>`,
        )
        .join("")}</ul>
    </section>`;
}

/** @param {{ allowPerBundleLive: boolean; globalMode: string }} settings */
export function renderGlobalLiveStagingControls(settings) {
  const globalLive = settings.globalMode === "live";
  return `
    <section class="border border-gray-200 rounded-lg p-3 mt-2" data-global-live-staging>
      <h3 class="text-[10px] font-black uppercase text-gray-400 mb-2">Live staging</h3>
      <label class="flex items-center gap-2 text-[10px] text-gray-600">
        <input type="checkbox" data-allow-per-bundle-live ${settings.allowPerBundleLive ? "checked" : ""} />
        Allow per-bundle live enablement
      </label>
      <button type="button" data-save-allow-per-bundle-live class="mt-2 border-2 border-gray-600 text-gray-800 px-3 py-1 text-[10px] font-black uppercase">Save staging flag</button>
      ${
        settings.allowPerBundleLive && !globalLive
          ? `<button type="button" data-enable-global-live
            class="mt-2 w-full border-2 border-red-700 text-red-800 px-3 py-1.5 text-[10px] font-black uppercase">
            Enable global live mode
          </button>
          <p class="text-[9px] text-gray-400 mt-1">Required before per-bundle live enablement.</p>`
          : globalLive
            ? `<p class="text-[10px] text-red-800 mt-2">Global live mode is active.</p>`
            : `<p class="text-[9px] text-gray-400 mt-1">Enable allow-per-bundle-live first.</p>`
      }
    </section>`;
}

/** @param {HTMLElement} container @param {() => Promise<void>} reload */
export function wireLiveReadinessActions(container, reload) {
  container.querySelectorAll("[data-live-readiness]").forEach((wrap) => {
    const variantId = wrap.getAttribute("data-live-readiness");
    if (!variantId) return;

    wrap.querySelector("[data-ack-independent-stock]")?.addEventListener("click", async () => {
      const noteEl = wrap.querySelector("[data-independent-ack-note]");
      const note = noteEl instanceof HTMLTextAreaElement ? noteEl.value : "";
      try {
        await acknowledgeIndependentStock(variantId, note || null);
        showInventoryToast("Independent stock acknowledged.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelector("[data-enable-virtual-bundle]")?.addEventListener("click", async () => {
      try {
        await enableBundleVirtual(variantId);
        showInventoryToast("Virtual bundle enabled.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelector("[data-request-live-bundle]")?.addEventListener("click", async () => {
      const note = window.prompt("Optional note for live request:");
      if (note === null) return;
      if (
        !window.confirm(
          "Request live enablement for this bundle?\n\nThis stages the bundle for live — component deduction starts only after explicit live enablement.",
        )
      ) {
        return;
      }
      try {
        await requestBundleLiveEnablement(variantId, note || null);
        showInventoryToast("Live enablement requested.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelector("[data-enable-live-bundle]")?.addEventListener("click", async () => {
      const note = window.prompt("Optional note for live enablement:");
      if (note === null) return;
      if (
        !window.confirm(
          "Enable live for this bundle?\n\nThis will make bundle sales reserve and finalize component inventory.",
        )
      ) {
        return;
      }
      try {
        await enableBundleLiveMode(variantId, note || null);
        showInventoryToast("Live enabled — component reserve/finalize active.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelectorAll("[data-revert-live-bundle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const target = btn.getAttribute("data-target") || "shadow";
        const note = window.prompt(`Optional note for reverting to ${target}:`);
        if (note === null) return;
        if (
          !window.confirm(
            `Revert bundle to ${target}?\n\nFuture sales will stop live component behavior. Existing reservations/finalizations are not undone.`,
          )
        ) {
          return;
        }
        try {
          await revertBundleLiveMode(variantId, target, note || null);
          showInventoryToast(`Reverted to ${target}.`, { variant: "success" });
          await reload();
        } catch (err) {
          showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
        }
      });
    });
  });

  container.querySelector("[data-enable-global-live]")?.addEventListener("click", async () => {
    if (
      !window.confirm(
        "Enable global live mode?\n\nRequired for per-bundle live enablement. No bundle deducts until individually enabled.",
      )
    ) {
      return;
    }
    try {
      await enableGlobalBundleLiveMode();
      showInventoryToast("Global live mode enabled.", { variant: "success" });
      await reload();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });

  container.querySelector("[data-save-allow-per-bundle-live]")?.addEventListener("click", async () => {
    const cb = container.querySelector("[data-allow-per-bundle-live]");
    try {
      await setAllowPerBundleLive(cb instanceof HTMLInputElement && cb.checked);
      showInventoryToast("Live staging flag saved.", { variant: "success" });
      await reload();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });
}

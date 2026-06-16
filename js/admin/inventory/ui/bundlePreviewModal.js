/**
 * Bundle preview modal (Phase 10B — picker + rule management).
 */

import { esc } from "../utils/formatters.js";
import {
  fetchBundlePreviewData,
  upsertBundleRule,
  setBundleRuleActive,
  deleteBundleRule,
  validateBundleRuleInput,
} from "../api/bundlePreviewApi.js";
import { renderPreviewBody } from "./bundlePreviewSummary.js";
import { runBundleSimulationPrompt } from "./bundleSimulationPanel.js";
import { renderReadinessSection, renderGlobalLiveStagingControls, wireLiveReadinessActions } from "./bundleLiveReadinessPanel.js";
import {
  fetchBundleGlobalSettings,
  fetchCutoverReadiness,
} from "../api/bundleShadowApi.js";
import {
  renderGlobalModeControls,
  wireGlobalModeControls,
  wireVariantModeControls,
} from "./bundleModeControls.js";
import { mountShadowEventsSection } from "./bundleShadowEventsPanel.js";
import { mountReturnRestockSection } from "./bundleReturnRestockPanel.js";
import {
  mountBundleRuleForm,
  clearEditingRule,
  loadRuleForEdit,
  getPickerState,
} from "./bundleRuleForm.js";
import { showInventoryToast } from "../events.js";
import { getDom } from "../dom.js";

/** @type {(() => void)|null} */
let onRefresh = null;
/** @type {string|null} */
let focusBundleVariantId = null;
/** @type {boolean} */
let focusReturnsSection = false;

function closeModal() {
  const mount = getDom().bundlePreviewModalMount;
  if (mount) mount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
  clearEditingRule();
  focusBundleVariantId = null;
  focusReturnsSection = false;
}

function showFormWarnings(warnings) {
  const el = document.querySelector("[data-form-warnings]");
  if (!el) return;
  if (!warnings.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = warnings.map((w) => `<p>⚠ ${esc(w)}</p>`).join("");
}

function wireRuleActions(container, reload) {
  container.querySelectorAll("[data-rule-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ruleId = btn.getAttribute("data-rule-edit");
      const data = await fetchBundlePreviewData();
      const rule = data.availability.find((r) => r.ruleId === ruleId);
      if (!rule) return;
      await loadRuleForEdit(rule);
      const formMount = container.querySelector("#bundleRuleFormMount");
      if (formMount) {
        mountBundleRuleForm(formMount, () => showFormWarnings([]));
        formMount.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  });

  for (const [attr, active] of [
    ["data-rule-disable", false],
    ["data-rule-enable", true],
  ]) {
    container.querySelectorAll(`[${attr}]`).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ruleId = btn.getAttribute(attr);
        if (!ruleId) return;
        if (!active && !window.confirm("Disable this rule? Preview only — no inventory change.")) return;
        try {
          await setBundleRuleActive(ruleId, active);
          showInventoryToast(active ? "Rule enabled." : "Rule disabled.", { variant: "success" });
          await reload();
          onRefresh?.();
        } catch (err) {
          showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
        }
      });
    });
  }

  container.querySelectorAll("[data-rule-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ruleId = btn.getAttribute("data-rule-delete");
      if (!ruleId) return;
      if (!window.confirm("Remove this rule? Config only — no inventory change.")) return;
      try {
        await deleteBundleRule(ruleId);
        showInventoryToast("Rule removed.", { variant: "success" });
        clearEditingRule();
        await reload();
        onRefresh?.();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });
  });

  container.querySelectorAll("[data-use-like-bundle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const variantId = btn.getAttribute("data-use-like-bundle");
      if (!variantId) return;
      clearEditingRule();
      const { prefillPickerVariant } = await import("./bundleRuleForm.js");
      await prefillPickerVariant(variantId, "bundleVariantId");
      const formMount = container.querySelector("#bundleRuleFormMount");
      if (formMount) mountBundleRuleForm(formMount, () => showFormWarnings([]));
      document.getElementById("bundleRuleFormSection")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  container.querySelectorAll("[data-simulate-bundle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const variantId = btn.getAttribute("data-simulate-bundle");
      const label = btn.getAttribute("data-simulate-label") || "Bundle";
      const card = btn.closest("[data-bundle-card]");
      if (variantId && card instanceof HTMLElement) {
        void runBundleSimulationPrompt(variantId, label, card);
      }
    });
  });
}

function wireRuleForm(container, reload) {
  const formMount = container.querySelector("#bundleRuleFormMount");
  if (!formMount) return;

  mountBundleRuleForm(formMount, () => showFormWarnings([]));

  formMount.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
    clearEditingRule();
    mountBundleRuleForm(formMount, () => showFormWarnings([]));
  });

  formMount.querySelector("#bundleRuleForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(/** @type {HTMLFormElement} */ (e.currentTarget));
    const input = {
      ruleId: String(fd.get("ruleId") || "") || null,
      bundleVariantId: String(fd.get("bundleVariantId") ?? ""),
      componentVariantId: String(fd.get("componentVariantId") ?? ""),
      componentQty: Number(fd.get("componentQty")),
      notes: String(fd.get("notes") || "") || null,
    };
    const { bundle, component } = getPickerState();
    const { errors, warnings } = validateBundleRuleInput(input, bundle, component);
    showFormWarnings(warnings);
    if (errors.length) {
      showInventoryToast(errors[0], { variant: "error" });
      return;
    }
    if (warnings.length) {
      const ok = window.confirm(`${warnings.join("\n")}\n\nSave rule anyway? (Preview/config only)`);
      if (!ok) return;
    }
    try {
      await upsertBundleRule(input);
      showInventoryToast("Bundle rule saved (preview config only).", { variant: "success" });
      clearEditingRule();
      await reload();
      onRefresh?.();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });
}

async function reloadModal() {
  const mount = getDom().bundlePreviewModalMount;
  if (!mount?.querySelector("[data-bundle-preview-modal]") && mount?.innerHTML && !mount.querySelector(".fixed")) {
    // initial open — build shell first below
  }

  const isOpen = Boolean(mount?.querySelector("[data-bundle-preview-modal]"));
  if (!isOpen && mount) {
    document.body.classList.add("overflow-hidden");
    mount.innerHTML = `
      <div data-bundle-preview-modal class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-labelledby="bundlePreviewTitle">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
          <div class="p-4 border-b border-gray-100 flex flex-wrap justify-between gap-2 items-start">
            <div>
              <p class="text-[9px] font-black uppercase text-amber-700">Preview / Config / Simulation</p>
              <h2 id="bundlePreviewTitle" class="text-sm font-black tracking-tight">Bundle / Component Preview</h2>
              <p class="text-[10px] text-gray-500 mt-1">Simulation only — no live deduction. Checkout, stock, reservations, and channel sync unchanged.</p>
            </div>
            <button type="button" data-bundle-preview-close class="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button>
          </div>
          <div class="p-4 flex-1 overflow-hidden" data-bundle-preview-body><p class="text-sm text-gray-500">Loading…</p></div>
        </div>
      </div>`;
    mount.querySelector("[data-bundle-preview-close]")?.addEventListener("click", closeModal);
    mount.querySelector("[data-bundle-preview-modal]")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
  }

  const body = mount?.querySelector("[data-bundle-preview-body]");
  if (!body) return;

  try {
    const [data, settings, readiness] = await Promise.all([
      fetchBundlePreviewData(),
      fetchBundleGlobalSettings().catch(() => ({ globalMode: "preview_only", allowPerBundleLive: false })),
      fetchCutoverReadiness().catch(() => []),
    ]);
    body.innerHTML = renderPreviewBody(
      data.summaries,
      data.availability,
      data.likeVariants,
      focusBundleVariantId,
      settings.globalMode,
      Object.fromEntries(readiness.map((r) => [r.bundleVariantId, r.bundleMode])),
      Object.fromEntries(readiness.map((r) => [r.bundleVariantId, r])),
    );
    const readinessMount = body.querySelector("#bundleReadinessMount");
    if (readinessMount) readinessMount.innerHTML = renderReadinessSection(readiness);
    const globalModeMount = body.querySelector("#bundleGlobalModeMount");
    if (globalModeMount) globalModeMount.innerHTML = await renderGlobalModeControls();
    const stagingMount = body.querySelector("#bundleLiveStagingMount");
    if (stagingMount) stagingMount.innerHTML = renderGlobalLiveStagingControls(settings);

    const reload = () => reloadModal();
    wireRuleForm(body, reload);
    wireRuleActions(body, reload);
    wireGlobalModeControls(body, reload);
    wireVariantModeControls(body, reload);
    wireLiveReadinessActions(body, reload);
    await mountShadowEventsSection(body);
    await mountReturnRestockSection(body, reload);

    if (focusBundleVariantId) {
      document.getElementById(`bundle-card-${focusBundleVariantId}`)?.scrollIntoView({ behavior: "smooth" });
    } else if (focusReturnsSection) {
      document.querySelector("[data-return-restock-section]")?.scrollIntoView({ behavior: "smooth" });
    }
  } catch (err) {
    body.innerHTML = `<p class="text-sm text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

/** @param {{ onRefresh?: () => void, focusBundleVariantId?: string|null, focusReturnsSection?: boolean }} [opts] */
export function openBundlePreviewModal(opts = {}) {
  onRefresh = opts.onRefresh ?? null;
  focusBundleVariantId = opts.focusBundleVariantId ?? null;
  focusReturnsSection = Boolean(opts.focusReturnsSection);
  const mount = getDom().bundlePreviewModalMount;
  if (!mount) return;
  void reloadModal();
}

export { closeModal as closeBundlePreviewModal };

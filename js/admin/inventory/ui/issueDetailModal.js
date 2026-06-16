/**
 * Issue detail modal (Phase 8A drill-down + Phase 8B workflow state).
 */

import { getDom } from "../dom.js";
import { esc } from "../utils/formatters.js";
import { buildLineItemsOrdersUrl, channelFromOrderId } from "../constants/orderLinks.js";
import { getIssueActionDef } from "../services/issueActions.js";
import { fetchIssueSamples } from "../api/issuesApi.js";
import { executeIssueAction } from "../services/issueActionHandlers.js";
import {
  markIssueReviewed,
  snoozeIssue,
  resolveIssue,
  ignoreIssue,
  reopenIssue,
  snoozeUntilDays,
} from "../api/issueStateApi.js";
import { workflowStatusLabel, isSnoozeActive } from "../services/issueWorkflow.js";
import { buildGroupIssueKey } from "../services/issueKeys.js";
import { refreshInventoryAfterIssueStateChange } from "../services/refreshInventoryData.js";
import { showInventoryToast } from "../events.js";
import { issueSupportsMappingAssist, openMappingAssistModal } from "./mappingAssistModal.js";
import { fetchReservationRetryCandidates } from "../api/reservationRetryApi.js";
import { promptReservationRetry } from "./reservationRetryPrompt.js";
import { openShippedFinalizeAuditModal } from "./shippedFinalizeAuditModal.js";
import { promptManualFinalize } from "./manualFinalizePrompt.js";
import { fetchManualFinalizeCandidate } from "../api/manualFinalizeAssistApi.js";

function closeModal() {
  const mount = getDom().issueDetailModalMount;
  if (mount) mount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
}

function renderRetryCandidatesSection(candidates) {
  if (!candidates.length) {
    return `<p class="text-xs text-gray-500">No mapped lines awaiting reservation retry.</p>`;
  }
  return `
    <ul class="space-y-1.5 max-h-36 overflow-y-auto border border-indigo-100 rounded-lg p-2 bg-indigo-50/50">
      ${candidates
        .map(
          (c, idx) => `
        <li class="text-xs border-b border-indigo-100 pb-1.5 last:border-0">
          <span class="font-bold text-gray-900">${esc(c.title || c.productLabel)}</span>
          <span class="block text-gray-600">${esc(c.sourceChannel)} · qty ${c.quantity} · ${esc(c.sku)}</span>
          ${
            c.isEligible
              ? `<button type="button" data-retry-reservation="${idx}" class="mt-1 text-[10px] font-black uppercase text-indigo-800 hover:underline">Retry Reservation →</button>`
              : `<span class="block text-[10px] text-gray-500 mt-0.5">${esc(c.reason)}</span>`
          }
        </li>`,
        )
        .join("")}
    </ul>`;
}

function renderSamples(issue, samples) {
  if (!samples?.length) {
    return `<p class="text-xs text-gray-500">No sample rows loaded for this issue type.</p>`;
  }
  const assist = issueSupportsMappingAssist(issue);
  const shippedAudit = issue.type === "shipped_finalize_audit_needed";
  const bundlePreview = issue.type.startsWith("bundle_");
  const returnGuidance =
    issue.type.startsWith("bundle_component_return") ||
    issue.type.startsWith("bundle_return") ||
    issue.type === "bundle_component_restock_manual_review" ||
    issue.type === "refund_without_return_workflow" ||
    issue.type === "partial_refund_return_review" ||
    issue.type === "refund_restock_review_needed" ||
    issue.type === "marketplace_refund_review" ||
    issue.type === "marketplace_cancel_review" ||
    issue.type === "afn_return_external_review" ||
    issue.type === "marketplace_restock_assist_ready" ||
    issue.type === "marketplace_observation_stale";
  return `
    <ul class="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50">
      ${samples
        .map(
          (s, idx) => `
        <li class="text-xs ${assist && s.mappingAssistEligible ? "border-b border-gray-100 pb-1.5 last:border-0" : ""}">
          <span class="font-bold text-gray-900">${esc(s.label)}</span>
          <span class="block text-gray-600">${esc(s.detail)}</span>
          ${
            returnGuidance && s.sourceOrderId
              ? `<a href="${esc(
                  buildLineItemsOrdersUrl({
                    sessionId: s.sourceOrderId,
                    lineId: s.sourceOrderItemId || undefined,
                    channel: channelFromOrderId(s.sourceOrderId) || undefined,
                    tab: "overview",
                  }),
                )}" target="_blank" rel="noopener" class="mt-1 inline-block text-[10px] font-black uppercase text-indigo-800 hover:underline">Open order line →</a>`
              : assist && s.sourceOrderId
                ? `<a href="${esc(
                    buildLineItemsOrdersUrl({
                      sessionId: s.sourceOrderId,
                      lineId: s.sourceOrderItemId || undefined,
                      channel: channelFromOrderId(s.sourceOrderId) || undefined,
                      tab: "overview",
                    }),
                  )}" target="_blank" rel="noopener" class="mt-1 inline-block text-[10px] font-black uppercase text-indigo-800 hover:underline">Open order line →</a>`
                : ""
          }
          ${
            bundlePreview && s.bundleVariantId
              ? `<button type="button" data-bundle-preview-sample="${idx}" class="mt-1 text-[10px] font-black uppercase text-indigo-800 hover:underline">Open in Bundle Preview →</button>`
              : ""
          }
          ${
            assist && s.mappingAssistEligible
              ? `<button type="button" data-mapping-assist-sample="${idx}" class="mt-1 text-[10px] font-black uppercase text-teal-800 hover:underline">Map this row →</button>`
              : ""
          }
          ${
            shippedAudit && s.manualFinalizeEligible
              ? `<button type="button" data-manual-finalize-sample="${idx}" class="mt-1 text-[10px] font-black uppercase text-red-800 hover:underline">Manual Finalize →</button>`
              : shippedAudit
                ? `<span class="block text-[9px] text-gray-400 mt-0.5">Not eligible for manual finalize</span>`
                : ""
          }
        </li>`,
        )
        .join("")}
    </ul>`;
}

function workflowSection(issue) {
  const status = issue.workflowStatus || "open";
  const key = buildGroupIssueKey(issue.type);
  let snoozeNote = "";
  if (status === "snoozed" && issue.snoozedUntil) {
    const active = isSnoozeActive(issue);
    snoozeNote = active
      ? `Snoozed until ${new Date(issue.snoozedUntil).toLocaleString()}`
      : "Snooze expired — issue is active again in default view.";
  }

  const isClosed = status === "resolved" || status === "ignored";

  const workflowActions = isClosed
    ? `<button type="button" data-issue-workflow="reopen" class="border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase min-h-[44px]">Reopen</button>`
    : `
      <button type="button" data-issue-workflow="reviewed" class="border-2 border-blue-600 text-blue-900 px-3 py-2 text-xs font-black uppercase min-h-[44px]">Mark Reviewed</button>
      <button type="button" data-issue-workflow="snooze-1" class="border-2 border-violet-500 text-violet-900 px-3 py-2 text-xs font-black uppercase min-h-[44px]">Snooze 1d</button>
      <button type="button" data-issue-workflow="snooze-7" class="border-2 border-violet-500 text-violet-900 px-3 py-2 text-xs font-black uppercase min-h-[44px]">Snooze 7d</button>
      <button type="button" data-issue-workflow="snooze-custom" class="border-2 border-violet-300 text-violet-800 px-3 py-2 text-xs font-black uppercase min-h-[44px]">Custom Snooze</button>
      <button type="button" data-issue-workflow="resolved" class="border-2 border-gray-600 bg-gray-800 text-white px-3 py-2 text-xs font-black uppercase min-h-[44px]">Mark Resolved</button>
      <button type="button" data-issue-workflow="ignored" class="border-2 border-gray-400 text-gray-700 px-3 py-2 text-xs font-black uppercase min-h-[44px]">Ignore</button>`;

  return `
    <div class="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/80">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-[10px] font-black uppercase tracking-[.1em] text-gray-500">Workflow</h3>
        <span class="text-[10px] font-black uppercase px-2 py-0.5 border border-gray-300 rounded bg-white">${esc(workflowStatusLabel(status))}</span>
      </div>
      <p class="text-[10px] font-mono text-gray-400">Key: ${esc(key)}</p>
      ${snoozeNote ? `<p class="text-[11px] text-violet-800">${esc(snoozeNote)}</p>` : ""}
      ${issue.resolutionNote ? `<p class="text-[11px] text-gray-600"><strong>Note:</strong> ${esc(issue.resolutionNote)}</p>` : ""}
      <p class="text-[10px] text-gray-500">These actions update workflow state only — they do not change inventory, reservations, or channel listings.</p>
      <div class="flex flex-wrap gap-2">${workflowActions}</div>
    </div>`;
}

/**
 * @param {import('../state.js').InventoryIssueRow} issue
 * @param {import('../api/issuesApi.js').IssueSampleRow[]} samples
 * @param {import('../api/reservationRetryApi.js').ReservationRetryCandidate[]} [retryCandidates]
 */
function renderPanel(issue, samples, retryCandidates = []) {
  const mount = getDom().issueDetailModalMount;
  const panel = mount?.querySelector(".relative");
  if (!panel) return;

  const def = getIssueActionDef(issue.type);
  const severity = def?.severity || issue.severity;
  const description = issue.description || def?.description || "";
  const rootCause = def?.rootCause || "";
  const source = issue.source || def?.source || "";
  const primary = def?.primary;
  const secondary = def?.secondary;

  panel.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Issue Detail</p>
        <h2 class="text-lg font-black">${esc(issue.label)}</h2>
        <p class="text-[10px] font-mono text-gray-400">${esc(issue.type)}</p>
      </div>
      <button type="button" data-issue-detail-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase">Close</button>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="border border-gray-200 rounded-lg p-2"><span class="font-black uppercase text-[9px] text-gray-500">Severity</span><br>${esc(severity)}</div>
      <div class="border border-gray-200 rounded-lg p-2"><span class="font-black uppercase text-[9px] text-gray-500">Affected</span><br><strong>${esc(issue.affectedCount)}</strong></div>
    </div>
    <p class="text-xs text-gray-700">${esc(description)}</p>
    ${rootCause ? `<p class="text-[11px] text-gray-500"><strong>Likely cause:</strong> ${esc(rootCause)}</p>` : ""}
    ${source ? `<p class="text-[10px] font-mono text-gray-400">Source: ${esc(source)}</p>` : ""}
    <div>
      <h3 class="text-[10px] font-black uppercase tracking-[.1em] text-gray-500 mb-1">Sample rows</h3>
      ${renderSamples(issue, samples)}
    </div>
    ${
      issue.type === "unmapped_order_line"
        ? `<div>
            <h3 class="text-[10px] font-black uppercase tracking-[.1em] text-indigo-800 mb-1">Reservation retry candidates</h3>
            ${renderRetryCandidatesSection(retryCandidates)}
          </div>`
        : ""
    }
    ${
      issue.type === "shipped_finalize_audit_needed"
        ? `<button type="button" id="issueDetailShippedAuditBtn" class="w-full border-2 border-red-700 text-red-900 px-3 py-2 text-xs font-black uppercase min-h-[44px]">Open Shipped Finalize Audit</button>`
        : ""
    }
    ${
      issue.type === "unmapped_order_line"
        ? `<button type="button" id="issueDetailEbayWorklistBtn" class="w-full border-2 border-violet-700 text-violet-900 px-3 py-2 text-xs font-black uppercase min-h-[44px]">Open eBay Mapping Worklist</button>`
        : ""
    }
    ${
      issueSupportsMappingAssist(issue)
        ? `<button type="button" id="issueDetailMappingAssistBtn" class="w-full border-2 border-teal-700 text-teal-900 px-3 py-2 text-xs font-black uppercase min-h-[44px]">Open Mapping Assist</button>`
        : ""
    }
    ${workflowSection(issue)}
    <div class="flex flex-wrap gap-2 pt-1">
      ${
        primary
          ? `<button type="button" data-issue-action="${esc(issue.type)}" data-action-role="primary" class="border-2 border-black bg-black text-white px-3 py-2 text-xs font-black uppercase min-h-[44px]">${esc(primary.label)}</button>`
          : ""
      }
      ${
        secondary?.implemented
          ? `<button type="button" data-issue-action="${esc(issue.type)}" data-action-role="secondary" class="border-2 border-gray-400 bg-white text-gray-900 px-3 py-2 text-xs font-black uppercase min-h-[44px]">${esc(secondary.label)}</button>`
          : ""
      }
    </div>
    <p class="text-[10px] text-gray-500">Resolved hides this workflow item until reopened or the issue clears and returns.</p>`;

  wirePanelEvents(panel, issue, samples, retryCandidates);
}

/**
 * @param {HTMLElement} panel
 * @param {import('../state.js').InventoryIssueRow} issue
 * @param {import('../api/issuesApi.js').IssueSampleRow[]} samples
 * @param {import('../api/reservationRetryApi.js').ReservationRetryCandidate[]} retryCandidates
 */
function wirePanelEvents(panel, issue, samples, retryCandidates) {
  panel.querySelectorAll("[data-issue-detail-close]").forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  panel.querySelectorAll("[data-issue-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.getAttribute("data-action-role") || "primary";
      const type = btn.getAttribute("data-issue-action");
      if (!type) return;
      const actionDef = getIssueActionDef(type);
      const action = role === "secondary" ? actionDef?.secondary : actionDef?.primary;
      if (action) {
        closeModal();
        executeIssueAction(action, issue);
      }
    });
  });

  panel.querySelectorAll("[data-issue-workflow]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-issue-workflow");
      if (!action) return;
      btn.setAttribute("disabled", "true");
      try {
        await runWorkflowAction(issue, action);
        closeModal();
        await refreshInventoryAfterIssueStateChange();
        showInventoryToast("Issue workflow updated.", { variant: "success" });
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
        btn.removeAttribute("disabled");
      }
    });
  });

  panel.querySelector("#issueDetailEbayWorklistBtn")?.addEventListener("click", () => {
    closeModal();
    import("./ebayMappingWorklistModal.js").then((mod) => mod.openEbayMappingWorklistModal());
  });

  panel.querySelector("#issueDetailMappingAssistBtn")?.addEventListener("click", () => {
    const first = samples.find((s) => s.mappingAssistEligible) || samples[0];
    if (!first) return;
    void launchMappingAssist(issue, first);
  });

  panel.querySelector("#issueDetailShippedAuditBtn")?.addEventListener("click", () => {
    closeModal();
    void openShippedFinalizeAuditModal({ needsAuditOnly: true });
  });

  panel.querySelectorAll("[data-bundle-preview-sample]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-bundle-preview-sample"));
      const sample = samples[idx];
      if (!sample?.bundleVariantId) return;
      closeModal();
      import("./bundlePreviewModal.js").then((mod) =>
        mod.openBundlePreviewModal({ focusBundleVariantId: sample.bundleVariantId }),
      );
    });
  });

  panel.querySelectorAll("[data-mapping-assist-sample]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-mapping-assist-sample"));
      const sample = samples[idx];
      if (sample) void launchMappingAssist(issue, sample);
    });
  });

  panel.querySelectorAll("[data-manual-finalize-sample]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-manual-finalize-sample"));
      const sample = samples[idx];
      if (sample?.sourceChannel && sample.sourceOrderId && sample.sourceOrderItemId) {
        void launchManualFinalize(sample);
      }
    });
  });

  panel.querySelectorAll("[data-retry-reservation]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-retry-reservation"));
      const candidate = retryCandidates[idx];
      if (candidate) void promptReservationRetry(candidate);
    });
  });
}

/** @param {import('../api/issuesApi.js').IssueSampleRow} sample */
async function launchManualFinalize(sample) {
  try {
    const candidate = await fetchManualFinalizeCandidate(
      sample.sourceChannel || "",
      sample.sourceOrderId || "",
      sample.sourceOrderItemId || "",
    );
    if (!candidate) {
      showInventoryToast("Line not found in shipped audit.", { variant: "error" });
      return;
    }
    closeModal();
    await promptManualFinalize(candidate, {
      onComplete: () => void refreshInventoryAfterIssueStateChange(),
    });
  } catch (err) {
    showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
  }
}

/** @param {import('../state.js').InventoryIssueRow} issue @param {import('../api/issuesApi.js').IssueSampleRow} sample */
async function launchMappingAssist(issue, sample) {
  closeModal();
  await openMappingAssistModal(issue, {
    issueType: issue.type,
    sourceOrderId: sample.sourceOrderId ?? sample.ref ?? null,
    sourceOrderItemId: sample.sourceOrderItemId ?? null,
  });
}

/**
 * @param {import('../state.js').InventoryIssueRow} issue
 * @param {string} action
 */
async function runWorkflowAction(issue, action) {
  switch (action) {
    case "reviewed":
      await markIssueReviewed(issue);
      break;
    case "snooze-1":
      await snoozeIssue(issue, snoozeUntilDays(1));
      break;
    case "snooze-7":
      await snoozeIssue(issue, snoozeUntilDays(7));
      break;
    case "snooze-custom": {
      const raw = window.prompt("Snooze until (YYYY-MM-DD):");
      if (!raw) return;
      const d = new Date(`${raw.trim()}T23:59:59`);
      if (Number.isNaN(d.getTime())) throw new Error("Invalid date.");
      if (d.getTime() <= Date.now()) throw new Error("Snooze date must be in the future.");
      await snoozeIssue(issue, d);
      break;
    }
    case "resolved": {
      const note = window.prompt("Optional resolution note (does not fix inventory):");
      await resolveIssue(issue, note || undefined);
      break;
    }
    case "ignored": {
      const note = window.prompt("Optional note for ignored issue:");
      await ignoreIssue(issue, note || undefined);
      break;
    }
    case "reopen":
      await reopenIssue(issue);
      break;
    default:
      throw new Error("Unknown workflow action.");
  }
}

/**
 * @param {import('../state.js').InventoryIssueRow} issue
 */
export async function openIssueDetailModal(issue) {
  const mount = getDom().issueDetailModalMount;
  if (!mount) return;

  document.body.classList.add("overflow-hidden");

  mount.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <button type="button" class="absolute inset-0 bg-black/50" data-issue-detail-close aria-label="Close"></button>
      <div class="relative bg-white w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl p-4 space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Issue Detail</p>
            <h2 class="text-lg font-black">${esc(issue.label)}</h2>
          </div>
          <button type="button" data-issue-detail-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase">Close</button>
        </div>
        <p class="text-xs text-gray-600" role="status">Loading samples…</p>
      </div>
    </div>`;

  mount.querySelectorAll("[data-issue-detail-close]").forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  let samples = [];
  let retryCandidates = [];
  try {
    samples = await fetchIssueSamples(issue.type, 8);
    if (issue.type === "unmapped_order_line") {
      retryCandidates = await fetchReservationRetryCandidates({ eligibleOnly: false, limit: 8 });
    }
  } catch {
    samples = [];
  }

  renderPanel(issue, samples, retryCandidates);
}

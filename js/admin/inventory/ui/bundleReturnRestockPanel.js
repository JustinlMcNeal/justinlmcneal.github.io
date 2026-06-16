/**
 * Returns / Restock panel — refund guidance + RMA workflow (Phase 10G–10J).
 */

import { esc } from "../utils/formatters.js";
import { formatCents, restockBundleComponentLine } from "../api/bundleReturnRestockApi.js";
import {
  fetchReturnWorkflowGuidance,
  createReturnWorkflow,
  updateReturnWorkflow,
  closeReturnWorkflow,
  linkReturnWorkflowRestock,
} from "../api/returnWorkflowApi.js";
import {
  buildLineItemsOrdersUrl,
  buildOrderReferenceLabel,
  buildInventoryPageUrl,
  channelFromOrderId,
} from "../constants/orderLinks.js";
import { showInventoryToast } from "../events.js";
import { renderRefundBlock, wireRefundPanelActions } from "./bundleReturnRestockRefund.js";
import { renderWorkflowBlock } from "./bundleReturnRestockWorkflow.js";
import { showPostRestockChecklist, restorePostRestockChecklist } from "./bundleReturnRestockChecklist.js";
import {
  renderMarketplaceAssistBlock,
  wireMarketplaceAssistActions,
  marketplaceAssistCanPrefillSuggested,
  marketplaceAssistBlocksRestock,
} from "./bundleReturnRestockMarketplaceAssist.js";
import { fetchMarketplaceRestockAssistMap } from "../api/marketplaceRestockAssistApi.js";
import {
  logMarketplaceRestockAssistAction,
  STALE_OBSERVATION_HOURS,
} from "../api/marketplaceRestockAssistQueueApi.js";

const GUIDANCE_LABELS = {
  restock_available: "Restock available",
  full_refund_after_finalize: "Full refund — suggest restock",
  partial_refund_review: "Partial refund — review",
  already_restocked: "Fully restocked",
  manual_review: "Manual review",
};

const GUIDANCE_CLS = {
  restock_available: "text-green-800 bg-green-50 border-green-200",
  full_refund_after_finalize: "text-amber-900 bg-amber-50 border-amber-200",
  partial_refund_review: "text-orange-900 bg-orange-50 border-orange-200",
  already_restocked: "text-gray-600 bg-gray-50 border-gray-200",
  manual_review: "text-amber-800 bg-amber-50 border-amber-200",
};

/** @type {string|null} */
let _selectedReservationId = null;
/** @type {Record<string, unknown>|null} */
let _lastRestockByReservation = null;
/** @type {boolean} */
let _checklistVisible = false;

/** @param {string} id */
function shortId(id) {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** @typedef {import('../api/returnWorkflowApi.js').ReturnWorkflowGuidanceRow} ReturnWorkflowGuidanceRow */

/** @param {ReturnWorkflowGuidanceRow} row @param {boolean} selected @param {Record<string, unknown>|null} lastRestock @param {import('../api/marketplaceRestockAssistApi.js').MarketplaceRestockAssistRow|null} assist */
function renderGuidanceRow(row, selected, lastRestock, assist) {
  const canManualRestock =
    row.maxRestockableQty > 0 &&
    row.guidanceStatus !== "already_restocked" &&
    row.suggestedAction !== "not_finalized" &&
    (!row.workflowCondition || row.workflowCondition === "resellable" || !row.workflowId) &&
    !marketplaceAssistBlocksRestock(assist, row);
  const mpSuggested = assist?.suggestedRestockQty ?? row.marketplaceSuggestedRestockQty;
  const canPrefillMp = marketplaceAssistCanPrefillSuggested(assist) ||
    (row.marketplaceObservationConfidence === "line_confirmed" &&
      row.marketplaceAssistStatus === "eligible_line_confirmed");
  const suggestedQty = canPrefillMp && mpSuggested != null ? mpSuggested : row.suggestedRestockQty;
  const canSuggestRestock =
    canManualRestock &&
    suggestedQty != null &&
    suggestedQty > 0 &&
    row.guidanceStatus !== "partial_refund_review" &&
    (canPrefillMp || row.guidanceStatus !== "manual_review");
  const defaultQty = suggestedQty ?? row.maxRestockableQty;
  const gCls = GUIDANCE_CLS[row.guidanceStatus] || GUIDANCE_CLS.manual_review;
  const gLabel = GUIDANCE_LABELS[row.guidanceStatus] || row.guidanceStatus;
  const lineId = row.parentOrderItemId || row.sourceOrderItemId || undefined;
  const channel = channelFromOrderId(row.sourceOrderId) || undefined;
  const orderLineUrl = buildLineItemsOrdersUrl({
    sessionId: row.sourceOrderId,
    lineId,
    channel,
    tab: "overview",
  });
  const orderRef = buildOrderReferenceLabel({ sessionId: row.sourceOrderId, lineId, channel });
  const selectedCls = selected ? " ring-2 ring-indigo-400 ring-offset-1 bg-indigo-50/40" : "";

  return `
    <li class="border border-gray-200 rounded p-2 text-[10px] space-y-2${selectedCls}" data-return-candidate="${esc(row.reservationId)}"
      data-workflow-id="${esc(row.workflowId || "")}" data-component-sku="${esc(row.componentSku)}"
      data-parent-bundle="${esc(row.parentBundleVariantId || "")}" data-suggested-qty="${suggestedQty ?? ""}"
      data-max-restock="${row.maxRestockableQty}" data-qty-expected="${row.workflowQuantityExpected ?? row.finalizedQty}">
      <div class="flex flex-wrap justify-between gap-1">
        <span class="font-bold">${esc(row.parentBundleLabel)} → ${esc(row.componentProductLabel)}</span>
        <span class="text-[9px] font-black uppercase px-1.5 py-0.5 border rounded ${gCls}">${esc(gLabel)}</span>
      </div>
      <p class="text-gray-600 font-mono">${esc(row.componentSku)}</p>
      <p class="text-gray-600">
        Finalized ${row.finalizedQty} · restocked ${row.alreadyRestockedQty} · max ${row.maxRestockableQty}
        ${row.suggestedRestockQty != null ? ` · suggested ${row.suggestedRestockQty}` : ""}
      </p>
      <p class="text-gray-500">
        Refund: ${row.refundStatus ? esc(row.refundStatus) : "none"}
        ${row.refundedAmountCents != null ? ` · ${formatCents(row.refundedAmountCents)} of ${formatCents(row.orderTotalCents)}` : ""}
      </p>
      <p class="text-amber-900 bg-amber-50 border border-amber-100 rounded p-1.5">${esc(row.guidanceReason)}</p>
      ${renderRefundBlock(row)}
      ${renderMarketplaceAssistBlock(row, assist)}
      ${renderWorkflowBlock(row, lastRestock)}
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-gray-600 border-t border-gray-100 pt-1.5">
        <span title="${esc(row.reservationId)}">Reservation: <span class="font-mono">${esc(shortId(row.reservationId))}</span></span>
        ${
          row.matchingLedgerId
            ? `<a href="${esc(buildInventoryPageUrl({ q: row.componentSku }))}" target="_blank" rel="noopener" class="text-indigo-700 hover:underline">Finalize ledger →</a>`
            : ""
        }
        <button type="button" data-copy-order-ref="${esc(orderRef)}" class="text-gray-700 hover:underline">Copy ref</button>
      </div>
      <a href="${esc(orderLineUrl)}" target="_blank" rel="noopener"
        class="inline-block border-2 border-indigo-700 text-indigo-900 px-2 py-1 text-[9px] font-black uppercase">Open Order Line</a>
      ${
        canManualRestock
          ? `<div class="flex flex-wrap gap-2 items-end pt-1">
          <label class="text-[9px] uppercase text-gray-500">Restock qty
            <input type="number" min="1" max="${row.maxRestockableQty}" value="${defaultQty}"
              data-restock-qty class="block w-20 border border-gray-300 rounded px-1 py-0.5 text-[11px] mt-0.5" />
          </label>
          <label class="flex-1 min-w-[120px] text-[9px] uppercase text-gray-500">Note
            <input type="text" data-restock-note placeholder="Return reason / RMA"
              class="block w-full border border-gray-300 rounded px-1 py-0.5 text-[11px] mt-0.5" />
          </label>
          ${
            canSuggestRestock
              ? `<button type="button" data-restock-suggested
                class="border-2 border-green-600 bg-green-100 text-green-900 px-2 py-1 text-[9px] font-black uppercase">
                Restock suggested qty (${suggestedQty})
              </button>`
              : ""
          }
          <button type="button" data-restock-confirm
            class="border-2 border-green-700 text-green-900 px-2 py-1 text-[9px] font-black uppercase">
            Restock Confirmed Qty
          </button>
        </div>`
          : row.workflowCondition === "damaged" || row.workflowCondition === "missing"
            ? `<p class="text-[9px] text-amber-800">Restock blocked — workflow condition is ${esc(row.workflowCondition)}.</p>`
            : ""
      }
    </li>`;
}

/** @param {ReturnWorkflowGuidanceRow[]} rows @param {Record<string, unknown>|null} lastRestock @param {Map<string, import('../api/marketplaceRestockAssistApi.js').MarketplaceRestockAssistRow>} assistMap */
function renderPanelBody(rows, lastRestock, assistMap) {
  if (!rows.length) {
    return `<p class="text-[10px] text-gray-400">No finalized live bundle component lines found.</p>`;
  }
  const pending = rows.filter((r) => r.maxRestockableQty > 0 && r.guidanceStatus !== "already_restocked").length;
  const withWf = rows.filter((r) => r.workflowId).length;
  return `
    <div class="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 mb-2 space-y-1">
      <p>Refund detected does not always mean item was returned.</p>
      <p>Return workflow tracks physical return state only — stock changes only after confirmed restock.</p>
    </div>
    <p class="text-[10px] text-gray-600 mb-2">${rows.length} line(s) · ${pending} restock remaining · ${withWf} with RMA workflow</p>
    <ul class="space-y-2 max-h-72 overflow-y-auto">${rows
      .map((row) =>
        renderGuidanceRow(
          row,
          _selectedReservationId === row.reservationId,
          lastRestock &&
            String(lastRestock.reservation_id || lastRestock.reservationId) === row.reservationId
            ? lastRestock
            : null,
          assistMap.get(row.reservationId) || null,
        ),
      )
      .join("")}</ul>`;
}

/** @param {HTMLElement} wrap @param {number} qty @param {string} reservationId @param {() => Promise<void>} reload @param {HTMLElement} section @param {import('../api/marketplaceRestockAssistApi.js').MarketplaceRestockAssistRow|null} assist @param {ReturnWorkflowGuidanceRow|null} row */
async function performRestock(wrap, qty, reservationId, reload, section, assist, row) {
  if (!Number.isFinite(qty) || qty <= 0) {
    showInventoryToast("Enter a valid restock quantity.", { variant: "error" });
    return;
  }

  const max = Number(wrap.getAttribute("data-max-restock") || row?.maxRestockableQty || 0);
  if (max > 0 && qty > max) {
    showInventoryToast(`Restock qty cannot exceed max restockable (${max}).`, { variant: "error" });
    return;
  }

  if (row?.workflowCondition === "damaged" || row?.workflowCondition === "missing") {
    showInventoryToast(`Restock blocked — workflow condition is ${row.workflowCondition}.`, { variant: "error" });
    return;
  }

  const mpStatus = assist?.assistStatus || row?.marketplaceAssistStatus;
  const isStale =
    assist?.isObservationStale ||
    (assist?.observationAgeHours != null && assist.observationAgeHours > STALE_OBSERVATION_HOURS);
  if (isStale && mpStatus === "eligible_line_confirmed") {
    showInventoryToast(`Observation older than ${STALE_OBSERVATION_HOURS}h — refresh before restocking.`, {
      variant: "error",
    });
    return;
  }
  if (mpStatus === "eligible_line_confirmed") {
    const ack = wrap.querySelector("[data-mp-restock-ack]");
    if (!(ack instanceof HTMLInputElement) || !ack.checked) {
      showInventoryToast(
        "Confirm: the component was physically returned and is resellable.",
        { variant: "error" },
      );
      return;
    }
  } else if (
    mpStatus === "needs_physical_return_confirmation" ||
    mpStatus === "needs_rma_workflow" ||
    mpStatus === "afn_external_review"
  ) {
    showInventoryToast("Complete marketplace restock assist steps before restocking.", { variant: "error" });
    return;
  }

  if (
    !window.confirm(
      "Restock this component line?\n\nI confirmed the component was physically returned and is resellable.\n\nThis will add stock back to the component variant only. It will not restock the parent bundle SKU.",
    )
  ) {
    return;
  }

  const noteEl = wrap.querySelector("[data-restock-note]");
  const note = noteEl instanceof HTMLInputElement ? noteEl.value.trim() : "";

  try {
    const result = await restockBundleComponentLine({
      reservationId,
      restockQty: qty,
      note: note || null,
      idempotencyKey: `ui_restock:${reservationId}:${qty}`,
    });

    if (assist?.observationId || row?.marketplaceObservationId) {
      try {
        await logMarketplaceRestockAssistAction({
          reservationId,
          returnWorkflowId: row?.workflowId || assist?.workflowId || null,
          observationId: assist?.observationId || row?.marketplaceObservationId || null,
          actionType: "restock_confirmed",
          qty,
          previousStatus: assist?.assistStatus || row?.marketplaceAssistStatus || null,
          nextStatus: "already_restocked",
          note: note || null,
          rawContext: {
            suggested_restock_qty: assist?.suggestedRestockQty ?? row?.marketplaceSuggestedRestockQty,
            observation_confidence: assist?.observationConfidence ?? row?.marketplaceObservationConfidence,
            restock_result: result,
            ledger_id: result?.ledger_id ?? null,
            audit_id: result?.audit_id ?? null,
          },
        });
      } catch (auditErr) {
        console.warn("[restock] assist audit log failed:", auditErr);
      }
    }

    _selectedReservationId = reservationId;
    _lastRestockByReservation = { ...result, reservationId };
    _checklistVisible = true;

    showInventoryToast("Component stock restored.", { variant: "success" });
    showPostRestockChecklist(section, {
      componentSku: wrap.getAttribute("data-component-sku") || undefined,
      parentBundleVariantId: wrap.getAttribute("data-parent-bundle") || null,
      restockQty: qty,
      restockActionId: result?.audit_id ? String(result.audit_id) : undefined,
      ledgerId: result?.ledger_id ? String(result.ledger_id) : undefined,
      onDismiss: () => {
        _checklistVisible = false;
      },
    });

    const workflowId = wrap.getAttribute("data-workflow-id");
    if (workflowId && window.confirm("Mark this return workflow as restocked for the qty just confirmed?")) {
      try {
        await linkReturnWorkflowRestock({
          workflowId,
          restockQty: qty,
          reservationId,
        });
        showInventoryToast("Return workflow updated.", { variant: "success" });
      } catch (err) {
        showInventoryToast(
          err instanceof Error ? err.message : "Workflow link failed — stock restock still applied.",
          { variant: "error" },
        );
      }
    }

    await reload();
  } catch (err) {
    showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
  }
}

/** @param {HTMLElement} container @param {() => Promise<void>} reload @param {Map<string, import('../api/marketplaceRestockAssistApi.js').MarketplaceRestockAssistRow>} assistMap @param {ReturnWorkflowGuidanceRow[]} rows */
function wirePanelActions(container, reload, assistMap, rows) {
  const section = container.querySelector("[data-return-restock-section]") || container;
  const rowByReservation = new Map(rows.map((r) => [r.reservationId, r]));

  container.querySelectorAll("[data-return-candidate]").forEach((wrap) => {
    const reservationId = wrap.getAttribute("data-return-candidate");
    if (!reservationId) return;
    const assist = assistMap.get(reservationId) || null;
    const row = rowByReservation.get(reservationId) || null;

    wireMarketplaceAssistActions(wrap, assist, reload);

    wrap.addEventListener("click", (e) => {
      if (e.target instanceof HTMLElement && e.target.closest("button, a, input, label")) return;
      _selectedReservationId = reservationId;
      container.querySelectorAll("[data-return-candidate]").forEach((el) => {
        el.classList.remove("ring-2", "ring-indigo-400", "ring-offset-1", "bg-indigo-50/40");
      });
      wrap.classList.add("ring-2", "ring-indigo-400", "ring-offset-1", "bg-indigo-50/40");
    });

    wrap.querySelector("[data-restock-suggested]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const qtyEl = wrap.querySelector("[data-restock-qty]");
      const qty = qtyEl instanceof HTMLInputElement ? Number(qtyEl.value) : 0;
      await performRestock(wrap, qty, reservationId, reload, /** @type {HTMLElement} */ (section), assist, row);
    });

    wrap.querySelector("[data-restock-confirm]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const qtyEl = wrap.querySelector("[data-restock-qty]");
      const qty = qtyEl instanceof HTMLInputElement ? Number(qtyEl.value) : 0;
      await performRestock(wrap, qty, reservationId, reload, /** @type {HTMLElement} */ (section), assist, row);
    });

    wrap.querySelector("[data-wf-create]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const rma = window.prompt("RMA number (optional):");
      const tracking = window.prompt("Tracking number (optional):");
      const qtyExpected = Number(wrap.getAttribute("data-qty-expected") || wrap.getAttribute("data-max-restock"));
      try {
        await createReturnWorkflow({
          reservationId,
          quantityExpected: Number.isFinite(qtyExpected) && qtyExpected > 0 ? qtyExpected : undefined,
          rmaNumber: rma || undefined,
          trackingNumber: tracking || undefined,
        });
        showInventoryToast("Return workflow created.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelector("[data-wf-received]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const workflowId = wrap.getAttribute("data-workflow-id");
      if (!workflowId) return;
      const raw = window.prompt("Quantity received:", wrap.getAttribute("data-qty-expected") || "1");
      const qty = Number(raw);
      if (!Number.isFinite(qty) || qty <= 0) {
        showInventoryToast("Enter a valid received quantity.", { variant: "error" });
        return;
      }
      try {
        await updateReturnWorkflow({
          workflowId,
          status: qty < Number(wrap.getAttribute("data-qty-expected") || qty) ? "partially_received" : "received",
          quantityReceived: qty,
        });
        showInventoryToast("Return marked received.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelector("[data-wf-inspect-resellable]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const workflowId = wrap.getAttribute("data-workflow-id");
      if (!workflowId) return;
      try {
        await updateReturnWorkflow({ workflowId, status: "inspected", condition: "resellable" });
        showInventoryToast("Marked inspected — resellable.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelector("[data-wf-inspect-damaged]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const workflowId = wrap.getAttribute("data-workflow-id");
      if (!workflowId) return;
      const cond = window.confirm("Mark as damaged? (Cancel = missing)") ? "damaged" : "missing";
      try {
        await updateReturnWorkflow({ workflowId, status: "inspected", condition: cond });
        showInventoryToast(`Marked inspected — ${cond}.`, { variant: "info" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelector("[data-wf-note]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const workflowId = wrap.getAttribute("data-workflow-id");
      if (!workflowId) return;
      const note = window.prompt("Add workflow note:");
      if (note === null) return;
      try {
        await updateReturnWorkflow({ workflowId, note: note.trim() || null });
        showInventoryToast("Note added.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    wrap.querySelector("[data-wf-close]")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const workflowId = wrap.getAttribute("data-workflow-id");
      if (!workflowId) return;
      if (!window.confirm("Close this return workflow?")) return;
      try {
        await closeReturnWorkflow(workflowId);
        showInventoryToast("Return workflow closed.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });
  });

  wireRefundPanelActions(container, reload);
}

/** @param {HTMLElement} body @param {() => Promise<void>} reload */
export async function mountReturnRestockSection(body, reload) {
  const mount = body.querySelector("#bundleReturnRestockMount");
  if (!mount) return;

  if (!mount.querySelector("[data-return-restock-section]")) {
    mount.innerHTML = `<p class="text-[10px] text-gray-400">Loading return guidance…</p>`;
  }

  try {
    const rows = await fetchReturnWorkflowGuidance({ limit: 30 });
    const assistMap = await fetchMarketplaceRestockAssistMap(rows.map((r) => r.reservationId));
    mount.innerHTML = `
      <section class="border border-gray-200 rounded-lg p-3 mt-2" data-return-restock-section>
        <h3 class="text-[10px] font-black uppercase text-gray-400 mb-2">Returns / Restock (live bundle components)</h3>
        ${renderPanelBody(rows, _lastRestockByReservation, assistMap)}
      </section>`;
    wirePanelActions(mount, async () => mountReturnRestockSection(body, reload), assistMap, rows);
    if (_selectedReservationId) {
      mount.querySelector(`[data-return-candidate="${CSS.escape(_selectedReservationId)}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
    const section = mount.querySelector("[data-return-restock-section]");
    if (section instanceof HTMLElement && _checklistVisible && _lastRestockByReservation) {
      restorePostRestockChecklist(section, _lastRestockByReservation, () => {
        _checklistVisible = false;
      });
    }
  } catch (err) {
    mount.innerHTML = `<p class="text-[10px] text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

import { qs } from "./dom.js";
import { bulkPatchAmazonListings } from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import { escapeHtml } from "./renderListings.js";

const BULK_BATCH_SIZE = 50;

/** @type {boolean} */
let submitting = false;

/** @type {{ getSelectedIds?: () => string[], onComplete?: () => Promise<void> | void, openModal?: () => void, closeModal?: () => void }} */
let deps = {};

const OPERATION_LABELS = {
  set_price: "Set price to amount",
  adjust_price_percent: "Adjust price by %",
  adjust_price_amount: "Adjust price by $",
  match_kk_price: "Match KK website price",
  set_quantity: "Set FBM quantity",
  match_kk_stock: "Match KK website stock",
  match_kk_price_and_stock: "Match KK price & stock",
};

const VALUE_OPERATIONS = new Set([
  "set_price",
  "adjust_price_percent",
  "adjust_price_amount",
  "set_quantity",
]);

function readOperation() {
  const el = qs("#amazonBulkPatchOperation");
  return el instanceof HTMLSelectElement ? el.value : "";
}

function readValue() {
  const el = qs("#amazonBulkPatchValue");
  if (!(el instanceof HTMLInputElement)) return null;
  if (!el.value.trim()) return null;
  return Number(el.value);
}

function updateValueFieldVisibility() {
  const operation = readOperation();
  const wrap = qs("#amazonBulkPatchValueSection");
  const label = qs("#amazonBulkPatchValueLabel");
  if (!wrap || !label) return;

  const needsValue = VALUE_OPERATIONS.has(operation);
  wrap.classList.toggle("hidden", !needsValue);

  if (operation === "set_price" || operation === "adjust_price_amount") {
    label.textContent = "Amount (USD)";
  } else if (operation === "adjust_price_percent") {
    label.textContent = "Percent change (+10 = +10%)";
  } else if (operation === "set_quantity") {
    label.textContent = "Quantity (whole number)";
  }
}

function renderResults(payload) {
  const panel = qs("#amazonBulkPatchResults");
  if (!panel) return;

  const summary = payload.summary || {};
  const results = Array.isArray(payload.results) ? payload.results : [];

  const lines = results.slice(0, 25).map((row) => {
    const sku = escapeHtml(String(row.sellerSku || row.amazonListingId || "—"));
    const status = String(row.status || "failed");
    const tone = status === "success"
      ? "text-green-800"
      : status === "skipped"
        ? "text-gray-600"
        : "text-red-700";
    const detail = row.error ? ` — ${escapeHtml(String(row.error))}` : "";
    return `<li class="${tone}"><span class="font-mono text-[11px]">${sku}</span> · ${status}${detail}</li>`;
  }).join("");

  const more = results.length > 25
    ? `<p class="text-[11px] text-gray-500 mt-2">Showing first 25 of ${results.length} rows.</p>`
    : "";

  panel.classList.remove("hidden");
  panel.innerHTML = `
    <p class="text-xs font-bold">
      ${Number(summary.succeeded || 0)} succeeded ·
      ${Number(summary.failed || 0)} failed ·
      ${Number(summary.skipped || 0)} skipped
    </p>
    <ul class="mt-2 space-y-1 text-xs max-h-40 overflow-y-auto">${lines || "<li>No row results.</li>"}</ul>
    ${more}
  `;
}

function setSubmitting(active) {
  submitting = active;
  for (const selector of ['[data-action="preview-bulk-patch"]', '[data-action="apply-bulk-patch"]']) {
    const btn = qs(selector);
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.disabled = active;
    btn.setAttribute("aria-disabled", active ? "true" : "false");
  }
}

async function runBulkPatch(preview) {
  if (submitting) return;

  const ids = deps.getSelectedIds?.() || [];
  if (!ids.length) {
    showAmazonNotification("Select at least one listing.", { tone: "warning" });
    return;
  }

  const operation = readOperation();
  if (!operation) {
    showAmazonNotification("Choose a bulk update operation.", { tone: "warning" });
    return;
  }

  const value = readValue();
  if (VALUE_OPERATIONS.has(operation) && (value === null || !Number.isFinite(value))) {
    showAmazonNotification("Enter a valid value for this operation.", { tone: "warning" });
    return;
  }

  if (!preview && !window.confirm(`Apply this bulk update to ${ids.length} listing(s) on live Amazon?`)) {
    return;
  }

  setSubmitting(true);
  try {
    /** @type {Record<string, unknown>} */
    let mergedSummary = { total: 0, succeeded: 0, failed: 0, skipped: 0 };
    /** @type {Array<Record<string, unknown>>} */
    const mergedResults = [];

    for (let offset = 0; offset < ids.length; offset += BULK_BATCH_SIZE) {
      const batchIds = ids.slice(offset, offset + BULK_BATCH_SIZE);
      const result = await bulkPatchAmazonListings({
        amazonListingIds: batchIds,
        operation,
        value: VALUE_OPERATIONS.has(operation) ? value : undefined,
        preview,
      });

      const summary = result.summary || {};
      mergedSummary = {
        total: Number(mergedSummary.total) + Number(summary.total || 0),
        succeeded: Number(mergedSummary.succeeded) + Number(summary.succeeded || 0),
        failed: Number(mergedSummary.failed) + Number(summary.failed || 0),
        skipped: Number(mergedSummary.skipped) + Number(summary.skipped || 0),
      };
      mergedResults.push(...(result.results || []));
    }

    renderResults({ summary: mergedSummary, results: mergedResults });

    if (preview) {
      showAmazonNotification("Bulk validation preview complete.", { tone: "success" });
      return;
    }

    showAmazonNotification(
      `Bulk update finished — ${mergedSummary.succeeded} succeeded, ${mergedSummary.failed} failed.`,
      { tone: mergedSummary.failed > 0 ? "warning" : "success" },
    );
    await deps.onComplete?.();
  } catch (err) {
    renderResults({ summary: {}, results: [{ status: "failed", error: err?.code || "request_failed" }] });
    showAmazonNotification(bulkErrorMessage(err), { tone: "error" });
  } finally {
    setSubmitting(false);
  }
}

/** @param {Record<string, unknown>} err */
function bulkErrorMessage(err) {
  const code = err?.code || err?.error || "request_failed";
  const messages = {
    live_patch_disabled: "Live listing updates are disabled on the server.",
    batch_limit_exceeded: "Too many listings in one batch (max 50).",
    invalid_request: "Invalid bulk update request.",
    unauthorized: "Please sign in as an admin.",
    database_error: "Bulk update failed.",
  };
  return messages[code] || "Bulk update failed.";
}

export function hydrateAmazonBulkPatchModal(selectedCount) {
  const countEl = qs("#amazonBulkPatchSelectedCount");
  if (countEl) countEl.textContent = String(selectedCount);

  const results = qs("#amazonBulkPatchResults");
  if (results) {
    results.classList.add("hidden");
    results.innerHTML = "";
  }

  updateValueFieldVisibility();
}

/**
 * @param {{
 *   getSelectedIds?: () => string[],
 *   onComplete?: () => Promise<void> | void,
 *   openModal?: () => void,
 *   closeModal?: () => void,
 * }} options
 */
export function initAmazonBulkPatch(options = {}) {
  deps = options;

  const operationEl = qs("#amazonBulkPatchOperation");
  operationEl?.addEventListener("change", updateValueFieldVisibility);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-action="open-bulk-patch-modal"]')) {
      event.preventDefault();
      const ids = deps.getSelectedIds?.() || [];
      if (!ids.length) {
        showAmazonNotification("Select at least one listing.", { tone: "warning" });
        return;
      }
      hydrateAmazonBulkPatchModal(ids.length);
      deps.openModal?.();
      return;
    }

    if (target.closest('[data-action="preview-bulk-patch"]')) {
      event.preventDefault();
      runBulkPatch(true).catch(() => {});
      return;
    }

    if (target.closest('[data-action="apply-bulk-patch"]')) {
      event.preventDefault();
      runBulkPatch(false).catch(() => {});
    }
  });

  return { hydrateAmazonBulkPatchModal };
}

export { OPERATION_LABELS };

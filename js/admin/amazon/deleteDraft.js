import { deleteAmazonDraft } from "./api.js";
import { showAmazonNotification } from "./notifications.js";

/** @type {boolean} */
let deleting = false;

/**
 * @param {string} title
 * @param {string} status
 */
function buildConfirmMessage(title, status) {
  const label = title || "this draft";
  if (status === "submitted") {
    return `Delete local tracking for "${label}"?\n\nThe Amazon listing (if accepted) is unchanged. Verification retry metadata will be removed.`;
  }
  return `Delete the local Amazon draft for "${label}"?\n\nThis does not change anything on Amazon.`;
}

/** @param {Record<string, unknown>} err */
function deleteErrorMessage(err) {
  const code = err?.code || "request_failed";
  const messages = {
    draft_not_found: "Draft not found.",
    draft_not_deletable: "Published drafts cannot be deleted.",
    invalid_request: "Invalid delete request.",
    unauthorized: "Please sign in as an admin.",
    database_error: "Could not delete draft.",
  };
  return messages[code] || "Could not delete draft.";
}

/**
 * @param {string} draftId
 * @param {{ draftStatus?: string, title?: string }} [context]
 * @param {{ getDraftRowById?: (id: string) => Record<string, unknown> | null, onDeleted?: () => Promise<void> | void, closeModals?: () => void }} deps
 */
export async function requestDeleteAmazonDraft(draftId, context = {}, deps = {}) {
  if (!draftId || deleting) return;

  const row = deps.getDraftRowById?.(draftId);
  const status = String(row?.draft_status || context.draftStatus || "");
  const title = String(row?.kk_product_title || row?.kk_sku || context.title || "this draft");

  if (!window.confirm(buildConfirmMessage(title, status))) {
    return;
  }

  deleting = true;
  try {
    await deleteAmazonDraft(draftId);
    showAmazonNotification("Local draft deleted.", { tone: "success" });
    deps.closeModals?.();
    await deps.onDeleted?.();
  } catch (err) {
    showAmazonNotification(deleteErrorMessage(err), { tone: "error" });
  } finally {
    deleting = false;
  }
}

/**
 * @param {{
 *   getDraftRowById?: (id: string) => Record<string, unknown> | null,
 *   onDeleted?: () => Promise<void> | void,
 *   closeModals?: () => void,
 * }} [options]
 */
export function initAmazonDeleteDraft(options = {}) {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest('[data-action="delete-amazon-draft"], [data-action="delete-draft"]');
    if (!actionEl) return;

    event.preventDefault();

    const draftId = actionEl.dataset.draftId || "";
    if (!draftId) {
      showAmazonNotification("No draft linked to this action.", { tone: "warning" });
      return;
    }

    requestDeleteAmazonDraft(
      draftId,
      {
        draftStatus: actionEl.dataset.draftStatus || "",
        title: actionEl.dataset.sku || actionEl.dataset.title || "",
      },
      options,
    ).catch(() => {});
  });

  return {
    requestDeleteAmazonDraft: (draftId, context) =>
      requestDeleteAmazonDraft(draftId, context, options),
  };
}

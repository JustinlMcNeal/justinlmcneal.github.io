import {
  fetchAmazonDraftsIssues,
  requeueAmazonDraftVerification,
  bulkRequeueAmazonDraftVerification,
} from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import { renderDraftsIssues } from "./renderDraftsIssues.js";

/** @type {Map<string, Record<string, unknown>>} */
let draftRowsById = new Map();

export function getDraftRowById(draftId) {
  return draftRowsById.get(String(draftId)) || null;
}

/**
 * @param {{ onDraftsLoaded?: () => void }} [deps]
 */
export function initAmazonDraftsIssues(deps = {}) {
  /** @type {boolean} */
  let requeueSaving = false;

  async function refreshDraftsIssues() {
    try {
      const rows = await fetchAmazonDraftsIssues({ limit: 50 });
      draftRowsById = new Map(rows.map((row) => [String(row.draft_id), row]));
      renderDraftsIssues(rows);
      deps.onDraftsLoaded?.();
      return rows;
    } catch {
      showAmazonNotification("Could not load Amazon drafts.", { tone: "error" });
      return [];
    }
  }

  document.addEventListener("amazon:view-change", (event) => {
    const view = event.detail?.view;
    if (view === "drafts-issues") refreshDraftsIssues().catch(() => {});
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionEl = target.closest("[data-action]");
    if (!actionEl) return;

    if (actionEl.dataset.action === "scroll-submitted-drafts") {
      event.preventDefault();
      const firstSubmitted = document.querySelector('[data-submitted-draft="true"]');
      firstSubmitted?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (actionEl.dataset.action === "scroll-max-attempt-drafts") {
      event.preventDefault();
      const firstMax = document.querySelector('[data-max-attempt-draft="true"]');
      firstMax?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (actionEl.dataset.action === "bulk-requeue-max-attempt-drafts") {
      event.preventDefault();
      if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return;
      if (requeueSaving) return;

      requeueSaving = true;
      bulkRequeueAmazonDraftVerification({ allMaxAttempts: true })
        .then(async (result) => {
          const count = Number(result.requeuedCount || 0);
          const skipped = Number(result.skippedCount || 0);
          showAmazonNotification(
            skipped > 0
              ? `Requeued ${count} draft(s). ${skipped} could not be requeued.`
              : `Requeued ${count} max-attempt draft(s) for automatic retry.`,
            { tone: count > 0 ? "success" : "warning" },
          );
          await refreshDraftsIssues();
        })
        .catch((err) => {
          const messages = {
            no_drafts_to_requeue: "No max-attempt drafts to requeue.",
            unauthorized: "Please sign in as an admin.",
            database_error: "Could not bulk requeue drafts.",
            invalid_request: "Invalid bulk requeue request.",
          };
          showAmazonNotification(messages[err?.code] || "Could not bulk requeue drafts.", {
            tone: "error",
          });
        })
        .finally(() => {
          requeueSaving = false;
        });
      return;
    }

    if (actionEl.dataset.action !== "requeue-draft-verification") return;
    event.preventDefault();
    if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return;

    const draftId = actionEl.dataset.draftId;
    if (!draftId || requeueSaving) return;

    requeueSaving = true;
    requeueAmazonDraftVerification(String(draftId))
      .then(async () => {
        showAmazonNotification("Draft verification requeued for automatic retry.", {
          tone: "success",
        });
        await refreshDraftsIssues();
      })
      .catch((err) => {
        const messages = {
          draft_not_found: "Draft not found.",
          draft_not_submitted: "Only submitted drafts can be requeued.",
          invalid_request: "Invalid requeue request.",
          unauthorized: "Please sign in as an admin.",
          database_error: "Could not requeue draft verification.",
        };
        showAmazonNotification(messages[err?.code] || "Could not requeue draft verification.", {
          tone: "error",
        });
      })
      .finally(() => {
        requeueSaving = false;
      });
  });

  return {
    refreshDraftsIssues,
    getDraftRowById: (draftId) => draftRowsById.get(String(draftId)) || null,
  };
}

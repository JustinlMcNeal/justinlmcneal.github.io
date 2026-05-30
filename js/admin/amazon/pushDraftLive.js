import { qs } from "./dom.js";
import { submitAmazonDraftLive } from "./api.js";
import { showAmazonNotification } from "./notifications.js";

export const LIVE_CONFIRM_PHRASE = "PUBLISH_TO_AMAZON";

const READINESS_LABELS = {
  "product-type": "Product type selected",
  "ptd-loaded": "Amazon requirements loaded",
  "ptd-preview": "Local / PTD preview complete",
  "amazon-preview": "Amazon submit preview valid",
  "ready-status": "Ready for live submit",
};

function readInput(id) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim();
  }
  return "";
}

function setInput(id, value) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = value ?? "";
  }
}

function isPreviewAccepted(status) {
  const normalized = String(status || "").toUpperCase();
  return normalized === "VALID" || normalized === "ACCEPTED";
}

function parseIsoMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function isPtdPreviewCurrent() {
  const previewedAt = readInput("#amazonPushPtdPreviewAt");
  const draftUpdatedAt = readInput("#amazonPushDraftUpdatedAt");
  const amazonPreviewAt = readInput("#amazonPushAmazonPreviewAt");
  const productType = readInput("#amazonPushProductType");
  const previewProductType = readInput("#amazonPushPtdPreviewProductType");

  if (!previewedAt || !productType) return false;
  if (previewProductType && previewProductType !== productType) return false;

  const previewMs = parseIsoMs(previewedAt);
  const updatedMs = parseIsoMs(draftUpdatedAt);
  const amazonMs = parseIsoMs(amazonPreviewAt);
  if (previewMs === null) return false;
  if (updatedMs === null) return true;

  const freshnessAnchor = amazonMs !== null && amazonMs >= previewMs ? amazonMs : previewMs;
  return updatedMs <= freshnessAnchor;
}

function hasPtdRequirementsLoaded() {
  const list = qs("#amazonPushRequiredAttributes");
  if (!list) return false;
  const placeholder = list.querySelector(".text-gray-400");
  return !placeholder && list.children.length > 0;
}

function computeReadinessState() {
  const draftId = readInput("#amazonPushDraftId");
  const draftStatus = readInput("#amazonPushDraftStatus");
  const previewValidated = readInput("#amazonPushPreviewValidated") === "true";
  const previewStatus = readInput("#amazonPushPreviewStatus");
  const productTypeSelected = Boolean(readInput("#amazonPushProductType"));
  const ptdLoaded = hasPtdRequirementsLoaded();
  const ptdPreview = isPtdPreviewCurrent();
  const amazonPreview = previewValidated && isPreviewAccepted(previewStatus);
  const readyStatus = draftStatus === "ready_to_submit";

  return {
    draftId,
    draftStatus,
    productTypeSelected,
    ptdLoaded,
    ptdPreview,
    amazonPreview,
    readyStatus,
    submitEnabled: Boolean(draftId) &&
      productTypeSelected &&
      ptdLoaded &&
      ptdPreview &&
      amazonPreview &&
      readyStatus,
  };
}

function renderReadinessChecklist(state) {
  const panel = qs("#amazonPushSubmitReadiness");
  if (!panel) return;

  const flags = {
    "product-type": state.productTypeSelected,
    "ptd-loaded": state.ptdLoaded,
    "ptd-preview": state.ptdPreview,
    "amazon-preview": state.amazonPreview,
    "ready-status": state.readyStatus && state.amazonPreview && state.ptdPreview,
  };

  panel.querySelectorAll("[data-readiness-item]").forEach((item) => {
    const key = item.getAttribute("data-readiness-item");
    const done = Boolean(flags[key]);
    item.classList.toggle("text-green-800", done);
    item.classList.toggle("text-gray-500", !done);
    item.classList.toggle("font-medium", done);
    const icon = item.querySelector("span[aria-hidden]");
    if (icon) icon.textContent = done ? "✓" : "○";
    const label = READINESS_LABELS[key];
    const textSpan = item.querySelector("span:last-child");
    if (textSpan && label) textSpan.textContent = label;
  });
}

export function setPtdPreviewMeta(meta = {}) {
  if (meta.previewedAt != null) setInput("#amazonPushPtdPreviewAt", String(meta.previewedAt));
  if (meta.productType != null) setInput("#amazonPushPtdPreviewProductType", String(meta.productType));
  updateLiveSubmitReadiness();
}

export function setDraftSubmitMeta(meta = {}) {
  if (meta.draftStatus != null) setInput("#amazonPushDraftStatus", String(meta.draftStatus));
  if (meta.submissionStatus != null) setInput("#amazonPushPreviewStatus", String(meta.submissionStatus));
  if (meta.previewValidated != null) {
    setInput("#amazonPushPreviewValidated", meta.previewValidated ? "true" : "false");
  }
  if (meta.draftUpdatedAt != null) setInput("#amazonPushDraftUpdatedAt", String(meta.draftUpdatedAt));
  if (meta.amazonPreviewAt != null) setInput("#amazonPushAmazonPreviewAt", String(meta.amazonPreviewAt));
  updateLiveSubmitReadiness();
}

export function updateLiveSubmitReadiness() {
  const state = computeReadinessState();
  renderReadinessChecklist(state);

  const btn = qs('[data-action="submit-amazon-listing"]');
  if (!(btn instanceof HTMLButtonElement)) return;

  btn.disabled = !state.submitEnabled;
  btn.setAttribute("aria-disabled", state.submitEnabled ? "false" : "true");
  btn.title = state.submitEnabled
    ? "Submit this draft to Amazon Seller Central"
    : "Complete the readiness checklist before live submit";
  btn.classList.toggle("opacity-50", !state.submitEnabled);
  btn.classList.toggle("cursor-not-allowed", !state.submitEnabled);
  btn.classList.toggle("hover:bg-gray-900", state.submitEnabled);
}

function openLiveSubmitModal() {
  const modal = qs("#amazonLiveSubmitModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  setInput("#amazonLiveSubmitConfirmPhrase", "");
  qs("#amazonLiveSubmitConfirmPhrase")?.focus?.();
}

function closeLiveSubmitModal() {
  const modal = qs("#amazonLiveSubmitModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  setInput("#amazonLiveSubmitConfirmPhrase", "");
}

function formatDraftNotReadyMessage(reasons) {
  const labels = {
    missing_product_type: "Product type is required.",
    ptd_preview_required: "Run Preview Amazon Requirements after your latest draft changes.",
    amazon_validation_preview_required: "Run Preview Amazon Submit with VALID or ACCEPTED status.",
    open_validation_errors: "Resolve open validation errors first.",
    open_push_errors: "Resolve open Amazon preview errors first.",
    missing_last_validation_result: "Validation results are missing. Run previews again.",
    draft_status_not_ready: "Draft must reach ready_to_submit status.",
  };
  if (!Array.isArray(reasons) || !reasons.length) {
    return "Draft is not ready for live submit.";
  }
  return reasons.map((reason) => labels[reason] || reason).join(" ");
}

/**
 * @param {{
 *   renderValidationPanel: (issues: unknown[]) => void,
 *   onDraftSaved?: () => Promise<void> | void,
 *   isSaving: () => boolean,
 *   setSaving: (value: boolean) => void,
 *   onSubmitComplete?: () => void,
 * }} deps
 */
export function initPushDraftLive(deps) {
  async function submitLiveDraft() {
    if (deps.isSaving()) return;

    const draftId = readInput("#amazonPushDraftId");
    const phrase = readInput("#amazonLiveSubmitConfirmPhrase");

    if (!draftId) {
      showAmazonNotification("Save the draft before submitting to Amazon.", { tone: "warning" });
      return;
    }

    if (phrase !== LIVE_CONFIRM_PHRASE) {
      showAmazonNotification(`Type ${LIVE_CONFIRM_PHRASE} to confirm live submit.`, { tone: "warning" });
      return;
    }

    deps.setSaving(true);
    try {
      const result = await submitAmazonDraftLive({
        draftId,
        confirmation: phrase,
      });

      closeLiveSubmitModal();
      setDraftSubmitMeta({
        draftStatus: result.draftStatus,
        submissionStatus: result.submissionStatus,
        previewValidated: false,
      });

      const statusEl = qs('[data-hydrate="push-review-status"]');
      if (statusEl) {
        statusEl.textContent = String(result.draftStatus || "submitted").replace(/_/g, " ");
      }

      showAmazonNotification(
        result.needsSync
          ? "Submitted to Amazon. Amazon may take a few minutes to return the listing through SP-API. Run verification now or try again later."
          : "Listing submitted to Amazon.",
        { tone: "success" },
      );
      deps.onSubmitComplete?.();
      await deps.onDraftSaved?.();
    } catch (err) {
      const messages = {
        draft_not_found: "Draft not found.",
        draft_not_ready: formatDraftNotReadyMessage(err?.reasons),
        confirmation_required: `Type ${LIVE_CONFIRM_PHRASE} to confirm.`,
        live_submit_disabled: "Live submit is disabled on the server.",
        amazon_not_connected: "Connect Amazon before submitting.",
        token_missing: "Amazon token missing. Reconnect Seller Central.",
        token_refresh_failed: "Could not refresh Amazon token.",
        listing_payload_error: "Could not build Amazon listing payload.",
        sp_api_submit_failed: "Amazon rejected the live submit.",
        invalid_request: "Invalid submit request.",
        unauthorized: "Please sign in as an admin.",
      };

      if (err?.draftStatus) {
        setDraftSubmitMeta({
          draftStatus: err.draftStatus,
          submissionStatus: err.submissionStatus,
          previewValidated: false,
        });
      }
      if (Array.isArray(err?.amazonIssues)) {
        deps.renderValidationPanel(err.amazonIssues);
      }

      showAmazonNotification(messages[err?.code] || "Could not submit to Amazon.", { tone: "error" });
    } finally {
      deps.setSaving(false);
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest("[data-action]");
    if (!actionEl) return;

    switch (actionEl.dataset.action) {
      case "submit-amazon-listing":
        event.preventDefault();
        if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return;
        openLiveSubmitModal();
        break;
      case "confirm-amazon-live-submit":
        event.preventDefault();
        submitLiveDraft().catch(() => {});
        break;
      case "cancel-amazon-live-submit":
        event.preventDefault();
        closeLiveSubmitModal();
        break;
      default:
        break;
    }
  });

  return {
    setDraftSubmitMeta,
    setPtdPreviewMeta,
    updateLiveSubmitReadiness,
    closeLiveSubmitModal,
  };
}

export function deriveSubmitMetaFromDraftRow(row) {
  const draftStatus = String(row?.draft_status || "");
  const submissionStatus = String(row?.submission_status || "");
  const lastResponse = row?.last_submission_response && typeof row.last_submission_response === "object"
    ? row.last_submission_response
    : null;
  const lastResult = row?.last_validation_result && typeof row.last_validation_result === "object"
    ? row.last_validation_result
    : null;
  const previewValidated = lastResponse?.mode === "VALIDATION_PREVIEW" &&
    isPreviewAccepted(submissionStatus || lastResponse?.status);

  return {
    draftStatus,
    submissionStatus,
    previewValidated: Boolean(previewValidated),
    draftUpdatedAt: row?.updated_at || "",
    ptdPreviewAt: lastResult?.previewedAt || "",
    ptdPreviewProductType: lastResult?.productType || row?.product_type || "",
    amazonPreviewAt: lastResult?.amazonPreviewAt || "",
  };
}

import { qs } from "./dom.js";
import { verifySubmittedAmazonDraft } from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import { setDraftSubmitMeta } from "./pushDraftLive.js";

function readInput(id) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim();
  }
  return "";
}

export function updateVerifyReadiness() {
  const btn = qs('[data-action="verify-submitted-draft"]');
  if (!(btn instanceof HTMLButtonElement)) return;

  const draftId = readInput("#amazonPushDraftId");
  const draftStatus = readInput("#amazonPushDraftStatus");
  const ready = Boolean(draftId) && draftStatus === "submitted";

  btn.disabled = !ready;
  btn.setAttribute("aria-disabled", ready ? "false" : "true");
  btn.classList.toggle("hidden", !ready);
  btn.classList.toggle("opacity-50", !ready);
  btn.classList.toggle("cursor-not-allowed", !ready);
}

/**
 * @param {string} draftId
 * @param {{ onVerified?: () => Promise<void> | void, isSaving?: () => boolean, setSaving?: (v: boolean) => void }} deps
 */
export async function runSubmittedDraftVerification(draftId, deps = {}) {
  if (!draftId) {
    showAmazonNotification("No draft selected for verification.", { tone: "warning" });
    return null;
  }

  if (deps.isSaving?.()) return null;

  deps.setSaving?.(true);
  try {
    const result = await verifySubmittedAmazonDraft(draftId, { runSingleSkuSync: true });

    if (result.verified) {
      setDraftSubmitMeta({
        draftStatus: result.draftStatus,
        previewValidated: false,
      });
      updateVerifyReadiness();

      const statusEl = qs('[data-hydrate="push-review-status"]');
      if (statusEl) {
        statusEl.textContent = String(result.draftStatus || "published").replace(/_/g, " ");
      }

      showAmazonNotification("Amazon listing verified and draft marked published.", {
        tone: "success",
      });
      await deps.onVerified?.();
      return result;
    }

    const reasonMessages = {
      listing_not_found_yet: "Amazon has not returned this SKU yet. Auto-verify will retry.",
      awaiting_buyable: result.offerActivationAttempted
        ? "Offer submitted to Amazon — waiting for the listing to become buyable. Auto-verify will retry."
        : "Listing found but not buyable yet. Auto-verify will retry.",
      offer_activation_failed: "Could not auto-submit the seller offer. Use Fix Inactive on Synced Listings or retry verify.",
    };
    const reason = String(result.reason || "listing_not_found_yet");
    showAmazonNotification(
      reasonMessages[reason] || reasonMessages.listing_not_found_yet,
      { tone: "warning" },
    );
    return result;
  } catch (err) {
    const messages = {
      draft_not_found: "Draft not found.",
      draft_not_submitted: "Only submitted drafts can be verified.",
      amazon_not_connected: "Connect Amazon before verifying.",
      token_missing: "Amazon token missing. Reconnect Seller Central.",
      token_refresh_failed: "Could not refresh Amazon token.",
      sync_failed: "Could not sync listing from Amazon.",
      invalid_request: "Invalid verification request.",
      unauthorized: "Please sign in as an admin.",
    };
    showAmazonNotification(messages[err?.code] || "Could not verify submitted draft.", {
      tone: "error",
    });
    return null;
  } finally {
    deps.setSaving?.(false);
  }
}

/**
 * @param {{
 *   onVerified?: () => Promise<void> | void,
 *   isSaving?: () => boolean,
 *   setSaving?: (value: boolean) => void,
 * }} deps
 */
export function initPushDraftVerify(deps = {}) {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest("[data-action]");
    if (!actionEl || actionEl.dataset.action !== "verify-submitted-draft") return;

    event.preventDefault();
    if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return;

    const draftId = actionEl.dataset.draftId || readInput("#amazonPushDraftId");
    runSubmittedDraftVerification(String(draftId || ""), deps).catch(() => {});
  });

  return { updateVerifyReadiness, runSubmittedDraftVerification };
}

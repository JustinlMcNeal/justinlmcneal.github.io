/** Pure helpers for Amazon push draft workflow (no DOM imports). */

/** @param {string} formValue */
export function resolveSuggestedAsinForSubmit(formValue) {
  return String(formValue || "").trim();
}

/** @param {string} formValue */
export function resolvePushWorkflowFromSuggestedAsin(formValue) {
  const suggestedAsin = resolveSuggestedAsinForSubmit(formValue);
  const offerOnExistingAsin = Boolean(suggestedAsin);
  return {
    suggestedAsin,
    offerOnExistingAsin,
    requirements: offerOnExistingAsin ? "LISTING_OFFER_ONLY" : "LISTING",
    pushWorkflow: offerOnExistingAsin ? "offer_on_asin" : "new_catalog",
  };
}

/** @param {string} pushWorkflow @param {string} requirements */
export function shouldHydrateSuggestedAsin(pushWorkflow, requirements) {
  return pushWorkflow === "offer_on_asin" || requirements === "LISTING_OFFER_ONLY";
}

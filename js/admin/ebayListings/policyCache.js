/**
 * policyCache.js — eBay policy data fetch and dropdown population.
 *
 * Owns:
 *   - cachedPolicies module state
 *   - loading policies from the edge function (action: "get_policies")
 *   - populating Push modal and Edit modal policy <select> elements
 *
 * Does NOT own:
 *   - getSelectedPolicies (payload read — stays in utils.js)
 *   - setupPanel policy display (setupPanel.js fetches independently)
 *   - openPush / openEdit / create/save/publish handlers
 *
 * Dependencies: api.js only — no circular imports
 */

import { callEdge } from "./api.js";

let cachedPolicies = null;

export async function loadPoliciesCache() {
  if (cachedPolicies) return cachedPolicies;
  try {
    const result = await callEdge("ebay-manage-listing", { action: "get_policies" });
    if (result.success) {
      cachedPolicies = result.policies;
      populatePolicyDropdowns();
    }
  } catch (e) { console.warn("Policy load failed:", e); }
  return cachedPolicies;
}

function populatePolicyDropdowns() {
  if (!cachedPolicies) return;
  const defaultFulfill = "266551432012";
  const defaultReturn  = "266551433012";
  const defaultPayment = "266551437012";

  function fill(selectId, policyType, defaultId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const raw  = cachedPolicies[policyType];
    const list = raw?.policies || raw?.fulfillmentPolicies || raw?.returnPolicies || raw?.paymentPolicies || [];
    sel.innerHTML = list.map(p => {
      const id       = p.fulfillmentPolicyId || p.returnPolicyId || p.paymentPolicyId || "";
      const name     = p.name || p.policyName || "Unnamed";
      const selected = id === defaultId ? " selected" : "";
      return `<option value="${id}"${selected}>${name}</option>`;
    }).join("") || '<option value="">No policies found</option>';
  }

  fill("modalFulfillmentPolicy", "fulfillment_policy", defaultFulfill);
  fill("modalReturnPolicy",      "return_policy",      defaultReturn);
  fill("modalPaymentPolicy",     "payment_policy",     defaultPayment);
  fill("editFulfillmentPolicy",  "fulfillment_policy", defaultFulfill);
  fill("editReturnPolicy",       "return_policy",      defaultReturn);
  fill("editPaymentPolicy",      "payment_policy",     defaultPayment);
}

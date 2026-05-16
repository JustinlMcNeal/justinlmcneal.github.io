/**
 * setupPanel.js — eBay Setup Panel UI for the eBay Listings admin page.
 *
 * Owns:
 *   - toggling the policies panel open/closed (btnSetup)
 *   - rendering policy summaries inside the setup panel (policiesContent)
 *   - setup location button handler (btnSetupLocation / locationStatus)
 *
 * Does NOT own:
 *   - loadPoliciesCache / populatePolicyDropdowns (shared with Push/Edit modals — lives in index.js)
 *   - cachedPolicies state (lives in index.js)
 *   - any eBay mutation actions (create/edit/publish/end/withdraw/discard)
 *
 * Dependencies are passed in from index.js to avoid any circular imports.
 */

import { esc } from "./utils.js";

/**
 * Wire up the Setup Panel button handlers.
 *
 * @param {{ callEdge: function }} deps
 *   callEdge — from api.js, passed through from index.js
 */
export function initSetupPanel({ callEdge }) {
  // ── Setup button — toggle panel + load policies ──────────────
  document.getElementById("btnSetup").addEventListener("click", async () => {
    const panel = document.getElementById("policiesPanel");
    panel.classList.toggle("hidden");
    if (panel.classList.contains("hidden")) return;

    const content = document.getElementById("policiesContent");
    content.textContent = "Loading policies...";
    try {
      const result = await callEdge("ebay-manage-listing", { action: "get_policies" });
      if (result.success) {
        const html = [];
        for (const [type, data] of Object.entries(result.policies)) {
          const policies = (data?.policies || data?.fulfillmentPolicies || data?.returnPolicies || data?.paymentPolicies || []);
          const label    = type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          html.push(`<div class="mb-3"><strong>${label}:</strong>`);
          if (policies.length) {
            for (const p of policies) {
              html.push(`<div class="ml-3 text-gray-600">• ${esc(p.name || p.policyName || "Unnamed")} <span class="text-gray-400">(${p.fulfillmentPolicyId || p.returnPolicyId || p.paymentPolicyId || ""})</span></div>`);
            }
          } else {
            html.push('<div class="ml-3 text-red-500">No policies found — create them in eBay Seller Hub first</div>');
          }
          html.push("</div>");
        }
        content.innerHTML = html.join("");
      } else {
        content.textContent = "❌ " + (result.error || "Failed to load policies");
      }
    } catch (e) { content.textContent = "❌ " + e.message; }
  });

  // ── Setup Location button ────────────────────────────────────
  document.getElementById("btnSetupLocation").addEventListener("click", async () => {
    const btn    = document.getElementById("btnSetupLocation");
    const status = document.getElementById("locationStatus");
    btn.disabled = true; status.textContent = "Creating location...";
    try {
      const result = await callEdge("ebay-manage-listing", { action: "setup_location", locationKey: "default" });
      status.textContent = result.success ? "✅ Location ready" : "❌ " + (result.error || "Failed");
    } catch (e) { status.textContent = "❌ " + e.message; }
    finally { btn.disabled = false; }
  });
}

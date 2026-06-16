/**
 * Execute issue action routes (Phase 8A) — navigation and existing flows only.
 */

import { getIssueActionDef } from "./issueActions.js";
import { applyIssueTableFilter, showInventoryToast } from "../events.js";

/**
 * @param {import('./issueActions.js').IssueActionButton} action
 * @param {import('../state.js').InventoryIssueRow} [issue]
 */
export function executeIssueAction(action, issue) {
  if (!action?.implemented) {
    showInventoryToast("This action is not available yet.", { variant: "info" });
    return;
  }

  switch (action.type) {
    case "open_order_lines":
    case "open_parcel_imports":
    case "open_amazon_admin":
    case "open_ebay_admin":
    case "open_products_admin":
      if (action.url) {
        window.location.assign(action.url);
      } else {
        showInventoryToast("Destination URL not configured.", { variant: "error" });
      }
      return;

    case "open_sync_modal":
    case "refresh_ebay_cache":
    case "open_relist_assist":
      import("../ui/syncDryRunModal.js").then((mod) => mod.openSyncDryRunModal());
      return;

    case "open_inventory_row":
    case "open_manual_adjustment": {
      const filter = issue ? getIssueActionDef(issue.type)?.tableFilter : null;
      if (filter) applyIssueTableFilter(filter);
      if (action.type === "open_manual_adjustment" && issue?.type === "negative_stock") {
        import("../state.js").then(({ state }) => {
          const row = state.inventoryRows.find((r) => r.onHand < 0);
          if (row) {
            import("../ui/adjustModal.js").then((mod) => mod.openAdjustModal(row.id));
          } else {
            showInventoryToast("Filter applied — use Adjust on a negative row.", { variant: "info" });
          }
        });
      }
      return;
    }

    case "open_detail":
      if (issue) {
        import("../ui/issueDetailModal.js").then((mod) => mod.openIssueDetailModal(issue));
      }
      return;

    case "open_shipped_audit_modal":
      import("../ui/shippedFinalizeAuditModal.js").then((mod) =>
        mod.openShippedFinalizeAuditModal({ needsAuditOnly: true }),
      );
      return;

    case "open_bundle_preview":
      import("../ui/bundlePreviewModal.js").then((mod) => mod.openBundlePreviewModal());
      return;

    case "open_restock_assist_queue":
      import("../ui/marketplaceRestockAssistQueueModal.js").then((mod) =>
        mod.openMarketplaceRestockAssistQueueModal({
          initialBucket: action.initialBucket || "ready_to_restock",
        }),
      );
      return;

    case "open_restock_followup_audit":
      import("../ui/marketplaceRestockAssistQueueModal.js").then((mod) =>
        mod.openMarketplaceRestockAssistQueueModal({ initialTab: "audit" }),
      );
      return;

    case "open_returns_restock_dashboard":
      import("../ui/returnsRestockDashboardModal.js").then((mod) =>
        mod.openReturnsRestockDashboardModal({
          tab: action.tab || "worklist",
          staleOnly: action.staleOnly || false,
          channel: action.channel || "",
          rowType: action.rowType || "",
        }),
      );
      return;

    case "refresh_marketplace_observations":
      import("../api/refundRefreshApi.js").then(async ({ refreshMarketplaceObservations }) => {
        try {
          const result = await refreshMarketplaceObservations({ channel: "all" });
          showInventoryToast(
            `Observations refreshed — inserted ${result?.inserted ?? 0}, updated ${result?.updated ?? 0}.`,
            { variant: "success" },
          );
        } catch (err) {
          showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
        }
      });
      return;

    case "no_action":
      showInventoryToast("Manual review required — no automated fix in this phase.", { variant: "info" });
      return;

    default:
      showInventoryToast("Action not wired yet.", { variant: "info" });
  }
}

/** @param {import('../state.js').InventoryIssueRow} issue */
export function executePrimaryIssueAction(issue) {
  const def = getIssueActionDef(issue.type);
  const action = def?.primary;
  if (action) executeIssueAction(action, issue);
  else executeIssueAction({ label: "Manual Review", type: "no_action", implemented: true, safe: true }, issue);
}

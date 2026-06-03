import { qs, qsa, show, hide } from "./dom.js";
import { syncAmazonListings } from "./api.js";
import { showAmazonNotification } from "./notifications.js";

/** @type {boolean} */
let syncing = false;

function setSyncingUi(active) {
  syncing = active;
  const banner = qs("#amazonStateSyncing");
  if (banner) {
    if (active) show(banner);
    else hide(banner);
  }

  qsa('[data-action="sync-amazon"]').forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.disabled = active || btn.getAttribute("data-auth-disabled") === "true";
    btn.setAttribute("aria-disabled", btn.disabled ? "true" : "false");
    if (active) {
      btn.dataset.syncLabel = btn.textContent.trim();
      btn.textContent = "Syncing…";
    } else if (btn.dataset.syncLabel) {
      btn.textContent = btn.dataset.syncLabel;
      delete btn.dataset.syncLabel;
    }
  });
}

function markSyncButtonsAuthDisabled(disabled) {
  qsa('[data-action="sync-amazon"]').forEach((btn) => {
    btn.setAttribute("data-auth-disabled", disabled ? "true" : "false");
  });
}

/**
 * @param {{ getAuthState: () => Record<string, unknown> | null, refreshAuth: () => Promise<unknown>, onSyncComplete?: () => Promise<void> | void }} deps
 */
export function initAmazonSyncActions(deps) {
  markSyncButtonsAuthDisabled(true);

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const btn = target.closest('[data-action="sync-amazon"]');
    if (!(btn instanceof HTMLButtonElement)) return;
    event.preventDefault();

    if (syncing) return;

    const auth = deps.getAuthState?.();
    if (!auth?.connected || auth?.tokenStatus !== "active") {
      showAmazonNotification("Connect Amazon before syncing listings.", {
        tone: "warning",
      });
      return;
    }

    setSyncingUi(true);
    try {
      const result = await syncAmazonListings({
        syncType: "full",
        maxPages: 25,
      });

      const failed = Number(result.recordsFailed || 0);
      const created = Number(result.recordsCreated || 0);
      const updated = Number(result.recordsUpdated || 0);
      const seen = Number(result.recordsSeen || 0);
      const markedAbsent = Number(result.recordsMarkedAbsent || 0);
      const status = String(result.status || "success");
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      const hasMore = warnings.includes("pagination_incomplete_more_pages_available");
      const reconcileSkipped = warnings.some((w) => String(w).startsWith("catalog_reconcile:skipped"));

      if (status === "failed" || result.ok === false) {
        showAmazonNotification("Amazon sync failed. Check sync logs and try again.", {
          tone: "error",
        });
      } else if (failed > 0) {
        showAmazonNotification(
          `Sync finished — ${seen} seen, ${updated} updated, ${failed} errors.${hasMore ? " More catalog pages remain — sync again." : ""}`,
          { tone: "warning" },
        );
      } else {
        const parts = [];
        if (created > 0) parts.push(`${created} new`);
        if (updated > 0) parts.push(`${updated} updated`);
        const summary = parts.length > 0 ? parts.join(", ") : "0 changed";
        const absentNote = markedAbsent > 0
          ? ` ${markedAbsent} deleted-on-Amazon listing(s) hidden from the dashboard.`
          : "";
        const reconcileNote = hasMore
          ? " Sync again to import remaining pages (catalog cleanup runs after the last page)."
          : reconcileSkipped
          ? " Catalog cleanup did not run — sync must finish all pages successfully."
          : " Check Needs Mapping for unmapped items.";
        showAmazonNotification(
          `Full catalog sync — ${seen} listings from Amazon (${summary}).${absentNote}${reconcileNote}`,
          { tone: "success" },
        );
      }

      await deps.onSyncComplete?.();
      await deps.refreshAuth?.();
    } catch (err) {
      const code = err?.code || "request_failed";
      const messages = {
        amazon_not_connected: "Amazon is not connected.",
        token_refresh_failed: "Amazon token refresh failed. Try reconnecting.",
        sp_api_request_failed: "Amazon sync request failed (SP-API rejected the call).",
        aws_assume_role_failed: "AWS role assumption failed. Check AMAZON_IAM_ROLE_ARN and STS policy.",
        server_misconfigured: "Amazon sync is not configured on the server.",
        unauthorized: "Please sign in as an admin to sync Amazon.",
      };
      showAmazonNotification(
        messages[code] || "Amazon sync failed.",
        { tone: "error" },
      );
    } finally {
      setSyncingUi(false);
    }
  });

  return {
    setAuthAllowsSync(connected) {
      markSyncButtonsAuthDisabled(!connected);
      if (!connected) setSyncingUi(false);
    },
  };
}

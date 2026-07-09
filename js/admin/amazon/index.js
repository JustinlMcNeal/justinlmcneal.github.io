/**

 * Amazon Listings admin page — live wiring, mapping, and local push drafts.

 */

import { initAdminNav } from "/js/shared/adminNav.js";

import { requireAdmin } from "/js/shared/guard.js";

import { initAmazonTabs } from "./tabs.js";

import { initAmazonModals } from "./modals.js";

import { initAmazonRowActions } from "./rowActions.js";

import { initAmazonAuthStatus } from "./authStatus.js";

import { initAmazonSyncActions } from "./syncActions.js";

import { initAmazonLiveListings } from "./liveListings.js";

import { initAmazonSyncFreshness } from "./syncFreshness.js";

import { initAmazonSyncRunHistory } from "./syncRunHistory.js";

import { initAmazonListingsToolbar } from "./listingsToolbar.js";

import { initAmazonMapping } from "./mapping.js";

import { initAmazonDraftsIssues } from "./draftsIssues.js";

import { initAmazonReadyToPush } from "./readyToPush.js";
import { isParentShellRow } from "./readyToPushNormalize.js";
import {
  buildProductGroupSummary,
  listingRowAsPushTrigger,
  readyRowAsTrigger,
  startPushQueue,
} from "./readyToPushQueue.js";

import { initAmazonPushDraft } from "./pushDraft.js";

import { initAmazonProductPicker } from "./productPicker.js";

import { initAmazonListingPatch } from "./listingPatch.js";

import { initAmazonListingImagePatch } from "./listingImagePatch.js";

import { initAmazonListingInactiveFix } from "./listingInactiveFix.js";

import { initAmazonDeleteDraft } from "./deleteDraft.js";

import { initAmazonListingsSelection } from "./listingsSelection.js";

import { initAmazonBulkPatch } from "./bulkPatch.js";

import { initAmazonListingFees } from "./listingFees.js";

import { initAmazonListingDetails } from "./listingDetails.js";

import { initAmazonTableSettings } from "./tableSettings.js";

import { paginateListings } from "./listingsQuery.js";

import { showAmazonNotification } from "./notifications.js";



async function requireAdminWithTimeout(timeoutMs = 10000) {
  let timer;
  try {
    return await Promise.race([
      requireAdmin(),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, reason: "Admin check timed out. Refresh the page and try again." }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function boot() {
  const authStatus = window.__kkAmazonAuthStatus || initAmazonAuthStatus();

  const auth = await requireAdminWithTimeout();

  if (!auth.ok) {
    showAmazonNotification(auth.reason || "Admin access required.", { tone: "error" });
    return;
  }

  await initAdminNav("Amazon Listings");

  /** @type {{ api?: ReturnType<typeof initAmazonListingsSelection> | null }} */
  const selectionRef = { api: null };

  /** @type {{ api?: ReturnType<typeof initAmazonListingFees> | null }} */
  const listingFeesRef = { api: null };

  const liveListings = initAmazonLiveListings({

    isConnected: authStatus.isConnected,

    afterRender: () => {
      selectionRef.api?.afterRender?.();
      listingFeesRef.api?.prefetchVisible?.();
    },

    onRefresh: () => listingFeesRef.api?.clearListingFeeCache?.(),

  });

  const listingsSelection = initAmazonListingsSelection({

    getFilteredRows: () => liveListings.getFilteredRows(),

    getRowById: (id) => liveListings.getRowById(id),

  });

  selectionRef.api = listingsSelection;

  listingFeesRef.api = initAmazonListingFees({
    getAuthState: authStatus.getState,
    getVisibleRows: () => {
      const filtered = liveListings.getFilteredRows();
      const query = liveListings.getQuery();
      return paginateListings(filtered, query.page, query.pageSize).rows;
    },
    onUpdate: () => liveListings.applyQuery(),
  });

  const listingDetails = initAmazonListingDetails();



  initAmazonListingsToolbar(liveListings);

  initAmazonTableSettings();

  const syncFreshness = initAmazonSyncFreshness();

  const syncRunHistory = initAmazonSyncRunHistory();



  const draftsIssues = initAmazonDraftsIssues();

  const readyToPush = initAmazonReadyToPush();



  const mapping = initAmazonMapping({

    onMappingSaved: async () => {

      await liveListings.refresh();

      await readyToPush.refreshReadyToPush();

    },

  });



  let closePopover = () => {};

  const pickerBridge = { open: null };

  const modalApi = {
    closeAmazonModals: () => {},
    openPatch: (_row, _mode) => {},
    openImagePatch: (_row) => {},
  };

  const listingPatch = initAmazonListingPatch({
    closeModal: () => modalApi.closeAmazonModals(),
    onPatched: async () => {
      await liveListings.refresh();
      await syncFreshness.refresh();
      await syncRunHistory.refresh();
    },
  });

  const listingImagePatch = initAmazonListingImagePatch({
    closeModal: () => modalApi.closeAmazonModals(),
    onPatched: async () => {
      await liveListings.refresh();
      await syncFreshness.refresh();
      await syncRunHistory.refresh();
    },
  });

  const inactiveFix = initAmazonListingInactiveFix({
    closeModal: () => modalApi.closeAmazonModals(),
    getAuthState: authStatus.getState,
    onFixed: async () => {
      await liveListings.refresh();
      await mapping.refreshUnmapped();
      await syncFreshness.refresh();
    },
  });



  const pushDraft = initAmazonPushDraft({

    onDraftSaved: async () => {

      await draftsIssues.refreshDraftsIssues();

      await readyToPush.refreshReadyToPush();

    },

    getDraftRowById: draftsIssues.getDraftRowById,

    onVerified: async () => {

      await draftsIssues.refreshDraftsIssues();

      await liveListings.refresh();

      await mapping.refreshUnmapped();

      await readyToPush.refreshReadyToPush();

    },

  });



  const modals = initAmazonModals(

    {

      hydratePushModal: pushDraft.hydratePushModal,

      hydrateMappingModal: mapping.hydrateMappingModal,
      hydrateMappingFromListingRow: mapping.hydrateMappingFromListingRow,

      hydratePatchModal: listingPatch.hydrateAmazonPatchModal,

      hydrateImagePatchModal: listingImagePatch.hydrateAmazonImagePatchModal,

      hydrateInactiveFixModal: inactiveFix.hydrateAmazonInactiveFixModal,

      openProductPicker: (trigger) => pickerBridge.open?.(trigger),

      startPushRemaining: (productId) => {
        const allRows = readyToPush.getRowsForProduct(productId);
        const parentShell = allRows.find(isParentShellRow);
        const summary = buildProductGroupSummary(allRows);
        const variantRows = allRows.filter((row) => !isParentShellRow(row));
        const queue = startPushQueue(variantRows);

        if (summary.parentNeedsAttention && parentShell) {
          showAmazonNotification(
            "Start with the variation parent (KK-XXXX-PARENT) — child SKUs must link to it on Amazon.",
            { tone: "info" },
          );
          modals.openPush(readyRowAsTrigger(parentShell), {
            draftMode: true,
            fromQueue: queue.length > 0,
          }).catch(() => {});
          return;
        }

        if (!queue.length) {
          showAmazonNotification("No pushable variants remaining for this product.", { tone: "warning" });
          return;
        }
        modals.openPush(readyRowAsTrigger(queue[0]), { draftMode: true, fromQueue: true }).catch(() => {});
      },

      openPushForListing: (row) => {
        modals.openPush(listingRowAsPushTrigger(row, { linkToFamily: true }), {
          draftMode: true,
          linkToFamily: true,
          listingRow: row,
        }).catch(() => {});
      },

    },

    {

      beforeOpen: () => closePopover(),

    },

  );

  modalApi.closeAmazonModals = modals.closeAmazonModals;
  modalApi.openPatch = modals.openPatch;

  inactiveFix.attachOpener((row) => modals.openInactiveFix(row));

  initAmazonBulkPatch({
    getSelectedIds: () => listingsSelection.getSelectedIds(),
    openModal: () => modals.openBulkPatch(),
    closeModal: () => modalApi.closeAmazonModals(),
    onComplete: async () => {
      listingsSelection.clearSelection();
      await liveListings.refresh();
      await syncFreshness.refresh();
    },
  });

  const deleteDraftActions = initAmazonDeleteDraft({
    getDraftRowById: draftsIssues.getDraftRowById,
    closeModals: () => modalApi.closeAmazonModals(),
    onDeleted: async () => {
      await draftsIssues.refreshDraftsIssues();
      await readyToPush.refreshReadyToPush();
    },
  });



  const productPicker = initAmazonProductPicker({

    openPush: modals.openPush,

    beforeOpen: () => {

      closePopover();

      modals.closeAmazonModals();

    },

  });

  pickerBridge.open = productPicker.open;



  initAmazonSyncActions({

    getAuthState: authStatus.getState,

    refreshAuth: authStatus.refresh,

    onSyncComplete: async () => {

      await liveListings.refresh();

      await mapping.refreshUnmapped();

      await syncFreshness.refresh();

      await syncRunHistory.refresh();

    },

  });



  closePopover = initAmazonRowActions({

    beforeOpen: () => modals.closeAmazonModals(),

    getRowById: liveListings.getRowById,

    getAuthState: authStatus.getState,

    openPatchModal: (row, mode) => modals.openPatch(row, mode),

    openImagePatchModal: (row) => modals.openImagePatch(row),

    openInactiveFixModal: (row) => modals.openInactiveFix(row),

    openPushForListing: (row) => {
      modals.openPush(listingRowAsPushTrigger(row, { linkToFamily: true }), {
        draftMode: true,
        linkToFamily: true,
        listingRow: row,
      }).catch(() => {});
    },

    openMappingForListing: (row) => {
      modals.openMappingFromListingRow(row).catch(() => {});
    },

    openListingDetails: listingDetails.openAmazonListingDetailsModal,

    deleteDraft: (draftId, context) =>
      deleteDraftActions.requestDeleteAmazonDraft(draftId, context),

    onSyncComplete: async () => {

      await liveListings.refresh();

      await mapping.refreshUnmapped();

      await readyToPush.refreshReadyToPush();

      await syncFreshness.refresh();

      await syncRunHistory.refresh();

    },

  });



  initAmazonTabs();

  // Prefetch work-area counts and panel data on load (not only after first tab click).
  void Promise.allSettled([
    readyToPush.refreshReadyToPush(),
    mapping.refreshUnmapped(),
    draftsIssues.refreshDraftsIssues(),
  ]);
}



boot().catch((err) => {
  console.error("[amazon] boot failed", err);
  if (!window.__kkAmazonAuthStatus) initAmazonAuthStatus();
  showAmazonNotification("Could not initialize Amazon admin page.", { tone: "error" });
});



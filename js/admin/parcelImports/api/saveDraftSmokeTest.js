/** Dev-only authenticated RPC smoke test (Phase 6A). */

import { buildSaveDraftPayload } from "./parcelImportsMappers.js";
import {
  fetchImportSmokeCounts,
  saveParcelImportDraft,
} from "./parcelImportsApi.js";
import {
  getState,
  setCurrentImportId,
  setSaveStatus,
} from "../state.js";

/**
 * Run create + update save_parcel_import_draft smoke test from console.
 * Requires parsed state and admin JWT session.
 */
export async function runSaveDraftSmokeTest() {
  const state = getState();

  if (!state.items?.length || !state.parcel?.parcelId) {
    throw new Error(
      "Parse a Baestao file first (e.g. sample_baestao_waybill_227461.xls).",
    );
  }

  setSaveStatus("saving", "Running save draft smoke test…");
  console.info("[parcelImports smoke] building payload…");

  const basePayload = await buildSaveDraftPayload(state);
  const createPayload = { ...basePayload, importId: null };

  console.info("[parcelImports smoke] create RPC…", {
    parcelId: createPayload.parcel?.parcelId,
    itemCount: createPayload.items.length,
    statusIntent: createPayload.statusIntent,
  });

  const createResult = await saveParcelImportDraft(createPayload);
  console.info("[parcelImports smoke] create result:", createResult);

  if (!createResult?.import_id) {
    throw new Error("Create RPC did not return import_id");
  }
  if (createResult.created !== true) {
    throw new Error(`Expected created=true, got ${createResult.created}`);
  }

  setCurrentImportId(createResult.import_id);

  const updatePayload = {
    ...basePayload,
    importId: createResult.import_id,
  };

  console.info("[parcelImports smoke] update RPC…");
  const updateResult = await saveParcelImportDraft(updatePayload);
  console.info("[parcelImports smoke] update result:", updateResult);

  if (updateResult.created !== false) {
    throw new Error(`Expected created=false on update, got ${updateResult.created}`);
  }

  const counts = await fetchImportSmokeCounts(createResult.import_id);
  console.info("[parcelImports smoke] DB counts:", counts);

  const eventTypes = counts.events.map((e) => e.event_type);
  const parsedCount = eventTypes.filter((t) => t === "parsed").length;
  const draftSavedCount = eventTypes.filter((t) => t === "draft_saved").length;
  const eventsOk =
    eventTypes.length >= 3 &&
    parsedCount >= 1 &&
    draftSavedCount >= 2;

  const summary = {
    createResult,
    updateResult,
    counts,
    checks: {
      createTrue: createResult.created === true,
      updateFalse: updateResult.created === false,
      itemCount11: createResult.item_count === 11,
      allocCount11: createResult.allocation_count === 11,
      dbItemsStable: counts.itemCount === 11,
      dbAllocsStable: counts.allocationCount === 11,
      eventsOk,
      eventTypes,
    },
  };

  const allPass = Object.entries(summary.checks)
    .filter(([k]) => k !== "eventTypes")
    .every(([, v]) => v === true);

  if (allPass) {
    setSaveStatus("saved", "Smoke test passed");
    console.info("[parcelImports smoke] PASSED", summary);
  } else {
    setSaveStatus("error", "Smoke test checks failed — see console");
    console.warn("[parcelImports smoke] FAILED checks", summary);
  }

  return summary;
}

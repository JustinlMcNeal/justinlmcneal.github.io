// Pinterest boards — init, setup, load

import { initBoardsContext, getBoardsContext } from "./boardsContext.js";
import {
  loadBoardStrategyData,
  refreshBoardsFromDb,
  addBoard,
  syncPinterestBoards,
} from "./boardActions.js";
import { populateBoardDropdown, renderBoardList } from "./boardsRender.js";

export { populateBoardDropdown, renderBoardList };

export function initBoards(deps) {
  initBoardsContext(deps);
}

export function setupBoards() {
  const { els } = getBoardsContext();

  els.btnAddBoard?.addEventListener("click", () => {
    const name = prompt("Enter board name (local registry only — does not create on Pinterest):");
    if (name) addBoard(name);
  });

  document.getElementById("btnSyncBoards")?.addEventListener("click", () => {
    syncPinterestBoards();
  });
}

/**
 * @param {{ syncFromApi?: boolean }} [options]
 * syncFromApi: pull board names from Pinterest API into DB (slow; use on init or Sync button).
 */
export async function loadBoards({ syncFromApi = false } = {}) {
  const { state, getSupabaseClient } = getBoardsContext();
  const client = getSupabaseClient();
  const { data: pinData } = await client
    .from("social_settings")
    .select("setting_value")
    .eq("setting_key", "pinterest_connected")
    .single();

  if (!pinData?.setting_value?.connected) {
    state.boards = [];
    return;
  }

  const alreadyLoaded = Array.isArray(state.boards) && state.boards.length > 0;
  const doApiSync = syncFromApi || !alreadyLoaded;

  if (doApiSync) {
    await loadBoardStrategyData();
  } else {
    await refreshBoardsFromDb({ syncFromApi: false });
  }
  await populateBoardDropdown(getBoardsContext().els.boardSelect);
}

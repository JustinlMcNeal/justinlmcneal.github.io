// Pinterest boards — init, setup, load

import { initBoardsContext, getBoardsContext } from "./boardsContext.js";
import { fetchPinterestBoards, addBoard, syncPinterestBoards } from "./boardActions.js";
import { populateBoardDropdown, renderBoardList } from "./boardsRender.js";

export { populateBoardDropdown, renderBoardList };

export function initBoards(deps) {
  initBoardsContext(deps);
}

export function setupBoards() {
  const { els } = getBoardsContext();

  els.btnAddBoard?.addEventListener("click", () => {
    const name = prompt("Enter board name:");
    if (name) addBoard(name);
  });

  document.getElementById("btnSyncBoards")?.addEventListener("click", () => {
    syncPinterestBoards();
  });
}

export async function loadBoards() {
  const { state, els, getSupabaseClient } = getBoardsContext();
  const client = getSupabaseClient();
  const { data: pinData } = await client
    .from("social_settings").select("setting_value")
    .eq("setting_key", "pinterest_connected").single();

  if (!pinData?.setting_value?.connected) {
    state.boards = [];
    return;
  }

  state.boards = await fetchPinterestBoards();
  await populateBoardDropdown(els.boardSelect);
}

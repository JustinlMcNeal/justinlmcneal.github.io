// Pinterest boards — fetch, sync, CRUD actions

import {
  createBoard,
  updateBoard,
  deleteBoard,
} from "../../api.js";
import { getBoardsContext } from "./boardsContext.js";

export async function fetchPinterestBoards() {
  const { SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } = getBoardsContext();
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-boards`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const data = await resp.json();
    if (data.success) return data.boards;
    console.error("Failed to fetch Pinterest boards:", data.error, data.debug);
    return [];
  } catch (err) {
    console.error("Pinterest boards fetch error:", err);
    return [];
  }
}

export async function addBoard(name) {
  const { state } = getBoardsContext();
  try {
    await createBoard({ name, is_default: state.boards.length === 0 });
    const { loadBoards, renderBoardList } = await import("./boardsController.js");
    await loadBoards();
    renderBoardList();
  } catch (err) {
    console.error("Add board error:", err);
    alert("Failed to add board");
  }
}

export async function syncPinterestBoards() {
  const { getSupabaseClient } = getBoardsContext();
  const btn = document.getElementById("btnSyncBoards");
  btn.disabled = true;
  btn.textContent = "Syncing...";
  try {
    const client = getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    const resp = await fetch(`https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/sync-pinterest-boards`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session?.access_token}`,
        "Content-Type": "application/json",
      },
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) throw new Error(result.error || "Sync failed");
    const msg = `Boards synced!\n\nMatched: ${result.matched?.length || 0}\nCreated: ${result.created?.length || 0}\nTotal mapped: ${result.total_mapped || 0}`;
    alert(msg);
    const { loadBoards, renderBoardList } = await import("./boardsController.js");
    await loadBoards();
    renderBoardList();
  } catch (err) {
    console.error("Board sync error:", err);
    alert("Failed to sync boards: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📌 Auto-Sync Boards";
  }
}

export async function updateBoardCategory(boardId, categoryId) {
  try {
    await updateBoard(boardId, { category_id: categoryId });
    const { loadBoards } = await import("./boardsController.js");
    await loadBoards();
  } catch (err) {
    console.error("Update board error:", err);
  }
}

export async function deleteBoardById(boardId) {
  try {
    await deleteBoard(boardId);
    const { loadBoards, renderBoardList } = await import("./boardsController.js");
    await loadBoards();
    renderBoardList();
  } catch (err) {
    console.error("Delete board error:", err);
    alert("Failed to delete board");
  }
}

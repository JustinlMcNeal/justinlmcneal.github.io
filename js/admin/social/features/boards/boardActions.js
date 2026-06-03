// Pinterest boards — fetch, sync, CRUD, strategy

import {
  createBoard,
  updateBoard,
  deleteBoard,
  fetchBoards,
  upsertPinterestBoardFromApi,
  setDefaultPinterestBoard,
  fetchPinterestBoardUsageStats,
} from "../../api.js";
import { getBoardsContext } from "./boardsContext.js";

export async function fetchPinterestApiBoards() {
  const { SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } = getBoardsContext();
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-boards`, {
      method: "GET",
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const data = await resp.json();
    if (data.success) return data.boards || [];
    console.error("Failed to fetch Pinterest boards:", data.error, data.debug);
    return [];
  } catch (err) {
    console.error("Pinterest boards fetch error:", err);
    return [];
  }
}

/** @deprecated inlined in loadBoardStrategyData with per-board error handling */
export async function syncApiBoardsToDatabase(apiBoards) {
  for (const b of apiBoards || []) {
    if (!b?.id || !b?.name) continue;
    await upsertPinterestBoardFromApi({
      pinterest_board_id: String(b.id),
      name: b.name,
    });
  }
}

function applyBoardUsage(state, boards, usage) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  state.boards = boards.map((board) => {
    const pid = board.pinterest_board_id;
    const u = pid ? usage[pid] : null;
    const lastUsed = u?.last_used_at ? new Date(u.last_used_at).getTime() : null;
    return {
      ...board,
      _post_count: u?.post_count || 0,
      _last_used_at: u?.last_used_at || null,
      _stale: lastUsed != null && lastUsed < thirtyDaysAgo,
    };
  });
  state.boardUsage = usage;
  return state.boards;
}

async function syncPinterestApiBoardsToDb() {
  try {
    const apiBoards = await fetchPinterestApiBoards();
    if (!apiBoards.length) return;
    for (const b of apiBoards) {
      try {
        await upsertPinterestBoardFromApi({
          pinterest_board_id: String(b.id),
          name: b.name,
        });
      } catch (err) {
        console.warn("[boards] Upsert failed for", b.name, err?.message || err);
      }
    }
  } catch (err) {
    console.warn("[boards] Pinterest API board list failed:", err?.message || err);
  }
}

/** Fast path: DB (+ optional usage). Skips Pinterest API unless syncFromApi. */
export async function refreshBoardsFromDb({
  syncFromApi = false,
  includeUsage = true,
} = {}) {
  const { state } = getBoardsContext();

  if (syncFromApi) {
    await syncPinterestApiBoardsToDb();
  }

  let boards;
  try {
    boards = await fetchBoards();
  } catch (err) {
    console.error("[boards] fetchBoards failed:", err?.message || err, err);
    throw err;
  }

  let usage = state.boardUsage || {};
  if (includeUsage) {
    try {
      usage = await fetchPinterestBoardUsageStats();
    } catch (err) {
      console.warn("[boards] Usage stats unavailable:", err);
    }
  }

  return applyBoardUsage(state, boards, usage);
}

/** Full refresh: Pinterest API sync + DB + usage (use on first load or explicit sync). */
export async function loadBoardStrategyData(options = {}) {
  return refreshBoardsFromDb({ syncFromApi: true, includeUsage: true, ...options });
}

export async function addBoard(name) {
  const { state } = getBoardsContext();
  try {
    await createBoard({
      name,
      is_default: state.boards.length === 0,
      intent_key: "other",
      content_types: ["product"],
      mapped_category_ids: [],
      is_active: true,
    });
    const { renderBoardList } = await import("./boardsController.js");
    await refreshBoardsFromDb({ syncFromApi: false });
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
        Authorization: `Bearer ${session?.access_token}`,
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
    btn.textContent = "Sync from Pinterest";
  }
}

export async function updateBoardStrategy(boardId, updates) {
  try {
    await updateBoard(boardId, updates);
    await refreshBoardsFromDb({ syncFromApi: false, includeUsage: false });
  } catch (err) {
    console.error("Update board strategy error:", err);
    throw err;
  }
}

export async function setBoardAsDefault(boardUuid) {
  const { state } = getBoardsContext();
  const { renderBoardList } = await import("./boardsController.js");
  const previous = state.boards.map((b) => ({ ...b, is_default: b.is_default }));

  state.boards = state.boards.map((b) => ({
    ...b,
    is_default: b.id === boardUuid,
  }));
  renderBoardList();

  try {
    await setDefaultPinterestBoard(boardUuid);
    await refreshBoardsFromDb({ syncFromApi: false, includeUsage: false });
    renderBoardList();
  } catch (err) {
    console.error("Set default board error:", err);
    state.boards = previous;
    renderBoardList();
    alert("Failed to set default board");
  }
}

export async function updateBoardCategory(boardId, categoryId) {
  try {
    const mapped = categoryId ? [categoryId] : [];
    await updateBoard(boardId, {
      category_id: categoryId,
      mapped_category_ids: mapped,
    });
    await refreshBoardsFromDb({ syncFromApi: false, includeUsage: false });
  } catch (err) {
    console.error("Update board error:", err);
  }
}

export async function deleteBoardById(boardId) {
  try {
    await deleteBoard(boardId);
    const { renderBoardList } = await import("./boardsController.js");
    await refreshBoardsFromDb({ syncFromApi: false });
    renderBoardList();
  } catch (err) {
    console.error("Delete board error:", err);
    alert("Failed to delete board");
  }
}

/** @deprecated use loadBoardStrategyData */
export async function fetchPinterestBoards() {
  return fetchPinterestApiBoards();
}

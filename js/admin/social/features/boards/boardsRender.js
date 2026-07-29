// Pinterest boards — strategy routing UI, dropdowns

import { escapeHtml } from "../../utils/html.js";
import { INTENT_KEYS, CONTENT_TYPES } from "./boardRouting.js";
import { getBoardsContext } from "./boardsContext.js";
import {
  updateBoardStrategy,
  setBoardAsDefault,
  deleteBoardById,
} from "./boardActions.js";

function formatIntentLabel(key) {
  return String(key || "other").replace(/-/g, " ");
}

function intentOptions(selected) {
  return INTENT_KEYS.map(
    (k) =>
      `<option value="${k}" ${k === selected ? "selected" : ""}>${formatIntentLabel(k)}</option>`
  ).join("");
}

function contentTypeCheckboxes(board) {
  const selected = new Set(board.content_types || ["product"]);
  return CONTENT_TYPES.map(
    (t) => `
    <label class="board-strategy-check">
      <input type="checkbox" class="board-content-type" data-board-id="${board.id}" value="${t}"
        ${selected.has(t) ? "checked" : ""}>
      ${t}
    </label>`
  ).join("");
}

function categoryMultiOptions(board, categories) {
  const selected = new Set(
    board.mapped_category_ids?.length
      ? board.mapped_category_ids
      : board.category_id
        ? [board.category_id]
        : []
  );
  return categories
    .map(
      (c) =>
        `<option value="${c.id}" ${selected.has(c.id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )
    .join("");
}

export async function populateBoardDropdown(selectElement) {
  if (!selectElement) return;
  selectElement.innerHTML = '<option value="">Loading boards...</option>';

  const { state } = getBoardsContext();
  let boards = state.boards || [];
  if (!boards.length) {
    const { refreshBoardsFromDb } = await import("./boardActions.js");
    boards = await refreshBoardsFromDb({ syncFromApi: false, includeUsage: false });
  }

  const active = boards.filter((b) => b.is_active !== false && b.pinterest_board_id);

  if (!active.length) {
    selectElement.innerHTML =
      '<option value="">No boards found — connect Pinterest or sync boards</option>';
    return;
  }

  selectElement.innerHTML = '<option value="">Select a board...</option>';
  active.forEach((board) => {
    const option = document.createElement("option");
    option.value = board.pinterest_board_id;
    option.textContent = board.is_default
      ? `${board.name} (default)`
      : board.name;
    selectElement.appendChild(option);
  });
}

export function renderBoardList() {
  const { state, els } = getBoardsContext();
  const warningEl = document.getElementById("boardStrategyWarning");

  const hasDefault = state.boards.some((b) => b.is_default && b.pinterest_board_id);
  if (warningEl) {
    if (!hasDefault) {
      warningEl.classList.remove("hidden");
      warningEl.textContent =
        "No default fallback board set. Pinterest auto-queue posts may be skipped until you mark one board as default.";
    } else {
      warningEl.classList.add("hidden");
    }
  }

  if (!state.boards.length) {
    els.boardList.innerHTML = `
      <div class="boards-tab__empty">
        <p class="boards-tab__empty-title">No boards in strategy registry</p>
        <p class="boards-tab__empty-sub">Connect Pinterest, then use Sync from Pinterest (does not change routing rules).</p>
      </div>
    `;
    return;
  }

  els.boardList.innerHTML = state.boards
    .map((board) => {
      const inactive = board.is_active === false;
      const badges = [
        board.is_default
          ? '<span class="board-strategy-badge board-strategy-badge--default">Default fallback</span>'
          : "",
        inactive
          ? '<span class="board-strategy-badge board-strategy-badge--inactive">Inactive</span>'
          : "",
        board._stale
          ? '<span class="board-strategy-badge board-strategy-badge--stale">Stale 30d+</span>'
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      const usage =
        board._post_count > 0
          ? `${board._post_count} pin(s)${board._last_used_at ? ` · last ${new Date(board._last_used_at).toLocaleDateString()}` : ""}`
          : "No pins logged yet";

      const pid = board.pinterest_board_id
        ? `<span class="board-strategy-item__pid">${escapeHtml(board.pinterest_board_id)}</span>`
        : '<span class="board-strategy-item__pid board-strategy-item__pid--missing">No Pinterest ID — sync required</span>';

      return `
      <div class="board-strategy-item${inactive ? " is-inactive" : ""}" data-board-id="${board.id}">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <div class="board-strategy-item__name">${escapeHtml(board.name)}</div>
            <div class="flex flex-wrap gap-1.5 mt-2">${badges}</div>
            ${pid}
            <p class="board-strategy-item__meta">${escapeHtml(usage)}</p>
          </div>
          <div class="board-strategy-item__actions">
            <button type="button" class="btn-set-default board-strategy-item__btn" data-board-id="${board.id}" ${board.is_default ? "disabled" : ""}>Set default</button>
            <button type="button" class="btn-delete-board board-strategy-item__btn board-strategy-item__btn--danger" data-board-id="${board.id}">Delete</button>
          </div>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label class="board-strategy-label">Search intent</label>
            <select class="board-intent board-strategy-control" data-board-id="${board.id}">
              ${intentOptions(board.intent_key || "product-category")}
            </select>
          </div>
          <div>
            <label class="board-strategy-label">Product categories</label>
            <select class="board-categories board-strategy-control" data-board-id="${board.id}" multiple size="3">
              ${categoryMultiOptions(board, state.categories || [])}
            </select>
          </div>
          <div>
            <label class="board-strategy-label">Active</label>
            <label class="board-strategy-check mt-1">
              <input type="checkbox" class="board-active" data-board-id="${board.id}" ${board.is_active !== false ? "checked" : ""}>
              <span>Use for routing</span>
            </label>
          </div>
        </div>
        <div class="mt-3">
          <label class="board-strategy-label">Allowed content types</label>
          <div class="flex flex-wrap gap-3">${contentTypeCheckboxes(board)}</div>
        </div>
        <div class="mt-3">
          <label class="board-strategy-label">Notes</label>
          <input type="text" class="board-notes board-strategy-control" data-board-id="${board.id}"
            value="${escapeHtml(board.strategy_notes || "")}" placeholder="Strategy notes (optional)">
        </div>
        <button type="button" class="btn-save-board board-strategy-item__btn board-strategy-item__btn--save" data-board-id="${board.id}">Save routing</button>
      </div>`;
    })
    .join("");

  wireBoardListEvents();
}

function wireBoardListEvents() {
  document.querySelectorAll(".btn-save-board").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const boardId = btn.dataset.boardId;
      const root = btn.closest(".board-strategy-item");
      if (!root) return;

      const intent = root.querySelector(".board-intent")?.value || "other";
      const notes = root.querySelector(".board-notes")?.value || null;
      const active = root.querySelector(".board-active")?.checked !== false;
      const content_types = [...root.querySelectorAll(".board-content-type:checked")].map(
        (el) => el.value
      );
      const catSelect = root.querySelector(".board-categories");
      const mapped_category_ids = catSelect
        ? [...catSelect.selectedOptions].map((o) => o.value)
        : [];

      btn.disabled = true;
      btn.textContent = "Saving...";
      try {
        await updateBoardStrategy(boardId, {
          intent_key: intent,
          strategy_notes: notes,
          is_active: active,
          content_types: content_types.length ? content_types : ["product"],
          mapped_category_ids,
          category_id: mapped_category_ids[0] || null,
        });
        const { renderBoardList } = await import("./boardsController.js");
        renderBoardList();
      } catch (err) {
        alert("Failed to save board: " + (err.message || err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Save routing";
      }
    });
  });

  document.querySelectorAll(".btn-set-default").forEach((btn) => {
    btn.addEventListener("click", () => setBoardAsDefault(btn.dataset.boardId));
  });

  document.querySelectorAll(".btn-delete-board").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (
        confirm(
          "Remove this board from the strategy registry?\n\nIt will stay on Pinterest but won't reappear after sync or page refresh."
        )
      ) {
        await deleteBoardById(btn.dataset.boardId);
      }
    });
  });
}

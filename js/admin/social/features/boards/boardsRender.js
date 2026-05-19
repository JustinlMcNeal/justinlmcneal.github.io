// Pinterest boards — dropdown and list rendering

import { getBoardsContext } from "./boardsContext.js";
import { fetchPinterestBoards, updateBoardCategory, deleteBoardById } from "./boardActions.js";

export async function populateBoardDropdown(selectElement) {
  if (!selectElement) return;
  selectElement.innerHTML = '<option value="">Loading boards...</option>';
  const boards = await fetchPinterestBoards();
  if (boards.length === 0) {
    selectElement.innerHTML = '<option value="">No boards found - Connect Pinterest first</option>';
    return;
  }
  selectElement.innerHTML = '<option value="">Select a board...</option>';
  boards.forEach(board => {
    const option = document.createElement("option");
    option.value = board.id;
    option.textContent = board.name;
    selectElement.appendChild(option);
  });
}

export function renderBoardList() {
  const { state, els } = getBoardsContext();

  if (!state.boards.length) {
    els.boardList.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <p>No boards configured yet</p>
        <p class="text-xs mt-1">Add boards to organize your Pinterest pins by category</p>
      </div>
    `;
    return;
  }

  els.boardList.innerHTML = state.boards.map(board => `
    <div class="board-item" data-board-id="${board.id}">
      <div class="flex-1">
        <div class="font-medium">${board.name}</div>
        <div class="text-xs text-gray-400">
          ${board.category?.name ? `Linked to: ${board.category.name}` : "No category linked"}
          ${board.is_default ? " \u2022 Default board" : ""}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <select class="board-category-select text-sm border rounded px-2 py-1" data-board-id="${board.id}">
          <option value="">No category</option>
          ${state.categories.map(c => `
            <option value="${c.id}" ${board.category_id === c.id ? "selected" : ""}>${c.name}</option>
          `).join("")}
        </select>
        <button class="btn-delete-board p-2 hover:bg-red-50 rounded text-red-500" title="Delete">\ud83d\uddd1\ufe0f</button>
      </div>
    </div>
  `).join("");

  els.boardList.querySelectorAll(".board-category-select").forEach(select => {
    select.addEventListener("change", async () => {
      const boardId = select.dataset.boardId;
      const categoryId = select.value || null;
      await updateBoardCategory(boardId, categoryId);
    });
  });

  els.boardList.querySelectorAll(".btn-delete-board").forEach(btn => {
    btn.addEventListener("click", async () => {
      const boardId = btn.closest(".board-item").dataset.boardId;
      if (confirm("Delete this board?")) await deleteBoardById(boardId);
    });
  });
}

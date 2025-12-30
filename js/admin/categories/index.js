import { initNavbar } from "../../shared/navbar.js";
import { fetchCategories, upsertCategory } from "./api.js";
import { renderCategoryTable } from "./renderTable.js";
import { bindCategoryModal } from "./modal.js";

const els = {
  rows: document.getElementById("categoryRows"),
  btnNew: document.getElementById("btnNewCategory"),

  modal: document.getElementById("categoryModal"),
  modalTitle: document.getElementById("modalTitle"),
  btnClose: document.getElementById("btnCloseModal"),
  btnSave: document.getElementById("btnSaveCategory"),

  fName: document.getElementById("fName"),
  fSlug: document.getElementById("fSlug"),
  fImage: document.getElementById("fImage"),
  fOrder: document.getElementById("fOrder"),
  fActive: document.getElementById("fActive"),
};

let categories = [];

async function refresh() {
  categories = await fetchCategories();
  renderCategoryTable(els.rows, categories, editCategory);
}

function editCategory(id) {
  const cat = categories.find(c => c.id === id);
  modal.open(cat);
}

const modal = bindCategoryModal(els, async (payload) => {
  await upsertCategory(payload);
  await refresh();
});

els.btnNew.addEventListener("click", () => modal.open(null));

document.addEventListener("DOMContentLoaded", async () => {
  await initNavbar();
  await refresh();
});

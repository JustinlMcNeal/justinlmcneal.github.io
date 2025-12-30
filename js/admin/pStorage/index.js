import { initNavbar } from "../../shared/navbar.js";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

import { getEls, setStatus } from "./dom.js";
import { makeApi } from "./api.js";
import { createState } from "./state.js";
import { renderTable } from "./renderTable.js";
import { bindModal, openModalForNew, openModalForEdit } from "./modal.js";

/* --------------------------
   Helpers
-------------------------- */
function requireEls(map, keys) {
  const missing = keys.filter((k) => !map[k]);
  if (missing.length) {
    console.error(
      "[Admin Product Storage] Missing required elements (wrong HTML or id changed):",
      missing
    );
    return false;
  }
  return true;
}

/* --------------------------
   Boot (WAIT FOR NAVBAR)
-------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initNavbar();
  } catch (e) {
    console.error("[Admin Product Storage] initNavbar failed:", e);
  }

  bootAdmin();
});

function bootAdmin() {
  const els = getEls();

  // IMPORTANT: fail fast if HTML ids don’t match
  if (
    !requireEls(els, [
      "statusEl",
      "searchInput",
      "btnNew",
      "countLabel",
      "storageRows",
      "modal",
      "btnClose",
      "btnSave",
      "btnArchive",
      "btnHardDelete",
      "fName",
      "fStage",
    ])
  ) {
    // Don’t continue if required elements are missing
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const api = makeApi(supabase);
  const state = createState();

  setStatus(els, "Loading…");

  // Wire modal once
  bindModal({
    els,
    api,
    state,
    onSaved: () => renderTable({ els, state }),
    onDeleted: () => renderTable({ els, state }),
    onStatus: (msg) => setStatus(els, msg),
  });

  // Search
  els.searchInput.addEventListener("input", (e) => {
    state.setQuery(e.target.value || "");
    renderTable({ els, state });
  });

  // NEW
  els.btnNew.addEventListener("click", () => {
    console.log("[Admin Product Storage] + Add item clicked");
    openModalForNew(els);
  });

  // Table action: edit
  els.storageRows.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action='edit']");
    if (!btn) return;

    const id = btn.getAttribute("data-id");
    const row = state.getById(id);
    if (!row) return;

    openModalForEdit(els, row);
  });

  refresh();

  async function refresh() {
    try {
      setStatus(els, "Fetching items…");
      const rows = await api.list();
      state.setItems(rows);
      renderTable({ els, state });
      setStatus(els, `Loaded ${rows.length} item(s).`);
    } catch (e) {
      console.error(e);
      setStatus(els, `Error: ${e?.message || "Failed to load"}`);
    }
  }
}

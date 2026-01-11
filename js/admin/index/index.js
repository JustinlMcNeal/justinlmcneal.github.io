// /js/admin/index/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { requireAdmin } from "/js/shared/guard.js";

function nextUrl() {
  return location.pathname + location.search + location.hash;
}

function setStatus(title, msg) {
  const box = document.getElementById("adminStatus");
  if (!box) return;
  box.innerHTML = `
    <div class="text-[11px] font-black uppercase tracking-[.25em]">${title}</div>
    <div class="text-sm text-black/70 mt-2">${msg}</div>
  `;
}

function initToolSearch() {
  const input = document.getElementById("toolSearch");
  const clearBtn = document.getElementById("clearSearch");
  const grid = document.getElementById("toolGrid");
  const countEl = document.getElementById("toolCount");
  const filterBtns = Array.from(document.querySelectorAll(".js-filter"));
  if (!grid) return;

  const tiles = Array.from(grid.querySelectorAll("a[data-title]"));
  let activeFilter = "all";
  let query = "";

  function setActive(btn) {
    filterBtns.forEach((b) => {
      b.classList.remove("bg-black", "text-white");
      b.classList.add("bg-white", "text-black");
    });
    btn.classList.remove("bg-white", "text-black");
    btn.classList.add("bg-black", "text-white");
  }

  function apply() {
    const q = (query || "").trim().toLowerCase();
    let shown = 0;

    for (const tile of tiles) {
      const title = (tile.dataset.title || "").toLowerCase();
      const kicker = (tile.dataset.kicker || "").toLowerCase();
      const tags = (tile.dataset.tags || "").toLowerCase();

      const matchesText = !q || title.includes(q) || kicker.includes(q) || tags.includes(q);
      const matchesFilter = activeFilter === "all" || kicker === activeFilter;

      const show = matchesText && matchesFilter;
      tile.style.display = show ? "" : "none";
      if (show) shown++;
    }

    if (countEl) {
      countEl.textContent =
        shown === tiles.length ? `Showing all ${tiles.length} tools` : `Showing ${shown} of ${tiles.length} tools`;
    }
  }

  input?.addEventListener("input", () => {
    query = input.value || "";
    apply();
  });

  clearBtn?.addEventListener("click", () => {
    if (input) input.value = "";
    query = "";
    apply();
    input?.focus();
  });

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter || "all";
      setActive(btn);
      apply();
    });
  });

  const allBtn = filterBtns.find((b) => b.dataset.filter === "all");
  if (allBtn) setActive(allBtn);

  apply();
}

async function boot() {
  try {
    setStatus("Loading", "Checking admin session…");

    const res = await requireAdmin();
    if (!res.ok) {
      const next = encodeURIComponent(nextUrl());
      location.replace(`/pages/admin/login.html?next=${next}`);
      return;
    }

    // show page after authorization
    document.body.classList.remove("hidden");

    await initAdminNav("Dashboard");
    initFooter();
    initToolSearch();

    setStatus("Ready", "Admin access granted.");
    // optional: hide status box after a moment
    // setTimeout(() => document.getElementById("adminStatus")?.remove(), 800);

  } catch (err) {
    console.error("[admin-index] boot error:", err);
    document.body.classList.remove("hidden");
    setStatus("Error", err?.message || String(err));
  }
}

document.addEventListener("DOMContentLoaded", boot);

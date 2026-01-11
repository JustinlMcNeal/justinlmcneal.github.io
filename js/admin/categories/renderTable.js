function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function badge(active) {
  return active
    ? `
      <span class="inline-flex items-center gap-2 border-2 border-black px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] bg-white">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-black"></span>
        Active
      </span>`
    : `
      <span class="inline-flex items-center gap-2 border-2 border-black/25 px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] bg-white text-black/55">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-black/25"></span>
        Inactive
      </span>`;
}

function kv(label, value) {
  return `
    <div class="flex flex-col gap-1">
      <div class="text-[11px] font-black uppercase tracking-[0.14em] text-black/55">${label}</div>
      <div class="text-[13px] leading-5 text-black/80 break-words">${value}</div>
    </div>
  `;
}

export function renderCategoryTable(rowsEl, categories, onEdit) {
  rowsEl.innerHTML = categories.map((c) => {
    const id = esc(c.id);
    const name = esc(c.name);
    const slug = esc(c.slug);
    const img = esc(c.home_image_path || "—");
    const order = Number.isFinite(Number(c.home_sort_order)) ? esc(c.home_sort_order) : "—";
    const active = !!c.is_active;

    return `
      <tr class="align-top">
        <!-- NAME + MOBILE CARD -->
        <td class="min-w-[240px]">
          <!-- Desktop name -->
          <div class="hidden md:block">
            <div class="text-[14px] font-black uppercase tracking-[0.06em]">${name}</div>
          </div>

          <!-- Mobile card -->
          <div class="md:hidden">
            <div class="border-2 border-black/15 bg-black/[0.02] p-3">
              <!-- Top row: Name + badge -->
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[14px] font-black uppercase tracking-[0.06em] leading-5 break-words">
                    ${name}
                  </div>
                  <div class="mt-2">${badge(active)}</div>
                </div>
              </div>

              <!-- Details grid -->
              <div class="mt-3 grid grid-cols-1 gap-3">
                ${kv("Slug", slug)}
                ${kv("Home image path", img)}
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-[11px] font-black uppercase tracking-[0.14em] text-black/55">Sort order</div>
                    <div class="mt-1 inline-flex items-center border-2 border-black px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em]">
                      ${order}
                    </div>
                  </div>

                  <!-- BIG mobile edit button -->
                  <button
                    class="border-[4px] border-black bg-black text-white px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em]
                           hover:bg-kkPink hover:text-black transition active:translate-y-[1px] w-[120px]"
                    data-edit="${id}"
                    type="button"
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          </div>
        </td>

        <!-- DESKTOP COLUMNS -->
        <td class="hidden md:table-cell">${slug}</td>
        <td class="hidden md:table-cell max-w-[420px]">
          <div class="truncate" title="${img}">${img}</div>
        </td>
        <td class="hidden md:table-cell">
          <span class="inline-flex items-center border-2 border-black px-2 py-1 text-[12px] font-black uppercase tracking-[0.12em]">
            ${order}
          </span>
        </td>
        <td class="hidden md:table-cell">
          ${badge(active)}
        </td>

        <!-- DESKTOP ACTIONS -->
        <td class="hidden md:table-cell text-right">
          <button
            class="border-[4px] border-black bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em]
                   hover:bg-black hover:text-white transition active:translate-y-[1px]"
            data-edit="${id}"
            type="button"
          >
            Edit
          </button>
        </td>

        <!-- MOBILE: hide last TD entirely to avoid extra column -->
        <td class="md:hidden hidden"></td>
      </tr>
    `;
  }).join("");

  rowsEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => onEdit(btn.dataset.edit));
  });
}

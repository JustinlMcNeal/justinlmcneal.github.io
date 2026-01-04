import { escapeHtml, money } from "./dom.js";
import { state } from "./state.js";

function mobileCardRow(p, cat, active, readOnly) {
  return `
    <div class="border-4 border-black p-4 bg-white">
      <div class="flex justify-between gap-3">
        <div class="min-w-0">
          <div class="text-xs font-black uppercase tracking-[.18em]">
            ${escapeHtml(p.name || "")}
          </div>

          <div class="mt-2 text-sm text-black/70 space-y-1">
            <div><b>Slug:</b> ${escapeHtml(p.slug || "—")}</div>
            <div><b>Code:</b> ${escapeHtml(p.code || "—")}</div>
            <div><b>Category:</b> ${escapeHtml(cat || "—")}</div>
            <div><b>Price:</b> ${money(p.price)}</div>
            <div><b>Active:</b> ${active}</div>
          </div>
        </div>

        ${
          readOnly
            ? ""
            : `
          <button
            type="button"
            data-edit="${p.id}"
            class="border-4 border-black px-3 py-2 text-[11px] font-black uppercase tracking-[.12em]
                   hover:bg-black hover:text-white"
          >
            Edit
          </button>
        `
        }
      </div>
    </div>
  `;
}

export function renderTable({
  productRowsEl,
  countLabelEl,
  searchValue,
  onEdit,
  onEditError,
  readOnly = false,
}) {
  if (!productRowsEl) return;

  const q = (searchValue || "").trim().toLowerCase();
  const categories = state.categories || [];
  const products = state.products || [];

  const filtered = products.filter((p) => {
    if (!q) return true;
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.slug || "").toLowerCase().includes(q) ||
      (p.code || "").toLowerCase().includes(q)
    );
  });

  if (countLabelEl) {
    countLabelEl.textContent = `${filtered.length} item${filtered.length === 1 ? "" : "s"}`;
  }

  const catMap = new Map(categories.map((c) => [String(c.id), c.name]));

  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  /* ---------------- MOBILE ---------------- */
  if (isMobile) {
    productRowsEl.innerHTML = filtered
      .map((p) => {
        const cat = catMap.get(String(p.category_id)) || "";
        const active = p.is_active ? "YES" : "NO";
        return mobileCardRow(p, cat, active, readOnly);
      })
      .join("");

    if (!readOnly) {
      productRowsEl.querySelectorAll("[data-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await onEdit(btn.dataset.edit);
          } catch (err) {
            console.error(err);
            onEditError?.(err);
          }
        });
      });
    }
    return;
  }

  /* ---------------- DESKTOP ---------------- */
  productRowsEl.innerHTML = filtered
    .map((p) => {
      const cat = catMap.get(String(p.category_id)) || "";
      const active = p.is_active ? "YES" : "NO";

      return `
        <tr class="hover:bg-black/5">
          <td class="px-4 py-3 font-semibold">
            ${escapeHtml(p.name || "")}
          </td>
          <td class="px-4 py-3">
            ${escapeHtml(p.slug || "")}
          </td>
          <td class="px-4 py-3">
            ${escapeHtml(p.code || "")}
          </td>
          <td class="px-4 py-3">
            ${escapeHtml(cat)}
          </td>
          <td class="px-4 py-3 text-right">
            ${money(p.price)}
          </td>
          <td class="px-4 py-3 text-center">
            ${active}
          </td>
          <td class="px-4 py-3 text-right">
            ${
              readOnly
                ? `<span class="text-xs opacity-50">Read only</span>`
                : `
              <button
                type="button"
                data-edit="${p.id}"
                class="border-4 border-black px-3 py-2 text-[11px] font-black uppercase tracking-[.12em]
                       hover:bg-black hover:text-white"
              >
                Edit
              </button>
            `
            }
          </td>
        </tr>
      `;
    })
    .join("");

  if (!readOnly) {
    productRowsEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await onEdit(btn.dataset.edit);
        } catch (err) {
          console.error(err);
          onEditError?.(err);
        }
      });
    });
  }
}

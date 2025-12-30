import { escapeHtml, money } from "./dom.js";
import { state } from "./state.js";

function mobileCardRow(p, cat, active) {
  return `
    <div class="kk-card" style="padding:14px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-weight:1000; text-transform:uppercase; letter-spacing:.06em; font-size:13px;">
            ${escapeHtml(p.name || "")}
          </div>
          <div style="margin-top:6px; font-size:13px; color:rgba(0,0,0,.70); line-height:1.35;">
            <div><b>Slug:</b> ${escapeHtml(p.slug || "—")}</div>
            <div><b>Code:</b> ${escapeHtml(p.code || "—")}</div>
            <div><b>Category:</b> ${escapeHtml(cat || "—")}</div>
            <div><b>Price:</b> ${money(p.price)}</div>
            <div><b>Active:</b> ${active}</div>
          </div>
        </div>

        <div style="flex:0 0 auto;">
          <button type="button" data-edit="${p.id}" class="kk-btn" style="padding:10px 12px; font-size:11px;">
            Edit
          </button>
        </div>
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

  // MOBILE: render cards
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  if (isMobile) {
    productRowsEl.innerHTML = filtered
      .map((p) => {
        const cat = catMap.get(String(p.category_id)) || "";
        const active = p.is_active ? "YES" : "NO";

        if (readOnly) {
          return `
            <div class="kk-card" style="padding:14px; margin-bottom:12px;">
              <div style="font-weight:1000; text-transform:uppercase; letter-spacing:.06em; font-size:13px;">
                ${escapeHtml(p.name || "")}
              </div>
              <div style="margin-top:6px; font-size:13px; color:rgba(0,0,0,.70); line-height:1.35;">
                <div><b>Slug:</b> ${escapeHtml(p.slug || "—")}</div>
                <div><b>Code:</b> ${escapeHtml(p.code || "—")}</div>
                <div><b>Category:</b> ${escapeHtml(cat || "—")}</div>
                <div><b>Price:</b> ${money(p.price)}</div>
                <div><b>Active:</b> ${active}</div>
              </div>
            </div>
          `;
        }

        return mobileCardRow(p, cat, active);
      })
      .join("");

    if (!readOnly) {
      productRowsEl.querySelectorAll("button[data-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await onEdit(btn.dataset.edit);
          } catch (err) {
            console.error("[Admin Products] openEdit failed:", err);
            if (onEditError) onEditError(err);
            else alert(err?.message || String(err));
          }
        });
      });
    }

    return;
  }

  // DESKTOP: render table rows
  productRowsEl.innerHTML = filtered
    .map((p) => {
      const cat = catMap.get(String(p.category_id)) || "";
      const active = p.is_active ? "YES" : "NO";

      return `
        <tr>
          <td><strong>${escapeHtml(p.name || "")}</strong></td>
          <td>${escapeHtml(p.slug || "")}</td>
          <td>${escapeHtml(p.code || "")}</td>
          <td>${escapeHtml(cat)}</td>
          <td>${money(p.price)}</td>
          <td>${active}</td>
          <td class="kk-admin-table-actions">
            ${
              readOnly
                ? `<span style="font-size:12px; color:rgba(0,0,0,.55);">Read-only</span>`
                : `
                  <div class="kk-admin-row-actions">
                    <button type="button" data-edit="${p.id}">Edit</button>
                  </div>
                `
            }
          </td>
        </tr>
      `;
    })
    .join("");

  if (!readOnly) {
    productRowsEl.querySelectorAll("button[data-edit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await onEdit(btn.dataset.edit);
        } catch (err) {
          console.error("[Admin Products] openEdit failed:", err);
          if (onEditError) onEditError(err);
          else alert(err?.message || String(err));
        }
      });
    });
  }
}

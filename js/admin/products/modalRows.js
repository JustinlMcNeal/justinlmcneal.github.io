import { escapeAttr } from "./dom.js";

/* =========================
   VARIANTS
========================= */

export function addVariantRow(
  variantListEl,
  v = { option_value: "", stock: 0, preview_image_url: "" }
) {
  const row = document.createElement("div");
  row.setAttribute("data-row", "variant");
  row.classList.add("kk-admin-list-row"); // ✅ CSS controls border/padding/margin

  row.innerHTML = `
    <div class="kk-grid kk-grid-2">
      <div class="kk-field">
        <label class="kk-label kk-label--tight">Color</label>
        <input class="kk-input kk-input--tight" placeholder="Black" value="${escapeAttr(
          v.option_value || ""
        )}" data-v="value" />
      </div>

      <div class="kk-field">
        <label class="kk-label kk-label--tight">Stock</label>
        <input class="kk-input kk-input--tight" type="number" min="0" placeholder="0" value="${Number(
          v.stock || 0
        )}" data-v="stock" />
      </div>

      <div class="kk-field" style="grid-column: 1 / -1;">
        <label class="kk-label kk-label--tight">Preview image URL</label>
        <input class="kk-input kk-input--tight" placeholder="https://." value="${escapeAttr(
          v.preview_image_url || ""
        )}" data-v="img" />
      </div>

      <div class="kk-field" style="grid-column: 1 / -1; display:flex; justify-content:flex-end;">
        <button type="button" class="kk-btn-ghost" data-v="del">
          Remove
        </button>
      </div>
    </div>
  `;

  row.querySelector('[data-v="del"]').addEventListener("click", () => row.remove());
  variantListEl.appendChild(row);
}

export function collectVariants(variantListEl) {
  const rows = Array.from(variantListEl.querySelectorAll('[data-row="variant"]'));
  return rows
    .map((row, idx) => {
      const option_value = row.querySelector('[data-v="value"]').value.trim();
      const stock = Number(row.querySelector('[data-v="stock"]').value || 0);
      const preview_image_url = row.querySelector('[data-v="img"]').value.trim();
      return {
        option_value,
        stock: Math.max(0, stock),
        preview_image_url: preview_image_url || null,
        sort_order: idx,
      };
    })
    .filter((v) => v.option_value);
}

/* =========================
   GALLERY
========================= */

export function addGalleryRow(galleryListEl, g = { url: "", position: 1 }) {
  const row = document.createElement("div");
  row.setAttribute("data-row", "gallery");
  row.classList.add("kk-admin-list-row"); // ✅ CSS controls border/padding/margin

  row.innerHTML = `
    <div class="kk-grid kk-grid-2">
      <div class="kk-field" style="grid-column: 1 / -1;">
        <label class="kk-label kk-label--tight">Image URL</label>
        <input class="kk-input kk-input--tight" placeholder="https://." value="${escapeAttr(
          g.url || ""
        )}" data-g="url" />
      </div>

      <div class="kk-field">
        <label class="kk-label kk-label--tight">Position</label>
        <input class="kk-input kk-input--tight" type="number" min="0" placeholder="1" value="${Number(
          g.position || 1
        )}" data-g="pos" />
      </div>

      <div class="kk-field" style="display:flex; justify-content:flex-end; align-self:end;">
        <button type="button" class="kk-btn-ghost" data-g="del" style="border-color:#b91c1c;color:#b91c1c; width:100%; max-width:220px;">
          Remove
        </button>
      </div>
    </div>
  `;

  row.querySelector('[data-g="del"]').addEventListener("click", () => row.remove());
  galleryListEl.appendChild(row);
}

export function collectGallery(galleryListEl) {
  const rows = Array.from(galleryListEl.querySelectorAll('[data-row="gallery"]'));
  return rows
    .map((row, idx) => {
      const url = row.querySelector('[data-g="url"]').value.trim();
      const position = Number(row.querySelector('[data-g="pos"]').value || idx + 1);
      return { url, position: Math.max(0, position) };
    })
    .filter((g) => g.url);
}

/* =========================
   PRODUCT SECTIONS (Description / Sizing / Care)
   Stored in product_section_items
========================= */

function ensureSectionMount(modalMsgEl) {
  let el = document.getElementById("sectionItemsEditor");
  if (!el) {
    el = document.createElement("div");
    el.id = "sectionItemsEditor";
    // Insert just before the modal message area (matches your current layout)
    modalMsgEl.parentElement.insertBefore(el, modalMsgEl);
  }
  return el;
}

function sectionRowHtml(sec, row = { content: "", position: 0 }) {
  return `
    <div class="kk-grid kk-grid-2" data-sec-row="${escapeAttr(sec)}" style="margin-top:12px; align-items:end;">
      <div class="kk-field" style="grid-column: 1 / -1;">
        <label class="kk-label kk-label--tight">Text</label>
        <input class="kk-input kk-input--tight"
               placeholder="Type bullet text…"
               value="${escapeAttr(row.content || "")}"
               data-sec="${escapeAttr(sec)}"
               data-k="content" />
      </div>

      <div class="kk-field">
        <label class="kk-label kk-label--tight">Position</label>
        <input class="kk-input kk-input--tight"
               type="number"
               min="0"
               value="${Number(row.position || 0)}"
               data-sec="${escapeAttr(sec)}"
               data-k="position" />
      </div>

      <div class="kk-field" style="display:flex; justify-content:flex-end; align-self:end;">
        <button type="button"
                class="kk-btn-ghost"
                data-sec-del="1"
                style="border-color:#b91c1c;color:#b91c1c; width:100%; max-width:220px;">
          Remove
        </button>
      </div>
    </div>
  `;
}

/**
 * Renders the Product Sections UI into the modal.
 * @param {Object} opts
 * @param {HTMLElement} opts.modalMsgEl - element used to insert the editor before
 * @param {string[]} opts.sections - allowed sections, ex: ["description","sizing","care"]
 * @param {Array} opts.items - rows from Supabase: [{section, content, position}]
 */
export function renderSectionEditor({ modalMsgEl, sections, items = [] }) {
  const mount = ensureSectionMount(modalMsgEl);

  const grouped = Object.fromEntries(sections.map((s) => [s, []]));
  (items || []).forEach((it) => {
    if (grouped[it.section]) grouped[it.section].push(it);
  });
  sections.forEach((s) =>
    grouped[s].sort((a, b) => Number(a.position) - Number(b.position))
  );

  mount.innerHTML = `
    <div class="kk-divider"></div>
    <div class="kk-section-title" style="margin-top:10px;">Product Sections</div>
    <div class="kk-sub" style="margin-top:6px; opacity:.75;">
      These bullets show on the product page under Description / Sizing / Care.
    </div>

    ${sections
      .map(
        (sec) => `
          <div class="kk-card" style="border-width:2px; margin-top:14px;">
            <div class="kk-card-pad" style="padding:14px 16px;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                <div class="kk-kicker">${escapeAttr(sec)}</div>
                <button type="button" class="kk-btn" data-sec-add="${escapeAttr(sec)}"
                        style="width:auto; padding:10px 12px; font-size:12px;">
                  + Add bullet
                </button>
              </div>

              <div data-sec-list="${escapeAttr(sec)}" style="margin-top:10px;">
                ${
                  grouped[sec].length
                    ? grouped[sec].map((row) => sectionRowHtml(sec, row)).join("")
                    : `<div class="kk-sub" style="opacity:.7;">No items yet.</div>`
                }
              </div>
            </div>
          </div>
        `
      )
      .join("")}
  `;

  // Wire Add buttons
  mount.querySelectorAll("[data-sec-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = btn.getAttribute("data-sec-add");
      addSectionRow({ sections, sec, mount });
    });
  });

  // Delegated remove
  mount.addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-sec-del]");
    if (!delBtn) return;

    const row = delBtn.closest("[data-sec-row]");
    if (row) row.remove();

    const sec = row?.getAttribute("data-sec-row");
    if (!sec) return;

    const list = mount.querySelector(`[data-sec-list="${sec}"]`);
    if (list && list.querySelectorAll("[data-sec-row]").length === 0) {
      list.innerHTML = `<div class="kk-sub" style="opacity:.7;">No items yet.</div>`;
    }
  });

  return mount;
}

function addSectionRow({ sections, sec, mount }) {
  if (!sections.includes(sec)) return;
  const list = mount.querySelector(`[data-sec-list="${sec}"]`);
  if (!list) return;

  // clear placeholder
  if (list.textContent.trim() === "No items yet.") list.innerHTML = "";

  const count = list.querySelectorAll("[data-sec-row]").length;
  list.insertAdjacentHTML("beforeend", sectionRowHtml(sec, { content: "", position: count }));

  // focus last content input
  const last = list.querySelectorAll('input[data-k="content"]');
  last[last.length - 1]?.focus();
}

/**
 * Collects section items from the modal UI.
 * @param {Object} opts
 * @param {string[]} opts.sections
 */
export function collectSectionItems({ sections }) {
  const mount = document.getElementById("sectionItemsEditor");
  if (!mount) return [];

  const out = [];
  const grids = mount.querySelectorAll("[data-sec-row]");

  grids.forEach((grid) => {
    const sec = grid.getAttribute("data-sec-row");
    const content = grid.querySelector('input[data-k="content"]')?.value.trim();
    const position = Number(grid.querySelector('input[data-k="position"]')?.value || 0);

    if (!content) return;
    if (!sections.includes(sec)) return;

    out.push({
      section: sec,
      content,
      position: Number.isFinite(position) ? position : 0,
    });
  });

  out.sort((a, b) => a.section.localeCompare(b.section) || a.position - b.position);
  return out;
}

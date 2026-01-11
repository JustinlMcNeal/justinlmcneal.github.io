import { escapeAttr } from "./dom.js";
import { uploadProductImage } from "./api.js";

/* =========================
   VARIANTS
========================= */

export function addVariantRow(
  variantListEl,
  v = { option_value: "", stock: 0, preview_image_url: "" }
) {
  const row = document.createElement("div");
  row.setAttribute("data-row", "variant");
  row.classList.add("kk-admin-list-row");
  row.style.cssText = "padding: 10px; border: 2px solid #e5e7eb; background: #fafafa; border-radius: 4px;";

  const uniqueId = `var-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  row.innerHTML = `
    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <!-- Preview image thumbnail -->
      <div data-v="preview" style="width:44px; height:44px; background:#fff; border:2px solid #000; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; cursor:pointer;" title="Click to change image">
        ${v.preview_image_url 
          ? `<img src="${escapeAttr(v.preview_image_url)}" style="width:100%; height:100%; object-fit:cover;" />` 
          : `<span style="font-size:16px; color:#9ca3af;">+</span>`}
      </div>
      
      <!-- Hidden file input -->
      <input type="file" accept="image/*" data-v="file" style="display:none;" />
      
      <!-- Color input -->
      <div style="flex: 1; min-width: 100px;">
        <input class="kk-input" style="padding: 8px 10px; font-size: 13px; border-width: 2px;" 
               placeholder="Color name" value="${escapeAttr(v.option_value || "")}" data-v="value" />
      </div>
      
      <!-- Stock input -->
      <div style="width: 70px;">
        <input class="kk-input" style="padding: 8px 10px; font-size: 13px; border-width: 2px; text-align: center;" 
               type="number" min="0" placeholder="0" value="${Number(v.stock || 0)}" data-v="stock" title="Stock quantity" />
      </div>
      
      <!-- Hidden URL storage -->
      <input type="hidden" value="${escapeAttr(v.preview_image_url || "")}" data-v="img" />
      
      <!-- Remove button -->
      <button type="button" class="kk-btn-ghost" data-v="del" style="padding: 6px 10px; font-size: 10px;">
        ✕
      </button>
    </div>
  `;

  // Wire delete
  row.querySelector('[data-v="del"]').addEventListener("click", () => row.remove());

  // Wire preview click to trigger file input
  const previewEl = row.querySelector('[data-v="preview"]');
  const fileInput = row.querySelector('[data-v="file"]');
  const urlInput = row.querySelector('[data-v="img"]');

  previewEl.addEventListener("click", () => fileInput.click());

  fileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    previewEl.innerHTML = `<span style="font-size:10px;">...</span>`;
    try {
      const url = await uploadProductImage(file, "variants");
      urlInput.value = url;
      previewEl.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;" />`;
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed: " + (err.message || err));
      previewEl.innerHTML = `<span style="font-size:16px; color:#9ca3af;">+</span>`;
    }
    fileInput.value = "";
  });

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
   GALLERY (Grid of squares)
========================= */

/**
 * Creates a gallery square item with image preview and remove button
 * Supports drag & drop reordering
 */
export function addGalleryRow(galleryListEl, g = { url: "", position: 0 }) {
  const item = document.createElement("div");
  item.setAttribute("data-row", "gallery");
  item.setAttribute("draggable", "true");
  item.classList.add("gallery-item");
  item.style.cssText = `
    position: relative;
    width: 80px;
    height: 80px;
    border: 3px solid #000;
    background: #f3f4f6;
    overflow: hidden;
    flex-shrink: 0;
    cursor: grab;
    transition: transform 0.15s, opacity 0.15s;
  `;

  const url = g.url || g.image_url || "";
  const position = g.position ?? g.sort_order ?? 0;

  item.innerHTML = `
    <!-- Image preview -->
    <div data-g="preview" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
      ${url 
        ? `<img src="${escapeAttr(url)}" style="width:100%; height:100%; object-fit:cover;" />` 
        : `<span style="font-size:9px; color:#9ca3af;">Empty</span>`}
    </div>
    
    <!-- Hidden URL input -->
    <input type="hidden" data-g="url" value="${escapeAttr(url)}" />
    <input type="hidden" data-g="pos" value="${position}" />
    
    <!-- Drag handle indicator -->
    <div style="position:absolute; bottom:2px; left:2px; right:2px; height:4px; 
                display:flex; gap:1px; justify-content:center; opacity:0.3;">
      <div style="width:12px; height:2px; background:#000; border-radius:1px;"></div>
      <div style="width:12px; height:2px; background:#000; border-radius:1px;"></div>
    </div>
    
    <!-- Remove button (X in corner) -->
    <button type="button" data-g="del" 
            style="position:absolute; top:2px; right:2px; width:18px; height:18px; 
                   background:#000; color:#fff; border:none; 
                   font-size:12px; font-weight:bold; cursor:pointer; 
                   display:flex; align-items:center; justify-content:center;
                   opacity:0; transition:opacity 0.15s;"
            title="Remove">×</button>
  `;

  // Show/hide remove button on hover
  item.addEventListener("mouseenter", () => {
    item.querySelector('[data-g="del"]').style.opacity = "1";
  });
  item.addEventListener("mouseleave", () => {
    item.querySelector('[data-g="del"]').style.opacity = "0";
  });

  // Wire delete
  item.querySelector('[data-g="del"]').addEventListener("click", (e) => {
    e.stopPropagation();
    item.remove();
  });

  // Drag & drop handlers
  item.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    item.style.opacity = "0.5";
    item.classList.add("dragging");
  });

  item.addEventListener("dragend", () => {
    item.style.opacity = "1";
    item.classList.remove("dragging");
    // Remove any drag-over styles from all items
    galleryListEl.querySelectorAll('[data-row="gallery"]').forEach(el => {
      el.style.transform = "";
    });
  });

  item.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    const draggingItem = galleryListEl.querySelector(".dragging");
    if (!draggingItem || draggingItem === item) return;
    
    // Visual feedback
    const rect = item.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    
    if (e.clientX < midX) {
      item.style.transform = "translateX(8px)";
    } else {
      item.style.transform = "translateX(-8px)";
    }
  });

  item.addEventListener("dragleave", () => {
    item.style.transform = "";
  });

  item.addEventListener("drop", (e) => {
    e.preventDefault();
    item.style.transform = "";
    
    const draggingItem = galleryListEl.querySelector(".dragging");
    if (!draggingItem || draggingItem === item) return;
    
    // Determine drop position
    const rect = item.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    
    if (e.clientX < midX) {
      galleryListEl.insertBefore(draggingItem, item);
    } else {
      galleryListEl.insertBefore(draggingItem, item.nextSibling);
    }
  });

  galleryListEl.appendChild(item);
  return item;
}

/**
 * Adds multiple gallery items from file uploads
 */
export async function addGalleryFromFiles(galleryListEl, files) {
  for (const file of files) {
    // Create placeholder item
    const item = document.createElement("div");
    item.setAttribute("data-row", "gallery");
    item.classList.add("gallery-item");
    item.style.cssText = `
      position: relative;
      width: 80px;
      height: 80px;
      border: 3px solid #000;
      background: #f3f4f6;
      overflow: hidden;
      flex-shrink: 0;
    `;
    
    item.innerHTML = `
      <div data-g="preview" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
        <span style="font-size:8px; animation:pulse 1s infinite;">...</span>
      </div>
      <input type="hidden" data-g="url" value="" />
      <input type="hidden" data-g="pos" value="0" />
      <button type="button" data-g="del" 
              style="position:absolute; top:2px; right:2px; width:18px; height:18px; 
                     background:#000; color:#fff; border:none; 
                     font-size:12px; font-weight:bold; cursor:pointer; 
                     display:flex; align-items:center; justify-content:center;
                     opacity:0; transition:opacity 0.15s;"
              title="Remove">×</button>
    `;

    // Show/hide remove button on hover
    item.addEventListener("mouseenter", () => {
      item.querySelector('[data-g="del"]').style.opacity = "1";
    });
    item.addEventListener("mouseleave", () => {
      item.querySelector('[data-g="del"]').style.opacity = "0";
    });

    // Wire delete
    item.querySelector('[data-g="del"]').addEventListener("click", (e) => {
      e.stopPropagation();
      item.remove();
    });

    galleryListEl.appendChild(item);

    // Upload the file
    try {
      const url = await uploadProductImage(file, "gallery");
      item.querySelector('[data-g="url"]').value = url;
      item.querySelector('[data-g="preview"]').innerHTML = 
        `<img src="${url}" style="width:100%; height:100%; object-fit:cover;" />`;
    } catch (err) {
      console.error("Upload failed:", err);
      
      // Show better error message based on error type
      let errorMsg = "Failed";
      if (err.message?.includes("Bucket not found")) {
        errorMsg = "No bucket";
        alert('Storage bucket "products" not found. Please create it in your Supabase Dashboard:\n\n1. Go to Storage\n2. Click "New Bucket"\n3. Name it "products"\n4. Enable "Public bucket"');
      }
      
      item.querySelector('[data-g="preview"]').innerHTML = 
        `<span style="font-size:8px; color:#dc2626;">${errorMsg}</span>`;
    }
  }
}

export function collectGallery(galleryListEl) {
  const items = Array.from(galleryListEl.querySelectorAll('[data-row="gallery"]'));
  return items
    .map((item, idx) => {
      const url = item.querySelector('[data-g="url"]').value.trim();
      // Always use DOM order as position to avoid duplicate key issues
      return { url, position: idx + 1 };
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
 * Compact version of section row for side-by-side layout
 */
function sectionRowHtmlCompact(sec, row = { content: "", position: 0 }) {
  return `
    <div data-sec-row="${escapeAttr(sec)}" style="display:flex; gap:6px; align-items:center;">
      <input type="number" min="0" value="${Number(row.position || 0)}" data-sec="${escapeAttr(sec)}" data-k="position"
             style="width:36px; border:2px solid #000; padding:4px 6px; font-size:11px; text-align:center; outline:none;" />
      <input placeholder="Bullet text…" value="${escapeAttr(row.content || "")}" data-sec="${escapeAttr(sec)}" data-k="content"
             style="flex:1; border:2px solid #000; padding:4px 8px; font-size:11px; outline:none;" />
      <button type="button" data-sec-del="1"
              style="border:none; background:none; color:#b91c1c; font-size:16px; cursor:pointer; padding:0 4px;"
              title="Remove">×</button>
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
    <div class="kk-section-title" style="margin-top:10px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="width:20px; height:20px; background:#000; color:#fff; font-size:10px; display:flex; align-items:center; justify-content:center;">6</span>
        <span>Product Sections</span>
      </div>
    </div>
    <div class="kk-sub" style="margin-top:6px; opacity:.75;">
      These bullets show on the product page under Description / Sizing / Care.
    </div>

    <!-- Side by side grid for sections -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-top:14px;">
      ${sections
        .map(
          (sec) => `
            <div class="kk-card" style="border-width:2px;">
              <div class="kk-card-pad" style="padding:12px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
                  <div class="kk-kicker" style="text-transform:capitalize; font-size:11px;">${escapeAttr(sec)}</div>
                  <div style="display:flex; gap:4px;">
                    <button type="button" class="kk-btn" data-sec-paste="${escapeAttr(sec)}"
                            style="width:auto; padding:6px 8px; font-size:9px; background:#fff; border:2px solid #000; color:#000;"
                            title="Paste multiple lines"
                            onmouseover="this.style.background='#000'; this.style.color='#fff';"
                            onmouseout="this.style.background='#fff'; this.style.color='#000';">
                      📋 Paste
                    </button>
                    <button type="button" class="kk-btn" data-sec-add="${escapeAttr(sec)}"
                            style="width:auto; padding:6px 10px; font-size:10px;">
                      +
                    </button>
                  </div>
                </div>

                <!-- Paste area (hidden by default) -->
                <div data-sec-paste-area="${escapeAttr(sec)}" style="display:none; margin-bottom:10px;">
                  <textarea data-sec-paste-input="${escapeAttr(sec)}" 
                            placeholder="Paste lines here...&#10;Each line becomes a bullet"
                            style="width:100%; height:80px; border:2px dashed #999; padding:8px; font-size:11px; resize:none;"></textarea>
                  <div style="display:flex; gap:4px; margin-top:4px;">
                    <button type="button" data-sec-paste-apply="${escapeAttr(sec)}"
                            style="flex:1; border:2px solid #000; background:#000; color:#fff; padding:4px 8px; font-size:9px; font-weight:bold; cursor:pointer;">
                      Apply
                    </button>
                    <button type="button" data-sec-paste-cancel="${escapeAttr(sec)}"
                            style="border:2px solid #999; background:#fff; padding:4px 8px; font-size:9px; cursor:pointer;">
                      Cancel
                    </button>
                  </div>
                </div>

                <div data-sec-list="${escapeAttr(sec)}" style="display:flex; flex-direction:column; gap:8px;">
                  ${
                    grouped[sec].length
                      ? grouped[sec].map((row) => sectionRowHtmlCompact(sec, row)).join("")
                      : `<div class="kk-sub" style="opacity:.7; font-size:11px;">No items yet.</div>`
                  }
                </div>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;

  // Wire Add buttons
  mount.querySelectorAll("[data-sec-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = btn.getAttribute("data-sec-add");
      addSectionRow({ sections, sec, mount });
    });
  });

  // Wire Paste buttons - show/hide paste area
  mount.querySelectorAll("[data-sec-paste]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = btn.getAttribute("data-sec-paste");
      const pasteArea = mount.querySelector(`[data-sec-paste-area="${sec}"]`);
      if (pasteArea) {
        pasteArea.style.display = pasteArea.style.display === "none" ? "block" : "none";
        // Focus the textarea
        const textarea = pasteArea.querySelector("textarea");
        if (textarea && pasteArea.style.display === "block") textarea.focus();
      }
    });
  });

  // Wire Paste Apply buttons
  mount.querySelectorAll("[data-sec-paste-apply]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = btn.getAttribute("data-sec-paste-apply");
      const textarea = mount.querySelector(`[data-sec-paste-input="${sec}"]`);
      const pasteArea = mount.querySelector(`[data-sec-paste-area="${sec}"]`);
      
      if (textarea && textarea.value.trim()) {
        // Parse the pasted text - handle various formats
        const rawText = textarea.value;
        
        // Split by newlines, then clean up each line
        const lines = rawText
          .split(/[\n\r]+/)
          .map(line => {
            // Remove leading quotes, commas, array brackets, bullet points
            return line
              .replace(/^[\s\[\]"'•\-\*,]+/, '')  // Remove leading chars
              .replace(/["\],]+$/, '')            // Remove trailing chars
              .trim();
          })
          .filter(line => line.length > 0);
        
        // Add each line as a section row
        lines.forEach((content, idx) => {
          addSectionRowWithContent({ sections, sec, mount, content, position: idx });
        });
        
        // Clear and hide paste area
        textarea.value = "";
        if (pasteArea) pasteArea.style.display = "none";
      }
    });
  });

  // Wire Paste Cancel buttons
  mount.querySelectorAll("[data-sec-paste-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = btn.getAttribute("data-sec-paste-cancel");
      const pasteArea = mount.querySelector(`[data-sec-paste-area="${sec}"]`);
      const textarea = mount.querySelector(`[data-sec-paste-input="${sec}"]`);
      if (textarea) textarea.value = "";
      if (pasteArea) pasteArea.style.display = "none";
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

/**
 * Adds a section row with pre-filled content
 */
function addSectionRowWithContent({ sections, sec, mount, content, position = 0 }) {
  if (!sections.includes(sec)) return;
  const list = mount.querySelector(`[data-sec-list="${sec}"]`);
  if (!list) return;

  // clear placeholder
  if (list.textContent.trim() === "No items yet.") list.innerHTML = "";

  const count = list.querySelectorAll("[data-sec-row]").length;
  list.insertAdjacentHTML("beforeend", sectionRowHtmlCompact(sec, { content, position: count }));
}

function addSectionRow({ sections, sec, mount }) {
  if (!sections.includes(sec)) return;
  const list = mount.querySelector(`[data-sec-list="${sec}"]`);
  if (!list) return;

  // clear placeholder
  if (list.textContent.trim() === "No items yet.") list.innerHTML = "";

  const count = list.querySelectorAll("[data-sec-row]").length;
  list.insertAdjacentHTML("beforeend", sectionRowHtmlCompact(sec, { content: "", position: count }));

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

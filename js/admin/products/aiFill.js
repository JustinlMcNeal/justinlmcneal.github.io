// js/admin/products/aiFill.js
// AI-powered auto-fill for product sections (description, sizing, care)
// Uses GPT-4o vision to analyze uploaded product images

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config/env.js";
import { getSupabaseClient } from "../../shared/supabaseClient.js";

const EDGE_FN = `${SUPABASE_URL}/functions/v1/ai-product-fill`;

/**
 * Converts a File to a base64 data URI
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Calls the AI product fill edge function
 * @param {Object} opts
 * @param {File[]} opts.files - Image files to analyze
 * @param {string[]} opts.imageUrls - Existing image URLs to analyze
 * @param {string} [opts.productName] - Product name if already entered
 * @param {string} [opts.category] - Category name if already selected
 * @returns {Promise<{name?: string, description: string[], sizing: string[], care: string[], tags?: string[]}>}
 */
export async function callAiFill({ files = [], imageUrls = [], productName, category }) {
  // Convert files to base64
  const base64Images = [];
  for (const file of files) {
    const dataUri = await fileToBase64(file);
    base64Images.push(dataUri);
  }

  // Get auth token
  const sb = getSupabaseClient();
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error("You must be logged in to use AI auto-fill");
  }

  const response = await fetch(EDGE_FN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      images: base64Images,
      imageUrls: imageUrls.filter(Boolean),
      productName: productName || undefined,
      category: category || undefined,
      sections: ["description", "sizing", "care", "tags", "name"],
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `AI request failed (${response.status})`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "AI generation failed");
  }

  return result.data;
}

/**
 * Applies AI-generated data to the section editors in the modal.
 * Populates description, sizing, and care bullet points.
 */
export function applyAiDataToSections(data) {
  const mount = document.getElementById("sectionItemsEditor");
  if (!mount) return;

  const sectionMap = {
    description: data.description || [],
    sizing: data.sizing || [],
    care: data.care || [],
  };

  for (const [sec, bullets] of Object.entries(sectionMap)) {
    if (!bullets.length) continue;

    const list = mount.querySelector(`[data-sec-list="${sec}"]`);
    if (!list) continue;

    // Clear existing items
    list.innerHTML = "";

    // Add each bullet as a section row
    bullets.forEach((content, idx) => {
      const html = `
        <div data-sec-row="${sec}" style="display:flex; gap:6px; align-items:center;">
          <input type="number" min="0" value="${idx}" data-sec="${sec}" data-k="position"
                 style="width:36px; border:2px solid #000; padding:4px 6px; font-size:11px; text-align:center; outline:none;" />
          <input placeholder="Bullet text…" value="${escapeAttr(content)}" data-sec="${sec}" data-k="content"
                 style="flex:1; border:2px solid #000; padding:4px 8px; font-size:11px; outline:none;" />
          <button type="button" data-sec-del="1"
                  style="border:none; background:none; color:#b91c1c; font-size:16px; cursor:pointer; padding:0 4px;"
                  title="Remove">×</button>
        </div>
      `;
      list.insertAdjacentHTML("beforeend", html);
    });
  }
}

/**
 * Applies AI-generated tags to the tags input field
 */
export function applyAiTags(tagsInput, tags) {
  if (!tagsInput || !tags?.length) return;

  const existing = tagsInput.value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // Merge without duplicates
  const merged = [...new Set([...existing, ...tags.map((t) => t.toLowerCase())])];
  tagsInput.value = merged.join(", ");
}

/**
 * Escapes HTML attribute values
 */
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Creates + binds the AI Auto-Fill UI panel.
 * Returns the panel element to be inserted into the modal.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.nameInput - #fName
 * @param {HTMLElement} opts.categorySelect - #fCategory
 * @param {HTMLElement} opts.tagsInput - #fTags
 * @param {HTMLElement} opts.primaryImgInput - #fPrimaryImg
 * @param {HTMLElement} opts.catalogImgInput - #fCatalogImg
 * @param {HTMLElement} opts.modalMsg - #modalMsg
 * @returns {HTMLElement}
 */
export function createAiFillPanel({
  nameInput,
  categorySelect,
  tagsInput,
  primaryImgInput,
  catalogImgInput,
  modalMsg,
}) {
  const panel = document.createElement("section");
  panel.id = "aiFillPanel";
  panel.className = "space-y-3";
  panel.innerHTML = `
    <div class="border-t-4 border-gray-100"></div>
    <div>
      <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2">
        <span class="w-5 h-5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] flex items-center justify-center rounded-sm">✦</span>
        AI Auto-Fill
      </div>
      <div class="text-sm text-gray-500 mt-1">
        Upload product images and let AI generate description, sizing &amp; care instructions.
      </div>
    </div>

    <!-- Upload area -->
    <div id="aiFillDropZone"
         class="border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center
                hover:border-purple-400 hover:bg-purple-50/30 transition-colors cursor-pointer">
      <input type="file" id="aiFillFileInput" accept="image/*" multiple class="hidden" />
      
      <div id="aiFillPlaceholder">
        <div class="text-3xl mb-2">🤖</div>
        <div class="text-sm font-bold text-gray-600">
          Drop images here or click to upload
        </div>
        <div class="text-xs text-gray-400 mt-1">
          AI will analyze photos to auto-fill product details
        </div>
      </div>

      <!-- Preview of selected images -->
      <div id="aiFillPreviews" class="hidden flex flex-wrap gap-2 justify-center mt-3"></div>
    </div>

    <!-- Options row -->
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-1.5 text-xs cursor-pointer">
        <input type="checkbox" id="aiFillUseExisting" class="accent-purple-500 w-4 h-4" />
        <span class="text-gray-600">Also use images already in the form</span>
      </label>
    </div>

    <!-- Action button -->
    <button
      id="btnAiFill"
      type="button"
      class="w-full border-4 border-purple-500 bg-purple-500 text-white px-4 py-3 font-black uppercase tracking-[.12em] text-xs
             hover:bg-purple-600 hover:border-purple-600 transition-colors
             disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      <span id="aiFillBtnIcon">✦</span>
      <span id="aiFillBtnText">Generate with AI</span>
    </button>

    <!-- Status message -->
    <div id="aiFillStatus" class="hidden text-xs text-center py-2 rounded font-bold"></div>
  `;

  // Wire up file input + drop zone
  const dropZone = panel.querySelector("#aiFillDropZone");
  const fileInput = panel.querySelector("#aiFillFileInput");
  const previews = panel.querySelector("#aiFillPreviews");
  const placeholder = panel.querySelector("#aiFillPlaceholder");
  const btn = panel.querySelector("#btnAiFill");
  const btnText = panel.querySelector("#aiFillBtnText");
  const btnIcon = panel.querySelector("#aiFillBtnIcon");
  const status = panel.querySelector("#aiFillStatus");
  const useExistingChk = panel.querySelector("#aiFillUseExisting");

  let selectedFiles = [];

  function updatePreviews() {
    if (selectedFiles.length === 0) {
      previews.classList.add("hidden");
      placeholder.classList.remove("hidden");
      return;
    }

    placeholder.classList.add("hidden");
    previews.classList.remove("hidden");
    previews.innerHTML = "";

    selectedFiles.forEach((file, idx) => {
      const thumb = document.createElement("div");
      thumb.className = "relative";
      thumb.style.cssText =
        "width:64px; height:64px; border:2px solid #000; overflow:hidden;";

      const url = URL.createObjectURL(file);
      thumb.innerHTML = `
        <img src="${url}" style="width:100%; height:100%; object-fit:cover;" />
        <button type="button" data-remove="${idx}"
                style="position:absolute; top:1px; right:1px; width:16px; height:16px;
                       background:#000; color:#fff; border:none; font-size:10px;
                       cursor:pointer; display:flex; align-items:center; justify-content:center;">×</button>
      `;

      thumb.querySelector("[data-remove]").addEventListener("click", (e) => {
        e.stopPropagation();
        selectedFiles.splice(idx, 1);
        updatePreviews();
      });

      previews.appendChild(thumb);
    });
  }

  // Click to open file picker
  dropZone.addEventListener("click", (e) => {
    if (e.target.closest("button")) return; // don't trigger on remove buttons
    fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    selectedFiles.push(...files);
    updatePreviews();
    fileInput.value = "";
  });

  // Drag & drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-purple-500", "bg-purple-50");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-purple-500", "bg-purple-50");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-purple-500", "bg-purple-50");
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    );
    selectedFiles.push(...files);
    updatePreviews();
  });

  // Generate button
  btn.addEventListener("click", async () => {
    // Gather image URLs from the form if checkbox is checked
    const existingUrls = [];
    if (useExistingChk.checked) {
      if (primaryImgInput?.value) existingUrls.push(primaryImgInput.value);
      if (catalogImgInput?.value) existingUrls.push(catalogImgInput.value);
    }

    if (selectedFiles.length === 0 && existingUrls.length === 0) {
      showStatus("Please upload at least one image or check 'use existing images'", "error");
      return;
    }

    // Get product context
    const productName = nameInput?.value?.trim() || undefined;
    const category =
      categorySelect?.selectedOptions?.[0]?.textContent?.trim() || undefined;

    // Set loading state
    btn.disabled = true;
    btnIcon.innerHTML = `<svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`;
    btnText.textContent = "Analyzing images…";
    showStatus("AI is analyzing your product images. This may take 10-20 seconds…", "info");

    try {
      const data = await callAiFill({
        files: selectedFiles,
        imageUrls: existingUrls,
        productName,
        category,
      });

      // Apply results to sections
      applyAiDataToSections(data);

      // Apply suggested name if the field is empty
      if (data.name && nameInput && !nameInput.value.trim()) {
        nameInput.value = data.name;
        // Trigger slug generation
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      }

      // Apply tags
      if (data.tags?.length) {
        applyAiTags(tagsInput, data.tags);
      }

      showStatus(
        `AI generated ${data.description?.length || 0} description, ${data.sizing?.length || 0} sizing, and ${data.care?.length || 0} care bullet points!`,
        "success"
      );
    } catch (err) {
      console.error("[AI Fill] Error:", err);
      showStatus(err.message || "AI generation failed. Please try again.", "error");
    } finally {
      btn.disabled = false;
      btnIcon.textContent = "✦";
      btnText.textContent = "Generate with AI";
    }
  });

  function showStatus(msg, type = "info") {
    status.classList.remove("hidden");
    status.textContent = msg;
    status.className =
      "text-xs text-center py-2 rounded font-bold " +
      (type === "error"
        ? "bg-red-50 text-red-600 border border-red-200"
        : type === "success"
          ? "bg-green-50 text-green-600 border border-green-200"
          : "bg-purple-50 text-purple-600 border border-purple-200");

    if (type === "success") {
      setTimeout(() => status.classList.add("hidden"), 8000);
    }
  }

  return panel;
}

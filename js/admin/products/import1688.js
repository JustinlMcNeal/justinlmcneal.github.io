// js/admin/products/import1688.js
// 1688 Product Importer — collects product title + image URLs from the user,
// sends to GPT-4o for translation, returns structured product data.
//
// WHY client-side input: 1688.com blocks server-side scraping, so the user
// copies the title and image URLs from their browser (which CAN access 1688).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config/env.js";

/**
 * Creates and returns the 1688 import modal DOM + wiring.
 *
 * @param {Object} opts
 * @param {Function} opts.openNewProduct  - opens an empty product-editor modal
 * @param {Function} opts.applyJson       - applyJsonToForm(els, data)
 * @param {Object}   opts.formEls         - product-form element refs
 */
export function create1688Importer({ openNewProduct, applyJson, formEls }) {
  /* ---- Build modal HTML ---- */
  const overlay = document.createElement("div");
  overlay.id = "import1688Modal";
  overlay.className =
    "fixed inset-0 z-[300] hidden items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4";

  overlay.innerHTML = /* html */ `
    <div class="bg-white border-4 border-black w-full max-w-2xl max-h-[90vh] flex flex-col shadow-[8px_8px_0_0_rgba(0,0,0,0.1)]">
      <!-- Header -->
      <div class="border-b-4 border-black p-4 flex justify-between items-center shrink-0">
        <div>
          <div class="inline-block bg-kkpink text-black px-2 py-0.5 text-[8px] font-black uppercase tracking-[.2em] mb-1">
            1688 Importer
          </div>
          <h3 class="text-xl font-black uppercase tracking-[.12em]">Import from 1688.com</h3>
        </div>
        <button id="i1688Close" class="border-4 border-black w-10 h-10 flex items-center justify-center font-black text-lg hover:bg-black hover:text-white transition-colors">&times;</button>
      </div>

      <!-- Body -->
      <div class="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5" id="i1688Body">
        <!-- Instructions -->
        <div class="bg-gray-50 border-2 border-gray-200 p-4 text-sm space-y-2">
          <div class="font-black uppercase tracking-wider text-[11px] text-gray-600">How it works</div>
          <ol class="list-decimal list-inside space-y-1 text-gray-600 text-xs">
            <li>Open the product on <strong>1688.com</strong> in another tab</li>
            <li>Copy the <strong>Chinese title</strong> and paste it below</li>
            <li>Right-click product images → <strong>"Copy image address"</strong> and paste URLs below</li>
            <li>Optionally enter the <strong>price in ¥</strong></li>
            <li>Hit <strong>Generate</strong> — AI creates your English listing!</li>
          </ol>
        </div>

        <!-- Product Title -->
        <div>
          <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-2 text-black/70">
            Chinese Product Title
          </label>
          <input id="i1688Title" type="text"
            class="w-full border-4 border-black px-4 py-3 text-sm outline-none focus:border-kkpink transition-colors"
            placeholder="Paste the Chinese product title here…" />
        </div>

        <!-- Image URLs -->
        <div>
          <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-2 text-black/70">
            Image URLs <span class="text-gray-400 font-normal">(one per line, paste up to 10)</span>
          </label>
          <textarea id="i1688Images" rows="4"
            class="w-full border-4 border-black px-4 py-3 text-sm outline-none resize-none focus:border-kkpink transition-colors font-mono"
            placeholder="https://cbu01.alicdn.com/img/...&#10;https://cbu01.alicdn.com/img/...&#10;(right-click images → Copy image address)"></textarea>
          <div id="i1688ImgPreview" class="flex gap-2 mt-2 overflow-x-auto"></div>
        </div>

        <!-- Price + Markup Row -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-2 text-black/70">
              Price in ¥ <span class="text-gray-400 font-normal">(optional)</span>
            </label>
            <input id="i1688PriceCny" type="number" step="0.01"
              class="w-full border-4 border-black px-4 py-3 text-sm outline-none focus:border-kkpink transition-colors"
              placeholder="e.g. 15.80" />
          </div>
          <div>
            <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-2 text-black/70">
              Markup: <span id="i1688MarkupLabel" class="text-kkpink">3.5×</span>
            </label>
            <input id="i1688Markup" type="range" min="200" max="800" value="350" step="50"
              class="w-full accent-[#ff69b4] mt-2" />
            <div class="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>2×</span><span>4×</span><span>6×</span><span>8×</span>
            </div>
          </div>
        </div>

        <!-- 1688 URL (optional, saved as supplier_url) -->
        <div>
          <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-2 text-black/70">
            1688 Link <span class="text-gray-400 font-normal">(optional — saved as supplier URL)</span>
          </label>
          <input id="i1688Url" type="text"
            class="w-full border-4 border-black px-4 py-3 text-sm outline-none focus:border-kkpink transition-colors"
            placeholder="https://detail.1688.com/offer/..." />
        </div>

        <!-- Generate Button -->
        <button id="i1688Generate" type="button"
          class="w-full border-4 border-black bg-black text-white px-6 py-4 font-black uppercase tracking-[.15em] text-sm
                 hover:bg-kkpink hover:border-kkpink hover:text-black transition-colors">
          ✨ Generate English Listing
        </button>

        <!-- Loading State -->
        <div id="i1688Loading" class="hidden text-center py-10">
          <div class="inline-block animate-spin w-10 h-10 border-4 border-black border-t-kkpink rounded-full"></div>
          <p class="mt-4 text-sm font-bold uppercase tracking-wider">AI is analyzing &amp; translating…</p>
          <p class="text-xs text-gray-400 mt-1">This usually takes 5-10 seconds</p>
        </div>

        <!-- Error State -->
        <div id="i1688Error" class="hidden border-4 border-red-500 bg-red-50 p-4">
          <div class="text-[11px] font-black uppercase tracking-[.25em] text-red-600">Error</div>
          <div class="text-sm text-red-700 mt-2" id="i1688ErrorMsg"></div>
        </div>

        <!-- Preview (hidden until results arrive) -->
        <div id="i1688Preview" class="hidden space-y-5">
          <div class="border-4 border-green-500 bg-green-50 p-3 text-center">
            <span class="text-[11px] font-black uppercase tracking-[.2em] text-green-700">✓ Listing Generated — review &amp; edit below</span>
          </div>

          <!-- Product Name -->
          <div>
            <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Product Name</label>
            <input id="i1688Name" class="w-full border-4 border-black px-3 py-2 text-sm font-bold outline-none focus:border-kkpink" />
          </div>

          <!-- Category + Price Row -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Category</label>
              <input id="i1688Category" class="w-full border-4 border-black px-3 py-2 text-sm outline-none focus:border-kkpink" />
            </div>
            <div>
              <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Price (USD)</label>
              <input id="i1688Price" type="number" step="0.01"
                class="w-full border-4 border-black px-3 py-2 text-sm outline-none focus:border-kkpink" />
            </div>
          </div>

          <!-- Tags -->
          <div>
            <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Tags</label>
            <input id="i1688Tags" class="w-full border-4 border-black px-3 py-2 text-sm outline-none focus:border-kkpink"
              placeholder="tag1, tag2, tag3" />
          </div>

          <!-- Description -->
          <div>
            <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Description</label>
            <textarea id="i1688Desc" rows="3"
              class="w-full border-4 border-black px-3 py-2 text-sm outline-none resize-none focus:border-kkpink"></textarea>
          </div>

          <!-- Colors -->
          <div>
            <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Colors / Variants</label>
            <input id="i1688Colors" class="w-full border-4 border-black px-3 py-2 text-sm outline-none focus:border-kkpink"
              placeholder="Pink, Blue, White" />
          </div>

          <!-- Images Preview -->
          <div>
            <label class="block text-[11px] font-black uppercase tracking-[.12em] mb-2 text-black/70">
              Images <span id="i1688ResultImgCount" class="text-gray-400 font-normal">(0)</span>
            </label>
            <div id="i1688ResultImages" class="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-48 overflow-y-auto"></div>
          </div>
        </div>
      </div>

      <!-- Footer (shown when preview is visible) -->
      <div id="i1688Footer" class="hidden border-t-4 border-black p-4 flex justify-end gap-3 shrink-0 bg-gray-50">
        <button id="i1688Cancel" type="button"
          class="border-2 border-gray-400 px-6 py-2 font-bold uppercase text-xs hover:bg-gray-100 transition-colors">
          Cancel
        </button>
        <button id="i1688Apply" type="button"
          class="border-4 border-black bg-black text-white px-6 py-2 font-bold uppercase text-xs
                 hover:bg-kkpink hover:border-kkpink hover:text-black transition-colors">
          → Open in Product Editor
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  /* ---- Wire up elements ---- */
  const q = (id) => overlay.querySelector(`#${id}`);

  const titleInput    = q("i1688Title");
  const imagesInput   = q("i1688Images");
  const imgPreview    = q("i1688ImgPreview");
  const priceCnyInput = q("i1688PriceCny");
  const urlInput      = q("i1688Url");
  const markupSlider  = q("i1688Markup");
  const markupLabel   = q("i1688MarkupLabel");
  const generateBtn   = q("i1688Generate");
  const loading       = q("i1688Loading");
  const errorBox      = q("i1688Error");
  const errorMsg      = q("i1688ErrorMsg");
  const preview       = q("i1688Preview");
  const footer        = q("i1688Footer");

  // Preview fields
  const pName     = q("i1688Name");
  const pCategory = q("i1688Category");
  const pPrice    = q("i1688Price");
  const pTags     = q("i1688Tags");
  const pDesc     = q("i1688Desc");
  const pColors   = q("i1688Colors");
  const pResultImages  = q("i1688ResultImages");
  const pResultImgCount = q("i1688ResultImgCount");

  // Stash the latest result for the "Apply" step
  let latestResult = null;
  let inputImages = [];   // parsed from textarea

  /* ---- Helpers ---- */
  function parseImageUrls() {
    const raw = imagesInput.value.trim();
    if (!raw) return [];
    return raw
      .split(/[\n\r,]+/)
      .map(s => s.trim())
      .filter(s => s.startsWith("http"));
  }

  /* ---- Markup slider ---- */
  markupSlider.addEventListener("input", () => {
    markupLabel.textContent = `${(markupSlider.value / 100).toFixed(1)}×`;
  });

  /* ---- Live image preview ---- */
  imagesInput.addEventListener("input", () => {
    const urls = parseImageUrls();
    imgPreview.innerHTML = urls.slice(0, 8).map(url =>
      `<img src="${url}" class="w-14 h-14 object-cover border-2 border-black shrink-0"
            onerror="this.style.display='none'" />`
    ).join("");
  });

  /* ---- Open / Close ---- */
  function open() {
    titleInput.value = "";
    imagesInput.value = "";
    priceCnyInput.value = "";
    urlInput.value = "";
    imgPreview.innerHTML = "";
    resetStates();
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    titleInput.focus();
  }

  function close() {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  }

  function resetStates() {
    loading.classList.add("hidden");
    errorBox.classList.add("hidden");
    preview.classList.add("hidden");
    footer.classList.add("hidden");
    generateBtn.classList.remove("hidden");
    latestResult = null;
  }

  q("i1688Close")?.addEventListener("click", close);
  q("i1688Cancel")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });

  /* ---- Generate handler ---- */
  async function doGenerate() {
    const title = titleInput.value.trim();
    inputImages = parseImageUrls();

    if (!title && inputImages.length === 0) {
      showError("Please provide at least a product title or some image URLs.");
      return;
    }

    resetStates();
    loading.classList.remove("hidden");
    generateBtn.classList.add("hidden");

    // 60-second client-side timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/import-from-1688`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          images: inputImages,
          price_cny: priceCnyInput.value ? Number(priceCnyInput.value) : null,
          url: urlInput.value.trim(),
          markup_percent: Number(markupSlider.value),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await resp.json();

      if (!resp.ok || !data.success) {
        throw new Error(data.error || `Server error (${resp.status})`);
      }

      latestResult = data;
      latestResult._inputImages = inputImages; // keep for gallery
      renderPreview(data);
    } catch (err) {
      if (err.name === "AbortError") {
        showError("Request timed out after 60 seconds. Try with fewer images or a shorter title.");
      } else {
        showError(err.message || "Failed to generate listing.");
      }
    } finally {
      clearTimeout(timeout);
      loading.classList.add("hidden");
      generateBtn.classList.remove("hidden");
    }
  }

  generateBtn.addEventListener("click", doGenerate);

  /* ---- Error helper ---- */
  function showError(msg) {
    errorMsg.textContent = msg;
    errorBox.classList.remove("hidden");
  }

  /* ---- Render preview ---- */
  function renderPreview(data) {
    const p = data.product;

    pName.value = p.name || "";
    pCategory.value = p.category_name || "";
    pPrice.value = p.price || "";
    pTags.value = (p.tags || []).join(", ");
    pDesc.value = (p.description || []).map(b => `• ${b}`).join("\n");
    pColors.value = (p.colors || []).join(", ");

    // Render image thumbnails
    const imgs = p.images || inputImages;
    pResultImgCount.textContent = `(${imgs.length})`;
    pResultImages.innerHTML = imgs
      .slice(0, 20)
      .map((url, i) => `
        <div class="relative group">
          <img src="${url}" loading="lazy"
               class="w-full aspect-square object-cover border-2 border-black"
               onerror="this.parentElement.style.display='none'" />
          <span class="absolute bottom-0 right-0 bg-black text-white text-[9px] px-1">${i + 1}</span>
        </div>
      `)
      .join("");

    preview.classList.remove("hidden");
    footer.classList.remove("hidden");
    generateBtn.classList.add("hidden");
  }

  /* ---- Apply to product editor ---- */
  q("i1688Apply")?.addEventListener("click", () => {
    if (!latestResult) return;

    const p = latestResult.product;
    const imgs = p.images || latestResult._inputImages || [];

    // Read possibly-edited values from the preview form
    const editedName   = pName.value.trim() || p.name;
    const editedPrice  = parseFloat(pPrice.value) || p.price;
    const editedTags   = pTags.value.split(",").map(t => t.trim()).filter(Boolean);
    const editedDesc   = pDesc.value.split("\n").map(l => l.replace(/^[•\-]\s*/, "").trim()).filter(Boolean);
    const editedColors = pColors.value.split(",").map(c => c.trim()).filter(Boolean);

    // Build the JSON object that applyJsonToForm expects
    const formData = {
      name: editedName,
      slug: editedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      category: pCategory.value.trim(),
      price: editedPrice,
      weight_g: p.weight_g || null,
      supplier_url: p.supplier_url || urlInput.value.trim() || "",
      tags: editedTags,
      descriptionList: editedDesc,
      sizingList: p.sizing || [],
      careList: p.care || [],

      // Variants from colors
      custom1Options: editedColors.join(" | "),
      variantStock: Object.fromEntries(editedColors.map(c => [c, 0])),
      variantImages: {},

      // Images: first → catalog, second → hover, third → primary
      catalogImage: imgs[0] || "",
      catalogImageHover: imgs[1] || "",
      image: imgs[2] || imgs[0] || "",

      // Rest of images → gallery thumbnails
      thumbnails: imgs.slice(1),
    };

    // Close 1688 modal
    close();

    // Open a new product editor and fill it
    openNewProduct();

    // Small delay so modal DOM renders before we fill it
    requestAnimationFrame(() => {
      applyJson(formEls, formData);
    });
  });

  return { open, close };
}

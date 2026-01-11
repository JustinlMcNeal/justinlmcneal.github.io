// /js/admin/homeCats/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

const supabase = getSupabaseClient();

// Storage bucket name - uses existing "looks" bucket with categories/ prefix
const BUCKET = "looks";
const BUCKET_PREFIX = "categories/";

// State
let categories = [];
let orderChanged = false;
let editingCatId = null;

// DOM
const grid = document.getElementById("categoriesGrid");
const btnSaveOrder = document.getElementById("btnSaveOrder");
const statsTotal = document.getElementById("statsTotal");
const statsVisible = document.getElementById("statsVisible");
const statsHidden = document.getElementById("statsHidden");

// Modal elements
const imageModal = document.getElementById("imageModal");
const modalCatName = document.getElementById("modalCatName");
const modalCurrentImage = document.getElementById("modalCurrentImage");
const modalPreviewImg = document.getElementById("modalPreviewImg");
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const uploadProgress = document.getElementById("uploadProgress");
const progressBar = document.getElementById("progressBar");

// ========== INIT ==========
async function init() {
  await initAdminNav("Home Categories");
  initFooter();
  document.body.classList.remove("hidden");
  
  await loadCategories();
  setupEventListeners();
}

// ========== LOAD DATA ==========
async function loadCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("home_sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("Failed to load categories:", error);
    grid.innerHTML = `<div class="text-red-500 col-span-full p-4">Error loading categories: ${error.message}</div>`;
    return;
  }

  categories = data || [];
  renderGrid();
  updateStats();
}

// ========== RENDER ==========
function renderGrid() {
  if (!categories.length) {
    grid.innerHTML = `<div class="text-gray-400 col-span-full p-8 text-center">No categories found.</div>`;
    return;
  }

  grid.innerHTML = categories.map((cat, index) => {
    const imageUrl = resolveImageUrl(cat.home_image_path);
    const isVisible = cat.show_on_home !== false; // Default to true if null
    
    return `
      <div class="cat-card bg-white border-2 ${isVisible ? 'border-black' : 'border-gray-300'} overflow-hidden relative group"
           data-id="${cat.id}" 
           data-index="${index}"
           draggable="true">
        
        <!-- Drag Handle -->
        <div class="absolute top-2 left-2 z-20 bg-white/90 rounded px-2 py-1 text-xs font-bold text-gray-500 cursor-grab shadow">
          ⋮⋮ ${index + 1}
        </div>
        
        <!-- Visibility Toggle -->
        <button class="toggle-visibility absolute top-2 right-2 z-20 w-8 h-8 rounded-full flex items-center justify-center shadow transition-colors ${isVisible ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'}"
                data-id="${cat.id}" title="${isVisible ? 'Visible on home' : 'Hidden from home'}">
          ${isVisible ? '👁️' : '🚫'}
        </button>
        
        <!-- Image Area -->
        <div class="aspect-[10/14] bg-gray-100 relative overflow-hidden">
          ${imageUrl 
            ? `<img src="${imageUrl}" class="w-full h-full object-cover" alt="${cat.name}" />`
            : `<div class="w-full h-full flex items-center justify-center text-gray-300 text-6xl">📷</div>`
          }
          
          <!-- Overlay for hidden categories -->
          ${!isVisible ? `<div class="absolute inset-0 bg-white/60"></div>` : ''}
          
          <!-- Upload overlay -->
          <div class="upload-overlay absolute inset-0 bg-black/50 flex items-center justify-center">
            <button class="change-image bg-white text-black px-4 py-2 font-bold uppercase text-xs hover:bg-kkpink transition-colors"
                    data-id="${cat.id}">
              Change Image
            </button>
          </div>
        </div>
        
        <!-- Info -->
        <div class="p-4 ${!isVisible ? 'opacity-50' : ''}">
          <div class="font-bold text-lg">${cat.name}</div>
          <div class="text-xs text-gray-500 mt-1">
            <span class="font-mono bg-gray-100 px-1">${cat.slug || '—'}</span>
            ${cat.product_count ? `• ${cat.product_count} products` : ''}
          </div>
        </div>
      </div>
    `;
  }).join("");
  
  setupDragAndDrop();
}

function updateStats() {
  const visible = categories.filter(c => c.show_on_home !== false).length;
  const hidden = categories.length - visible;
  
  statsTotal.textContent = `Total: ${categories.length}`;
  statsVisible.textContent = `Visible: ${visible}`;
  statsHidden.textContent = `Hidden: ${hidden}`;
}

// ========== IMAGE HELPERS ==========
function resolveImageUrl(pathOrUrl) {
  const v = (pathOrUrl || "").trim();
  if (!v) return "";
  
  // Already a full URL
  if (/^https?:\/\//i.test(v)) return v;
  
  // Absolute path on site
  if (v.startsWith("/")) return v;
  
  // Supabase storage path
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(v);
  return data?.publicUrl || "";
}

// ========== DRAG & DROP ==========
function setupDragAndDrop() {
  const cards = grid.querySelectorAll(".cat-card");
  
  cards.forEach(card => {
    card.addEventListener("dragstart", handleDragStart);
    card.addEventListener("dragend", handleDragEnd);
    card.addEventListener("dragover", handleDragOver);
    card.addEventListener("dragenter", handleDragEnter);
    card.addEventListener("dragleave", handleDragLeave);
    card.addEventListener("drop", handleDrop);
  });
}

let draggedItem = null;
let draggedIndex = -1;

function handleDragStart(e) {
  draggedItem = this;
  draggedIndex = parseInt(this.dataset.index);
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function handleDragEnd() {
  this.classList.remove("dragging");
  grid.querySelectorAll(".cat-card").forEach(card => card.classList.remove("drag-over"));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleDragEnter(e) {
  e.preventDefault();
  if (this !== draggedItem) {
    this.classList.add("drag-over");
  }
}

function handleDragLeave() {
  this.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  this.classList.remove("drag-over");
  
  if (this === draggedItem) return;
  
  const dropIndex = parseInt(this.dataset.index);
  
  // Reorder array
  const [removed] = categories.splice(draggedIndex, 1);
  categories.splice(dropIndex, 0, removed);
  
  orderChanged = true;
  btnSaveOrder.disabled = false;
  
  renderGrid();
}

// ========== VISIBILITY TOGGLE ==========
async function toggleVisibility(catId) {
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;
  
  const newValue = cat.show_on_home === false ? true : false;
  
  // Optimistic update
  cat.show_on_home = newValue;
  renderGrid();
  updateStats();
  
  // Save to DB
  const { error } = await supabase
    .from("categories")
    .update({ show_on_home: newValue })
    .eq("id", catId);
  
  if (error) {
    console.error("Failed to update visibility:", error);
    // Revert
    cat.show_on_home = !newValue;
    renderGrid();
    updateStats();
  }
}

// ========== SAVE ORDER ==========
async function saveOrder() {
  btnSaveOrder.disabled = true;
  btnSaveOrder.textContent = "Saving...";
  
  // Build updates with new order values
  const updates = categories.map((cat, i) => ({
    id: cat.id,
    home_sort_order: (i + 1) * 10 // 10, 20, 30...
  }));
  
  // Batch update
  for (const u of updates) {
    const { error } = await supabase
      .from("categories")
      .update({ home_sort_order: u.home_sort_order })
      .eq("id", u.id);
    
    if (error) {
      console.error("Failed to update order:", error);
      alert("Failed to save order. Please try again.");
      btnSaveOrder.disabled = false;
      btnSaveOrder.textContent = "Save Order";
      return;
    }
  }
  
  orderChanged = false;
  btnSaveOrder.textContent = "Saved ✓";
  
  setTimeout(() => {
    btnSaveOrder.textContent = "Save Order";
  }, 2000);
}

// ========== IMAGE UPLOAD ==========
function openImageModal(catId) {
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;
  
  editingCatId = catId;
  modalCatName.textContent = cat.name;
  
  const imageUrl = resolveImageUrl(cat.home_image_path);
  if (imageUrl) {
    modalCurrentImage.classList.remove("hidden");
    modalPreviewImg.src = imageUrl;
  } else {
    modalCurrentImage.classList.add("hidden");
  }
  
  uploadProgress.classList.add("hidden");
  progressBar.style.width = "0%";
  fileInput.value = "";
  
  imageModal.showModal();
}

async function uploadImage(file) {
  if (!file || !editingCatId) return;
  
  uploadProgress.classList.remove("hidden");
  progressBar.style.width = "10%";
  
  const cat = categories.find(c => c.id === editingCatId);
  if (!cat) return;
  
  // Generate filename with prefix
  const ext = file.name.split(".").pop().toLowerCase();
  const filename = `${BUCKET_PREFIX}${cat.slug || cat.id}.${ext}`;
  
  progressBar.style.width = "30%";
  
  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, file, { upsert: true });
  
  if (error) {
    console.error("Upload failed:", error);
    alert("Failed to upload image: " + error.message);
    uploadProgress.classList.add("hidden");
    return;
  }
  
  progressBar.style.width = "70%";
  
  // Update category with new path
  const { error: updateError } = await supabase
    .from("categories")
    .update({ home_image_path: filename })
    .eq("id", editingCatId);
  
  if (updateError) {
    console.error("Failed to update category:", updateError);
    alert("Image uploaded but failed to update category.");
  }
  
  progressBar.style.width = "100%";
  
  // Refresh
  await loadCategories();
  
  setTimeout(() => {
    imageModal.close();
    uploadProgress.classList.add("hidden");
  }, 500);
}

// ========== EVENT LISTENERS ==========
function setupEventListeners() {
  // Save order button
  btnSaveOrder.addEventListener("click", saveOrder);
  
  // Delegated click handlers
  grid.addEventListener("click", (e) => {
    // Visibility toggle
    const toggleBtn = e.target.closest(".toggle-visibility");
    if (toggleBtn) {
      e.stopPropagation();
      toggleVisibility(toggleBtn.dataset.id);
      return;
    }
    
    // Change image
    const changeBtn = e.target.closest(".change-image");
    if (changeBtn) {
      e.stopPropagation();
      openImageModal(changeBtn.dataset.id);
      return;
    }
  });
  
  // File input
  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.length) {
      uploadImage(e.target.files[0]);
    }
  });
  
  // Drop zone click
  dropZone.addEventListener("click", () => fileInput.click());
  
  // Drop zone drag/drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-black", "bg-gray-50");
  });
  
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-black", "bg-gray-50");
  });
  
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-black", "bg-gray-50");
    if (e.dataTransfer.files?.length) {
      uploadImage(e.dataTransfer.files[0]);
    }
  });
  
  // Warn before leaving with unsaved changes
  window.addEventListener("beforeunload", (e) => {
    if (orderChanged) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

// Start
document.addEventListener("DOMContentLoaded", init);

// /js/admin/looks/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

const supabase = getSupabaseClient();

// State
let items = [];         // [{ id, x, y, product_id, product: {...} }]
let currentLookId = null; 
let currentImageFile = null;

// DOM
const editorPanel = document.getElementById("editorPanel");
const looksList = document.getElementById("looksList");
const imageArea = document.getElementById("imageArea");
const previewImage = document.getElementById("previewImage");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const hotspotLayer = document.getElementById("hotspotLayer");
const taggedItemsList = document.getElementById("taggedItemsList");
const fileInput = document.getElementById("fileInput");

// Init
async function init() {
  await initAdminNav("Shop The Look");
  initFooter();
  document.body.classList.remove("hidden");
  
  // Create bucket if missing (public)
  await supabase.storage.createBucket('looks', { public: true }).catch(() => {});

  loadLooks();
  setupEventListeners();
}

async function loadLooks() {
  looksList.innerHTML = `<div class="p-4 text-center text-gray-400 text-xs uppercase animate-pulse">Loading...</div>`;
  
  const { data, error } = await supabase
    .from("shop_looks")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    looksList.innerHTML = `<div class="text-red-500 p-4 text-xs">Error: ${error.message}</div>`;
    return;
  }

  renderLooksList(data || []);
}

function renderLooksList(looks) {
  if (!looks.length) {
    looksList.innerHTML = `<div class="p-4 text-center text-gray-400 text-xs italic">No looks created yet.</div>`;
    return;
  }

  looksList.innerHTML = looks.map(look => `
    <div class="group relative flex items-center gap-3 p-3 border-2 ${look.id === currentLookId ? 'border-black bg-gray-50' : 'border-transparent hover:bg-gray-50'} cursor-pointer transition-colors"
         onclick="window.dispatchEvent(new CustomEvent('kk:editLook', { detail: '${look.id}' }))">
        <img src="${look.image_url}" class="w-16 h-16 object-cover border border-gray-200 bg-white">
        <div class="flex-1 min-w-0">
           <div class="font-bold text-sm truncate">${look.title || 'Untitled Look'}</div>
           <div class="text-[10px] text-gray-500 uppercase tracking-widest">${new Date(look.created_at).toLocaleDateString()}</div>
        </div>
        <div class="w-2 h-2 rounded-full ${look.is_active ? 'bg-green-500' : 'bg-gray-300'}"></div>
    </div>
  `).join("");
}

// Editor Logic
window.addEventListener("kk:editLook", async (e) => {
  const lookId = e.detail;
  loadEditor(lookId);
});

async function loadEditor(lookId) {
  currentLookId = lookId;
  editorPanel.classList.remove("hidden");
  
  // Fetch Look + Items
  const [lookRes, itemsRes] = await Promise.all([
    supabase.from("shop_looks").select("*").eq("id", lookId).single(),
    supabase.from("shop_look_items").select("*, product:products(id, name, primary_image_url)").eq("look_id", lookId)
  ]);

  if (lookRes.error) return alert("Failed to load look");

  const look = lookRes.data;
  items = itemsRes.data || [];

  // Populate UI
  document.getElementById("editTitle").value = look.title || "";
  document.getElementById("editIsActive").checked = look.is_active || false;
  
  if (look.image_url) {
    previewImage.src = look.image_url;
    previewImage.classList.remove("hidden");
    hotspotLayer.classList.remove("hidden");
    uploadPlaceholder.classList.add("hidden");
  } else {
    previewImage.classList.add("hidden");
    hotspotLayer.classList.add("hidden");
    uploadPlaceholder.classList.remove("hidden");
  }

  renderHotspots();
  renderTaggedList();
}

// DOM globals for Drag/Context
let dragItem = null;
let ctxItem = null;
let isDraggingGlobal = false;

function renderHotspots() {
  hotspotLayer.innerHTML = "";
  items.forEach(item => {
    const el = document.createElement("div");
    el.className = "hotspot-dot";
    el.style.left = `${item.x_position}%`;
    el.style.top = `${item.y_position}%`;
    el.title = item.product?.name || "Product";

    // Color Logic
    el.style.backgroundColor = item.dot_color || "white";
    // Add border for white dots so they are visible
    if (!item.dot_color || item.dot_color === 'white') {
        el.style.border = "1.5px solid #ccc";
    } else {
        el.style.border = "1.5px solid white";
    }
    
    // DRAG + CLICK LOGIC
    let isClick = true;
    
    // Mouse
    el.addEventListener("mousedown", (e) => {
       if (e.button !== 0) return; 
       e.stopPropagation(); 
       isClick = true;
       dragItem = { id: item.id, el, startX: e.clientX, startY: e.clientY };
    });

    // Touch
    el.addEventListener("touchstart", (e) => {
        e.stopPropagation();
        isClick = true;
        dragItem = { id: item.id, el };
    });
    
    // Click Handler (Edit)
    const handleClick = (e) => {
        e.stopPropagation(); 
        if (!isDraggingGlobal) {
            // Edit Mode
            openEditModal(item.id);
        }
    };

    el.addEventListener("click", handleClick);
    // touchend usually triggers click, but we might suppress it if dragged
    // The global touchend/mouseup handlers manage isDraggingGlobal

    hotspotLayer.appendChild(el);
  });
}

function openEditModal(itemId) {
   ctxItem = itemId;
   pendingCoords = null;
   
   document.getElementById("btnModalDelete").classList.remove("hidden"); // Show Delete
   
   modalSearch.value = "";
   modalResults.innerHTML = "";
   modal.showModal();
   searchProducts("");
}

function showContextMenu(x, y, itemId) {
    // Deprecated for Mobile Friendliness - using Modal instead
    // But kept for legacy/desktop right click if needed
   ctxItem = itemId;
   const menu = document.getElementById("ctxMenu");
   if(!menu) return;
   menu.style.left = `${x}px`;
   menu.style.top = `${y}px`;
   menu.classList.remove("hidden");
   
   // Dismiss on click elsewhere
   const dismiss = () => {
      menu.classList.add("hidden");
      document.removeEventListener("click", dismiss);
   };
   
   // Small timeout so the immediate click doesn't hide it
   setTimeout(() => document.addEventListener("click", dismiss), 50);
}

// Global Mouse Move for Dragging
document.addEventListener("mousemove", (e) => {
   if (!dragItem) return;
   
   isDraggingGlobal = true; 

   const rect = hotspotLayer.getBoundingClientRect();
   
   // Calculate percentage position
   // Clamp to 0-100
   let percentX = ((e.clientX - rect.left) / rect.width) * 100;
   let percentY = ((e.clientY - rect.top) / rect.height) * 100;
   
   percentX = Math.max(0, Math.min(100, percentX));
   percentY = Math.max(0, Math.min(100, percentY));

   // Visual update
   dragItem.el.style.left = `${percentX}%`;
   dragItem.el.style.top = `${percentY}%`;
   
   // Store logic update
   const item = items.find(i => i.id === dragItem.id);
   if (item) {
       item.x_position = percentX;
       item.y_position = percentY;
   }
});

document.addEventListener("mouseup", async (e) => {
   if (!dragItem) return;
   
   // Commit change to DB
   const item = items.find(i => i.id === dragItem.id);
   if (item) {
      // Optimistic UI, fire and forget (or alert on error)
      await supabase.from("shop_look_items")
         .update({ x_position: item.x_position, y_position: item.y_position })
         .eq("id", item.id);
   }
   
   dragItem = null;
   setTimeout(() => isDraggingGlobal = false, 100);
});

// Touch Move
document.addEventListener("touchmove", (e) => {
   if (!dragItem) return;
   e.preventDefault(); // Stop scroll while dragging dot
   
   isDraggingGlobal = true; 

   const touch = e.touches[0];
   const rect = hotspotLayer.getBoundingClientRect();
   
   let percentX = ((touch.clientX - rect.left) / rect.width) * 100;
   let percentY = ((touch.clientY - rect.top) / rect.height) * 100;
   
   percentX = Math.max(0, Math.min(100, percentX));
   percentY = Math.max(0, Math.min(100, percentY));

   dragItem.el.style.left = `${percentX}%`;
   dragItem.el.style.top = `${percentY}%`;
   
   // Store logic update
   const item = items.find(i => i.id === dragItem.id);
   if (item) {
       item.x_position = percentX;
       item.y_position = percentY;
   }
}, { passive: false });

// Touch End
document.addEventListener("touchend", async (e) => {
   if (!dragItem) return;
   
   const item = items.find(i => i.id === dragItem.id);
   if (item) {
      await supabase.from("shop_look_items")
         .update({ x_position: item.x_position, y_position: item.y_position })
         .eq("id", item.id);
   }
   
   dragItem = null;
   // Small delay to prevent 'click' firing
   setTimeout(() => isDraggingGlobal = false, 100);
});

function renderTaggedList() {
  taggedItemsList.innerHTML = items.map(item => `
    <div class="flex items-center gap-3 p-3 border border-gray-200 bg-gray-50">
       <div class="w-6 h-6 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">●</div>
       <img src="${item.product?.primary_image_url}" class="w-10 h-10 object-cover border border-gray-300">
       <div class="flex-1">
          <div class="text-xs font-bold truncate">${item.product?.name}</div>
       </div>
       <button class="text-xs text-red-500 hover:underline uppercase font-bold" onclick="window.dispatchEvent(new CustomEvent('kk:deleteTag', { detail: '${item.id}' }))">Remove</button>
    </div>
  `).join("");
}

// Interactions
function setupEventListeners() {
  // New Look
  document.getElementById("btnNewLook").addEventListener("click", async () => {
     // Provide empty string for image_url to satisfy NOT NULL constraint
     const { data, error } = await supabase.from("shop_looks").insert({ 
         title: "New Look", 
         is_active: false, 
         image_url: "" 
     }).select().single();
     
     if(error) return alert(error.message);
     loadLooks();
     loadEditor(data.id);
  });

  // Save
  document.getElementById("btnSaveLook").addEventListener("click", async () => {
     if(!currentLookId) return;
     const title = document.getElementById("editTitle").value;
     const is_active = document.getElementById("editIsActive").checked;
     
     let imageUrl = previewImage.src;
     
     // Upload if changed
     if (currentImageFile) {
        const path = `${Date.now()}_${currentImageFile.name}`;
        const { data, error } = await supabase.storage.from("looks").upload(path, currentImageFile);
        if(!error) {
           const { data: { publicUrl } } = supabase.storage.from("looks").getPublicUrl(path);
           imageUrl = publicUrl;
        }
     }

     await supabase.from("shop_looks").update({ title, is_active, image_url: imageUrl }).eq("id", currentLookId);
     currentImageFile = null;
     alert("Saved!");
     loadLooks();
  });

  // Delete Look
  document.getElementById("btnDeleteLook").addEventListener("click", async () => {
    if(!confirm("Delete this entire look?")) return;
    await supabase.from("shop_looks").delete().eq("id", currentLookId);
    location.reload();
  });

  // Image Upload Immediate
  fileInput.addEventListener("change", async (e) => {
     const file = e.target.files[0];
     if(!file) return;
     
     // 1. Show Preview Immediately
     const reader = new FileReader();
     reader.onload = (ev) => {
        previewImage.src = ev.target.result;
        previewImage.classList.remove("hidden");
        hotspotLayer.classList.remove("hidden");
        uploadPlaceholder.classList.add("hidden");
     };
     reader.readAsDataURL(file);

     // 2. Upload to Supabase & Save
     if (currentLookId) {
        uploadPlaceholder.innerHTML = `<span class="animate-pulse">Uploading...</span>`;
        
        const path = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
        const { data, error } = await supabase.storage.from("looks").upload(path, file);
        
        if (error) {
            alert("Upload failed: " + error.message);
            return;
        }

        const { data: { publicUrl } } = supabase.storage.from("looks").getPublicUrl(path);
        
        // Save to DB
        await supabase.from("shop_looks")
            .update({ image_url: publicUrl })
            .eq("id", currentLookId);
            
        // No explicit reload, just update local state if needed
        // But refreshing the list is good practice
        loadLooks(); 
     }
  });

  // Add Hotspot (Click on Layer)
  hotspotLayer.addEventListener("click", (e) => {
     if(!currentLookId) return;
     if(isDraggingGlobal) return;

     const rect = hotspotLayer.getBoundingClientRect();
     const x = ((e.clientX - rect.left) / rect.width) * 100;
     const y = ((e.clientY - rect.top) / rect.height) * 100;
     
     openProductPicker(x, y);
  });

  // Proxy events
  window.addEventListener("kk:deleteTag", (e) => deleteItem(e.detail));
  
  // Color Handler
  window.addEventListener("kk:setLookColor", async (e) => {
    if (!ctxItem) return;
    const color = e.detail;
    
    // Optimistic Update
    const item = items.find(i => i.id === ctxItem);
    if(item) {
        item.dot_color = color;
        renderHotspots();
        
        await supabase.from("shop_look_items")
            .update({ dot_color: color })
            .eq("id", ctxItem);
    }
    // Close legacy menu if open
    const menu = document.getElementById("ctxMenu");
    if (menu) menu.classList.add("hidden");
  });
}

// Item Management
async function deleteItem(itemId) {
  await supabase.from("shop_look_items").delete().eq("id", itemId);
  loadEditor(currentLookId); // reload
}

// Context Menu Actions
const ctxDelete = document.getElementById("ctxDelete");
const ctxChange = document.getElementById("ctxChangeProduct");

// ... Legacy Context Menu Listeners ...

// Modal Actions
const btnModalDelete = document.getElementById("btnModalDelete");
if (btnModalDelete) {
    btnModalDelete.addEventListener("click", () => {
        if(ctxItem) {
            if(confirm("Delete this tag?")) {
                deleteItem(ctxItem);
                modal.close();
            }
        }
    });
}

// Product Picker
let pendingCoords = null;
const modal = document.getElementById("productModal");
const modalSearch = document.getElementById("modalSearch");
const modalResults = document.getElementById("modalResults");

function openProductPicker(x, y) {
  pendingCoords = { x, y };
  ctxItem = null; // Clear update target
  
  // Hide Delete button for New Items
  if(btnModalDelete) btnModalDelete.classList.add("hidden");

  modalSearch.value = "";
  modalResults.innerHTML = "";
  modal.showModal();
  searchProducts("");
}

modalSearch.addEventListener("input", (e) => searchProducts(e.target.value));

async function searchProducts(q) {
  let query = supabase.from("products").select("id, name, price, primary_image_url").eq("is_active", true).limit(10);
  if(q) query = query.ilike("name", `%${q}%`);
  
  const { data } = await query;
  
  modalResults.innerHTML = (data || []).map(p => `
    <div class="flex items-center gap-3 p-2 border hover:bg-gray-50 cursor-pointer" 
         onclick="window.dispatchEvent(new CustomEvent('kk:selectProduct', { detail: '${p.id}' }))">
       <img src="${p.primary_image_url}" class="w-10 h-10 object-cover">
       <div class="text-sm font-bold">${p.name}</div>
    </div>
  `).join("");
}

window.addEventListener("kk:selectProduct", async (e) => {
   if(!currentLookId) return;
   const productId = e.detail;
   
   if (ctxItem) {
      // UPDATE existing item
      await supabase.from("shop_look_items").update({ product_id: productId }).eq("id", ctxItem);
   } else if (pendingCoords) {
      // INSERT new item
      await supabase.from("shop_look_items").insert({
          look_id: currentLookId,
          product_id: productId,
          x_position: pendingCoords.x,
          y_position: pendingCoords.y
      });
   }

   modal.close();
   ctxItem = null;
   pendingCoords = null;
   loadEditor(currentLookId);
});

init();

import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { requireAdmin } from "/js/shared/guard.js";
import { fetchBanners, fetchPromotablePromotions, togglePromotionVisibility, reorderBanners } from "./api.js";
import { openModal } from "./modal.js";

async function init() {
  await initAdminNav("Banners");
  initFooter();
  
  const user = await requireAdmin();
  if (!user) {
    document.getElementById("authPanel").classList.remove("hidden");
    return;
  }
  
  document.getElementById("appPanel").classList.remove("hidden");
  
  // Setup Actions
  document.getElementById("btnNewBanner").addEventListener("click", () => {
    openModal(null, refreshList);
  });

  loadList();
}

async function refreshList() {
    await loadList();
}

async function loadList() {
    const listEl = document.getElementById("activeBannersList");
    listEl.innerHTML = `<div class="text-center py-12 opacity-50">Loading...</div>`;

    try {
        const [banners, promotions] = await Promise.all([
          fetchBanners(),
          fetchPromotablePromotions()
        ]);
        
        renderList(banners, promotions);
    } catch (err) {
        console.error(err);
        listEl.innerHTML = `<div class="text-red-500 font-bold text-center">Failed to load content</div>`;
    }
}

function renderList(banners, promotions) {
    const listEl = document.getElementById("activeBannersList");
    
    if(!banners.length && !promotions.length) {
        listEl.innerHTML = `<div class="text-center py-12 opacity-50 border-2 border-dashed border-gray-300">No content found.</div>`;
        return;
    }

    // MAP Banners
    const bannerHtml = banners.map(b => `
       <article class="draggable-banner bg-white border-4 border-gray-100 hover:border-black transition-colors shadow-sm flex flex-col md:flex-row gap-6 p-4 items-center group relative cursor-move" draggable="true" data-id="${b.id}">
          <!-- Drag Handle -->
          <div class="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300 group-hover:text-black">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>
          </div>
          
          <!-- Image -->
          <div class="w-full md:w-48 aspect-video bg-gray-100 shrink-0 overflow-hidden border border-gray-200 ml-6 pointer-events-none">
             <img src="${b.image_url}" class="w-full h-full object-cover">
          </div>

          <!-- Info -->
          <div class="flex-1 text-center md:text-left pointer-events-none">
             <div class="flex items-center gap-2 justify-center md:justify-start mb-1">
                 <span class="bg-black text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">Custom Banner</span>
                 ${b.active ? `<span class="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">Active</span>` : `<span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">Draft</span>`}
                 <span class="text-[10px] font-bold uppercase tracking-wide opacity-50">#${b.sort_order}</span>
             </div>
             <h3 class="font-black text-lg leading-tight uppercase tracking-tight">${b.title}</h3>
             <p class="text-sm opacity-60 text-ellipsis overflow-hidden whitespace-nowrap max-w-[30ch]">${b.subtitle || 'No subtitle'}</p>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 shrink-0">
             <button data-id="${b.id}" class="btn-edit px-4 py-2 border-2 border-transparent hover:border-black text-xs font-bold uppercase tracking-widest relative z-10">
                Edit
             </button>
          </div>
       </article>
    `).join("");

    // MAP Promotions
    const promoHtml = promotions.map(p => {
       const hasImg = !!p.banner_image_path;
       const imgHtml = hasImg 
         ? `<img src="${p.banner_image_path}" class="w-full h-full object-cover">`
         : `<div class="w-full h-full bg-red-50 flex items-center justify-center text-red-300 font-bold uppercase text-[10px] text-center p-2">Missing<br>Image</div>`;

       const disableToggle = !hasImg;
       const tooltip = !hasImg ? 'title="Upload an image in Promotions tab first"' : '';

       return `
       <article class="bg-blue-50/50 border-4 border-blue-100/50 hover:border-blue-500 transition-colors shadow-sm flex flex-col md:flex-row gap-6 p-4 items-center group relative">
          <!-- Image -->
          <div class="w-full md:w-48 aspect-video bg-gray-100 shrink-0 overflow-hidden border border-gray-200 relative">
             ${imgHtml}
             <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span class="font-mono text-white text-xs bg-black/50 px-2 backdrop-blur-sm">PROMO</span>
             </div>
          </div>

          <!-- Info -->
          <div class="flex-1 text-center md:text-left">
             <div class="flex items-center gap-2 justify-center md:justify-start mb-1 h-5">
                 <span class="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">Auto-Generated</span>
                 ${p.is_public ? `<span class="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">Visible</span>` : `<span class="bg-gray-200 text-gray-500 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">Hidden</span>`}
                 ${!hasImg ? `<span class="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">No Image</span>` : ''}
             </div>
             <h3 class="font-black text-lg leading-tight uppercase tracking-tight">${p.name}</h3>
             <p class="text-sm opacity-60 text-ellipsis overflow-hidden whitespace-nowrap max-w-[30ch]">${p.description || 'Valid Promotion'}</p>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 shrink-0 items-center" ${tooltip}>
             <label class="flex items-center gap-2 ${disableToggle ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} select-none">
                <span class="text-[10px] font-bold uppercase tracking-widest opacity-60">Show on Home</span>
                <input type="checkbox" data-promo-id="${p.id}" class="toggle-promo w-5 h-5 accent-black" ${p.is_public ? 'checked' : ''} ${disableToggle ? 'disabled' : ''}>
             </label>
          </div>
       </article>
    `}).join("");

    listEl.innerHTML = bannerHtml + promoHtml;

    // Bind Edit Buttons (Banners)
    listEl.querySelectorAll(".btn-edit").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const banner = banners.find(x => x.id === id);
            if(banner) openModal(banner, refreshList);
        });
    });

    // --- Drag & Drop Sort ---
    const draggables = listEl.querySelectorAll(".draggable-banner");
    let draggedItem = null;

    draggables.forEach(item => {
        item.addEventListener("dragstart", (e) => {
            draggedItem = item;
            item.classList.add("dragging");
            // Ghost image feedback
            e.dataTransfer.effectAllowed = "move";
        });

        item.addEventListener("dragend", async () => {
            item.classList.remove("dragging");
            draggedItem = null;
            
            // Persist Order
            const newOrderIds = Array.from(listEl.querySelectorAll(".draggable-banner"))
                                     .map(el => el.getAttribute("data-id"));
            
            try {
                await reorderBanners(newOrderIds);
                // No need to full refresh, just update order visually or toast? 
                // Let's refresh to get correct sort indices shown
                refreshList(); 
            } catch(err) {
                console.error(err);
                alert("Failed to save order");
            }
        });
    });

    listEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(listEl, e.clientY);
        if (draggedItem) {
            if (afterElement == null) {
                // Insert after last draggable banner (before promos)
                const lastBanner = listEl.querySelector(".draggable-banner:last-of-type");
                if(lastBanner && lastBanner !== draggedItem) {
                    lastBanner.after(draggedItem);
                } else if(!listEl.querySelector(".draggable-banner")) {
                    listEl.prepend(draggedItem);
                }
            } else {
                listEl.insertBefore(draggedItem, afterElement);
            }
        }
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.draggable-banner:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // Bind Toggles (Promotions)
    listEl.querySelectorAll(".toggle-promo").forEach(chk => {
        chk.addEventListener("change", async (e) => {
            const id = chk.getAttribute("data-promo-id");
            const isPublic = chk.checked;
            
            // Optimistic UI? No, let's wait to ensure
            try {
                chk.disabled = true;
                await togglePromotionVisibility(id, isPublic);
                // Refresh to update badges (optional, but cleaner)
                refreshList();
            } catch(err) {
                console.error(err);
                alert("Failed to update promotion visibility");
                chk.checked = !isPublic; // Revert
                chk.disabled = false;
            }
        });
    });
}

init();

// /js/shared/components/productCard99c.js

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function render99cCard(product, bestDeal = null) {
  const slug = product?.slug || "";
  const href = slug ? `/pages/product.html?slug=${encodeURIComponent(slug)}` : "#";

  const img =
    product?.catalog_image_url ||
    product?.primary_image_url ||
    product?.catalog_hover_url ||
    "";

  const name = product?.name || "99¢ Deal";
  
  // Price Logic
  const basePrice = Number(product?.price || 0.99);
  let finalPrice = basePrice;
  let hasDiscount = false;

  if (bestDeal) {
      finalPrice = bestDeal.finalPrice;
      hasDiscount = true;
  }

  const jsonProduct = esc(JSON.stringify(product));

  return `
    <article class="group relative flex flex-col h-full border-[4px] border-yellow-400 bg-white hover:border-black transition-colors duration-300">
      
      <!-- Image Container -->
      <a href="${href}" class="block relative w-full aspect-square overflow-hidden bg-gray-100">
        ${img
          ? `<img 
              src="${esc(img)}" 
              alt="${esc(name)}" 
              loading="lazy" 
              class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
             >`
          : `<div class="w-full h-full flex items-center justify-center text-gray-300 font-bold uppercase text-xs">No Image</div>`
        }
        
        <!-- Corner Badge -->
        <div class="absolute top-0 right-0 bg-yellow-400 text-black text-[10px] font-black uppercase px-2 py-1 tracking-widest z-10 border-l-4 border-b-4 border-white">
          Deal
        </div>
      </a>

      <!-- Quick Add Overlay/Button (Mobile: Always Visible, Desktop: Hover) -->
      <button 
        type="button"
        class="js-quick-add w-full bg-black text-white font-black uppercase tracking-[0.2em] text-[10px] py-3 
               transition-all duration-200 hover:bg-yellow-400 hover:text-black
               flex items-center justify-center gap-2"
        data-product="${jsonProduct}"
      >
        <span>Add To Cart</span>
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4"></path></svg>
      </button>

      <!-- Content -->
      <a href="${href}" class="block p-3 flex-1 flex flex-col justify-between no-underline text-black">
        <h3 class="text-[12px] font-black uppercase tracking-wide leading-tight line-clamp-2 mb-2" title="${esc(name)}">
          ${esc(name)}
        </h3>

        <!-- Price Area -->
        <div class="mt-auto">
            ${hasDiscount 
                ? `<div class="flex items-center gap-2 flex-wrap">
                     <span class="text-xs text-gray-400 line-through font-bold decoration-[2px]">${money(basePrice)}</span>
                     <span class="text-xl font-black text-red-600 tracking-tighter">${money(finalPrice)}</span>
                   </div>`
                : `<div class="text-xl font-black tracking-tighter">${money(basePrice)}</div>`
            }
        </div>
      </a>
      
    </article>
  `;
}
// /js/shared/components/productCardHome.js

import { parseColorValue } from "../colorUtils.js";

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

function pickVariants(variants = []) {
  if (!Array.isArray(variants) || !variants.length) return [];
  const colors = variants.filter(v => String(v.option_name || "").toLowerCase().trim() === "color");
  return colors.length ? colors : variants;
}

export function renderHomeCard(product, variants = [], opts = {}) {
  const variantLimit = Number.isFinite(opts.variantLimit) ? opts.variantLimit : 6;
  const slug = product?.slug || "";
  const href = slug ? `/pages/product.html?slug=${encodeURIComponent(slug)}` : "#";

  const defaultImg = product?.catalog_image_url || product?.primary_image_url || "";
  const name = product?.name || "Product";
  const price = money(product?.price);

  const vlist = pickVariants(variants);
  const shown = vlist.slice(0, variantLimit);
  const moreCount = Math.max(0, vlist.length - shown.length);

  const swatchesHtml = shown.map(v => {
    const { background, isMultiColor } = parseColorValue(v.option_value);
    const oos = Number(v.stock || 0) <= 0;
    const style = `style="background:${esc(background)}"`;
    
    // Check if this is a light color that needs a border
    const colorLower = String(v.option_value || "").toLowerCase();
    const isLight = colorLower.includes("white") || colorLower.includes("cream") || colorLower.includes("ivory") || colorLower.includes("beige");
    const borderClass = isLight && !isMultiColor ? "ring-1 ring-inset ring-black/20" : "";
    
    // Using preview_image_url from Supabase schema
    const vImg = v.preview_image_url || defaultImg;

    return `
      <button 
        type="button"
        class="swatch-trigger w-7 h-5 border border-black/20 bg-white inline-block shrink-0 cursor-pointer hover:border-black hover:scale-110 transition-all ${borderClass} ${oos ? "opacity-40 relative after:content-[''] after:absolute after:inset-0 after:border-t after:border-black/50 after:-rotate-45" : ""}" 
        title="${esc(v.option_value)}" 
        data-variant-img="${esc(vImg)}"
        ${style}>
      </button>`;
  }).join("");

  const moreHtml = moreCount > 0 
    ? `<span class="text-[11px] font-bold text-black/60 leading-[20px] px-1.5 border border-black/10 bg-black/5 shrink-0 select-none">+${moreCount}</span>` 
    : "";

  const variantsRow = (shown.length || moreCount)
    ? `<div class="mt-3 flex flex-wrap gap-1.5 relative z-20 items-center min-h-[22px]">${swatchesHtml}${moreHtml}</div>`
    : `<div class="mt-3 min-h-[22px]"></div>`; // Keep layout stable even without variants

  // Sale price logic (optional if you have compare_at_price data)
  const isSale = product.compare_at_price &&  Number(product.compare_at_price) > Number(product.price);
  const saleBadge = isSale 
    ? `<div class="absolute top-2 left-2 bg-black text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider z-10 pointer-events-none">Sale</div>` 
    : "";
  
  const priceDisplay = isSale
    ? `<span class="text-black/40 line-through text-[0.9em] mr-1 font-medium">${money(product.compare_at_price)}</span> <span class="text-red-600">${esc(price)}</span>`
    : `${esc(price)}`;

  // Quick Add Logic
  const canQuickAdd = opts.showQuickAdd !== false; // Default true if not specified, strictly check false
  let quickAddBtn = "";
  
  if (canQuickAdd) {
    // If it has only 1 variant (or 0, implying just the base product), we can add directly.
    // If multiple options, we redirect.
    // Note: 'variants' arg here is often just the colors for swatches.
    // Ideally we check total variant count. For visual card purposes, we can trust the passed variants length somewhat, 
    // but usually products always have at least 1 variant row in Supabase if active.
    
    // We'll store data attributes for the handler to read.
    // If > 1 variant, the handler will see that and redirect.
    quickAddBtn = `
      <button 
        type="button"
        class="quick-add-btn absolute bottom-0 left-0 right-0 bg-white/90 backdrop-blur text-black font-black uppercase text-xs py-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300 z-30 border-t border-black hover:bg-black hover:text-white"
        data-id="${esc(product.id)}"
        data-has-variants="${variants.length > 1 ? 'true' : 'false'}"
        title="${variants.length > 1 ? 'Choose Options' : 'Add to Cart'}"
      >
        ${variants.length > 1 ? 'Choose Options' : 'Add to Cart +'}
      </button>
    `;
  }

  return `
    <article class="product-card block group relative flex flex-col h-full animate-fade-in-up" ${opts.style || ""}>
      <a href="${href}" class="block w-full aspect-square bg-neutral-100 overflow-hidden border border-black/5 relative">
        ${saleBadge}
        ${quickAddBtn}
        <img 
           data-main-img 
           loading="lazy"
           decoding="async"
           src="${esc(defaultImg)}" 
           alt="${esc(name)}" 
           class="w-full h-full object-cover block transition-transform duration-500 ease-in-out group-hover:scale-110 motion-reduce:transition-none">
      </a>

      <div class="pt-3 flex flex-col grow">
        <a href="${href}" class="block group-hover:text-black/70 transition-colors">
          <h3 class="m-0 font-bold tracking-wide leading-snug text-lg uppercase line-clamp-2 min-h-[2.5em] font-['Archivo_Black',sans-serif]">${esc(name)}</h3>
        </a>
        <div class="mt-1 font-black tracking-wide text-base">${priceDisplay}</div>
        ${variantsRow}
      </div>
    </article>
  `;
}
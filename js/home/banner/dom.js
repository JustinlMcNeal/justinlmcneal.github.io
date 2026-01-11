
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const countdowns = new Map(); // el -> intervalId

export function startCountdown(endIso, displayEl, valueEl) {
  // Clear old one for this element
  if (countdowns.has(valueEl)) {
     clearInterval(countdowns.get(valueEl));
     countdowns.delete(valueEl);
  }

  if (!endIso) return;
  
  const end = new Date(endIso).getTime();
  const update = () => {
    const now = Date.now();
    const diff = end - now;
    if (diff <= 0) {
      clearInterval(countdowns.get(valueEl));
      countdowns.delete(valueEl);
      if(displayEl) displayEl.classList.add("hidden");
      return;
    }

    if(displayEl) displayEl.classList.remove("hidden");
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    const pad = (n) => n.toString().padStart(2, "0");
    
    valueEl.textContent = days > 0 
       ? `${pad(days)}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
       : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };
  update();
  const id = setInterval(update, 1000);
  countdowns.set(valueEl, id);
}

export function buildSlide(promo, index) {
  // Basic fallback data
  const isDefault = !promo;
  const p = promo || {
      id: 'default',
      banner_title: "The New Collection",
      banner_subtitle: "Explore the latest drops and exclusive items available now.",
      banner_image_path: "", 
      type: 'general'
  };

  const rawPath = String(p.banner_image_path || "").trim();
  const isVideo = rawPath.endsWith(".mp4") || rawPath.endsWith(".webm");
  
  // Media Layer
  let mediaHtml = "";
  // Check index to prioritize LCP image (first slide)
  const isLcp = index === 0;
  const loadingAttr = isLcp ? 'fetchpriority="high" loading="eager"' : 'loading="lazy"';

  if (rawPath && isVideo) {
    mediaHtml = `<video src="${rawPath}" muted loop playsinline autoplay class="absolute inset-0 w-full h-full object-cover z-20 hover:scale-105 transition-transform duration-700"></video>`;
  } else if (rawPath) {
    mediaHtml = `<img src="${rawPath}" ${loadingAttr} class="absolute inset-0 w-full h-full object-cover z-20 transition-transform duration-[8000ms] ease-linear scale-100 group-hover:scale-110" alt="${esc(p.banner_title)}">`;
  }

  // CTA
  let btnText = "Shop Catalog";
  let href = "/pages/catalog.html";
  if (!isDefault) {
      // Check if it's a direct banner link or a promo code link
      if (p.link_url) {
          href = p.link_url;
      } else {
          href = `/pages/catalog.html?cat=promo:${p.id}`;
      }

      if (p.btn_text) {
          btnText = p.btn_text; 
      } else if (p.type === 'percentage') {
          btnText = `Get ${Number(p.value)}% Off`;
      } else if (p.type === 'fixed') {
          btnText = `Save $${Number(p.value)}`;
      } else if (!isDefault) {
          btnText = "Shop This Deal";
      }
  }

  // Timer
  const timerId = `timer-${index}`;
  const timerValId = `timer-val-${index}`;
  const timerHtml = p.end_date 
    ? `<div id="${timerId}" class="hidden flex items-center gap-1.5 text-white font-mono text-[10px] md:text-xs font-bold uppercase tracking-widest bg-red-600 px-2 py-1 mb-0 shadow-lg"><span id="${timerValId}">00:00:00</span></div>`
    : "";

  return `
    <article class="promo-slide relative min-w-[85vw] md:min-w-[60%] shrink-0 snap-center overflow-hidden shadow-xl group border-none select-none h-[300px] md:h-[450px] transition-all duration-500 ease-out origin-center scale-95 opacity-50 blur-[2px] brightness-75">
       
       <!-- 1. Background -->
       <div class="absolute inset-0 z-0 bg-neutral-200">
          <div class="absolute inset-0 z-0 bg-[#ffffff] [background:radial-gradient(circle_at_22%_30%,rgba(245,143,134,.65)_0%,transparent_42%),radial-gradient(circle_at_80%_70%,rgba(246,220,198,.85)_0%,transparent_48%),linear-gradient(120deg,#fff_0%,#fff_38%,rgba(245,143,134,.35)_38%,rgba(246,220,198,.55)_100%)]"></div>
          ${mediaHtml}
          <div class="absolute inset-0 z-30 bg-black/20 group-hover:bg-black/10 transition-colors duration-700"></div>
       </div>

       <!-- 2. Content (Vertically Center = justify-center) -->
       <div class="relative z-40 p-6 md:p-12 w-full h-full flex flex-col justify-center items-start pointer-events-none">
          <div class="bg-white/10 backdrop-blur-md border border-white/20 p-6 md:p-8 max-w-xl pointer-events-auto shadow-2xl skew-x-0 transition-transform hover:-translate-y-1">
             <div class="flex items-center gap-3 mb-3 flex-wrap">
                 <span class="bg-black text-white px-2 py-1 font-black uppercase tracking-[0.2em] text-[10px] md:text-xs shadow-lg">
                    ${p.label || (isDefault ? 'Welcome' : 'Featured Deal')}
                 </span>
                 ${timerHtml}
             </div>
             <h1 class="text-white font-[1000] uppercase text-3xl md:text-5xl tracking-tighter leading-[0.9] drop-shadow-xl mb-3">
                ${esc(p.banner_title || p.name)}
             </h1>
             <p class="text-white/90 text-sm md:text-base font-medium leading-relaxed max-w-[40ch] drop-shadow-md mb-6 line-clamp-2 md:line-clamp-none">
                ${esc(p.banner_subtitle || p.description)}
             </p>
             <a href="${href}" class="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-black uppercase tracking-widest border-2 border-white hover:bg-black hover:text-white hover:border-black transition-all text-xs md:text-sm shadow-xl">
                <span>${btnText}</span>
             </a>
          </div>
       </div>
    </article>
  `;
}

export function highlightSlide(track, targetIdx, skipAnimation = false) {
  Array.from(track.children).forEach((child, idx) => {
     // Always remove animate-in first
     child.classList.remove('animate-in');
     
     if (idx === targetIdx) {
         child.classList.remove('scale-95', 'opacity-50', 'blur-[2px]', 'brightness-75');
         child.classList.add('scale-100', 'opacity-100', 'blur-0', 'brightness-100', 'z-10', 'shadow-2xl', 'active');
         
         // Only add animate-in if not skipping (i.e., not a teleport)
         if (!skipAnimation) {
             child.classList.add('animate-in');
             // Remove animate-in after animation completes to allow re-triggering
             setTimeout(() => child.classList.remove('animate-in'), 600);
         }
     } else {
         child.classList.add('scale-95', 'opacity-50', 'blur-[2px]', 'brightness-75');
         child.classList.remove('scale-100', 'opacity-100', 'blur-0', 'brightness-100', 'z-10', 'shadow-2xl', 'active');
     }
  });
}

export function updateDots(dotsContainer, activeIndex) {
    if(!dotsContainer) return;
    dotsContainer.querySelectorAll(".slider-dot").forEach((dot, idx) => {
       dot.classList.toggle("bg-white", idx === activeIndex);
       dot.classList.toggle("bg-white/50", idx !== activeIndex);
       dot.style.transform = idx === activeIndex ? "scale(1.2)" : "scale(1)";
    });
}

// /js/product/render.js

function esc(str) {
  return String(str).replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]
  ));
}

export function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function shippingText(shipping_status, variant = null) {
  if (shipping_status === "mto") return "⏳ Made to order · ships in 2–4 weeks";
  if (variant && (variant.stock ?? null) !== null && variant.stock <= 0) {
    return "🕐 Shipping time 2–4 weeks";
  }
  return "🚀 In Stock · ships in 1–2 business days";
}

export function stockBadgeHtml(variant = null, shipping_status = "") {
  if (shipping_status === "mto") {
    return `<span class="inline-block bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Made to Order</span>`;
  }
  if (!variant || (variant.stock ?? null) === null) return "";
  const stock = variant.stock;
  if (stock <= 0) {
    return `<span class="inline-block bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Shipping time 2–4 weeks</span>`;
  }
  if (stock <= 3) {
    return `<span class="inline-block bg-yellow-100 text-yellow-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">⚠ Only ${stock} left!</span>`;
  }
  return `<span class="inline-block bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">✓ In Stock</span>`;
}

export function pickMainImage(product, gallery = [], variants = []) {
  return (
    product?.primary_image_url ||
    product?.catalog_image_url ||
    gallery?.[0]?.url ||
    variants?.[0]?.preview_image_url ||
    "/imgs/brand/placeholder.png"
  );
}

/**
 * MAIN CAROUSEL (Tailwind)
 * - scroll-snap track expects flex children that are full width
 */
export function renderMainCarousel(trackEl, images = [], onIndexChange) {
  if (!trackEl) return null;

  trackEl.innerHTML = "";
  const list = (images || []).filter(Boolean);
  if (!list.length) return null;

  list.forEach((url, idx) => {
    const slide = document.createElement("div");
    slide.className = "snap-start shrink-0 w-full h-full flex items-center justify-center overflow-hidden";
    slide.dataset.idx = String(idx);
    slide.innerHTML = `
      <img
        src="${esc(url)}"
        alt="Image ${idx + 1}"
        loading="${idx === 0 ? "eager" : "lazy"}"
        class="w-full h-full object-contain max-w-full"
        style="max-width: 100%; max-height: 100%;"
      >
    `;
    trackEl.appendChild(slide);
  });

  let activeIndex = 0;

  function scrollToIndex(i, behavior = "smooth") {
    const clamped = Math.max(0, Math.min(list.length - 1, i));
    activeIndex = clamped;

    const w = trackEl.clientWidth || 1;
    trackEl.scrollTo({ left: clamped * w, behavior });

    onIndexChange?.(activeIndex, list[activeIndex]);
  }

  let raf = null;
  trackEl.addEventListener("scroll", () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = trackEl.clientWidth || 1;
      const i = Math.round(trackEl.scrollLeft / w);
      const clamped = Math.max(0, Math.min(list.length - 1, i));
      if (clamped !== activeIndex) {
        activeIndex = clamped;
        onIndexChange?.(activeIndex, list[activeIndex]);
      }
    });
  });

  window.addEventListener("resize", () => scrollToIndex(activeIndex, "auto"));

  return {
    count: list.length,
    getIndex: () => activeIndex,
    setIndex: (i, behavior) => scrollToIndex(i, behavior),
    next: () => scrollToIndex(activeIndex + 1),
    prev: () => scrollToIndex(activeIndex - 1),
    getUrl: (i) => list[i],
  };
}

/**
 * DESKTOP THUMBS GRID (shows on lg+)
 * Modern rounded style with subtle shadow on active
 */
export function renderThumbGrid(containerEl, images = [], onPick) {
  if (!containerEl) return null;
  containerEl.innerHTML = "";

  const list = (images || []).filter(Boolean);
  if (!list.length) return null;

  const btns = [];

  list.forEach((url, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.idx = String(idx);

    btn.className =
      "bg-[#fafafa] overflow-hidden aspect-square rounded-lg focus:outline-none transition-all duration-200 " +
      (idx === 0
        ? "ring-2 ring-gray-900 opacity-100 shadow-md"
        : "opacity-60 hover:opacity-100 hover:shadow-sm");

    btn.innerHTML = `<img src="${esc(url)}" alt="thumb ${idx + 1}" class="w-full h-full object-cover">`;

    btn.addEventListener("click", () => onPick?.(url, idx));
    containerEl.appendChild(btn);
    btns.push(btn);
  });

  function setActive(i) {
    btns.forEach((b) => {
      b.classList.remove("ring-2", "ring-gray-900", "shadow-md");
      b.classList.add("opacity-60");
    });
    const btn = btns[i];
    if (btn) {
      btn.classList.remove("opacity-60");
      btn.classList.add("ring-2", "ring-gray-900", "shadow-md", "opacity-100");
    }
  }

  return { setActive, count: list.length };
}

/**
 * MOBILE THUMBS CAROUSEL (3 visible, swipe)
 * Modern rounded style with subtle shadow on active
 */
export function renderThumbCarousel(containerEl, images = [], onPick) {
  if (!containerEl) return null;
  containerEl.innerHTML = "";

  const list = (images || []).filter(Boolean);
  if (!list.length) return null;

  const btns = [];

  list.forEach((url, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.idx = String(idx);

    // 3 visible: smaller thumbnails on mobile
    btn.style.flex = "0 0 20%";
    btn.style.scrollSnapAlign = "start";

    btn.className =
      "bg-[#fafafa] overflow-hidden aspect-square rounded-lg focus:outline-none transition-all duration-200 " +
      (idx === 0
        ? "ring-2 ring-gray-900 opacity-100 shadow-md"
        : "opacity-60 hover:opacity-100");

    btn.innerHTML = `<img src="${esc(url)}" alt="thumb ${idx + 1}" class="w-full h-full object-cover">`;

    btn.addEventListener("click", () => onPick?.(url, idx));
    containerEl.appendChild(btn);
    btns.push(btn);
  });

  function setActive(i) {
    btns.forEach((b) => {
      b.classList.remove("ring-2", "ring-gray-900", "shadow-md");
      b.classList.add("opacity-60");
    });
    const btn = btns[i];
    if (btn) {
      btn.classList.remove("opacity-60");
      btn.classList.add("ring-2", "ring-gray-900", "shadow-md", "opacity-100");
    }
  }

  return { setActive, count: list.length };
}

/**
 * SLIDE INDICATOR DOTS (mobile)
 */
export function renderSlideIndicators(containerEl, count, onPick) {
  if (!containerEl || count < 2) {
    if (containerEl) containerEl.innerHTML = "";
    return null;
  }

  containerEl.innerHTML = "";
  const dots = [];

  for (let i = 0; i < Math.min(count, 10); i++) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `w-2 h-2 rounded-full transition-all duration-200 ${
      i === 0 ? "bg-gray-900 w-4" : "bg-gray-400"
    }`;
    dot.addEventListener("click", () => onPick?.(i));
    containerEl.appendChild(dot);
    dots.push(dot);
  }

  function setActive(idx) {
    dots.forEach((d, i) => {
      if (i === idx) {
        d.className = "w-4 h-2 rounded-full bg-gray-900 transition-all duration-200";
      } else {
        d.className = "w-2 h-2 rounded-full bg-gray-400 transition-all duration-200";
      }
    });
  }

  return { setActive };
}

export function renderTags(tagRowEl, tags = []) {
  if (!tagRowEl) return;
  tagRowEl.innerHTML = "";

  const safe = (tags || []).filter(Boolean).slice(0, 10);
  if (!safe.length) return;

  safe.forEach((t) => {
    const pill = document.createElement("span");
    pill.textContent = t;

    // Borderless tag pill
    pill.className =
      "bg-gray-100 text-black " +
      "px-3 py-2 text-[11px] font-black tracking-[.18em] uppercase";

    tagRowEl.appendChild(pill);
  });
}

/* ---------------- Swatches (Variants) ---------------- */

import { parseColorValue } from "../shared/colorUtils.js";

export function renderVariantSwatches(container, variants = [], onSelect) {
  if (!container) return;

  container.innerHTML = "";
  let activeBtn = null;

  variants.forEach((variant, idx) => {
    const label = variant?.option_value || "";
    const { background, isMultiColor } = parseColorValue(label);
    const isOutOfStock = (variant.stock ?? null) !== null && variant.stock <= 0;

    const btn = document.createElement("button");
    btn.type = "button";

    btn.className = [
      "w-8 h-8",
      "rounded-sm",
      "shadow-sm",
      "hover:shadow-md",
      "border-2 border-transparent",
      "hover:border-black focus:border-black",
      "transition-all duration-150",
      "outline-none",
      "relative",
    ].join(" ");

    btn.style.background = background;

    // Diagonal line for out-of-stock variants (still clickable — back-orderable)
    if (isOutOfStock) {
      btn.style.opacity = "0.7";
      btn.innerHTML = `<span class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span class="block w-[140%] h-[2px] bg-red-500 rotate-45 opacity-80"></span>
      </span>`;
    }
    
    // Add a subtle inner border for white/light colors
    if (!isMultiColor && (label.toLowerCase().includes("white") || label.toLowerCase().includes("cream") || label.toLowerCase().includes("ivory"))) {
      btn.classList.add("ring-1", "ring-inset", "ring-black/10");
    }

    btn.setAttribute("aria-label", `${label || `Color option ${idx + 1}`}${isOutOfStock ? " (2–4 week shipping)" : ""}`);
    btn.title = `${label || ""}${isOutOfStock ? " (2–4 week shipping)" : ""}`;

    btn.onclick = () => {
      if (activeBtn) {
        activeBtn.classList.remove("border-black", "shadow-md");
        activeBtn.classList.add("border-transparent", "shadow-sm");
      }

      btn.classList.remove("border-transparent", "shadow-sm");
      btn.classList.add("border-black", "shadow-md");

      activeBtn = btn;
      onSelect?.(variant);
    };

    container.appendChild(btn);
  });

  // auto-select first
  const first = container.querySelector("button");
  if (first) first.click();
}



export function renderDetailsSections(containerEl, items = []) {
  if (!containerEl) return;
  containerEl.innerHTML = "";

  if (!items.length) {
    containerEl.innerHTML = `<div class="text-sm opacity-70">No details yet.</div>`;
    return;
  }

  const order = ["description", "sizing", "care"];
  const grouped = {};
  order.forEach((k) => (grouped[k] = []));

  items.forEach((it) => {
    const key = (it.section || "").toLowerCase();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(it);
  });

  order.forEach((k) =>
    grouped[k].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  );

  containerEl.innerHTML = order
    .filter((k) => grouped[k]?.length)
    .map((k, idx) => {
      const rows = grouped[k];

      return `
        <details class="group bg-gray-100 p-4 ${idx ? "mt-3" : ""}">
          <summary class="list-none cursor-pointer flex items-center justify-between select-none">
            <span class="uppercase tracking-[.18em] font-black text-xs">${esc(k)}</span>
            <span class="text-xs font-black transition-transform duration-200 group-open:rotate-180">▼</span>
          </summary>

          <div class="mt-3">
            <ul class="ml-5 list-disc text-sm opacity-85 leading-7">
              ${rows.map((row) => `<li>${esc(row.content)}</li>`).join("")}
            </ul>
          </div>
        </details>
      `;
    })
    .join("");
}
export function renderPairsCarousel(containerEl, products = []) {
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const list = (products || []).filter(Boolean);
  if (!list.length) return;

  list.forEach((p) => {
    const a = document.createElement("a");
    a.href = `/pages/product.html?slug=${encodeURIComponent(p.slug)}`;
    a.className = "block snap-start shrink-0";

    // show 2 at a time on mobile/desktop
    a.style.flex = "0 0 calc((100% - 12px) / 2)";

    const img = p.primary_image_url || p.catalog_image_url || "/imgs/brand/placeholder.png";

    a.innerHTML = `
      <div class="bg-gray-100 p-3">
        <div class="aspect-square bg-white overflow-hidden">
          <img src="${esc(img)}" alt="${esc(p.name)}" class="w-full h-full object-cover" loading="lazy">
        </div>

        <div class="mt-3">
          <div class="font-black text-xs tracking-[.12em] uppercase line-clamp-2">${esc(p.name)}</div>
          <div class="mt-1 text-sm opacity-80">${money(p.price)}</div>
        </div>
      </div>
    `;

    containerEl.appendChild(a);
  });
}


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

export function shippingText(shipping_status) {
  if (shipping_status === "mto") return "Made to order · ships in 3–5 weeks";
  return "Ready to ship · ships in 1–3 business days";
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
    slide.className = "snap-start shrink-0 w-full h-full flex items-center justify-center";
    slide.dataset.idx = String(idx);
    slide.innerHTML = `
      <img
        src="${esc(url)}"
        alt="Image ${idx + 1}"
        loading="${idx === 0 ? "eager" : "lazy"}"
        class="w-full h-full object-contain"
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
 * Borderless / clean look (no border-4 border-black)
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
      "bg-white overflow-hidden aspect-square focus:outline-none transition " +
      (idx === 0
        ? "ring-2 ring-black/20 opacity-100"
        : "opacity-70 hover:opacity-100");

    btn.innerHTML = `<img src="${esc(url)}" alt="thumb ${idx + 1}" class="w-full h-full object-cover">`;

    btn.addEventListener("click", () => onPick?.(url, idx));
    containerEl.appendChild(btn);
    btns.push(btn);
  });

  function setActive(i) {
    btns.forEach((b) => {
      b.classList.remove("ring-2", "ring-black/20");
      b.classList.add("opacity-70");
    });
    const btn = btns[i];
    if (btn) {
      btn.classList.remove("opacity-70");
      btn.classList.add("ring-2", "ring-black/20");
    }
  }

  return { setActive, count: list.length };
}

/**
 * MOBILE THUMBS CAROUSEL (3 visible, swipe)
 * Borderless / clean look (no border-4 border-black)
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

    // 3 visible: (100% - 2 gaps) / 3
    btn.style.flex = "0 0 22%"; // ✅ smaller thumbnails on mobile
    btn.style.scrollSnapAlign = "start";

    btn.className =
      "bg-white overflow-hidden aspect-square focus:outline-none transition " +
      (idx === 0
        ? "ring-2 ring-black/20 opacity-100"
        : "opacity-70 hover:opacity-100");

    btn.innerHTML = `<img src="${esc(url)}" alt="thumb ${idx + 1}" class="w-full h-full object-cover">`;

    btn.addEventListener("click", () => onPick?.(url, idx));
    containerEl.appendChild(btn);
    btns.push(btn);
  });

  function setActive(i) {
    btns.forEach((b) => {
      b.classList.remove("ring-2", "ring-black/20");
      b.classList.add("opacity-70");
    });
    const btn = btns[i];
    if (btn) {
      btn.classList.remove("opacity-70");
      btn.classList.add("ring-2", "ring-black/20");
    }
  }

  return { setActive, count: list.length };
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

const COLOR_MAP = {
  black: "#000000",
  white: "#ffffff",
  pink: "#ff6ea8",
  hotpink: "#ff3d9a",
  rose: "#ff6ea8",
  red: "#e11d48",
  blue: "#2563eb",
  green: "#16a34a",
  beige: "#d6c6b2",
  tan: "#d6c6b2",
  brown: "#7c3f2a",
  gray: "#6b7280",
  grey: "#6b7280",
  purple: "#7c3aed",
  orange: "#f97316",
  yellow: "#f59e0b",
};

function guessColor(optionValue) {
  const raw = String(optionValue || "").trim().toLowerCase();
  if (COLOR_MAP[raw]) return COLOR_MAP[raw];
  for (const key of Object.keys(COLOR_MAP)) {
    if (raw.includes(key)) return COLOR_MAP[key];
  }
  return "#ffffff";
}

export function renderVariantSwatches(container, variants = [], onSelect) {
  if (!container) return;

  container.innerHTML = "";
  let activeBtn = null;

  variants.forEach((variant, idx) => {
    const label = variant?.option_value || "";
    const color = guessColor(label);

    const btn = document.createElement("button");
    btn.type = "button";

    btn.className = [
      "w-8 h-8",
      "rounded-sm",                 // optional: tiny softness
      "shadow-sm",                  // ✅ subtle base shadow
      "hover:shadow-md",            // ✅ lift on hover
      "border-2 border-transparent",
      "hover:border-black focus:border-black",
      "transition-all duration-150",
      "outline-none",
    ].join(" ");

    btn.style.backgroundColor = color;

    // accessibility
    btn.setAttribute("aria-label", label || `Color option ${idx + 1}`);
    btn.title = label || "";

    btn.onclick = () => {
      if (activeBtn) {
        activeBtn.classList.remove(
          "border-black",
          "shadow-md"
        );
        activeBtn.classList.add(
          "border-transparent",
          "shadow-sm"
        );
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


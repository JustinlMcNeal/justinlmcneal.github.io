// js/reviews/browse.js
// Browse reviews page — showcase approved reviews with photo gallery, filters, sort, search
import { initNavbar } from "/js/shared/navbar.js";
import { initFooter } from "/js/shared/footer.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

const supabase = getSupabaseClient();

const PAGE_SIZE = 20;

/* ── State ── */
let allReviews   = [];  // full loaded set
let filtered     = [];  // after filter + search
let displayCount = 0;   // how many currently shown
let activeFilter = null; // null = all, 1-5 = star
let activeSort   = "newest";
let searchQuery  = "";

/* ── Helpers ── */
const $ = (id) => document.getElementById(id);

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function starsHtml(rating) {
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="text-base ${i < rating ? "text-amber-400" : "text-gray-200"}">★</span>`
  ).join("");
}

/* ── Load Reviews ── */
async function loadReviews() {
  try {
    const { data, error } = await supabase
      .from("reviews")
      .select("id, product_id, product_name, reviewer_name, rating, title, body, photo_url, created_at")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    allReviews = data || [];
    applyFilters();
    renderAggregate();
    renderPhotoGallery();
  } catch (err) {
    console.error("[browse] load error:", err);
    $("reviewsFeed").innerHTML = `<div class="text-center text-sm text-gray-400 py-8">Could not load reviews.</div>`;
  }
}

/* ── Aggregate Stats ── */
function renderAggregate() {
  if (!allReviews.length) return;

  const total = allReviews.length;
  const sum = allReviews.reduce((s, r) => s + (r.rating || 0), 0);
  const avg = Math.round((sum / total) * 10) / 10;

  $("avgRating").textContent = avg.toFixed(1);
  $("totalCount").textContent = total;
  $("avgStars").innerHTML = starsHtml(Math.round(avg));

  const el = $("aggregateStats");
  el?.classList.remove("hidden");
}

/* ── Photo Gallery (photo_url IS NOT NULL) ── */
function renderPhotoGallery() {
  const photos = allReviews.filter(r => r.photo_url);
  if (!photos.length) return;

  const strip = $("photoStrip");
  strip.innerHTML = photos.map(r => `
    <img src="${escHtml(r.photo_url)}" alt="Photo by ${escHtml(r.reviewer_name || 'Customer')}"
         class="js-lightbox-photo w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border-2 border-black/10 shrink-0 cursor-pointer hover:border-black/40 hover:scale-105 transition-all"
         data-full="${escHtml(r.photo_url)}" loading="lazy" />
  `).join("");

  $("photoGallery")?.classList.remove("hidden");
}

/* ── Filter / Sort / Search ── */
function applyFilters() {
  let result = [...allReviews];

  // Star filter
  if (activeFilter) {
    result = result.filter(r => r.rating === activeFilter);
  }

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(r =>
      (r.product_name || "").toLowerCase().includes(q) ||
      (r.title || "").toLowerCase().includes(q) ||
      (r.body || "").toLowerCase().includes(q)
    );
  }

  // Sort
  if (activeSort === "highest") {
    result.sort((a, b) => b.rating - a.rating || new Date(b.created_at) - new Date(a.created_at));
  } else if (activeSort === "lowest") {
    result.sort((a, b) => a.rating - b.rating || new Date(b.created_at) - new Date(a.created_at));
  } else {
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  filtered = result;
  displayCount = 0;
  showMore();
}

/* ── Render ── */
function showMore() {
  const feed = $("reviewsFeed");
  const end = Math.min(displayCount + PAGE_SIZE, filtered.length);

  if (displayCount === 0) {
    feed.innerHTML = "";
  }

  if (!filtered.length) {
    feed.innerHTML = `
      <div class="text-center py-12">
        <div class="text-3xl mb-2">💬</div>
        <div class="text-sm text-gray-500">No reviews found.</div>
      </div>`;
    $("loadMoreWrap")?.classList.add("hidden");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let i = displayCount; i < end; i++) {
    fragment.appendChild(buildCard(filtered[i]));
  }
  feed.appendChild(fragment);
  displayCount = end;

  // Show/hide load more
  if (displayCount >= filtered.length) {
    $("loadMoreWrap")?.classList.add("hidden");
  } else {
    $("loadMoreWrap")?.classList.remove("hidden");
  }
}

function buildCard(r) {
  const div = document.createElement("div");
  div.className = "bg-white border-2 border-gray-200 p-5 hover:border-black transition-colors slide-up";

  div.innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-3">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="font-bold text-sm">${escHtml(r.reviewer_name || "Customer")}</span>
          <span class="text-[10px] text-green-600 font-bold uppercase bg-green-50 px-1.5 py-0.5 rounded">✓ Verified Purchase</span>
        </div>
        <div class="flex gap-0.5">${starsHtml(r.rating)}</div>
      </div>
      <div class="text-[10px] text-gray-400 whitespace-nowrap">${formatDate(r.created_at)}</div>
    </div>
    ${r.title ? `<div class="font-bold text-sm mb-1">${escHtml(r.title)}</div>` : ""}
    ${r.body ? `<div class="text-sm text-gray-700 leading-relaxed mb-2">${escHtml(r.body)}</div>` : ""}
    ${r.photo_url ? `<img src="${escHtml(r.photo_url)}" alt="Review photo" class="js-lightbox-photo mt-2 w-24 h-24 object-cover border-2 border-gray-200 rounded cursor-pointer hover:opacity-80 transition-opacity" data-full="${escHtml(r.photo_url)}" loading="lazy" />` : ""}
    ${r.product_name ? `<div class="text-[10px] text-gray-400 mt-3 uppercase tracking-wider">Product: ${escHtml(r.product_name)}</div>` : ""}
  `;

  return div;
}

/* ── Lightbox ── */
function initLightbox() {
  const lightbox = $("reviewPhotoLightbox");
  const img      = $("lightboxImg");
  const closeBtn = $("lightboxClose");

  function open(src) {
    img.src = src;
    lightbox.classList.remove("hidden");
    lightbox.classList.add("flex");
    document.body.style.overflow = "hidden";
  }

  function close() {
    lightbox.classList.add("hidden");
    lightbox.classList.remove("flex");
    img.src = "";
    document.body.style.overflow = "";
  }

  closeBtn?.addEventListener("click", close);
  lightbox?.addEventListener("click", (e) => { if (e.target === lightbox) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.classList.contains("hidden")) close();
  });

  // Delegate photo clicks
  document.addEventListener("click", (e) => {
    const photo = e.target.closest(".js-lightbox-photo");
    if (photo?.dataset.full) open(photo.dataset.full);
  });
}

/* ── Event Wiring ── */
function initFilters() {
  document.querySelectorAll(".review-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".review-filter-btn").forEach((b) => {
        b.classList.remove("bg-black", "text-white");
        b.classList.add("bg-white", "text-black");
      });
      btn.classList.remove("bg-white", "text-black");
      btn.classList.add("bg-black", "text-white");

      const f = btn.dataset.filter;
      activeFilter = f === "all" ? null : parseInt(f);
      applyFilters();
    });
  });
}

function initSort() {
  $("reviewSort")?.addEventListener("change", (e) => {
    activeSort = e.target.value;
    applyFilters();
  });
}

function initSearch() {
  let debounce;
  $("reviewSearch")?.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      searchQuery = e.target.value.trim();
      applyFilters();
    }, 300);
  });
}

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initNavbar();
  initFooter();
  initLightbox();
  initFilters();
  initSort();
  initSearch();

  $("btnLoadMore")?.addEventListener("click", showMore);

  loadReviews();
});

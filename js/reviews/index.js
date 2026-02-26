// js/reviews/index.js
// Customer-facing reviews page: order lookup → product picker → review form → coupon reward
import { initNavbar } from "/js/shared/navbar.js";
import { initFooter } from "/js/shared/footer.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

const VERIFY_URL = `${SUPABASE_URL}/functions/v1/verify-order`;
const SUBMIT_URL = `${SUPABASE_URL}/functions/v1/submit-review`;

/* ── State ── */
let orderData = null;   // from verify-order
let selectedItem = null; // item being reviewed

/* ── Helpers ── */
const $ = (id) => document.getElementById(id);
const hide = (el) => el?.classList.add("hidden");
const show = (el) => el?.classList.remove("hidden");

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  show(el);
}
function hideError(el) { hide(el); }

function starsHtml(rating, size = "text-sm") {
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="${size} ${i < rating ? "text-yellow-400" : "text-gray-300"}">★</span>`
  ).join("");
}

/* ── Step 1: Order Lookup ── */
async function lookupOrder() {
  const email = $("lookupEmail").value.trim();
  const orderId = $("lookupOrderId").value.trim().toUpperCase();
  const errEl = $("step1Error");
  hideError(errEl);

  if (!email || !orderId) {
    showError(errEl, "Please enter both your email and order number.");
    return;
  }

  const btn = $("btnLookup");
  btn.disabled = true;
  btn.textContent = "Looking up…";

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, order_id: orderId }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      showError(errEl, data.error || "Order not found.");
      return;
    }

    orderData = data;
    renderProductList(data);
    show($("step2"));
    $("step2").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("[reviews] lookup error:", err);
    showError(errEl, "Network error. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Find My Order";
  }
}

/* ── Step 2: Product List ── */
function renderProductList(data) {
  $("orderGreeting").textContent = data.order.first_name || "there";
  $("orderNumber").textContent = data.order.kk_order_id;

  const list = $("productList");
  list.innerHTML = "";

  if (!data.items?.length) {
    list.innerHTML = `<p class="text-sm text-gray-500">No items found on this order.</p>`;
    return;
  }

  data.items.forEach((item) => {
    const reviewed = item.already_reviewed;
    const card = document.createElement("div");
    card.className = `flex items-center gap-3 p-3 border-2 ${
      reviewed ? "border-gray-200 bg-gray-50 opacity-60" : "border-black hover:bg-kkpink/5 cursor-pointer"
    } transition-colors`;

    card.innerHTML = `
      <div class="w-14 h-14 border-2 border-black bg-gray-100 flex-shrink-0 overflow-hidden">
        ${item.image_url
          ? `<img src="${item.image_url}" class="w-full h-full object-cover" />`
          : `<div class="w-full h-full flex items-center justify-center text-gray-400 text-xs">📦</div>`}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-bold text-sm truncate">${escHtml(item.product_name || item.product_id || "Unknown")}</div>
        ${item.variant ? `<div class="text-xs text-gray-500">${escHtml(item.variant)}</div>` : ""}
        ${reviewed
          ? `<div class="text-[10px] text-green-600 font-bold uppercase mt-1">✓ Already reviewed</div>`
          : `<div class="text-[10px] text-kkpink font-bold uppercase mt-1">Click to review</div>`}
      </div>
      ${reviewed ? "" : `<div class="text-lg">→</div>`}
    `;

    if (!reviewed) {
      card.addEventListener("click", () => selectProduct(item));
    }

    list.appendChild(card);
  });
}

function selectProduct(item) {
  selectedItem = item;
  $("reviewingProduct").textContent = item.product_name || item.product_id;
  $("reviewerName").value = orderData?.order?.first_name || "";

  // Reset form
  $("ratingValue").value = "0";
  $("reviewTitle").value = "";
  $("reviewBody").value = "";
  resetStars();
  hidePhoto();
  hideError($("step3Error"));

  show($("step3"));
  $("step3").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── Step 3: Review Form ── */
function initStarRating() {
  const stars = document.querySelectorAll("#starRating .star-btn");
  stars.forEach((star) => {
    star.addEventListener("click", () => {
      const val = parseInt(star.dataset.star);
      $("ratingValue").value = val;
      stars.forEach((s) => {
        const sv = parseInt(s.dataset.star);
        s.classList.toggle("active", sv <= val);
        s.classList.toggle("inactive", sv > val);
      });
    });
  });
}

function resetStars() {
  document.querySelectorAll("#starRating .star-btn").forEach((s) => {
    s.classList.remove("active");
    s.classList.add("inactive");
  });
}

function initPhotoUpload() {
  const fileInput = $("reviewPhoto");
  const preview = $("photoPreview");
  const previewImg = $("photoPreviewImg");
  const removeBtn = $("removePhoto");

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    show(preview);
    $("photoLabel").textContent = file.name;
  });

  removeBtn?.addEventListener("click", () => {
    hidePhoto();
  });
}

function hidePhoto() {
  hide($("photoPreview"));
  $("photoPreviewImg").src = "";
  $("reviewPhoto").value = "";
  $("photoLabel").textContent = "📷 Click to upload a photo";
}

async function submitReview() {
  const errEl = $("step3Error");
  hideError(errEl);

  const rating = parseInt($("ratingValue").value);
  const body = $("reviewBody").value.trim();

  if (!rating || rating < 1) {
    showError(errEl, "Please select a star rating.");
    return;
  }
  if (!body) {
    showError(errEl, "Please write a review.");
    return;
  }

  const btn = $("btnSubmitReview");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    // Upload photo if present
    let photoUrl = null;
    const photoFile = $("reviewPhoto").files?.[0];
    if (photoFile) {
      try {
        photoUrl = await uploadReviewPhoto(photoFile);
      } catch (e) {
        console.warn("[reviews] photo upload failed:", e);
        // Non-fatal, continue without photo
      }
    }

    const res = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        order_session_id: orderData.order.session_id,
        product_id: selectedItem.product_id,
        product_name: selectedItem.product_name,
        reviewer_email: orderData.order.email,
        reviewer_name: $("reviewerName").value.trim() || null,
        rating,
        title: $("reviewTitle").value.trim() || null,
        review_body: body,
        photo_url: photoUrl,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      showError(errEl, data.error || "Submission failed. Please try again.");
      return;
    }

    // Show step 4
    showThankYou(data);
  } catch (err) {
    console.error("[reviews] submit error:", err);
    showError(errEl, "Network error. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Review";
  }
}

async function uploadReviewPhoto(file) {
  const sb = getSupabaseClient();
  const ext = file.name.split(".").pop() || "jpg";
  const path = `reviews/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await sb.storage.from("products").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) throw error;

  const { data: urlData } = sb.storage.from("products").getPublicUrl(path);
  return urlData.publicUrl;
}

/* ── Step 4: Thank You ── */
function showThankYou(data) {
  hide($("step1"));
  hide($("step2"));
  hide($("step3"));
  show($("step4"));

  $("thankYouTitle").textContent = "Thank You!";
  $("thankYouMsg").textContent = data.message;

  if (data.coupon) {
    show($("couponBox"));
    hide($("couponPending"));
    $("couponCodeDisplay").textContent = data.coupon.code;

    const detail = data.coupon.discount_type === "percentage"
      ? `${data.coupon.discount_value}% off your next order`
      : `$${data.coupon.discount_value} off your next order`;
    const expires = data.coupon.expires_at
      ? ` · Expires ${new Date(data.coupon.expires_at).toLocaleDateString()}`
      : "";
    $("couponDetailDisplay").textContent = detail + expires;
  } else if (data.coupon_pending) {
    hide($("couponBox"));
    show($("couponPending"));
  }

  $("step4").scrollIntoView({ behavior: "smooth", block: "start" });

  // Refresh the reviews feed
  loadApprovedReviews();
}

/* ── Copy Coupon ── */
function initCopyCoupon() {
  $("btnCopyCoupon")?.addEventListener("click", () => {
    const code = $("couponCodeDisplay")?.textContent;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      const btn = $("btnCopyCoupon");
      btn.textContent = "✓ Copied!";
      setTimeout(() => { btn.textContent = "📋 Copy Code"; }, 2000);
    });
  });
}

/* ── Review Another ── */
function initReviewAnother() {
  $("btnReviewAnother")?.addEventListener("click", () => {
    hide($("step4"));
    show($("step1"));
    show($("step2"));

    // Mark the just-reviewed item
    if (selectedItem) {
      selectedItem.already_reviewed = true;
      renderProductList(orderData);
    }
    selectedItem = null;

    $("step2").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/* ── Approved Reviews Feed ── */
async function loadApprovedReviews(filterRating = null) {
  const feed = $("reviewsFeed");
  feed.innerHTML = `<div class="text-center text-sm text-gray-400 py-8">Loading reviews…</div>`;

  try {
    const sb = getSupabaseClient();
    let query = sb
      .from("reviews")
      .select("id, product_name, reviewer_name, rating, title, body, photo_url, created_at")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(50);

    if (filterRating) {
      query = query.eq("rating", filterRating);
    }

    const { data: reviews, error } = await query;

    if (error) throw error;

    if (!reviews?.length) {
      feed.innerHTML = `
        <div class="text-center py-8">
          <div class="text-3xl mb-2">💬</div>
          <div class="text-sm text-gray-500">No reviews yet. Be the first to share your experience!</div>
        </div>`;
      return;
    }

    feed.innerHTML = reviews.map((r) => `
      <div class="bg-white border-2 border-gray-200 p-4 hover:border-black transition-colors">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm">${escHtml(r.reviewer_name || "Customer")}</span>
              <span class="text-[10px] text-green-600 font-bold uppercase">✓ Verified</span>
            </div>
            <div class="flex gap-0.5 mt-1">${starsHtml(r.rating)}</div>
          </div>
          <div class="text-[10px] text-gray-400 whitespace-nowrap">
            ${new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
        ${r.title ? `<div class="font-bold text-sm mb-1">${escHtml(r.title)}</div>` : ""}
        ${r.body ? `<div class="text-sm text-gray-700 leading-relaxed">${escHtml(r.body)}</div>` : ""}
        ${r.photo_url ? `<img src="${escAttr(r.photo_url)}" class="mt-2 w-24 h-24 object-cover border-2 border-gray-200 rounded" />` : ""}
        ${r.product_name ? `<div class="text-[10px] text-gray-400 mt-2 uppercase tracking-wider">Product: ${escHtml(r.product_name)}</div>` : ""}
      </div>
    `).join("");
  } catch (err) {
    console.error("[reviews] feed load error:", err);
    feed.innerHTML = `<div class="text-center text-sm text-gray-400 py-8">Could not load reviews.</div>`;
  }
}

function initReviewFilters() {
  document.querySelectorAll(".review-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Update active state
      document.querySelectorAll(".review-filter-btn").forEach((b) => {
        b.classList.remove("bg-black", "text-white");
        b.classList.add("bg-white", "text-black");
      });
      btn.classList.remove("bg-white", "text-black");
      btn.classList.add("bg-black", "text-white");

      const filter = btn.dataset.filter;
      loadApprovedReviews(filter === "all" ? null : parseInt(filter));
    });
  });
}

/* ── Escaping ── */
function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escAttr(s) { return escHtml(s); }

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initNavbar();
  initFooter();
  initStarRating();
  initPhotoUpload();
  initCopyCoupon();
  initReviewAnother();
  initReviewFilters();

  $("btnLookup")?.addEventListener("click", lookupOrder);
  $("btnSubmitReview")?.addEventListener("click", submitReview);

  // Enter key on inputs triggers lookup
  $("lookupEmail")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") lookupOrder();
  });
  $("lookupOrderId")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") lookupOrder();
  });

  // Load the approved reviews feed
  loadApprovedReviews();
});

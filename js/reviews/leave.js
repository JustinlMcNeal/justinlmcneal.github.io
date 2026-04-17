// js/reviews/leave.js
// Leave-a-review page: order lookup → product picker → review form → coupon reward
// Supports SMS token deep links: ?token=xxx → skips Steps 1-2
import { initNavbar } from "/js/shared/navbar.js";
import { initFooter } from "/js/shared/footer.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

const VERIFY_URL      = `${SUPABASE_URL}/functions/v1/verify-order`;
const VERIFY_TOKEN_URL = `${SUPABASE_URL}/functions/v1/verify-review-token`;
const SUBMIT_URL      = `${SUPABASE_URL}/functions/v1/submit-review`;
const MIN_BODY_LENGTH = 20;

/* ── State ── */
let orderData   = null; // from verify-order or verify-review-token
let selectedItem = null; // item being reviewed
let tokenEmail   = null; // email from token (for submit)

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

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function starsHtml(rating, size = "text-sm") {
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="${size} ${i < rating ? "text-yellow-400" : "text-gray-300"}">★</span>`
  ).join("");
}

/* ── Token Flow ── */
async function handleToken(token, code) {
  hide($("step1"));
  show($("tokenLoading"));

  try {
    const payload = code ? { code } : { token };
    const res = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      // Token expired or invalid — fall back to manual entry
      hide($("tokenLoading"));
      show($("step1"));
      show($("tokenExpiredBanner"));
      return;
    }

    // Already reviewed
    if (data.already_reviewed) {
      hide($("tokenLoading"));
      showAlreadyReviewed(data);
      return;
    }

    // Token verified — populate order data and skip to product selection or review form
    hide($("tokenLoading"));
    tokenEmail = data.email;

    orderData = {
      order: {
        kk_order_id: data.order.kk_order_id,
        session_id: data.order.session_id,
        email: data.email,
        first_name: data.order.first_name,
        order_date: data.order.order_date,
      },
      items: data.items,
    };

    // If token specifies a single product, skip step 2 entirely
    if (data.target_product_id && data.items?.length) {
      const target = data.items.find(it => it.product_id === data.target_product_id);
      if (target && !target.already_reviewed) {
        selectProduct(target);
        return;
      }
    }

    // Otherwise show step 2 (product picker)
    renderProductList(orderData);
    show($("step2"));
  } catch (err) {
    console.error("[leave] token verify error:", err);
    hide($("tokenLoading"));
    show($("step1"));
    show($("tokenExpiredBanner"));
  }
}

function showAlreadyReviewed(data) {
  show($("alreadyReviewed"));
  hide($("step1"));

  if (data.coupon_code) {
    show($("existingCouponBox"));
    $("existingCouponCode").textContent = data.coupon_code;

    const detail = data.coupon_discount_type === "percentage"
      ? `${data.coupon_discount_value}% off your next order`
      : `$${data.coupon_discount_value} off your next order`;
    $("existingCouponDetail").textContent = detail;
  }
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
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
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
    console.error("[leave] lookup error:", err);
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
          ? `<img src="${escHtml(item.image_url)}" class="w-full h-full object-cover" />`
          : `<div class="w-full h-full flex items-center justify-center text-gray-400 text-xs">📦</div>`}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-bold text-sm truncate">${escHtml(item.product_name || item.product_id || "Unknown")}</div>
        ${item.variant ? `<div class="text-xs text-gray-500">${escHtml(item.variant)}</div>` : ""}
        ${reviewed
          ? `<div class="text-[10px] text-green-600 font-bold uppercase mt-1">✓ Already reviewed</div>`
          : `<div class="text-[10px] text-kkpink font-bold uppercase mt-1">Click to review</div>`}
        ${reviewed && item.coupon_code
          ? `<div class="mt-1 inline-flex items-center gap-1 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
              <span class="text-[10px] text-green-700">Your coupon:</span>
              <span class="text-xs font-mono font-black text-green-800">${escHtml(item.coupon_code)}</span>
            </div>`
          : ""}
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
  updateCharCount();
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

function updateCharCount() {
  const body = $("reviewBody")?.value || "";
  const el = $("bodyCharCount");
  if (!el) return;
  const len = body.trim().length;
  if (len === 0) {
    el.textContent = "";
  } else if (len < MIN_BODY_LENGTH) {
    el.textContent = `${len}/${MIN_BODY_LENGTH} characters (need ${MIN_BODY_LENGTH - len} more)`;
    el.className = "text-[10px] text-red-400 text-right mt-1";
  } else {
    el.textContent = `${len} characters ✓`;
    el.className = "text-[10px] text-green-500 text-right mt-1";
  }
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
  $("photoLabel").textContent = "Click to upload a photo of your purchase";
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
  if (!body || body.length < MIN_BODY_LENGTH) {
    showError(errEl, `Please write at least ${MIN_BODY_LENGTH} characters in your review.`);
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
        console.warn("[leave] photo upload failed:", e);
      }
    }

    const reviewerEmail = tokenEmail || orderData?.order?.email;

    const res = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({
        order_session_id: orderData.order.session_id,
        product_id: selectedItem.product_id,
        product_name: selectedItem.product_name,
        reviewer_email: reviewerEmail,
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

    showThankYou(data);
  } catch (err) {
    console.error("[leave] submit error:", err);
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

  $("btnCopyExistingCoupon")?.addEventListener("click", () => {
    const code = $("existingCouponCode")?.textContent;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      const btn = $("btnCopyExistingCoupon");
      btn.textContent = "✓ Copied!";
      setTimeout(() => { btn.textContent = "📋 Copy Code"; }, 2000);
    });
  });
}

/* ── Review Another ── */
function initReviewAnother() {
  $("btnReviewAnother")?.addEventListener("click", () => {
    hide($("step4"));
    show($("step2"));

    if (selectedItem) {
      selectedItem.already_reviewed = true;
      renderProductList(orderData);
    }
    selectedItem = null;

    $("step2").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initNavbar();
  initFooter();
  initStarRating();
  initPhotoUpload();
  initCopyCoupon();
  initReviewAnother();

  $("btnLookup")?.addEventListener("click", lookupOrder);
  $("btnSubmitReview")?.addEventListener("click", submitReview);
  $("reviewBody")?.addEventListener("input", updateCharCount);

  $("lookupEmail")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") lookupOrder();
  });
  $("lookupOrderId")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") lookupOrder();
  });

  // Check for short code or token (SMS deep link)
  const params = new URLSearchParams(window.location.search);
  const code = params.get("r");
  const token = params.get("token");
  if (code) {
    handleToken(null, code);
    return;
  }
  if (token) {
    handleToken(token);
    return;
  }

  // Prefill order ID from URL params (e.g. from My Orders page)
  const oid = params.get("oid");
  if (oid && $("lookupOrderId")) {
    $("lookupOrderId").value = oid;
  }
});

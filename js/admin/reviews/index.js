// js/admin/reviews/index.js
import { initAdminNav } from "../../shared/adminNav.js";
import { initFooter } from "../../shared/footer.js";
import {
  fetchSettings, updateSettings,
  fetchReviews, updateReview, deleteReview, insertReview,
  fetchCoupons,
} from "./api.js";

/* ── Helpers ── */
const $ = (id) => document.getElementById(id);

function starsText(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function statusBadge(status) {
  const cls = status === "approved" ? "status-approved"
    : status === "rejected" ? "status-rejected"
    : "status-pending";
  return `<span class="${cls} text-[10px] font-bold uppercase px-2 py-0.5 rounded-full">${status}</span>`;
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ── Settings Panel ── */
async function loadSettings() {
  try {
    const s = await fetchSettings();
    $("setCouponEnabled").value = String(s.coupon_enabled);
    $("setDiscountValue").value = s.default_discount_value;
    $("setDiscountType").value = s.default_discount_type;
    $("setCouponPrefix").value = s.coupon_prefix || "";
    $("setExpiryDays").value = s.coupon_expiry_days;
    $("setSingleUse").value = String(s.single_use);
    $("setAutoApprove").value = String(s.auto_approve);
  } catch (err) {
    console.error("[admin reviews] load settings error:", err);
    showSettingsMsg("Failed to load settings", true);
  }
}

async function saveSettings() {
  const btn = $("btnSaveSettings");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    await updateSettings({
      coupon_enabled: $("setCouponEnabled").value === "true",
      default_discount_value: parseFloat($("setDiscountValue").value) || 5,
      default_discount_type: $("setDiscountType").value,
      coupon_prefix: $("setCouponPrefix").value.trim().toUpperCase() || "THANKS",
      coupon_expiry_days: parseInt($("setExpiryDays").value) || 30,
      single_use: $("setSingleUse").value === "true",
      auto_approve: $("setAutoApprove").value === "true",
    });
    showSettingsMsg("Settings saved!", false);
  } catch (err) {
    console.error("[admin reviews] save settings error:", err);
    showSettingsMsg("Error saving settings: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Settings";
  }
}

function showSettingsMsg(msg, isError) {
  const el = $("settingsMsg");
  el.textContent = msg;
  el.className = `mt-3 text-xs font-bold ${isError ? "text-red-600" : "text-green-600"}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}

/* ── Reviews Table ── */
let allReviews = [];

async function loadReviews() {
  const filter = $("filterStatus").value || null;
  try {
    allReviews = await fetchReviews(filter);
    $("reviewCount").textContent = allReviews.length;
    renderReviewRows();
  } catch (err) {
    console.error("[admin reviews] load reviews error:", err);
    $("reviewRows").innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-500 text-sm">Error loading reviews</td></tr>`;
  }
}

function renderReviewRows() {
  const tbody = $("reviewRows");

  if (!allReviews.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400 text-sm">No reviews found</td></tr>`;
    return;
  }

  tbody.innerHTML = allReviews.map((r) => `
    <tr class="review-row border-b border-gray-100 cursor-pointer" data-id="${r.id}">
      <td class="py-2 px-2 text-xs font-medium max-w-[120px] truncate">${escHtml(r.product_name || r.product_id)}</td>
      <td class="py-2 px-2 text-xs">${escHtml(r.reviewer_name || "—")}</td>
      <td class="py-2 px-2 text-xs text-yellow-500 whitespace-nowrap">${starsText(r.rating)}</td>
      <td class="py-2 px-2 text-xs max-w-[140px] truncate hidden sm:table-cell">${escHtml(r.title || "—")}</td>
      <td class="py-2 px-2">${statusBadge(r.status)}</td>
      <td class="py-2 px-2 text-[10px] text-gray-400 whitespace-nowrap">${new Date(r.created_at).toLocaleDateString()}</td>
      <td class="py-2 px-2 text-right">
        <div class="row-actions flex gap-1 justify-end">
          ${r.status !== "approved" ? `<button class="btn-approve text-[10px] px-2 py-1 bg-green-100 text-green-700 font-bold uppercase hover:bg-green-200" data-id="${r.id}">✓</button>` : ""}
          ${r.status !== "rejected" ? `<button class="btn-reject text-[10px] px-2 py-1 bg-red-100 text-red-700 font-bold uppercase hover:bg-red-200" data-id="${r.id}">✕</button>` : ""}
          <button class="btn-edit text-[10px] px-2 py-1 bg-gray-100 text-gray-700 font-bold uppercase hover:bg-gray-200" data-id="${r.id}">✎</button>
        </div>
      </td>
    </tr>
  `).join("");

  // Bind quick actions
  tbody.querySelectorAll(".btn-approve").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      quickStatus(btn.dataset.id, "approved");
    });
  });
  tbody.querySelectorAll(".btn-reject").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      quickStatus(btn.dataset.id, "rejected");
    });
  });
  tbody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openModal(btn.dataset.id);
    });
  });
  // Row click opens modal
  tbody.querySelectorAll(".review-row").forEach((row) => {
    row.addEventListener("click", () => openModal(row.dataset.id));
  });
}

async function quickStatus(id, status) {
  try {
    await updateReview(id, { status });
    await loadReviews();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

/* ── Coupons Table ── */
async function loadCoupons() {
  try {
    const coupons = await fetchCoupons();
    $("couponCount").textContent = coupons.length;
    const tbody = $("couponRows");

    if (!coupons.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-gray-400 text-sm">No coupons yet</td></tr>`;
      return;
    }

    tbody.innerHTML = coupons.map((c) => `
      <tr class="border-b border-gray-100">
        <td class="py-2 px-2 text-xs font-mono font-bold">${escHtml(c.code)}</td>
        <td class="py-2 px-2 text-xs">${escHtml(c.reviewer_email || "—")}</td>
        <td class="py-2 px-2 text-xs">${c.discount_type === "percentage" ? c.discount_value + "%" : "$" + c.discount_value}</td>
        <td class="py-2 px-2 text-[10px] text-gray-400">${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—"}</td>
        <td class="py-2 px-2">
          ${c.used_at
            ? `<span class="text-[10px] font-bold text-red-500 uppercase">Used ${new Date(c.used_at).toLocaleDateString()}</span>`
            : `<span class="text-[10px] font-bold text-green-600 uppercase">Active</span>`}
        </td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("[admin reviews] load coupons error:", err);
  }
}

/* ── Modal ── */
let editingId = null;

function openModal(id) {
  const review = id ? allReviews.find((r) => String(r.id) === String(id)) : null;
  editingId = review?.id || null;

  $("reviewModalTitle").textContent = review ? "Edit Review" : "Add Review";
  $("mProductName").value = review?.product_name || "";
  $("mReviewerName").value = review?.reviewer_name || "";
  $("mReviewerEmail").value = review?.reviewer_email || "";
  $("mReviewerEmail").readOnly = !!review;
  $("mRating").value = review?.rating || 5;
  $("mTitle").value = review?.title || "";
  $("mBody").value = review?.body || "";
  $("mPhotoUrl").value = review?.photo_url || "";
  $("mStatus").value = review?.status || "approved";

  $("btnDeleteReview").classList.toggle("hidden", !review);
  $("reviewModal").classList.remove("hidden");
}

function closeModal() {
  $("reviewModal").classList.add("hidden");
  editingId = null;
}

async function saveModal() {
  const payload = {
    product_name: $("mProductName").value.trim(),
    reviewer_name: $("mReviewerName").value.trim() || null,
    reviewer_email: $("mReviewerEmail").value.trim() || null,
    rating: parseInt($("mRating").value) || 5,
    title: $("mTitle").value.trim() || null,
    body: $("mBody").value.trim(),
    photo_url: $("mPhotoUrl").value.trim() || null,
    status: $("mStatus").value,
  };

  if (!payload.body) {
    alert("Review body is required.");
    return;
  }

  const btn = $("btnSaveReview");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    if (editingId) {
      await updateReview(editingId, payload);
    } else {
      // Admin-created review — no order_session_id required
      await insertReview({ ...payload, product_id: null, order_session_id: null });
    }
    closeModal();
    await loadReviews();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

async function deleteModal() {
  if (!editingId) return;
  if (!confirm("Delete this review permanently?")) return;

  try {
    await deleteReview(editingId);
    closeModal();
    await loadReviews();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initAdminNav("Reviews");
  initFooter();

  // Settings
  $("btnSaveSettings").addEventListener("click", saveSettings);

  // Filter
  $("filterStatus").addEventListener("change", loadReviews);

  // Add review button
  $("btnAddReview").addEventListener("click", () => openModal(null));

  // Modal
  $("btnCloseReviewModal").addEventListener("click", closeModal);
  $("reviewModalOverlay").addEventListener("click", closeModal);
  $("btnSaveReview").addEventListener("click", saveModal);
  $("btnDeleteReview").addEventListener("click", deleteModal);

  // Load all
  await Promise.all([loadSettings(), loadReviews(), loadCoupons()]);
});

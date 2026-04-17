// js/admin/reviews/index.js
import { initAdminNav } from "../../shared/adminNav.js";
import { initFooter } from "../../shared/footer.js";
import {
  fetchSettings, updateSettings,
  fetchReviews, updateReview, deleteReview, insertReview,
  fetchCoupons, fetchProducts,
} from "./api.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

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

/* ── Analytics ── */
async function loadAnalytics() {
  try {
    // Fetch ALL reviews (unfiltered) for analytics
    const allForStats = await fetchReviews(null);
    const coupons = await fetchCoupons();

    const total = allForStats.length;
    const approved = allForStats.filter((r) => r.status === "approved").length;
    const pending = allForStats.filter((r) => r.status === "pending").length;
    const sum = allForStats.reduce((s, r) => s + Number(r.rating || 0), 0);
    const avg = total ? (sum / total).toFixed(1) : "—";
    const issued = coupons.length;
    const redeemed = coupons.filter((c) => c.used_at).length;

    $("anTotal").textContent = total;
    $("anAvg").textContent = avg;
    $("anApproved").textContent = approved;
    $("anPending").textContent = pending;
    $("anCoupons").textContent = issued;
    $("anRedeemed").textContent = redeemed;
  } catch (err) {
    console.error("[admin reviews] analytics error:", err);
  }
}

/* ── Reviews Table ── */
let allReviews = [];
let allProducts = [];    // cached for dropdown + slug lookup
let productMap = {};     // code → { name, slug }

async function loadReviews() {
  const filter = $("filterStatus").value || null;
  try {
    allReviews = await fetchReviews(filter);
    $("reviewCount").textContent = allReviews.length;
    renderReviewRows();
  } catch (err) {
    console.error("[admin reviews] load reviews error:", err);
    $("reviewRows").innerHTML = `<tr><td colspan="8" class="text-center py-8 text-red-500 text-sm">Error loading reviews</td></tr>`;
  }
}

function renderReviewRows() {
  const tbody = $("reviewRows");

  if (!allReviews.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400 text-sm">No reviews found</td></tr>`;
    return;
  }

  tbody.innerHTML = allReviews.map((r) => {
    // Product link — link to storefront product page if slug exists
    const prod = productMap[r.product_id];
    const displayName = escHtml(r.product_name || r.product_id || "—");
    const productCell = prod?.slug
      ? `<a href="/pages/product.html?slug=${encodeURIComponent(prod.slug)}" target="_blank" class="text-blue-600 hover:underline" title="View product page">${displayName}</a>`
      : r.product_id
        ? `<span title="${escHtml(r.product_id)}">${displayName}</span>`
        : displayName;

    // Order link — only link real Stripe sessions (cs_*); show label for legacy
    const sid = r.order_session_id || "";
    const isStripe = sid.startsWith("cs_");
    const orderCell = isStripe
      ? `<a href="/pages/admin/lineItemsOrders.html?q=${encodeURIComponent(sid)}" target="_blank" class="text-blue-600 hover:underline text-[10px]" title="View order in admin">🔗 Order</a>`
      : sid
        ? `<span class="text-gray-400 text-[10px] truncate max-w-[80px] inline-block" title="${escHtml(sid)}">${escHtml(sid)}</span>`
        : `<span class="text-gray-300 text-[10px]">—</span>`;

    return `
    <tr class="review-row border-b border-gray-100 cursor-pointer" data-id="${r.id}">
      <td class="py-2 px-2 text-xs font-medium max-w-[120px] truncate">${productCell}</td>
      <td class="py-2 px-2 text-xs">${escHtml(r.reviewer_name || "—")}</td>
      <td class="py-2 px-2 text-xs text-yellow-500 whitespace-nowrap">${starsText(r.rating)}</td>
      <td class="py-2 px-2 text-xs max-w-[140px] truncate hidden sm:table-cell">${escHtml(r.title || "—")}</td>
      <td class="py-2 px-2">${statusBadge(r.status)}</td>
      <td class="py-2 px-2 text-[10px] text-gray-400 whitespace-nowrap">${new Date(r.created_at).toLocaleDateString()}</td>
      <td class="py-2 px-2 text-center">${orderCell}</td>
      <td class="py-2 px-2 text-right">
        <div class="row-actions flex gap-1 justify-end">
          ${r.status !== "approved" ? `<button class="btn-approve text-[10px] px-2 py-1 bg-green-100 text-green-700 font-bold uppercase hover:bg-green-200" data-id="${r.id}">✓</button>` : ""}
          ${r.status !== "rejected" ? `<button class="btn-reject text-[10px] px-2 py-1 bg-red-100 text-red-700 font-bold uppercase hover:bg-red-200" data-id="${r.id}">✕</button>` : ""}
          <button class="btn-edit text-[10px] px-2 py-1 bg-gray-100 text-gray-700 font-bold uppercase hover:bg-gray-200" data-id="${r.id}">✎</button>
        </div>
      </td>
    </tr>`;
  }).join("");

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
  // Prevent link clicks from triggering row click
  tbody.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", (e) => e.stopPropagation());
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
let productSortBy = "name"; // "name" or "code"

function openModal(id) {
  const review = id ? allReviews.find((r) => String(r.id) === String(id)) : null;
  editingId = review?.id || null;

  $("reviewModalTitle").textContent = review ? "Edit Review" : "Add Review";

  // Populate product dropdown (sorted)
  populateProductDropdown();

  // Pre-select matching product (or add a custom option for discontinued codes)
  if (review?.product_id) {
    const sel = $("mProduct");
    const match = allProducts.find((p) => p.code === review.product_id);
    if (match) {
      sel.value = review.product_id;
    } else {
      // Discontinued product — add a temporary option
      const opt = document.createElement("option");
      opt.value = review.product_id;
      opt.textContent = `${review.product_name || review.product_id} (${review.product_id}) [discontinued]`;
      opt.dataset.name = review.product_name || review.product_id;
      sel.prepend(opt);
      sel.value = review.product_id;
    }
  }

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

function populateProductDropdown(preserveValue) {
  const sel = $("mProduct");
  const curVal = preserveValue || sel.value;
  const sorted = [...allProducts].sort((a, b) =>
    productSortBy === "code"
      ? a.code.localeCompare(b.code)
      : a.name.localeCompare(b.name)
  );
  const label = productSortBy === "code" ? "Code ↓" : "Name ↓";
  $("btnToggleProductSort").textContent = `Sort: ${label}`;

  sel.innerHTML = `<option value="">— Select a product —</option>` +
    sorted.map((p) => {
      const display = productSortBy === "code"
        ? `${escHtml(p.code)} — ${escHtml(p.name)}`
        : `${escHtml(p.name)} (${escHtml(p.code)})`;
      return `<option value="${escHtml(p.code)}" data-name="${escHtml(p.name)}">${display}</option>`;
    }).join("");

  if (curVal) sel.value = curVal;
}

function closeModal() {
  $("reviewModal").classList.add("hidden");
  editingId = null;
}

async function saveModal() {
  const sel = $("mProduct");
  const selectedCode = sel.value;
  const selectedOpt = sel.selectedOptions[0];
  const productName = selectedOpt?.dataset?.name || selectedOpt?.textContent || "";

  const payload = {
    product_id: selectedCode || null,
    product_name: productName || null,
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
      await insertReview({ ...payload, order_session_id: null });
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

/* ── SMS Review Requests ── */
async function sendReviewRequests() {
  const btn = $("btnSendReviewRequests");
  const msg = $("reviewRequestMsg");
  btn.disabled = true;
  btn.textContent = "Sending…";
  msg.classList.add("hidden");

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-review-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${(await getSupabaseClient().auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ batch: true }),
    });

    const data = await res.json();

    msg.classList.remove("hidden");
    if (data.success) {
      msg.textContent = `Done! Sent ${data.sent} review requests (${data.skipped || 0} skipped).`;
      msg.className = "text-xs font-bold text-green-600 mt-3";
    } else {
      msg.textContent = data.error || "Failed to send requests.";
      msg.className = "text-xs font-bold text-red-600 mt-3";
    }

    loadReviewRequestStats();
  } catch (err) {
    console.error("[admin reviews] send requests error:", err);
    msg.classList.remove("hidden");
    msg.textContent = "Network error.";
    msg.className = "text-xs font-bold text-red-600 mt-3";
  } finally {
    btn.disabled = false;
    btn.textContent = "📱 Send Review Requests";
  }
}

async function loadReviewRequestStats() {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from("review_requests")
      .select("order_session_id, product_id, phone, status, sent_at, clicked_at, reviewed_at")
      .order("sent_at", { ascending: false });

    if (error) throw error;
    if (!data?.length) return;

    const counts = { sent: 0, clicked: 0, completed: 0 };
    for (const row of data) {
      if (counts[row.status] !== undefined) counts[row.status]++;
    }

    $("rrTotal").textContent = data.length;
    $("rrSent").textContent = counts.sent;
    $("rrClicked").textContent = counts.clicked;
    $("rrCompleted").textContent = counts.completed;
    $("reviewRequestStats")?.classList.remove("hidden");

    // Fetch customer names from orders_raw for the log table
    const orderIds = [...new Set(data.map(r => r.order_session_id))];
    const { data: orders } = await sb
      .from("orders_raw")
      .select("stripe_checkout_session_id, first_name, last_name")
      .in("stripe_checkout_session_id", orderIds);

    const orderNameMap = {};
    for (const o of orders || []) {
      orderNameMap[o.stripe_checkout_session_id] = [o.first_name, o.last_name].filter(Boolean).join(" ") || "—";
    }

    // Render log table
    const tbody = $("rrLogRows");
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : "—";
    const maskPhone = (p) => p ? p.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2") : "—";

    const statusCls = { sent: "bg-green-100 text-green-700", clicked: "bg-blue-100 text-blue-700", completed: "bg-purple-100 text-purple-700", failed: "bg-red-100 text-red-700", expired: "bg-gray-100 text-gray-500" };

    tbody.innerHTML = data.map(r => {
      const name = orderNameMap[r.order_session_id] || "—";
      const prod = productMap[r.product_id];
      const prodName = prod?.name || r.product_id?.slice(0, 8) || "—";
      const cls = statusCls[r.status] || "bg-gray-100 text-gray-600";

      return `<tr class="border-b border-gray-100 hover:bg-gray-50">
        <td class="py-2 px-2 text-xs font-medium">${escHtml(name)}</td>
        <td class="py-2 px-2 text-xs text-gray-500 font-mono">${maskPhone(r.phone)}</td>
        <td class="py-2 px-2 text-xs max-w-[120px] truncate" title="${escHtml(prod?.name || "")}">${escHtml(prodName)}</td>
        <td class="py-2 px-2"><span class="${cls} text-[10px] font-bold uppercase px-2 py-0.5 rounded-full">${r.status}</span></td>
        <td class="py-2 px-2 text-[10px] text-gray-400">${fmtDate(r.sent_at)}</td>
        <td class="py-2 px-2 text-[10px] text-gray-400 hidden sm:table-cell">${fmtDate(r.clicked_at)}</td>
        <td class="py-2 px-2 text-[10px] text-gray-400 hidden sm:table-cell">${fmtDate(r.reviewed_at)}</td>
      </tr>`;
    }).join("");

    $("rrLogSection")?.classList.remove("hidden");
  } catch (err) {
    console.warn("[admin reviews] review request stats error:", err);
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

  // Product sort toggle
  $("btnToggleProductSort").addEventListener("click", () => {
    productSortBy = productSortBy === "name" ? "code" : "name";
    populateProductDropdown($("mProduct").value);
  });

  // Load all
  allProducts = await fetchProducts();
  productMap = Object.fromEntries(allProducts.map((p) => [p.code, p]));
  await Promise.all([loadSettings(), loadReviews(), loadCoupons(), loadAnalytics(), loadReviewRequestStats()]);

  // SMS review requests
  $("btnSendReviewRequests")?.addEventListener("click", sendReviewRequests);
});

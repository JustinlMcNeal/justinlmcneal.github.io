// js/my-orders/index.js
// Customer order lookup — email + name verification
import { initNavbar } from "/js/shared/navbar.js";
import { initFooter } from "/js/shared/footer.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const LOOKUP_URL = `${SUPABASE_URL}/functions/v1/lookup-orders`;

/* ── State ── */
let lookupData = null; // full response from lookup-orders

/* ── Helpers ── */
const $ = (id) => document.getElementById(id);
const hide = (el) => el?.classList.add("hidden");
const show = (el) => el?.classList.remove("hidden");

function showError(msg) {
  const el = $("lookupError");
  if (!el) return;
  el.textContent = msg;
  show(el);
}
function hideError() { hide($("lookupError")); }

function cents(n) {
  return "$" + (Math.abs(n || 0) / 100).toFixed(2);
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ── Lookup ── */
async function lookupOrders() {
  const email = $("lookupEmail").value.trim();
  const name = $("lookupName").value.trim();
  hideError();

  if (!email || !name) {
    showError("Please enter both your email and first name.");
    return;
  }

  const btn = $("btnLookup");
  btn.disabled = true;
  btn.textContent = "Looking up…";

  try {
    const res = await fetch(LOOKUP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, first_name: name }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      showError(data.error || "No orders found.");
      return;
    }

    lookupData = data;
    renderOrdersList(data);
  } catch (err) {
    console.error("[my-orders] lookup error:", err);
    showError("Network error. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Find My Orders";
  }
}

/* ── Render Orders List ── */
function renderOrdersList(data) {
  $("customerName").textContent = data.customer_name || "there";

  const list = $("ordersList");
  list.innerHTML = "";

  if (!data.orders?.length) {
    list.innerHTML = `<p class="text-sm text-gray-500 py-4 text-center">No orders found.</p>`;
    show($("resultsSection"));
    return;
  }

  data.orders.forEach((order) => {
    const itemNames = order.items
      .slice(0, 3)
      .map((i) => escHtml(i.product_name || i.product_id))
      .join(", ");
    const moreCount = order.items.length > 3 ? ` +${order.items.length - 3} more` : "";

    const reviewedCount = order.items.filter((i) => i.already_reviewed).length;
    const hasReviews = reviewedCount > 0;

    const card = document.createElement("div");
    card.className =
      "order-card border-2 border-black p-4 cursor-pointer hover:shadow-md transition-all";

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-black text-sm">${escHtml(order.kk_order_id)}</span>
            ${hasReviews ? `<span class="text-[9px] font-bold text-green-600 uppercase bg-green-50 px-1.5 py-0.5 rounded">✓ ${reviewedCount} reviewed</span>` : ""}
          </div>
          <div class="text-xs text-gray-500">${formatDate(order.order_date)}</div>
          <div class="text-xs text-gray-600 mt-1 truncate">${itemNames}${moreCount}</div>
        </div>
        <div class="text-right flex-shrink-0">
          <div class="font-black text-sm">${cents(order.total_paid_cents)}</div>
          <div class="text-[10px] text-gray-400">${order.total_items || order.items.length} item${(order.total_items || order.items.length) !== 1 ? "s" : ""}</div>
        </div>
      </div>
      <div class="mt-2 text-[10px] text-kkpink font-bold uppercase text-right">View Details →</div>
    `;

    card.addEventListener("click", () => showOrderDetail(order));
    list.appendChild(card);
  });

  show($("resultsSection"));
  hide($("orderDetailSection"));
  $("resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── Show Order Detail ── */
function showOrderDetail(order) {
  $("detailOrderId").textContent = order.kk_order_id;
  $("detailOrderDate").textContent = formatDate(order.order_date);
  $("detailTotal").textContent = cents(order.total_paid_cents);

  // Render items
  const itemsList = $("detailItemsList");
  itemsList.innerHTML = order.items
    .map(
      (item) => `
    <div class="flex items-center gap-3 p-3 border-2 ${item.already_reviewed ? "border-green-200 bg-green-50/30" : "border-gray-200"}">
      <div class="w-12 h-12 border-2 border-black bg-gray-100 flex-shrink-0 overflow-hidden">
        ${item.image_url
          ? `<img src="${escHtml(item.image_url)}" class="w-full h-full object-cover" />`
          : `<div class="w-full h-full flex items-center justify-center text-gray-400 text-xs">📦</div>`}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-bold text-sm truncate">${escHtml(item.product_name || item.product_id || "Unknown")}</div>
        ${item.variant ? `<div class="text-[10px] text-gray-500">${escHtml(item.variant)}</div>` : ""}
        <div class="text-[10px] text-gray-400">Qty: ${item.quantity}</div>
      </div>
      <div class="text-right flex-shrink-0">
        ${item.already_reviewed
          ? `<div class="text-[10px] font-bold text-green-600 uppercase">✓ Reviewed</div>`
          : `<div class="text-[10px] font-bold text-kkpink uppercase">Not reviewed</div>`}
      </div>
    </div>
  `
    )
    .join("");

  // Coupon recovery — show coupons for reviewed items
  const reviewedWithCoupon = order.items.filter(
    (i) => i.already_reviewed && i.coupon_code
  );

  if (reviewedWithCoupon.length) {
    const couponList = $("couponRecoveryList");
    couponList.innerHTML = reviewedWithCoupon
      .map(
        (item) => `
      <div class="flex items-center justify-between gap-2 bg-green-50 border border-green-200 p-3 rounded">
        <div class="min-w-0">
          <div class="text-xs font-bold truncate">${escHtml(item.product_name)}</div>
          <div class="text-[10px] text-gray-500">Review reward coupon</div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="font-mono font-black text-sm bg-white border-2 border-green-400 px-2 py-1">${escHtml(item.coupon_code)}</span>
          <button class="btn-copy-coupon border border-black px-2 py-1 text-[10px] font-bold uppercase hover:bg-black hover:text-white transition-colors"
            data-code="${escHtml(item.coupon_code)}">
            📋
          </button>
        </div>
      </div>
    `
      )
      .join("");
    show($("couponRecoverySection"));

    // Bind copy buttons
    couponList.querySelectorAll(".btn-copy-coupon").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const code = btn.dataset.code;
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = "✓";
          setTimeout(() => (btn.textContent = "📋"), 2000);
        });
      });
    });
  } else {
    hide($("couponRecoverySection"));
  }

  // Set the review link to include order ID
  const reviewLink = $("btnLeaveReview");
  if (reviewLink) {
    reviewLink.href = `/pages/leave-review.html?oid=${encodeURIComponent(order.kk_order_id)}`;
  }

  hide($("resultsSection"));
  show($("orderDetailSection"));
  $("orderDetailSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── Back to List ── */
function backToList() {
  hide($("orderDetailSection"));
  show($("resultsSection"));
  $("resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── New Search ── */
function newSearch() {
  lookupData = null;
  hide($("resultsSection"));
  hide($("orderDetailSection"));
  $("lookupEmail").value = "";
  $("lookupName").value = "";
  $("lookupSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", async () => {
  await initNavbar();
  initFooter();

  $("btnLookup")?.addEventListener("click", lookupOrders);
  $("btnNewSearch")?.addEventListener("click", newSearch);
  $("btnBackToList")?.addEventListener("click", backToList);

  // Enter key triggers lookup
  $("lookupEmail")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") lookupOrders();
  });
  $("lookupName")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") lookupOrders();
  });
});

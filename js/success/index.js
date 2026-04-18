// /js/success/index.js
import { initNavbar } from "/js/shared/navbar.js";
import { initFooter } from "/js/shared/footer.js";
import { clearCart } from "/js/shared/cartStore.js";
import { removeCoupon } from "/js/shared/couponManager.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

/* ── Confetti ── */
function spawnConfetti() {
  const container = document.getElementById("confettiContainer");
  if (!container) return;

  const colors = ["#f58f86", "#f6dcc6", "#FFD700", "#FF69B4", "#87CEEB", "#98FB98"];
  const count = 40;

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 1.5}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    piece.style.width = `${6 + Math.random() * 8}px`;
    piece.style.height = `${6 + Math.random() * 8}px`;
    container.appendChild(piece);
  }

  setTimeout(() => container.innerHTML = "", 5000);
}

/* ── Order ID from URL ── */
function getOrderId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("oid") || null;
}

function showOrderId(oid) {
  if (!oid) return;
  const el = document.getElementById("orderId");
  const wrap = document.getElementById("orderIdWrap");
  if (el) el.textContent = oid;
  if (wrap) wrap.classList.remove("hidden");
}

/* ── Helpers ── */
function cents(n) {
  return "$" + (Math.abs(n || 0) / 100).toFixed(2);
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ── Fetch & Display Order Details ── */
async function loadOrderDetails(oid) {
  if (!oid) return;

  try {
    const sb = getSupabaseClient();

    // Fetch order
    const { data: order, error: orderErr } = await sb
      .from("orders_raw")
      .select("*")
      .eq("kk_order_id", oid)
      .single();

    if (orderErr || !order) {
      console.warn("[success] could not load order:", orderErr);
      return;
    }

    // Fetch line items
    const { data: items } = await sb
      .from("line_items_raw")
      .select("product_name, variant, quantity, unit_price_cents, post_discount_unit_price_cents")
      .eq("stripe_checkout_session_id", order.stripe_checkout_session_id);

    // Render items
    const itemsList = document.getElementById("orderItemsList");
    if (items?.length && itemsList) {
      itemsList.innerHTML = items.map((item) => `
        <div class="flex justify-between items-start gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-bold truncate">${escHtml(item.product_name)}</div>
            ${item.variant ? `<div class="text-[10px] text-gray-500">${escHtml(item.variant)}</div>` : ""}
            <div class="text-[10px] text-gray-400">Qty: ${item.quantity}</div>
          </div>
          <div class="text-sm font-bold whitespace-nowrap">
            ${cents((item.post_discount_unit_price_cents || item.unit_price_cents) * item.quantity)}
          </div>
        </div>
      `).join("");
    }

    // Render totals
    const subtotalEl = document.getElementById("orderSubtotal");
    const taxEl = document.getElementById("orderTax");
    const shippingEl = document.getElementById("orderShipping");
    const totalEl = document.getElementById("orderTotal");
    const savingsRow = document.getElementById("orderSavingsRow");
    const savingsEl = document.getElementById("orderSavings");

    if (subtotalEl) subtotalEl.textContent = cents(order.subtotal_paid_cents || order.subtotal_original_cents);
    if (taxEl) taxEl.textContent = cents(order.tax_cents);
    if (shippingEl) shippingEl.textContent = order.shipping_paid_cents ? cents(order.shipping_paid_cents) : "Free";
    if (totalEl) totalEl.textContent = cents(order.total_paid_cents);

    // Meta Pixel: Purchase
    if (typeof fbq === "function") {
      fbq("track", "Purchase", {
        content_type: "product",
        value: (order.total_paid_cents || 0) / 100,
        currency: "USD",
      });
    }

    if (order.order_savings_total_cents > 0 && savingsRow && savingsEl) {
      savingsEl.textContent = "-" + cents(order.order_savings_total_cents);
      savingsRow.classList.remove("hidden");
    }

    // Shipping address
    if (order.street_address || order.city) {
      const block = document.getElementById("shippingAddressBlock");
      const addrEl = document.getElementById("shippingAddress");
      if (block && addrEl) {
        const parts = [
          [order.first_name, order.last_name].filter(Boolean).join(" "),
          order.street_address,
          [order.city, order.state, order.zip].filter(Boolean).join(", "),
          order.country && order.country !== "US" ? order.country : null,
        ].filter(Boolean);
        addrEl.innerHTML = parts.map(p => escHtml(p)).join("<br>");
        block.classList.remove("hidden");
      }
    }

    // Show the section
    const section = document.getElementById("orderDetailsSection");
    if (section) section.classList.remove("hidden");

    return order;

  } catch (err) {
    console.error("[success] error loading order details:", err);
    return null;
  }
}

/* ── SMS Opt-in ── */

function formatPhoneDisplay(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const d = digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}

async function initSmsOptin(order) {
  const card = document.getElementById("smsOptinCard");
  const phoneInput = document.getElementById("smsOptinPhone");
  const consentBox = document.getElementById("smsOptinConsent");
  const btn = document.getElementById("smsOptinBtn");
  const statusEl = document.getElementById("smsOptinStatus");
  if (!card || !phoneInput || !consentBox || !btn || !statusEl) return;

  // Pre-fill phone from order
  const orderPhone = order?.phone_number || "";
  if (orderPhone) {
    phoneInput.value = formatPhoneDisplay(orderPhone);
  }

  // Check if already subscribed
  if (orderPhone) {
    try {
      const sb = getSupabaseClient();
      const digits = orderPhone.replace(/\D/g, "");
      const e164 = digits.length === 10 ? `+1${digits}` : digits.startsWith("1") && digits.length === 11 ? `+${digits}` : null;
      if (e164) {
        const { data: contact } = await sb
          .from("customer_contacts")
          .select("status")
          .eq("phone", e164)
          .maybeSingle();
        if (contact?.status === "active") {
          // Already opted in — don't show the card
          return;
        }
      }
    } catch (_) { /* show card anyway */ }
  }

  // Show the card
  card.classList.remove("hidden");

  // Enable button when consent is checked + phone has value
  function updateBtn() {
    btn.disabled = !(consentBox.checked && phoneInput.value.trim().length >= 10);
  }
  consentBox.addEventListener("change", updateBtn);
  phoneInput.addEventListener("input", updateBtn);
  updateBtn();

  // Handle submit
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Sending…";
    statusEl.classList.add("hidden");

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          phone: phoneInput.value.trim(),
          email: order?.email || "",
          consent_text: "By checking this box, you agree to receive recurring automated marketing texts from Karry Kraze at the number provided. Consent is not a condition of purchase. Msg & data rates may apply. Reply STOP to unsubscribe.",
          page_url: window.location.href,
          user_agent: navigator.userAgent,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      // Success state
      const couponCode = data.coupon_code || "";
      statusEl.innerHTML = couponCode
        ? `<span class="text-green-600 font-bold">You're in! 🎉 Use code <span class="bg-green-100 px-2 py-0.5 rounded font-black">${couponCode}</span> for 15% off!</span>`
        : `<span class="text-green-600 font-bold">You're in! 🎉 Check your texts for your coupon.</span>`;
      statusEl.classList.remove("hidden");

      // Hide the form, keep the status visible
      phoneInput.closest(".mt-3").classList.add("hidden");
      consentBox.closest("label").classList.add("hidden");
      btn.classList.add("hidden");
    } catch (err) {
      statusEl.innerHTML = `<span class="text-red-500">${err.message}</span>`;
      statusEl.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Yes, Text Me Deals! 🎉";
    }
  });
}

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", async () => {
  clearCart();
  removeCoupon();

  await initNavbar();

  const oid = getOrderId();
  showOrderId(oid);
  spawnConfetti();
  const order = await loadOrderDetails(oid);

  // SMS opt-in (uses order phone/email)
  initSmsOptin(order);

  await initFooter();
});

// /js/sms-signup/index.js
import { initNavbar } from "/js/shared/navbar.js";
import { initFooter } from "/js/shared/footer.js";
import { SUPABASE_URL } from "/js/config/env.js";

const SUBSCRIBE_URL = `${SUPABASE_URL}/functions/v1/sms-subscribe`;

const $ = (id) => document.getElementById(id);
const hide = (el) => el?.classList.add("hidden");
const show = (el) => el?.classList.remove("hidden");

// ── Phone formatting ────────────────────────────────────────

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function stripPhone(formatted) {
  return formatted.replace(/\D/g, "");
}

// ── Validation ──────────────────────────────────────────────

function validateForm() {
  const digits = stripPhone($("phone").value);
  const consent = $("consent").checked;
  let valid = true;

  if (!digits || digits.length !== 10 || !/^[2-9]/.test(digits)) {
    show($("phoneError"));
    $("phoneError").textContent = "Enter a valid 10-digit US phone number.";
    $("phone").parentElement.classList.add("shake", "border-red-400");
    setTimeout(() => $("phone").parentElement.classList.remove("shake"), 400);
    valid = false;
  } else {
    hide($("phoneError"));
    $("phone").parentElement.classList.remove("border-red-400");
  }

  if (!consent) {
    $("consent").parentElement.classList.add("shake");
    setTimeout(() => $("consent").parentElement.classList.remove("shake"), 400);
    valid = false;
  }

  return valid;
}

// ── Submit ──────────────────────────────────────────────────

let submitting = false;

async function handleSubmit() {
  if (submitting) return;
  if (!validateForm()) return;

  const btn = $("btnSubmit");
  submitting = true;
  btn.disabled = true;
  btn.textContent = "Sending…";
  hide($("formError"));

  const phone = "+1" + stripPhone($("phone").value);
  const email = $("email").value.trim() || null;
  const consentText = $("consentText").textContent.trim();

  try {
    const resp = await fetch(SUBSCRIBE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        email,
        consent_text: consentText,
        page_url: window.location.href,
        user_agent: navigator.userAgent,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    // Success
    $("couponDisplay").textContent = data.coupon_code;

    if (data.already_subscribed) {
      $("expiryNote").textContent = "You already have a coupon — use it before it expires!";
    }

    hide($("smsForm"));
    show($("smsSuccess"));

    // Remember subscription
    try { localStorage.setItem("kk_sms_subscribed", "1"); } catch (_) {}
  } catch (err) {
    show($("formError"));
    $("formError").textContent = err.message;
  } finally {
    submitting = false;
    btn.disabled = false;
    btn.textContent = "Get My Coupon";
  }
}

// ── Boot ────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await initNavbar();
  initFooter();

  // Phone formatting as user types
  $("phone").addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    const before = e.target.value.length;
    e.target.value = formatPhone(e.target.value);
    const after = e.target.value.length;
    e.target.setSelectionRange(pos + (after - before), pos + (after - before));
  });

  // Submit
  $("btnSubmit").addEventListener("click", handleSubmit);

  // Enter key on phone input
  $("phone").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });
});

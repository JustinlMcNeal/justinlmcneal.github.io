import { SUPABASE_ANON_KEY, SUPABASE_URL } from "/js/config/env.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { $, hide, show } from "./successDom.js";
import { formatPhoneDisplay, readJsonResponse, toUsE164 } from "./successUtils.js";

const SMS_CONSENT_TEXT = "By checking this box, you agree to receive recurring automated marketing texts from Karry Kraze at the number provided. Consent is not a condition of purchase. Msg & data rates may apply. Reply STOP to unsubscribe.";

export async function initSmsOptin(order) {
  const card = $("smsOptinCard");
  const phoneInput = $("smsOptinPhone");
  const consentBox = $("smsOptinConsent");
  const btn = $("smsOptinBtn");
  const statusEl = $("smsOptinStatus");
  if (!card || !phoneInput || !consentBox || !btn || !statusEl) return;
  if (card.dataset.successSmsBound === "true") return;
  card.dataset.successSmsBound = "true";

  const orderPhone = order?.phone_number || "";
  if (orderPhone) {
    phoneInput.value = formatPhoneDisplay(orderPhone);
  }

  if (orderPhone && await isAlreadySubscribed(orderPhone)) {
    return;
  }

  show(card);

  function updateBtn() {
    btn.disabled = !(consentBox.checked && phoneInput.value.trim().length >= 10);
  }

  consentBox.addEventListener("change", updateBtn);
  phoneInput.addEventListener("input", updateBtn);
  updateBtn();

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Sending…";
    hide(statusEl);

    try {
      const data = await subscribeSms(order, phoneInput.value.trim());
      renderSmsSuccess(statusEl, data);

      hide(phoneInput.closest(".mt-3"));
      hide(consentBox.closest("label"));
      hide(btn);
    } catch (err) {
      statusEl.innerHTML = `<span class="text-red-500">${err.message}</span>`;
      show(statusEl);
      btn.disabled = false;
      btn.textContent = "Yes, Text Me Deals! 🎉";
    }
  });
}

async function isAlreadySubscribed(phone) {
  try {
    const sb = getSupabaseClient();
    const e164 = toUsE164(phone);
    if (!e164) return false;

    const { data: contact } = await sb
      .from("customer_contacts")
      .select("status")
      .eq("phone", e164)
      .maybeSingle();

    return contact?.status === "active";
  } catch (_) {
    return false;
  }
}

async function subscribeSms(order, phone) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-subscribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      phone,
      email: order?.email || "",
      consent_text: SMS_CONSENT_TEXT,
      page_url: window.location.href,
      user_agent: navigator.userAgent,
    }),
  });

  const data = await readJsonResponse(res);

  if (!res.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

function renderSmsSuccess(statusEl, data) {
  const couponCode = data.coupon_code || "";
  statusEl.innerHTML = couponCode
    ? `<span class="text-green-600 font-bold">You're in! 🎉 Use code <span class="bg-green-100 px-2 py-0.5 rounded font-black">${couponCode}</span> for 15% off!</span>`
    : `<span class="text-green-600 font-bold">You're in! 🎉 Check your texts for your coupon.</span>`;
  show(statusEl);
}

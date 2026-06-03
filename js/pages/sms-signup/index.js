import { initFooter } from "/js/shared/footer.js";
import { initNavbar } from "/js/shared/navbar.js";
import { subscribeSms } from "./smsSignupApi.js";
import { trackSmsSignupSuccess } from "./smsSignupAnalytics.js";
import { getConsentText } from "./smsSignupConsent.js";
import { $ } from "./smsSignupDom.js";
import {
  isSubmitting,
  markPageInitialized,
  setSubmitting,
} from "./smsSignupState.js";
import {
  hideFormError,
  renderSignupSuccess,
  setLoadingState,
  showFormError,
} from "./smsSignupRender.js";
import { formatPhone, toUsE164FromNationalPhone } from "./smsSignupUtils.js";
import { validateForm } from "./smsSignupValidation.js";

async function initSmsSignupPage() {
  if (!markPageInitialized()) return;

  await initNavbar();
  initFooter();
  bindSmsSignupEvents();
}

function bindSmsSignupEvents() {
  const phone = $("phone");
  const btnSubmit = $("btnSubmit");

  phone?.addEventListener("input", handlePhoneInput);
  btnSubmit?.addEventListener("click", handleSubmit);
  phone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });
}

function handlePhoneInput(e) {
  const pos = e.target.selectionStart;
  const before = e.target.value.length;
  e.target.value = formatPhone(e.target.value);
  const after = e.target.value.length;
  e.target.setSelectionRange(pos + (after - before), pos + (after - before));
}

async function handleSubmit() {
  if (isSubmitting()) return;
  if (!validateForm()) return;

  setSubmitting(true);
  setLoadingState(true);
  hideFormError();

  try {
    const data = await subscribeSms(buildSubscribePayload());
    renderSignupSuccess(data);
    trackSmsSignupSuccess(data);
    rememberSubscription(data);
  } catch (err) {
    showFormError(err.message);
  } finally {
    setSubmitting(false);
    setLoadingState(false);
  }
}

function buildSubscribePayload() {
  return {
    phone: toUsE164FromNationalPhone($("phone")?.value || ""),
    email: $("email")?.value.trim() || null,
    consent_text: getConsentText(),
    page_url: window.location.href,
    user_agent: navigator.userAgent,
  };
}

function rememberSubscription(data) {
  try {
    localStorage.setItem("kk_sms_subscribed", "1");
    if (data.contact_id) localStorage.setItem("kk_sms_contact_id", data.contact_id);
  } catch (_) {}
}

document.addEventListener("DOMContentLoaded", initSmsSignupPage, { once: true });

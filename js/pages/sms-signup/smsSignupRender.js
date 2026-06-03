import { $, hide, setText, show } from "./smsSignupDom.js";
import { getCouponDisplayState } from "./smsSignupCoupon.js";

export function setLoadingState(isLoading) {
  const btn = $("btnSubmit");
  if (!btn) return;

  btn.disabled = Boolean(isLoading);
  btn.textContent = isLoading ? "Sending…" : "Get My Coupon";
}

export function hideFormError() {
  hide($("formError"));
}

export function showFormError(message) {
  const formError = $("formError");
  show(formError);
  setText(formError, message);
}

export function renderSignupSuccess(data) {
  const couponState = getCouponDisplayState(data);

  setText($("couponDisplay"), couponState.couponCode);
  if (couponState.expiryNote) {
    setText($("expiryNote"), couponState.expiryNote);
  }

  if (data.was_unsubscribed && !data.sms_sent) {
    renderRestartSmsNote();
  }

  hide($("smsForm"));
  show($("smsSuccess"));
}

function renderRestartSmsNote() {
  const expiryNote = $("expiryNote");
  if (!expiryNote) return;

  const startMsg = document.createElement("p");
  startMsg.className = "text-xs text-amber-600 font-medium mt-2";
  startMsg.textContent = "To receive texts again, text START to (888) 392-5295 first.";
  expiryNote.after(startMsg);
}

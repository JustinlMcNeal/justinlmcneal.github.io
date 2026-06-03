// DOM IDs used by pages/sms-signup.html.

export const SMS_SIGNUP_DOM_IDS = Object.freeze({
  phone: "phone",
  email: "email",
  consent: "consent",
  consentText: "consentText",
  btnSubmit: "btnSubmit",
  phoneError: "phoneError",
  formError: "formError",
  smsForm: "smsForm",
  smsSuccess: "smsSuccess",
  couponDisplay: "couponDisplay",
  expiryNote: "expiryNote",
  discountLabel: "discountLabel",
  minOrderLabel: "minOrderLabel",
});

export function $(id) {
  return document.getElementById(id);
}

export function show(el) {
  el?.classList.remove("hidden");
}

export function hide(el) {
  el?.classList.add("hidden");
}

export function setText(el, value) {
  if (el) el.textContent = value;
}

export function getSmsSignupDom() {
  return Object.fromEntries(
    Object.entries(SMS_SIGNUP_DOM_IDS).map(([key, id]) => [key, $(id)])
  );
}

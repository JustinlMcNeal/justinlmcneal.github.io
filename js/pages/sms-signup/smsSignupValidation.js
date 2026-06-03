import { $, hide, show, setText } from "./smsSignupDom.js";
import { stripPhone } from "./smsSignupUtils.js";

export function validateForm() {
  const phone = $("phone");
  const consent = $("consent");
  const phoneError = $("phoneError");
  let valid = true;

  const digits = stripPhone(phone?.value || "");
  const hasConsent = Boolean(consent?.checked);

  if (!digits || digits.length !== 10 || !/^[2-9]/.test(digits)) {
    show(phoneError);
    setText(phoneError, "Enter a valid 10-digit US phone number.");
    phone?.parentElement?.classList.add("shake", "border-red-400");
    setTimeout(() => phone?.parentElement?.classList.remove("shake"), 400);
    valid = false;
  } else {
    hide(phoneError);
    phone?.parentElement?.classList.remove("border-red-400");
  }

  if (!hasConsent) {
    consent?.parentElement?.classList.add("shake");
    setTimeout(() => consent?.parentElement?.classList.remove("shake"), 400);
    valid = false;
  }

  return valid;
}

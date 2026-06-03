import { $ } from "./smsSignupDom.js";

export function getConsentText() {
  return $("consentText")?.textContent.trim() || "";
}

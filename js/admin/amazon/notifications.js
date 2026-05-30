import { qs, hide, show } from "./dom.js";

/** @type {number | null} */
let dismissTimer = null;

/**
 * @param {"info"|"success"|"error"|"warning"} tone
 */
function toneClasses(tone) {
  if (tone === "success") {
    return "border-green-200 bg-green-50 text-green-900";
  }
  if (tone === "error") {
    return "border-red-200 bg-red-50 text-red-900";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-gray-200 bg-gray-50 text-gray-800";
}

/**
 * @param {string} message
 * @param {{ tone?: "info"|"success"|"error"|"warning", autoDismissMs?: number }} [options]
 */
export function showAmazonNotification(message, options = {}) {
  const el = qs("#amazonToast");
  if (!el || !message) return;

  const tone = options.tone || "info";
  el.className =
    `rounded-xl border px-4 py-3 text-sm font-medium ${toneClasses(tone)}`;
  el.textContent = message;
  show(el);

  if (dismissTimer) window.clearTimeout(dismissTimer);
  const ms = options.autoDismissMs ?? 6000;
  if (ms > 0) {
    dismissTimer = window.setTimeout(() => hideAmazonNotification(), ms);
  }
}

export function hideAmazonNotification() {
  const el = qs("#amazonToast");
  if (!el) return;
  hide(el);
  el.textContent = "";
  if (dismissTimer) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

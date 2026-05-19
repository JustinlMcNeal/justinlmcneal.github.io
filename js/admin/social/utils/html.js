// /js/admin/social/utils/html.js
// Pure HTML escaping helpers (no DOM side effects)

/**
 * Escape text for safe insertion into HTML markup.
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {unknown} value @returns {string} */
export function safeText(value) {
  return escapeHtml(value);
}

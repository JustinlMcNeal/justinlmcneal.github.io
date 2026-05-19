// /js/admin/social/utils/dom.js
// Small DOM read/write helpers (text only — no innerHTML)

/**
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export function qs(id) {
  return document.getElementById(id);
}

/**
 * Set textContent when element exists.
 * @param {string} id
 * @param {string | number} value
 */
export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * @param {HTMLElement | null} el
 * @param {boolean} visible
 */
export function setVisible(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

/** Small DOM helpers for Amazon admin page. */

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {Element | null}
 */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {Element[]}
 */
export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

/** @param {Element | null | undefined} el */
export function show(el) {
  if (!el) return;
  el.classList.remove("hidden");
  if (el.hasAttribute("aria-hidden")) {
    el.setAttribute("aria-hidden", "false");
  }
}

/** @param {Element | null | undefined} el */
export function hide(el) {
  if (!el) return;
  el.classList.add("hidden");
  if (el.hasAttribute("aria-hidden")) {
    el.setAttribute("aria-hidden", "true");
  }
}

/**
 * @param {Element | null | undefined} button
 * @param {boolean} expanded
 */
export function setExpanded(button, expanded) {
  if (!button) return;
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
}

/**
 * @param {Element | null | undefined} el
 * @param {boolean} hidden
 */
export function setHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle("hidden", hidden);
}

/**
 * @param {Element | null | undefined} el
 * @param {string} key
 * @param {string | number | null | undefined} value
 */
export function setHydrateText(el, key, value) {
  const target = el?.querySelector?.(`[data-hydrate="${key}"]`);
  if (target) target.textContent = value ?? "—";
}

/**
 * Highlight push-modal fields that Amazon Preview Submit reported as missing.
 * Matches KK theme: thick black border + pink offset (see .cursor/rules/website-theme.mdc).
 */

import { qs } from "./dom.js";

const FIELD_CLASS = "amazon-attr-field--missing";
const CONTROL_CLASS = "amazon-attr-control--missing";

/** Amazon attribute name → main push-form control (not in Additional Attributes). */
const MAIN_FORM_SELECTORS = {
  item_name: "#amazonPushAmazonTitle",
  brand: "#amazonPushBrand",
  product_description: "#amazonPushDescription",
  bullet_point: "#amazonPushBulletPoints",
  condition_type: "#amazonPushConditionType",
  purchasable_offer: "#amazonPushPrice",
  fulfillment_availability: "#amazonPushQuantity",
  product_type: "#amazonPushProductType",
  productType: "#amazonPushProductType",
  seller_sku: "#amazonPushSellerSku",
  main_product_image_locator: "#amazonPushImagesSection",
  other_product_image_locator_1: "#amazonPushImagesSection",
  swatch_product_image_locator: "#amazonPushImagesSection",
};

function cssEscape(value) {
  const raw = String(value || "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function modalRoot() {
  return qs("#amazonPushModal") || document;
}

/**
 * @param {string} name
 * @returns {HTMLElement[]}
 */
function resolveAttributeTargets(name) {
  const root = modalRoot();
  const key = String(name || "").trim();
  if (!key) return [];

  const mainSel = MAIN_FORM_SELECTORS[key];
  if (mainSel) {
    const el = root.querySelector(mainSel);
    return el instanceof HTMLElement ? [el] : [];
  }

  const field = root.querySelector(`[data-amazon-attr-field="${cssEscape(key)}"]`);
  if (field instanceof HTMLElement) return [field];

  const control = root.querySelector(`[data-amazon-attr="${cssEscape(key)}"]`);
  return control instanceof HTMLElement ? [control] : [];
}

/**
 * @param {HTMLElement} el
 * @returns {HTMLElement}
 */
function resolveFieldShell(el) {
  if (el.hasAttribute("data-amazon-attr-field")) return el;
  const named = el.closest("[data-amazon-attr-field]");
  if (named instanceof HTMLElement) return named;
  if (el.id === "amazonPushImagesSection") return el;
  const col = el.closest(".flex.flex-col");
  return col instanceof HTMLElement ? col : el;
}

export function clearMissingAttributeHighlights() {
  document.querySelectorAll(`.${FIELD_CLASS}`).forEach((el) => {
    el.classList.remove(FIELD_CLASS);
  });
  document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((el) => {
    el.classList.remove(CONTROL_CLASS);
  });
}

/**
 * @param {string[]} fieldNames
 * @param {{ scroll?: boolean }} [options]
 * @returns {number} number of fields highlighted
 */
export function highlightMissingAttributes(fieldNames = [], options = {}) {
  clearMissingAttributeHighlights();

  const names = [...new Set(
    (fieldNames || [])
      .map((name) => String(name || "").trim())
      .filter(Boolean),
  )];

  /** @type {HTMLElement[]} */
  const shells = [];

  for (const name of names) {
    for (const target of resolveAttributeTargets(name)) {
      const shell = resolveFieldShell(target);
      shell.classList.add(FIELD_CLASS);
      shells.push(shell);

      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
      ) {
        target.classList.add(CONTROL_CLASS);
      } else {
        target.querySelectorAll("input, select, textarea").forEach((control) => {
          control.classList.add(CONTROL_CLASS);
        });
      }
    }
  }

  if (options.scroll !== false && shells[0]) {
    shells[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return shells.length;
}

/**
 * Scroll / re-emphasize a single missing attribute (from the gaps list).
 * @param {string} fieldName
 */
export function focusMissingAttribute(fieldName) {
  const name = String(fieldName || "").trim();
  if (!name) return;

  const targets = resolveAttributeTargets(name);
  if (!targets.length) {
    highlightMissingAttributes([name], { scroll: true });
    return;
  }

  for (const target of targets) {
    const shell = resolveFieldShell(target);
    shell.classList.add(FIELD_CLASS);
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLSelectElement
      || target instanceof HTMLTextAreaElement
    ) {
      target.classList.add(CONTROL_CLASS);
      target.focus?.();
    }
    shell.scrollIntoView({ behavior: "smooth", block: "center" });
    break;
  }
}

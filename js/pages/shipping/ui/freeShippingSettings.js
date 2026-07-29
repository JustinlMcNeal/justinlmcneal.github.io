import { getFreeShippingSettings } from "/js/shared/cart/freeShippingBar.js";
import { DEFAULT_FREE_SHIPPING_THRESHOLD } from "../state/constants.js";

/**
 * @param {number} amount
 */
export function formatThresholdAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(DEFAULT_FREE_SHIPPING_THRESHOLD);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Load free-shipping settings for informational copy on the shipping page.
 * When disabled in admin, still shows threshold (decision A) with promo-aware wording.
 */
export async function loadFreeShippingDisplay() {
  const settings = await getFreeShippingSettings();
  const threshold = parseFloat(settings.threshold) || DEFAULT_FREE_SHIPPING_THRESHOLD;
  const enabled = settings.enabled !== false;
  const amount = formatThresholdAmount(threshold);

  const ordersOverLabel = `Orders $${amount}+`;

  const qualifierCopy = enabled
    ? `Available when your order subtotal is $${amount}+ (before shipping) or when a free-shipping promotion applies.`
    : `Free shipping may be offered during promotions. When active, orders $${amount}+ qualify for free standard shipping.`;

  const statSublabel = enabled
    ? ordersOverLabel
    : `${ordersOverLabel} · when promo active`;

  return {
    threshold,
    enabled,
    amount,
    ordersOverLabel,
    statSublabel,
    qualifierCopy,
  };
}

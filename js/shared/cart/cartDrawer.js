/**
 * cartDrawer.js
 * Public render entry for the cart drawer
 */

import { getCart } from "../cartStore.js";
import { bindCartControls } from "./cartControls.js";
import { calculateCartTotals } from "./cartTotals.js";
import { renderCartItems, getCartEls } from "./cartUI.js";

export async function renderCartDrawer() {
  bindCartControls();

  const items = getCart();
  const els = getCartEls();

  if (!els.cartItemsEl) {
    console.error("[CartDrawer] cart container missing");
    return;
  }

  const totals = await calculateCartTotals(items);

  renderCartItems(items, totals, els);
}

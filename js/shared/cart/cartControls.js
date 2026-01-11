/**
 * cartControls.js
 * Handles qty, remove, coupon apply
 */

import { setQty, removeItem } from "../cartStore.js";
import { applyCoupon } from "../couponManager.js";
import { renderCartDrawer } from "./cartDrawer.js";

let bound = false;

export function bindCartControls() {
  if (bound) return;
  bound = true;

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    // Qty -
    if (btn.hasAttribute("data-kk-qty-minus")) {
      setQty(
        btn.dataset.id,
        btn.dataset.variant || "",
        Number(btn.dataset.qty) - 1
      );
      return renderCartDrawer();
    }

    // Qty +
    if (btn.hasAttribute("data-kk-qty-plus")) {
      setQty(
        btn.dataset.id,
        btn.dataset.variant || "",
        Number(btn.dataset.qty) + 1
      );
      return renderCartDrawer();
    }

    // Remove
    if (btn.hasAttribute("data-kk-remove")) {
      removeItem(btn.dataset.id, btn.dataset.variant || "");
      return renderCartDrawer();
    }

    // Apply coupon
    if (btn.id === "kk-coupon-apply") {
      const input = document.getElementById("kk-coupon-input");
      const msg = document.getElementById("kk-coupon-message");
      if (!input || !msg) return;

      msg.style.display = "block";
      msg.textContent = "Checking code…";

      const result = await applyCoupon(input.value);

      msg.textContent = result.message;
      msg.style.color = result.valid ? "#16a34a" : "#b91c1c";

      return renderCartDrawer();
    }
  });
}

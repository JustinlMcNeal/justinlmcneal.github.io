/**
 * /js/shared/couponUI.js
 * Hooks the coupon input + apply button inside the cart drawer
 */

import { applyCoupon, removeCoupon } from "./couponManager.js";

export function initCouponUI() {
  const applyBtn = document.getElementById("kk-coupon-apply");
  const couponInput = document.getElementById("kk-coupon-input");
  const msgEl = document.getElementById("kk-coupon-message");

  if (!applyBtn || !couponInput) {
    console.warn("[CouponUI] Coupon button or input not found in DOM");
    return;
  }

  function showMessage(message, isSuccess = false) {
    if (!msgEl) return;
    msgEl.textContent = message;
    msgEl.style.display = "block";
    msgEl.style.color = isSuccess ? "#16a34a" : "#dc2626";
    if (isSuccess) {
      setTimeout(() => {
        msgEl.style.display = "none";
      }, 3000);
    }
  }

  applyBtn.addEventListener("click", async () => {
    const code = couponInput.value?.trim() || "";
    if (!code) {
      showMessage("Please enter a coupon code", false);
      return;
    }

    applyBtn.disabled = true;
    const original = applyBtn.textContent;
    applyBtn.textContent = "APPLYING...";

    const result = await applyCoupon(code);

    if (result.valid) {
      showMessage(result.message || "Coupon applied!", true);
      couponInput.value = "";
      window.dispatchEvent(new Event("kk-cart-updated"));
    } else {
      showMessage(result.message || "Coupon could not be applied.", false);
    }

    applyBtn.disabled = false;
    applyBtn.textContent = original || "APPLY";
  });

  couponInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyBtn.click();
    }
  });

  console.log("[CouponUI] Initialized");
}

export function clearCouponUI() {
  const couponInput = document.getElementById("kk-coupon-input");
  const msgEl = document.getElementById("kk-coupon-message");

  if (couponInput) couponInput.value = "";
  if (msgEl) msgEl.style.display = "none";

  removeCoupon();
  window.dispatchEvent(new Event("kk-cart-updated"));
}

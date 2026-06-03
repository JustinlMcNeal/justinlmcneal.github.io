import { initFooter } from "/js/shared/footer.js";
import { initNavbar } from "/js/shared/navbar.js";
import { clearCart } from "/js/shared/cartStore.js";
import { removeCoupon } from "/js/shared/couponManager.js";
import { trackPurchase } from "./successAnalytics.js";
import { initSmsOptin } from "./successCustomer.js";
import { loadOrderDetails } from "./successOrder.js";
import { renderOrderDetails, showOrderId, spawnConfetti } from "./successRender.js";
import { getOrderIdFromPageParams } from "./successSession.js";
import {
  markPageInitialized,
  readSuccessParams,
  setOrderData,
  setSuccessParams,
} from "./successState.js";

async function initSuccessPage() {
  if (!markPageInitialized()) return;

  safelyClearCheckoutState();
  await safelyInitChrome();

  const params = readSuccessParams();
  setSuccessParams(params);

  const oid = getOrderIdFromPageParams(params);
  showOrderId(oid);
  spawnConfetti();

  const { order, items } = await loadOrderDetails(oid);
  setOrderData(order, items);
  renderOrderDetails(order, items);
  trackPurchase(order);

  initSmsOptin(order).catch((err) => {
    console.warn("[success] could not initialize SMS opt-in:", err);
  });
  await safelyInitFooter();
}

function safelyClearCheckoutState() {
  try {
    clearCart();
    removeCoupon();
  } catch (err) {
    console.warn("[success] could not clear checkout state:", err);
  }
}

async function safelyInitChrome() {
  try {
    await initNavbar();
  } catch (err) {
    console.warn("[success] could not initialize navbar:", err);
  }
}

async function safelyInitFooter() {
  try {
    await initFooter();
  } catch (err) {
    console.warn("[success] could not initialize footer:", err);
  }
}

document.addEventListener("DOMContentLoaded", initSuccessPage, { once: true });

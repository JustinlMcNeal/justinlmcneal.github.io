// /js/shared/swipeToAdd.js
// Swipe-to-add feature for product cards on mobile

import { addToCart } from "./cartStore.js";
import { renderCartDrawer } from "./cart/cartDrawer.js";

const SWIPE_THRESHOLD = 80; // pixels needed to trigger

/**
 * Initialize swipe-to-add on product cards
 * Only works on mobile touch devices
 */
export function initSwipeToAdd() {
  // Only on touch devices
  if (!("ontouchstart" in window)) return;

  // Add styles
  addSwipeStyles();

  // Delegate touch events to document for dynamic cards
  document.addEventListener("touchstart", handleTouchStart, { passive: true });
  document.addEventListener("touchmove", handleTouchMove, { passive: false });
  document.addEventListener("touchend", handleTouchEnd, { passive: true });
}

let touchState = {
  card: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  isHorizontal: null,
  overlay: null
};

function handleTouchStart(e) {
  const card = e.target.closest(".product-card, article[data-product-id]");
  if (!card) return;

  // Check if card has product data
  const quickAddBtn = card.querySelector(".quick-add-btn");
  if (!quickAddBtn) return;

  const hasVariants = quickAddBtn.dataset.hasVariants === "true";
  if (hasVariants) return; // Don't enable swipe for multi-variant products

  const touch = e.touches[0];
  touchState = {
    card,
    startX: touch.clientX,
    startY: touch.clientY,
    currentX: 0,
    isHorizontal: null,
    overlay: null,
    productId: quickAddBtn.dataset.id
  };
}

function handleTouchMove(e) {
  if (!touchState.card) return;

  const touch = e.touches[0];
  const deltaX = touch.clientX - touchState.startX;
  const deltaY = touch.clientY - touchState.startY;

  // Determine scroll direction on first significant move
  if (touchState.isHorizontal === null) {
    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
      touchState.isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
    }
  }

  // Only handle horizontal swipes (left to right)
  if (!touchState.isHorizontal || deltaX <= 0) {
    return;
  }

  // Prevent vertical scroll
  e.preventDefault();

  touchState.currentX = deltaX;

  // Show overlay
  if (!touchState.overlay) {
    touchState.overlay = createOverlay(touchState.card);
  }

  // Update overlay progress
  const progress = Math.min(1, deltaX / SWIPE_THRESHOLD);
  updateOverlay(touchState.overlay, progress);

  // Translate card slightly
  const translateX = Math.min(deltaX * 0.3, 40);
  touchState.card.style.transform = `translateX(${translateX}px)`;
}

function handleTouchEnd(e) {
  if (!touchState.card) return;

  const triggered = touchState.currentX >= SWIPE_THRESHOLD;

  // Reset card position
  touchState.card.style.transform = "";

  if (triggered && touchState.productId) {
    // Add to cart!
    addToCartQuick(touchState.productId, touchState.card);
  }

  // Remove overlay with animation
  if (touchState.overlay) {
    touchState.overlay.classList.add("fade-out");
    setTimeout(() => touchState.overlay?.remove(), 200);
  }

  // Reset state
  touchState = {
    card: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    isHorizontal: null,
    overlay: null
  };
}

function createOverlay(card) {
  const overlay = document.createElement("div");
  overlay.className = "swipe-add-overlay";
  overlay.innerHTML = `
    <div class="swipe-add-content">
      <div class="swipe-add-icon">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
      </div>
      <div class="swipe-add-text">Add to Cart</div>
    </div>
    <div class="swipe-add-progress"></div>
  `;

  card.style.position = "relative";
  card.appendChild(overlay);
  return overlay;
}

function updateOverlay(overlay, progress) {
  const progressBar = overlay.querySelector(".swipe-add-progress");
  const icon = overlay.querySelector(".swipe-add-icon");
  
  if (progressBar) {
    progressBar.style.width = `${progress * 100}%`;
  }
  
  if (icon) {
    icon.style.transform = `scale(${0.8 + progress * 0.4})`;
    icon.style.opacity = progress;
  }

  // Change color when threshold reached
  if (progress >= 1) {
    overlay.classList.add("triggered");
  } else {
    overlay.classList.remove("triggered");
  }
}

async function addToCartQuick(productId, card) {
  try {
    // Get product data from Supabase
    const { getSupabaseClient } = await import("./supabaseClient.js");
    const supabase = getSupabaseClient();

    const { data: product } = await supabase
      .from("products")
      .select("*, variants:product_variants(*)")
      .eq("id", productId)
      .single();

    if (!product) {
      showToast("Product not found", "error");
      return;
    }

    // Find default variant (first with stock)
    const variant = product.variants?.find(v => (v.stock ?? 0) > 0) || product.variants?.[0];
    
    // Build cart item
    const cartItem = {
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.primary_image_url,
      variant: variant?.option_value || "",
      qty: 1
    };

    addToCart(cartItem);
    
    // Show success feedback
    showSwipeSuccess(card);
    
    // Update cart drawer
    await renderCartDrawer();
    
    // Dispatch cart change event
    window.dispatchEvent(new CustomEvent("kk:cart:change"));

  } catch (err) {
    console.error("[SwipeToAdd] Error:", err);
    showToast("Failed to add to cart", "error");
  }
}

function showSwipeSuccess(card) {
  const feedback = document.createElement("div");
  feedback.className = "swipe-success-feedback";
  feedback.innerHTML = `
    <svg class="w-10 h-10" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
    </svg>
  `;
  
  card.style.position = "relative";
  card.appendChild(feedback);

  // Vibrate if supported
  if (navigator.vibrate) {
    navigator.vibrate(50);
  }

  setTimeout(() => feedback.remove(), 800);
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-bold z-[200] ${
    type === "error" ? "bg-red-500 text-white" : "bg-black text-white"
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function addSwipeStyles() {
  if (document.getElementById("swipe-add-styles")) return;

  const style = document.createElement("style");
  style.id = "swipe-add-styles";
  style.textContent = `
    .swipe-add-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 50;
      pointer-events: none;
      transition: background 0.2s;
    }

    .swipe-add-overlay.triggered {
      background: rgba(34, 197, 94, 0.9);
    }

    .swipe-add-overlay.fade-out {
      opacity: 0;
      transition: opacity 0.2s;
    }

    .swipe-add-content {
      color: white;
      text-align: center;
    }

    .swipe-add-icon {
      transform: scale(0.8);
      opacity: 0;
      transition: all 0.1s;
    }

    .swipe-add-text {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 8px;
    }

    .swipe-add-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 4px;
      background: white;
      width: 0;
      transition: width 0.05s;
    }

    .swipe-success-feedback {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(34, 197, 94, 0.95);
      color: white;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 60;
      animation: swipe-success-pop 0.5s ease-out forwards;
    }

    @keyframes swipe-success-pop {
      0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
      50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
    }

    .product-card {
      transition: transform 0.1s ease-out;
    }
  `;
  document.head.appendChild(style);
}

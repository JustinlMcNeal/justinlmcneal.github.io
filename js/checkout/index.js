// js/checkout/index.js
// Checkout review page — entry point

import { getCart, addToCart } from "../shared/cartStore.js";
import { getSupabaseClient } from "../shared/supabaseClient.js";
import { initNavbar } from "../shared/navbar.js";
import { initFooter } from "../shared/footer.js";
import { calculateCartTotals, buildCheckoutPromoPayload } from "../shared/cart/cartTotals.js";
import { getAppliedCoupon } from "../shared/couponManager.js";
import { checkPromotionApplies } from "../shared/promotions/promoScope.js";
import { renderCheckoutItems, wireItemControls, resetStockCache } from "./renderItems.js";
import { updateSummary, wireCouponUI, loadReviewBadge } from "./summary.js";

/* ── Helpers ── */
function getSiteBasePath() {
  const m = location.pathname.match(/^(\/[^/]+\.github\.io)/);
  return m ? m[1] : "";
}

function withBase(path) {
  return getSiteBasePath() + path;
}

/* ── DOM refs ── */
const els = {
  items: () => document.getElementById("checkoutItems"),
  couponSection: () => document.getElementById("checkoutCoupon"),
  payBtn: () => document.getElementById("checkoutPayBtn"),
  mobilePayBtn: () => document.getElementById("mobileStickyPayBtn"),
  mobileStickyBar: () => document.getElementById("mobileStickyBar"),
  recsSection: () => document.getElementById("checkoutRecommendations"),
  recsGrid: () => document.getElementById("checkoutRecsGrid"),
};

/* ── Re-render the page on cart changes ── */
async function refresh() {
  const cart = getCart();
  const container = els.items();

  if (!cart.length) {
    await renderCheckoutItems([], container);
    // Hide coupon, summary, recs
    els.couponSection()?.classList.add("hidden");
    els.recsSection()?.classList.add("hidden");
    return;
  }

  // Show coupon section
  els.couponSection()?.classList.remove("hidden");

  // Render items (returns stock map + mtoSet for delivery estimates)
  resetStockCache();
  const { stockMap, mtoSet } = await renderCheckoutItems(cart, container);

  // Calculate totals
  const totals = await calculateCartTotals(cart);

  // Update summary sidebar (pass stock info for backorder-aware delivery)
  await updateSummary(totals, { cartItems: cart, stockMap, mtoSet });

  // Load recommendations
  loadRecommendations(cart, totals.activePromos);
}

/* ── Stripe checkout ── */
async function handleCheckout(btn) {
  const cart = getCart();
  if (!cart.length) return;

  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = `
    <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
    Processing...
  `;

  // Also disable the other pay button
  const otherBtn = btn.id === "checkoutPayBtn" ? els.mobilePayBtn() : els.payBtn();
  if (otherBtn) otherBtn.disabled = true;

  try {
    const supabase = getSupabaseClient();
    const totals = await calculateCartTotals(cart);

    const subtotal = Number(totals.subtotal || 0);
    const autoDiscount = Number(totals.autoDiscount || 0);
    const couponDiscount = Number(totals.couponDiscount || 0);

    const promo = await buildCheckoutPromoPayload(cart);

    // Cart subtotal for proportional distribution
    const cartSubtotal =
      cart.reduce(
        (sum, item) =>
          sum + Number(item.price || 0) * Math.max(1, Number(item.qty || 1)),
        0
      ) || 1;

    // Coupon scope matching
    const coupon = getAppliedCoupon();
    const couponScopeType = coupon?.scope_type || "all";

    let couponMatchSubtotal = 0;
    const couponMatchFlags = cart.map((item) => {
      if (!coupon || couponDiscount <= 0) return false;
      if (couponScopeType === "all") return true;
      return checkPromotionApplies(coupon, item);
    });

    couponMatchFlags.forEach((matches, idx) => {
      if (matches) {
        const item = cart[idx];
        const qty = Math.max(1, Number(item.qty || 1));
        couponMatchSubtotal += Number(item.price || 0) * qty;
      }
    });
    couponMatchSubtotal = couponMatchSubtotal || 1;

    const items = cart.map((item, idx) => {
      const qty = Math.max(1, Number(item.qty || 1));
      const unitPrice = Number(item.price || 0);
      const lineSubtotal = unitPrice * qty;

      // Auto promo — proportional across ALL items
      const autoWeight = lineSubtotal / cartSubtotal;
      const lineAutoDiscount = autoDiscount * autoWeight;

      // Coupon — proportional ONLY to scope-matching items
      let lineCouponDiscount = 0;
      if (couponMatchFlags[idx]) {
        const couponWeight = lineSubtotal / couponMatchSubtotal;
        lineCouponDiscount = couponDiscount * couponWeight;
      }

      const lineDiscount = lineAutoDiscount + lineCouponDiscount;
      const unitDiscount = lineDiscount / qty;
      const discounted_price = Math.max(0, unitPrice - unitDiscount);

      return {
        product_id: item.product_id || item.id,
        name: item.name,
        variant: item.variant || "",
        price: unitPrice,
        discounted_price,
        qty,
        image: item.image || "",
      };
    });

    // Save cart snapshot before Stripe (for debugging + abandoned cart)
    try {
      localStorage.setItem(
        "kk_checkout_snapshot",
        JSON.stringify({
          items: cart,
          totals: {
            subtotal: totals.subtotal,
            total: totals.total,
            autoDiscount: totals.autoDiscount,
            couponDiscount: totals.couponDiscount,
          },
          coupon_used: promo?.code || null,
          timestamp: new Date().toISOString(),
        })
      );
    } catch {
      // localStorage full — skip snapshot
    }

    const origin = location.origin.replace("127.0.0.1", "localhost");

    const res = await supabase.functions.invoke("create-checkout-session", {
      body: {
        items,
        promo,
        success_url: `${origin}${withBase("/pages/success.html")}`,
        cancel_url: `${origin}${withBase("/pages/checkout.html")}`,
      },
    });

    if (res.error) {
      const resp = res.error?.context?.response || res.response;
      if (resp && typeof resp.text === "function") {
        const text = await resp.text();
        try {
          const j = JSON.parse(text);
          const errorMsg = j.error || text;
          const details = j.details
            ? `\n\nDetails: ${JSON.stringify(j.details, null, 2)}`
            : "";
          alert(`Checkout failed: ${errorMsg}${details}`);
        } catch {
          alert(`Checkout failed: ${text}`);
        }
      } else {
        const msg = res.error?.message || res.error?.toString() || "Unknown error";
        alert(`Checkout failed: ${msg}`);
      }
      return;
    }

    if (res.data?.error) {
      alert(`Checkout failed: ${res.data.error}`);
      return;
    }

    if (!res.data?.url) {
      alert("Checkout failed: No session URL returned");
      return;
    }

    window.location.href = res.data.url;
  } catch (err) {
    console.error("Checkout error:", err);
    alert("Checkout failed. Please try again.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    const otherBtn2 = btn.id === "checkoutPayBtn" ? els.mobilePayBtn() : els.payBtn();
    if (otherBtn2) otherBtn2.disabled = false;
  }
}

/* ── Recommendations ── */
async function loadRecommendations(cart, activePromos) {
  const section = els.recsSection();
  const grid = els.recsGrid();
  if (!section || !grid) return;

  try {
    const { getCartRecommendations } = await import("../shared/cart/cartRecommendations.js");
    const recs = await getCartRecommendations(cart, activePromos);

    // Combine pairs-well + bestsellers, take first 4
    const products = [
      ...(recs?.pairsWell || []),
      ...(recs?.bestSellers || []),
    ]
      .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i) // dedupe
      .slice(0, 4);

    if (!products.length) {
      section.classList.add("hidden");
      return;
    }

    grid.innerHTML = products
      .map((p, idx) => {
        const img = p.catalog_image_url || p.image_url || "/imgs/placeholder.png";
        const slug = p.slug || "";
        const name = String(p.name || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const price = Number(p.price || 0).toFixed(2);
        const badge = idx === 0 ? `<span class="absolute top-1.5 left-1.5 bg-black text-white text-[9px] font-bold px-2 py-0.5 rounded-full z-10">Most Popular</span>` : "";
        const pid = String(p.id || "");

        return `
          <div class="bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 group">
            <a href="/pages/product.html?slug=${slug}">
              <div class="aspect-square bg-black/5 overflow-hidden relative">
                ${badge}
                <img src="${img}" alt="${name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
              </div>
              <div class="px-2.5 pt-2.5 pb-1">
                <p class="text-xs font-bold line-clamp-2 leading-tight">${name}</p>
                <p class="text-xs font-semibold mt-1">$${price}</p>
              </div>
            </a>
            <div class="px-2.5 pb-2.5 pt-1">
              <button
                type="button"
                class="checkout-rec-add w-full py-1.5 text-[11px] font-bold bg-black text-white rounded-lg hover:bg-black/80 transition-colors"
                data-rec-id="${pid}"
                data-rec-name="${name}"
                data-rec-price="${price}"
                data-rec-image="${img.replace(/"/g, "&quot;")}"
                data-rec-slug="${slug}"
                data-rec-catid="${p.category_id || ""}"
              >+ Add to Cart</button>
            </div>
          </div>
        `;
      })
      .join("");

    // Wire "Add to Cart" buttons
    grid.querySelectorAll(".checkout-rec-add").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const d = btn.dataset;
        addToCart({
          id: d.recId,
          name: d.recName,
          price: parseFloat(d.recPrice),
          image: d.recImage,
          slug: d.recSlug,
          category_id: d.recCatid || null,
          qty: 1,
        });
        btn.textContent = "✓ Added!";
        btn.disabled = true;
        btn.classList.replace("bg-black", "bg-green-600");
        refresh();
      });
    });

    section.classList.remove("hidden");
  } catch {
    section.classList.add("hidden");
  }
}

/* ── Mobile sticky bar visibility ── */
function initMobileStickyBar() {
  const bar = els.mobileStickyBar();
  if (!bar) return;

  // On mobile (< 768px), always show the sticky bar when cart has items.
  // On desktop, the sidebar CTA is always visible (sticky sidebar), so hide bar.
  function updateBar() {
    const isMobile = window.innerWidth < 768;
    const cart = getCart();
    if (isMobile && cart.length) {
      bar.classList.remove("hidden");
    } else {
      bar.classList.add("hidden");
    }
  }

  updateBar();
  window.addEventListener("resize", updateBar);
  window.addEventListener("kk-cart-updated", updateBar);
}

/* ── Exit intent tracking ── */
function initExitIntent() {
  window.addEventListener("beforeunload", () => {
    const cart = getCart();
    if (cart.length) {
      try {
        localStorage.setItem("kk_last_checkout_viewed_at", new Date().toISOString());
      } catch {
        // ignore
      }
    }
  });
}

/* ── Init ── */
async function init() {
  // Inject navbar + footer
  await Promise.all([initNavbar(), initFooter()]);

  const cart = getCart();

  // Empty cart → show empty state
  if (!cart.length) {
    await refresh();
    return;
  }

  // Wire item controls (delegated — only once)
  wireItemControls(els.items(), refresh);

  // Wire coupon UI
  wireCouponUI(refresh);

  // Wire checkout buttons
  const payBtn = els.payBtn();
  const mobilePayBtn = els.mobilePayBtn();

  payBtn?.addEventListener("click", () => handleCheckout(payBtn));
  mobilePayBtn?.addEventListener("click", () => handleCheckout(mobilePayBtn));

  // Mobile sticky bar
  initMobileStickyBar();

  // Exit intent
  initExitIntent();

  // Listen for cart updates from other tabs/drawer
  window.addEventListener("kk-cart-updated", refresh);

  // Initial render
  await refresh();

  // Load review badge (non-blocking)
  loadReviewBadge();
}

init();

// /js/product/dom.js

export function show(el, yes) {
  if (!el) return;
  el.classList.toggle("hidden", !yes);
}

export function setActionMsg(els, msg, isError = false) {
  if (!els?.actionMsg) return;
  els.actionMsg.textContent = msg || "";
  els.actionMsg.style.color = isError ? "#b91c1c" : "#111";
  show(els.actionMsg, !!msg);
}

export async function loadInsert(mountId, path) {
  const mount = document.getElementById(mountId);
  if (!mount) return false;

  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);

  mount.innerHTML = await res.text();
  return true;
}

export function getProductEls() {
  return {
    // page states
    details: document.getElementById("productSections"),
    loading: document.getElementById("productLoading"),
    error: document.getElementById("productError"),
    errorMsg: document.getElementById("errorMsg"),
    wrap: document.getElementById("productWrap"),

    // header
    crumbName: document.getElementById("crumbName"),
    category: document.getElementById("productCategory"),
    name: document.getElementById("productName"),
    code: document.getElementById("productCode"),

    // price + shipping
    price: document.getElementById("productPrice"),
    shipping: document.getElementById("shippingLine"),

    // promos panel
    promos: document.getElementById("productPromos"),
    promoApplied: document.getElementById("promoApplied"),
    promoEligibleWrap: document.getElementById("promoEligibleWrap"),
    promoEligible: document.getElementById("promoEligible"),

    // tags + variants
    tagRow: document.getElementById("tagRow"),
    variantSwatches: document.getElementById("variantSwatches"),

    // qty + cart
    qty: document.getElementById("qty"),
    qtyMinus: document.getElementById("qtyMinus"),
    qtyPlus: document.getElementById("qtyPlus"),

    addBtn: document.getElementById("btnAddToCart"),
    actionMsg: document.getElementById("actionMsg"),

    // gallery + thumbs
    carousel: document.getElementById("mainCarousel"),
    prev: document.getElementById("imgPrev"),
    next: document.getElementById("imgNext"),

    thumbCarousel: document.getElementById("thumbCarousel"),
    thumbRow: document.getElementById("thumbRow"),

    // sticky column (optional, but handy)
    stickyCol: document.getElementById("stickyDetailsCol"),

    // pairs well with
    pairsWrap: document.getElementById("pairsWrap"),
    pairsCarousel: document.getElementById("pairsCarousel"),
  };
}

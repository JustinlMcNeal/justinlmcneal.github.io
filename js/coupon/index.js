import { initNavbar } from "../shared/navbar.js";
import { initFooter } from "../shared/footer.js";
import { getSupabaseClient } from "../shared/supabaseClient.js";
import { isWithinDateWindow } from "../shared/promotions/promoUtils.js";

const supabase = getSupabaseClient();

function $(id) {
  return document.getElementById(id);
}

function show(el, yes) {
  if (!el) return;
  el.classList.toggle("hidden", !yes);
}

function showCouponVisual(yes) {
  const el = $("couponVisual");
  if (!el) return;
  el.classList.add("hidden");
  el.classList.toggle("lg:block", yes);
  el.classList.toggle("lg:hidden", !yes);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function getSlug() {
  const url = new URL(window.location.href);
  return (url.searchParams.get("promo") || url.searchParams.get("coupon") || url.searchParams.get("c") || "")
    .trim()
    .toLowerCase();
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatOffer(promo) {
  const type = String(promo?.type || "").toLowerCase();
  if (type === "percentage") return `${Number(promo.value || 0)}% off`;
  if (type === "fixed") return `${money(promo.value)} off`;
  if (type === "free-shipping") return "Free shipping";
  if (type === "bogo") return "BOGO offer";
  return "Special offer";
}

function formatDate(isoString) {
  if (!isoString) return "No expiration listed";
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeImagePath(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function isBeforeStartDate(promo) {
  return Boolean(promo?.start_date && new Date(promo.start_date) > new Date());
}

function isAfterEndDate(promo) {
  return Boolean(promo?.end_date && new Date(promo.end_date) < new Date());
}

function renderDetails(promo) {
  const minOrder = Number(promo.min_order_amount || 0);
  const limit = promo.usage_limit ? `${Number(promo.usage_limit).toLocaleString()} total` : "No listed limit";
  const details = [
    ["Offer", formatOffer(promo)],
    ["Minimum", minOrder > 0 ? money(minOrder) : "No minimum"],
    ["Ends", formatDate(promo.end_date)],
    ["Usage", limit],
  ];

  $("couponDetails").innerHTML = details
    .map(([label, value]) => `
      <div class="border-2 border-black/15 bg-gray-50 px-3 py-3">
        <dt class="text-[10px] uppercase tracking-[.18em] font-black text-black/45">${escapeHtml(label)}</dt>
        <dd class="mt-1 font-black">${escapeHtml(value)}</dd>
      </div>
    `)
    .join("");
}

function setError(message) {
  show($("couponPanel"), false);
  show($("couponActions"), false);
  showCouponVisual(false);
  show($("couponError"), true);
  $("couponTitle").textContent = "Coupon Not Available";
  $("couponDescription").textContent = "This offer is unavailable right now.";
  $("couponErrorText").textContent = message;
}

function renderScheduledCoupon(promo) {
  $("couponTitle").textContent = promo.coupon_page_title || promo.name || "Your Karry Kraze Coupon";
  $("couponDescription").textContent = `This offer starts ${formatDate(promo.start_date)}. Scan this code again when the celebration begins.`;
  $("couponCodeLabel").textContent = "Starts Soon";
  $("couponCode").textContent = formatDate(promo.start_date).toUpperCase();
  $("btnCopy").disabled = true;
  $("btnCopy").textContent = "Soon";
  renderDetails(promo);
  show($("couponPanel"), true);
  show($("couponActions"), false);
  showCouponVisual(false);
  show($("couponError"), false);
}

async function fetchCoupon(slug) {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("coupon_slug", slug)
    .eq("coupon_landing_enabled", true)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function renderCoupon(promo) {
  if (!promo?.code) {
    setError("This promotion does not have a coupon code attached yet.");
    return;
  }

  if (isBeforeStartDate(promo)) {
    renderScheduledCoupon(promo);
    return;
  }

  if (isAfterEndDate(promo) || !isWithinDateWindow(promo)) {
    setError("This coupon has expired.");
    return;
  }

  const offer = formatOffer(promo);
  const imagePath = normalizeImagePath(promo.banner_image_path);
  $("couponTitle").textContent = promo.coupon_page_title || promo.name || "Your Karry Kraze Coupon";
  $("couponDescription").textContent = promo.coupon_page_note || promo.description || `Use this code for ${offer} on your next order.`;
  $("couponCodeLabel").textContent = "Your Code";
  $("couponCode").textContent = String(promo.code || "").toUpperCase();
  $("btnCopy").disabled = false;
  $("btnCopy").textContent = "Copy";
  if (imagePath) $("couponImage").src = imagePath;
  renderDetails(promo);
  show($("couponPanel"), true);
  show($("couponActions"), true);
  showCouponVisual(Boolean(imagePath));
  show($("couponError"), false);
}

async function initCouponPage() {
  initNavbar();
  initFooter();

  const slug = getSlug();
  const copyBtn = $("btnCopy");

  copyBtn?.addEventListener("click", async () => {
    if (copyBtn.disabled) return;
    const code = $("couponCode")?.textContent?.trim();
    if (!code || code === "LOADING") return;

    await navigator.clipboard.writeText(code);
    show($("copyMsg"), true);
    setTimeout(() => show($("copyMsg"), false), 2400);
  });

  if (!slug) {
    setError("The coupon link is missing a promo slug.");
    return;
  }

  try {
    const promo = await fetchCoupon(slug);
    if (!promo) {
      setError("This coupon could not be found or is no longer active.");
      return;
    }
    renderCoupon(promo);
  } catch (error) {
    console.error("[Coupon Page] Failed to load coupon:", error);
    setError("Something went wrong while loading this coupon.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCouponPage);
} else {
  initCouponPage();
}
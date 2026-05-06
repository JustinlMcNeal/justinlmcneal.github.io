import { initNavbar } from "../shared/navbar.js";
import { initFooter } from "../shared/footer.js";
import { getSupabaseClient } from "../shared/supabaseClient.js";
import { isWithinDateWindow } from "../shared/promotions/promoUtils.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/env.js";

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

  // Collapse the grid to a single centered column when there's no visual
  const section = document.getElementById("couponMainSection");
  if (section) {
    if (yes) {
      section.classList.remove("max-w-xl", "lg:grid-cols-1");
      section.classList.add("max-w-5xl", "lg:grid-cols-[1.05fr_.95fr]");
    } else {
      section.classList.remove("max-w-5xl", "lg:grid-cols-[1.05fr_.95fr]");
      section.classList.add("max-w-xl", "lg:grid-cols-1");
    }
  }
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

// ── Coupon Upgrade ───────────────────────────────────────────

function formatUpgradeOffer(promo) {
  const type = String(promo?.type || "").toLowerCase();
  const val  = Number(promo?.coupon_upgrade_value || 0);
  if (type === "percentage") return `${val}% off`;
  if (type === "fixed") return `$${val} off`;
  return "an exclusive discount";
}

function formatPhoneInput(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function renderUpgradeSection(promo) {
  const section = $("couponUpgradeSection");
  if (!section) return;

  if (!promo.coupon_upgrade_enabled || !promo.coupon_upgrade_value) {
    show(section, false);
    return;
  }

  const offer = formatUpgradeOffer(promo);
  const baseOffer = formatOffer(promo);

  const headline = $("upgradeHeadline");
  const subtext  = $("upgradeSubtext");
  const consent  = $("upgradeConsentText");

  if (headline) headline.textContent = `Upgrade from ${baseOffer} → ${offer}`;
  if (subtext)  subtext.textContent  = `Enter your phone number to receive a personal ${offer} code sent directly to your phone.`;
  if (consent)  consent.textContent  = promo.coupon_upgrade_consent ||
    "By entering your number you agree to receive marketing texts from Karry Kraze. Reply STOP to opt out. Msg & data rates may apply.";

  show(section, true);
}

async function submitUpgrade(promoId, consentText) {
  const phoneInput = $("upgradePhone");
  const btn        = $("btnUpgrade");
  const errEl      = $("upgradeError");

  const rawPhone = phoneInput?.value?.trim() || "";
  const digits   = rawPhone.replace(/\D/g, "");
  if (digits.length < 10) {
    show(errEl, true);
    if (errEl) errEl.textContent = "Please enter a valid 10-digit US phone number.";
    return;
  }
  show(errEl, false);

  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/coupon-upgrade`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        phone:        rawPhone,
        promo_id:     promoId,
        consent_text: consentText,
        page_url:     window.location.href,
        user_agent:   navigator.userAgent,
      }),
    });

    const data = await resp.json();

    if (!resp.ok || data.error) {
      throw new Error(data.error || "Something went wrong. Please try again.");
    }

    // Show success state
    show($("upgradeForm"),    false);
    show($("upgradeSuccess"), true);

    const codeEl   = $("upgradeCode");
    const msgEl    = $("upgradeSuccessMsg");
    if (codeEl) codeEl.textContent = String(data.coupon_code || "").toUpperCase();
    if (msgEl) {
      msgEl.textContent = data.already_upgraded
        ? "You already have an upgrade! Use the code above at checkout."
        : data.sms_sent
          ? "Check your phone — your upgraded code is on its way!"
          : "Here's your upgraded code. Save it and use it at checkout!";
    }

  } catch (err) {
    show(errEl, true);
    if (errEl) errEl.textContent = err?.message || "Something went wrong. Please try again.";
    if (btn) { btn.disabled = false; btn.textContent = "Upgrade My Code"; }
  }
}

function initUpgradeSection(promo) {
  const phoneInput  = $("upgradePhone");
  const btn         = $("btnUpgrade");
  const copyBtn     = $("btnCopyUpgrade");
  const consentText = $("upgradeConsentText")?.textContent?.trim() || promo.coupon_upgrade_consent || "";

  // Auto-format phone as user types
  phoneInput?.addEventListener("input", () => {
    const pos = phoneInput.selectionStart;
    const prev = phoneInput.value;
    const next = formatPhoneInput(prev);
    phoneInput.value = next;
    // Keep cursor roughly in place
    const diff = next.length - prev.length;
    try { phoneInput.setSelectionRange(pos + diff, pos + diff); } catch (_) { /* ignore */ }
  });

  // Submit on Enter
  phoneInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitUpgrade(promo.id, consentText);
  });

  btn?.addEventListener("click", () => submitUpgrade(promo.id, consentText));

  copyBtn?.addEventListener("click", async () => {
    const code = $("upgradeCode")?.textContent?.trim();
    if (!code || code === "—") return;
    await navigator.clipboard.writeText(code);
    show($("upgradeCopyMsg"), true);
    setTimeout(() => show($("upgradeCopyMsg"), false), 2400);
  });
}

// ── Page init ────────────────────────────────────────────────

async function initCouponPage() {
  initNavbar();
  initFooter();

  const slug = getSlug();
  const copyBtn  = $('btnCopy');
  const shareBtn = $('btnShare');

  copyBtn?.addEventListener('click', async () => {
    if (copyBtn.disabled) return;
    const code = $('couponCode')?.textContent?.trim();
    if (!code || code === 'LOADING') return;

    await navigator.clipboard.writeText(code);
    show($('copyMsg'), true);
    setTimeout(() => show($('copyMsg'), false), 2400);
  });

  shareBtn?.addEventListener('click', async () => {
    const shareUrl = slug ? `https://karrykraze.com/c/${encodeURIComponent(slug)}` : window.location.href;
    const title = $('couponTitle')?.textContent?.trim() || 'Karry Kraze Coupon';
    if (navigator.share) {
      try {
        await navigator.share({ title, text: 'Check out this deal from Karry Kraze!', url: shareUrl });
      } catch (_) { /* user dismissed */ }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      show($('copyMsg'), true);
      $('copyMsg').textContent = 'Share link copied!';
      setTimeout(() => { show($('copyMsg'), false); $('copyMsg').textContent = 'Copied to clipboard.'; }, 2400);
    }
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
    renderUpgradeSection(promo);
    initUpgradeSection(promo);
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
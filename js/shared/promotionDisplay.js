/**
 * /js/shared/promotionDisplay.js
 * UI helpers for promotions.
 *
 * Backwards compatible exports:
 * - getPromoPill
 * - getPromoBanner
 *
 * Catalog exports expected:
 * - getPromoBadgeHTML
 * - getPromoCardBanner
 * - getPromoExpiryMessage
 */

function fmtMoney(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function toDateSafe(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysUntil(date) {
  const now = new Date();
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/* -------------------------
   Existing exports (product page used these)
------------------------- */

export function getPromoPill(promo) {
  if (!promo) return "";

  const type = promo.type;
  let text = "";

  if (type === "percentage") text = `${Math.round(Number(promo.value || 0))}% off`;
  else if (type === "fixed") text = `$${fmtMoney(promo.value)} off`;
  else if (type === "bogo") text = "BOGO";
  else if (type === "free-shipping" || type === "free_shipping") text = "Free shipping";
  else text = escapeHtml(type);

  return `
    <span class="kk-promo-pill kk-promo-pill--${escapeHtml(type)}">
      ${escapeHtml(text)}
    </span>
  `;
}

export function getPromoBanner(promo) {
  if (!promo) return "";

  const type = promo.type;
  let headline = "";

  if (type === "percentage") headline = `${Math.round(Number(promo.value || 0))}% OFF`;
  else if (type === "fixed") headline = `$${fmtMoney(promo.value)} OFF`;
  else if (type === "bogo") headline = `BUY ONE GET ONE`;
  else if (type === "free-shipping" || type === "free_shipping") headline = `FREE SHIPPING`;
  else headline = `PROMO`;

  const name = promo.name ? escapeHtml(promo.name) : "";
  const desc = promo.description ? escapeHtml(promo.description) : "";

  return `
    <div class="kk-promo-banner kk-promo-banner--${escapeHtml(type)}" role="note" aria-label="Promotion">
      <div class="kk-promo-banner__headline">${escapeHtml(headline)}</div>
      ${name ? `<div class="kk-promo-banner__name">${name}</div>` : ""}
      ${desc ? `<div class="kk-promo-banner__desc">${desc}</div>` : ""}
    </div>
  `;
}

/* -------------------------
   NEW exports used by catalog
------------------------- */

/**
 * Small “badge” html (used next to price)
 * Example: 20% OFF / $5 OFF / BOGO
 */
export function getPromoBadgeHTML(promo) {
  if (!promo) return "";

  const type = String(promo.type || "").toLowerCase();
  let label = "PROMO";

  if (type === "percentage") label = `${Math.round(Number(promo.value || 0))}% OFF`;
  else if (type === "fixed") label = `$${fmtMoney(promo.value)} OFF`;
  else if (type === "bogo") label = "BOGO";
  else if (type === "free-shipping" || type === "free_shipping") label = "FREE SHIP";

  return `
    <span class="kk-promo-badge kk-promo-badge--${escapeHtml(type)}">
      ${escapeHtml(label)}
    </span>
  `;
}

/**
 * Card overlay banner html for catalog cards.
 * You pass promos[]; we pick the “best” display promo.
 */
export function getPromoCardBanner(promos = []) {
  const list = Array.isArray(promos) ? promos : [];
  if (!list.length) return "";

  // pick a display promo:
  // prefer percentage, then fixed, then bogo, then free shipping
  const byPriority = (p) => {
    const t = String(p?.type || "").toLowerCase();
    if (t === "percentage") return 1;
    if (t === "fixed") return 2;
    if (t === "bogo") return 3;
    if (t === "free-shipping" || t === "free_shipping") return 4;
    return 9;
  };

  const best = [...list].sort((a, b) => {
    const pa = byPriority(a);
    const pb = byPriority(b);
    if (pa !== pb) return pa - pb;

    // within same type, prefer higher value
    return Number(b?.value || 0) - Number(a?.value || 0);
  })[0];

  // Use your existing banner style (safe + consistent)
  return getPromoBanner(best);
}

/**
 * Optional “expires soon” message.
 * Catalog calls: getPromoExpiryMessage(promos[0])
 */
export function getPromoExpiryMessage(promo) {
  if (!promo) return "";

  const end = toDateSafe(promo.end_date);
  if (!end) return "";

  const d = daysUntil(end);
  if (d <= 0) return "Ends today";
  if (d === 1) return "Ends tomorrow";
  if (d <= 7) return `Ends in ${d} days`;

  return "";
}

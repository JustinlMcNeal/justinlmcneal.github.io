/**
 * utils.js — Pure stateless helpers for ebay-listings.
 * No DOM queries that require the page to be specific, no shared state.
 */

/** HTML-escape a value for safe insertion into template literals. */
export function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip unsafe tags/attributes from HTML before sending to eBay. */
export function sanitizeForEbay(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("script,iframe,form,input,link,style,object,embed,applet")
     .forEach(el => el.remove());
  div.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
    });
  });
  return div.innerHTML;
}

/**
 * Returns true when the HTML has inline-styled divs or tables — too
 * complex for Quill to round-trip cleanly, so we use HTML mode.
 */
export function isComplexHtml(html) {
  return /<div\s[^>]*style\s*=/i.test(html) || /<table/i.test(html);
}

/** Wrap Quill HTML in a branded eBay-safe description template. */
export function wrapDescription(title, quillHtml) {
  const clean = sanitizeForEbay(quillHtml);
  return `<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">` +
    `<h2 style="color:#333;">${esc(title)}</h2>` +
    clean +
    `<p style="margin-top:20px;font-size:12px;color:#666;">Thank you for shopping with Karry Kraze! 💕</p></div>`;
}

/**
 * Build a deduplicated, ordered array of image URLs from a product row
 * (catalog → primary → hover → gallery).  Max 24.
 */
export function buildImageUrls(product) {
  const urls = [];
  const seen = new Set();
  function add(url) { if (url && !seen.has(url)) { seen.add(url); urls.push(url); } }
  add(product.catalog_image_url);
  add(product.primary_image_url);
  add(product.catalog_hover_url);
  const gallery = (product.product_gallery_images || [])
    .filter(g => g.is_active)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  gallery.forEach(g => add(g.url));
  return urls.slice(0, 24);
}

/** Read package weight/dimensions from form inputs and return eBay payload. */
export function buildPackageWeightAndSize(prefix) {
  const w  = parseFloat(document.getElementById(`${prefix}WeightOz`).value);
  const l  = parseFloat(document.getElementById(`${prefix}DimL`).value);
  const wi = parseFloat(document.getElementById(`${prefix}DimW`).value);
  const h  = parseFloat(document.getElementById(`${prefix}DimH`).value);
  if (!w && !l && !wi && !h) return null;
  const pkg = {};
  if (w) pkg.weight = { value: w, unit: "OUNCE" };
  if (l || wi || h) pkg.dimensions = { length: l || 0, width: wi || 0, height: h || 0, unit: "INCH" };
  return pkg;
}

/** Read fulfillment/return/payment policy selects and return eBay payload. */
export function getSelectedPolicies(prefix) {
  const f = document.getElementById(`${prefix}FulfillmentPolicy`).value;
  const r = document.getElementById(`${prefix}ReturnPolicy`).value;
  const p = document.getElementById(`${prefix}PaymentPolicy`).value;
  const policies = {};
  if (f) policies.fulfillmentPolicyId = f;
  if (r) policies.returnPolicyId = r;
  if (p) policies.paymentPolicyId = p;
  return Object.keys(policies).length ? policies : null;
}

/** Read Best Offer inputs and return eBay bestOfferTerms payload. Throws on invalid combo. */
export function getBestOfferTerms(prefix) {
  const enabled = document.getElementById(`${prefix}BestOffer`).checked;
  if (!enabled) return { bestOfferEnabled: false };
  const autoAccept  = parseFloat(document.getElementById(`${prefix}AutoAccept`).value);
  const autoDecline = parseFloat(document.getElementById(`${prefix}AutoDecline`).value);
  if (autoAccept > 0 && autoDecline > 0 && autoAccept <= autoDecline) {
    throw new Error(`Best Offer: auto-accept ($${autoAccept}) must be higher than auto-decline ($${autoDecline})`);
  }
  const terms = { bestOfferEnabled: true };
  if (autoAccept  > 0) terms.autoAcceptPrice  = autoAccept.toFixed(2);
  if (autoDecline > 0) terms.autoDeclinePrice = autoDecline.toFixed(2);
  return terms;
}

/** Generate the eBay SKU for a variant from the base product code and option value. */
export function variantSkuFromOption(baseCode, optionValue) {
  const suffix = String(optionValue || "").toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
  return `${baseCode}-${suffix}`;
}

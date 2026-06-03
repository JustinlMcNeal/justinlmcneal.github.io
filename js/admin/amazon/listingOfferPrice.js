/** Live Amazon offer price helpers (customer-facing price from SP-API offers[]). */

/**
 * @param {unknown} rawListing
 * @param {string} [marketplaceId]
 * @returns {number | null}
 */
export function extractLiveOfferPrice(rawListing, marketplaceId = "ATVPDKIKX0DER") {
  const item = rawListing && typeof rawListing === "object" ? rawListing : null;
  if (!item) return null;

  const offers = Array.isArray(item.offers) ? item.offers : [];
  const mp = String(marketplaceId || "ATVPDKIKX0DER");

  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    if (typeof offer.marketplaceId === "string" && offer.marketplaceId !== mp) continue;
    const priceRec = offer.price && typeof offer.price === "object" ? offer.price : null;
    if (!priceRec) continue;
    const amount = priceRec.amount ?? priceRec.value;
    const num = typeof amount === "number" ? amount : Number(amount);
    if (Number.isFinite(num)) return num;
  }

  return null;
}

/**
 * @param {unknown} rawListing
 * @param {string} [marketplaceId]
 * @returns {number | null}
 */
export function extractAttributeOfferPrice(rawListing, marketplaceId = "ATVPDKIKX0DER") {
  const item = rawListing && typeof rawListing === "object" ? rawListing : null;
  if (!item) return null;

  const attrs = item.attributes && typeof item.attributes === "object" ? item.attributes : null;
  const rows = attrs?.purchasable_offer;
  if (!Array.isArray(rows)) return null;

  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.marketplace_id && entry.marketplace_id !== marketplaceId) continue;
    const ourPrice = Array.isArray(entry.our_price) ? entry.our_price : [];
    for (const priceEntry of ourPrice) {
      const schedule = Array.isArray(priceEntry?.schedule) ? priceEntry.schedule : [];
      const first = schedule[0];
      const valueWithTax = first?.value_with_tax;
      const amount = valueWithTax?.value ?? first?.value;
      const num = typeof amount === "number" ? amount : Number(amount);
      if (Number.isFinite(num)) return num;
    }
  }

  return null;
}

/**
 * Customer-facing Amazon price for admin UI (live offer preferred).
 * @param {Record<string, unknown>} row
 * @returns {number | null}
 */
export function listingDisplayPrice(row) {
  const live = Number(row.live_offer_price);
  if (Number.isFinite(live) && live > 0) return live;

  const stored = Number(row.price);
  if (Number.isFinite(stored) && stored > 0) return stored;

  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {number | null}
 */
export function listingPendingAttributePrice(row) {
  const attr = Number(row.attribute_price);
  if (!Number.isFinite(attr) || attr <= 0) return null;

  const live = listingDisplayPrice(row);
  if (live === null) return attr;
  if (Math.abs(attr - live) < 0.01) return null;
  return attr;
}

/**
 * Amazon image picker helpers (push draft + live listing patch).
 */

import { buildImageUrls } from "../ebayListings/utils.js";
import { renderImageStrip, showGalleryPicker } from "../ebayListings/images.js";

/** Amazon catalog listings: 1 main + up to 8 secondary images. */
export const AMAZON_MAX_IMAGES = 9;

/**
 * @param {unknown} rawListing
 * @param {string} [marketplaceId]
 * @returns {string[]}
 */
export function extractAmazonListingImageUrls(rawListing, marketplaceId = "ATVPDKIKX0DER") {
  const item = rawListing && typeof rawListing === "object" ? rawListing : null;
  if (!item) return [];

  /** @type {string[]} */
  const urls = [];
  const seen = new Set();

  function add(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed.startsWith("http") || seen.has(trimmed)) return;
    seen.add(trimmed);
    urls.push(trimmed);
  }

  const attrs = item.attributes && typeof item.attributes === "object"
    ? item.attributes
    : {};
  const main = attrs.main_product_image_locator;
  if (Array.isArray(main)) {
    for (const entry of main) {
      if (entry?.marketplace_id && entry.marketplace_id !== marketplaceId) continue;
      add(entry?.media_location);
    }
  }

  for (let slot = 1; slot <= 8; slot += 1) {
    const rows = attrs[`other_product_image_locator_${slot}`];
    if (!Array.isArray(rows)) continue;
    for (const entry of rows) {
      if (entry?.marketplace_id && entry.marketplace_id !== marketplaceId) continue;
      add(entry?.media_location);
    }
  }

  const summaries = Array.isArray(item.summaries) ? item.summaries : [];
  const summary = summaries.find((row) => row?.marketplaceId === marketplaceId) || summaries[0];
  const mainImage = summary?.mainImage;
  if (mainImage && typeof mainImage === "object") {
    add(mainImage.link || mainImage.url || mainImage.media_location);
  }

  return urls.slice(0, AMAZON_MAX_IMAGES);
}

/**
 * @param {unknown} attr
 * @param {string} [marketplaceId]
 */
function readMarketplaceAttributeText(attr, marketplaceId = "ATVPDKIKX0DER") {
  if (!Array.isArray(attr)) return "";
  const entry = attr.find((row) => !row?.marketplace_id || row.marketplace_id === marketplaceId) || attr[0];
  return String(entry?.value || "").trim();
}

/**
 * Pull listing copy fields from synced SP-API raw_listing for child relink drafts.
 * @param {unknown} rawListing
 * @param {string} [marketplaceId]
 */
export function extractAmazonListingCopyFields(rawListing, marketplaceId = "ATVPDKIKX0DER") {
  const item = rawListing && typeof rawListing === "object" ? rawListing : null;
  if (!item) {
    return { title: "", brand: "", description: "", bulletPoints: [] };
  }

  const attrs = item.attributes && typeof item.attributes === "object"
    ? item.attributes
    : {};

  const summaries = Array.isArray(item.summaries) ? item.summaries : [];
  const summary = summaries.find((row) => row?.marketplaceId === marketplaceId) || summaries[0];

  const title = readMarketplaceAttributeText(attrs.item_name, marketplaceId)
    || String(summary?.itemName || "").trim();

  const bulletPoints = Array.isArray(attrs.bullet_point)
    ? attrs.bullet_point
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object") return readMarketplaceAttributeText([entry], marketplaceId);
        return "";
      })
      .filter(Boolean)
    : [];

  return {
    title,
    brand: readMarketplaceAttributeText(attrs.brand, marketplaceId),
    description: readMarketplaceAttributeText(attrs.product_description, marketplaceId),
    bulletPoints,
    color: readMarketplaceAttributeText(attrs.color, marketplaceId),
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} product
 * @returns {string[]}
 */
export function buildAmazonProductImageUrls(product) {
  if (!product) return [];
  return buildImageUrls(product).slice(0, AMAZON_MAX_IMAGES);
}

/** Full KK image pool for Amazon gallery picker (includes variant previews). */
export function buildAmazonGalleryImageUrls(product) {
  if (!product) return [];

  const urls = [];
  const seen = new Set();
  function add(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed.startsWith("http") || seen.has(trimmed)) return;
    seen.add(trimmed);
    urls.push(trimmed);
  }

  for (const url of buildImageUrls(product)) add(url);

  const variants = Array.isArray(product.product_variants) ? product.product_variants : [];
  for (const variant of variants) {
    if (variant?.is_active === false) continue;
    add(variant.preview_image_url);
  }

  return urls;
}

const AMAZON_GALLERY_PICKER_OPTIONS = {
  showAll: true,
  buildAvailableUrls: buildAmazonGalleryImageUrls,
};

/** Amazon CDN URLs cannot be re-submitted as media_location — use KK-hosted URLs instead. */
export function isAmazonHostedImageUrl(url) {
  try {
    const host = new URL(String(url || "").trim()).hostname.toLowerCase();
    return (
      host === "m.media-amazon.com"
      || host.endsWith(".media-amazon.com")
      || host.endsWith(".ssl-images-amazon.com")
      || host.endsWith(".images-amazon.com")
    );
  } catch {
    return false;
  }
}

/** URLs safe to send to Amazon patchListingsItem image locators. */
export function filterAmazonPatchableImageUrls(urls) {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry.startsWith("http") && !isAmazonHostedImageUrl(entry))
    .slice(0, AMAZON_MAX_IMAGES);
}

/**
 * @param {string} stripId
 * @param {string} pickerId
 * @param {string[]} stateArr
 */
export function renderAmazonImageStrip(stripId, stateArr) {
  renderImageStrip(stripId, stateArr, stateArr, AMAZON_MAX_IMAGES);
}

/**
 * @param {string} stripId
 * @param {string} pickerId
 * @param {string[]} stateArr
 * @param {Record<string, unknown> | null | undefined} product
 */
export function showAmazonGalleryPicker(stripId, pickerId, stateArr, product) {
  if (!product) return;
  showGalleryPicker(
    pickerId,
    stripId,
    stateArr,
    product,
    AMAZON_MAX_IMAGES,
    AMAZON_GALLERY_PICKER_OPTIONS,
  );
}

/** @param {string} pickerId */
export function hideAmazonGalleryPicker(pickerId) {
  const picker = document.getElementById(pickerId);
  if (!picker) return;
  picker.classList.add("hidden");
  picker.innerHTML = "";
}

/**
 * @param {Record<string, unknown> | null | undefined} product
 * @param {string[]} [savedUrls]
 */
export function initAmazonImageUrls(product, savedUrls = []) {
  const defaults = buildAmazonProductImageUrls(product);
  const urls = Array.isArray(savedUrls) && savedUrls.length
    ? savedUrls.filter((url) => typeof url === "string" && url.startsWith("http")).slice(0, AMAZON_MAX_IMAGES)
    : defaults;
  return [...urls];
}

// Push modal element IDs
export const PUSH_IMAGE_STRIP_ID = "amazonPushImageStrip";
export const PUSH_IMAGE_PICKER_ID = "amazonPushImagePicker";
export const PUSH_IMAGE_COUNT_ID = "amazonPushImageCount";

export function renderAmazonPushImageStrip(stateArr) {
  renderAmazonImageStrip(PUSH_IMAGE_STRIP_ID, stateArr);
}

export function showAmazonPushGalleryPicker(stateArr, product) {
  showAmazonGalleryPicker(PUSH_IMAGE_STRIP_ID, PUSH_IMAGE_PICKER_ID, stateArr, product);
}

export function hideAmazonPushGalleryPicker() {
  hideAmazonGalleryPicker(PUSH_IMAGE_PICKER_ID);
}

/** @deprecated use AMAZON_MAX_IMAGES */
export const AMAZON_PUSH_MAX_IMAGES = AMAZON_MAX_IMAGES;

export function buildAmazonPushImageUrls(product) {
  return buildAmazonProductImageUrls(product);
}

export function initAmazonPushImages(product, savedUrls = []) {
  hideAmazonPushGalleryPicker();
  return initAmazonImageUrls(product, savedUrls);
}

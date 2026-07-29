import { amazonProductUrl } from "./listingsExport.js";

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {Record<string, unknown>} row
 */
export function kkProductPageUrl(row) {
  const slug = String(row.kk_product_slug || "").trim();
  if (slug) {
    return `/pages/product.html?slug=${encodeURIComponent(slug)}`;
  }

  const sku = String(row.kk_sku || "").trim();
  if (sku) {
    return `/pages/admin/products.html?q=${encodeURIComponent(sku)}`;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} row
 */
export function amazonListingPageUrl(row) {
  return amazonProductUrl(
    String(row.marketplace_id || ""),
    String(row.asin || ""),
  );
}

/**
 * @param {string} escapedLabel
 * @param {string | null} url
 * @param {{ mono?: boolean, bold?: boolean, title?: string }} [options]
 */
export function listingExternalLink(escapedLabel, url, options = {}) {
  if (!url) return escapedLabel;

  const classes = [
    "hover:text-kkpink hover:underline underline-offset-2",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-kkpink",
    options.mono ? "font-mono" : "",
    options.bold ? "font-bold" : "",
  ].filter(Boolean).join(" ");

  const title = options.title ? ` title="${escapeAttr(options.title)}"` : "";

  return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="${classes}"${title}>${escapedLabel}</a>`;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} escapedLabel
 * @param {string} rawLabel
 */
export function linkListingTitle(row, escapedLabel, rawLabel) {
  const kkUrl = kkProductPageUrl(row);
  if (kkUrl) {
    return listingExternalLink(escapedLabel, kkUrl, {
      bold: true,
      title: `Open KK product: ${rawLabel}`,
    });
  }

  const amazonUrl = amazonListingPageUrl(row);
  if (amazonUrl) {
    return listingExternalLink(escapedLabel, amazonUrl, {
      bold: true,
      title: `View on Amazon: ${rawLabel}`,
    });
  }

  return escapedLabel;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} escapedSku
 * @param {string} rawSku
 */
export function linkListingSku(row, escapedSku, rawSku) {
  if (!rawSku || rawSku === "—") return escapedSku;

  const kkUrl = kkProductPageUrl(row);
  if (kkUrl) {
    return listingExternalLink(escapedSku, kkUrl, {
      mono: true,
      title: `Open KK product (SKU ${rawSku})`,
    });
  }

  const amazonUrl = amazonListingPageUrl(row);
  if (amazonUrl) {
    return listingExternalLink(escapedSku, amazonUrl, {
      mono: true,
      title: `View on Amazon (SKU ${rawSku})`,
    });
  }

  return escapedSku;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} escapedAsin
 * @param {string} rawAsin
 */
export function linkListingAsin(row, escapedAsin, rawAsin) {
  if (!rawAsin || rawAsin === "—") return escapedAsin;

  const amazonUrl = amazonListingPageUrl(row);
  if (amazonUrl) {
    return listingExternalLink(escapedAsin, amazonUrl, {
      mono: true,
      title: `View on Amazon (ASIN ${rawAsin})`,
    });
  }

  const kkUrl = kkProductPageUrl(row);
  if (kkUrl) {
    return listingExternalLink(escapedAsin, kkUrl, {
      mono: true,
      title: `Open KK product (ASIN ${rawAsin})`,
    });
  }

  return escapedAsin;
}

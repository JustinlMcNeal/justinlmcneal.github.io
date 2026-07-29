import { VARIATION_ROLES } from "./variationFamily.js";

/**
 * Amazon product title / Item Highlights limits (Seller Central, Jul 27 2026):
 * - item_name (title): max 75 characters including spaces (all categories except media)
 * - title_differentiation (Item Highlights): max 125 characters; searchable; shows under title
 *   only when item_name is ≤ 75. Materials / use cases / differentiators — do not repeat title.
 * Product description length is unchanged (still long-form product_description).
 */
export const AMAZON_ITEM_NAME_MAX_LENGTH = 75;
export const AMAZON_ITEM_HIGHLIGHT_MAX_LENGTH = 125;

/** @param {unknown} text @param {number} [maxLength] */
function clampAtWordBoundary(text, maxLength) {
  const trimmed = String(text || "").trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length <= maxLength) return trimmed;
  let cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxLength * 0.6)) {
    cut = cut.slice(0, lastSpace);
  }
  return cut.trim();
}

/** @param {unknown} title @param {number} [maxLength] */
export function clampAmazonItemName(title, maxLength = AMAZON_ITEM_NAME_MAX_LENGTH) {
  return clampAtWordBoundary(title, maxLength);
}

/** @param {unknown} text @param {number} [maxLength] */
export function clampAmazonItemHighlight(text, maxLength = AMAZON_ITEM_HIGHLIGHT_MAX_LENGTH) {
  return clampAtWordBoundary(text, maxLength);
}

/**
 * When a long title is clamped, use the leftover phrase as Item Highlights seed.
 * @param {string} original
 * @param {string} clamped
 */
export function overflowFromClampedTitle(original, clamped) {
  const full = String(original || "").trim().replace(/\s+/g, " ");
  const short = String(clamped || "").trim().replace(/\s+/g, " ");
  if (!full || !short || full.length <= short.length) return "";
  let overflow = full.slice(short.length).trim();
  overflow = overflow.replace(/^[-–—,|:;/]+/, "").trim();
  return clampAmazonItemHighlight(overflow);
}

/**
 * Update title length counter + over-limit styling.
 * @param {HTMLInputElement | HTMLTextAreaElement | null} input
 * @param {HTMLElement | null} counter
 */
export function syncAmazonTitleLengthUi(input, counter) {
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return;
  const len = input.value.length;
  const max = AMAZON_ITEM_NAME_MAX_LENGTH;
  if (counter) {
    counter.textContent = `${len} / ${max}`;
    counter.classList.toggle("text-red-600", len > max);
    counter.classList.toggle("text-gray-400", len <= max);
  }
  input.classList.toggle("amazon-attr-control--missing", len > max);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {unknown} value */
function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * Client-side checks aligned with amazon-save-draft 400 guards.
 * @param {Record<string, unknown>} payload
 * @param {{ variantCount?: number }} [context]
 * @returns {Array<{ field: string, message: string }>}
 */
export function validateAmazonDraftSavePayload(payload, context = {}) {
  /** @type {Array<{ field: string, message: string }>} */
  const issues = [];

  if (!isUuid(payload.kkProductId)) {
    issues.push({
      field: "kkProductId",
      message: "KK product is missing. Close the modal and open Push to Amazon again from Ready to Push.",
    });
  }

  const marketplaceId = String(payload.marketplaceId || "").trim();
  if (!marketplaceId) {
    issues.push({ field: "marketplaceId", message: "Marketplace is required." });
  }

  const draftPayload = payload.draftPayload && typeof payload.draftPayload === "object"
    ? payload.draftPayload
    : {};
  const title = String(draftPayload.title || "").trim();
  if (!title) {
    issues.push({
      field: "title",
      message: "Amazon title is required before preview submit.",
    });
  } else if (title.length > AMAZON_ITEM_NAME_MAX_LENGTH) {
    issues.push({
      field: "title",
      message: `Amazon title must be ${AMAZON_ITEM_NAME_MAX_LENGTH} characters or less (Item Highlights policy; currently ${title.length}).`,
    });
  }

  const highlight = String(
    draftPayload.title_differentiation
    || draftPayload.item_highlight
    || "",
  ).trim();
  if (highlight.length > AMAZON_ITEM_HIGHLIGHT_MAX_LENGTH) {
    issues.push({
      field: "title_differentiation",
      message: `Item Highlights must be ${AMAZON_ITEM_HIGHLIGHT_MAX_LENGTH} characters or less (currently ${highlight.length}).`,
    });
  }

  const variationRole = String(payload.variationRole || "standalone");
  const kkVariantId = payload.kkVariantId ? String(payload.kkVariantId) : "";

  if (variationRole === VARIATION_ROLES.PARENT && kkVariantId) {
    issues.push({
      field: "kkVariantId",
      message: "Parent listings cannot be tied to a color variant. Clear variant selection or use Parent role only.",
    });
  }

  if (variationRole === VARIATION_ROLES.CHILD) {
    const parentSku = String(
      payload.parentSellerSku
      || draftPayload.child_parent_sku_relationship
      || "",
    ).trim();
    const theme = String(payload.variationTheme || draftPayload.variation_theme || "").trim();

    if (!parentSku) {
      issues.push({
        field: "parentSellerSku",
        message: "Link to Parent SKU (e.g. KK-0001-PARENT) is required for child listings.",
      });
    }
    if (!theme) {
      issues.push({
        field: "variationTheme",
        message: "Variation theme is required (e.g. COLOR_NAME).",
      });
    }

    const variantCount = Number(context.variantCount || 0);
    if (variantCount > 1 && !isUuid(kkVariantId)) {
      issues.push({
        field: "kkVariantId",
        message: "Select which color/variant this child listing is for in the variant picker.",
      });
    }

    const parentDraftId = payload.parentDraftId ? String(payload.parentDraftId) : "";
    if (parentDraftId && !isUuid(parentDraftId)) {
      issues.push({
        field: "parentDraftId",
        message: "Parent draft link is invalid. Re-open the push modal from Ready to Push.",
      });
    }
  }

  if (kkVariantId && !isUuid(kkVariantId)) {
    issues.push({
      field: "kkVariantId",
      message: "Variant ID on this draft is invalid. Re-select the variant in the push modal.",
    });
  }

  return issues;
}

/** @param {Array<{ field: string, message: string }>} issues */
export function draftSaveValidationMessage(issues) {
  if (!issues.length) return "";
  return issues.map((issue) => issue.message).join(" ");
}

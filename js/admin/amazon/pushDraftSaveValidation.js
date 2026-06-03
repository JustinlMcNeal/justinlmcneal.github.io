import { VARIATION_ROLES } from "./variationFamily.js";

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

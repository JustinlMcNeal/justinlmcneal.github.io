import { qs } from "./dom.js";
import { fetchAmazonDraftById } from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import {
  applyExtraAttributeDefaults,
  mergeAttributeNameLists,
  getExtendedAttributeHints,
  renderExtraAttributeFields,
  stripInvalidPushPayloadAttributes,
  filterFormAttributeNames,
} from "./pushDraftAttributes.js";
import { getLoadedAttributeEnums, getLoadedAttributeNames, getLoadedRequiredAttributes } from "./pushDraftPtd.js";
import { VARIATION_ROLES } from "./variationFamily.js";

const CHILD_INHERIT_SKIP = new Set([
  "title",
  "item_name",
  "sellerSku",
  "seller_sku",
  "price",
  "quantity",
  "color",
  "merchant_suggested_asin",
  "matchedAsin",
  "matched_asin",
  "asin",
  "imageUrls",
  "image_urls",
  "mainImageUrl",
  "variation_role",
  "parentage_level",
  "child_parent_sku_relationship",
  "variation_theme",
  "parent_seller_sku",
  "kk_variant_id",
  "kkVariantId",
  "amazonProductTypeRecommendation",
]);

function readInput(id) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim();
  }
  return "";
}

function setInput(id, value) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = value ?? "";
  }
}

function readVariationRole() {
  const hidden = qs("#amazonPushVariationRole");
  return hidden instanceof HTMLInputElement ? hidden.value.trim() : "";
}

/**
 * @param {string} baseTitle
 * @param {string} variantLabel
 */
function titleWithVariantColor(baseTitle, variantLabel) {
  const title = String(baseTitle || "").trim();
  const label = String(variantLabel || "").trim();
  if (!title || !label) return title;
  const pattern = new RegExp(`\\(${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\s*$`, "i");
  if (pattern.test(title)) return title;
  if (title.toLowerCase().includes(label.toLowerCase())) return title;
  return `${title} (${label})`;
}

/**
 * @param {Record<string, unknown>} parentPayload
 */
function extractInheritedExtras(parentPayload) {
  /** @type {Record<string, string>} */
  const extras = {};
  for (const [key, value] of Object.entries(parentPayload)) {
    if (CHILD_INHERIT_SKIP.has(key)) continue;
    if (typeof value === "string" && value.trim()) {
      extras[key] = value.trim();
      continue;
    }
    if (Array.isArray(value) && key === "bulletPoints") continue;
  }
  return extras;
}

/**
 * Copy shared parent draft fields into a new child push form (variant-specific fields stay local).
 * @param {Record<string, unknown> | null | undefined} familyContext
 * @param {{
 *   variantLabel?: string,
 *   productTitle?: string,
 *   productType?: string,
 *   hasExistingChildDraft?: boolean,
 * }} options
 */
export async function applyParentDraftInheritance(familyContext, options = {}) {
  if (options.hasExistingChildDraft) return false;
  if (readVariationRole() !== VARIATION_ROLES.CHILD) return false;

  const parentDraftId = familyContext?.parentDraft?.id
    ? String(familyContext.parentDraft.id)
    : "";
  if (!parentDraftId) return false;

  let parentRow = null;
  try {
    parentRow = await fetchAmazonDraftById(parentDraftId);
  } catch {
    return false;
  }

  const parentPayload = parentRow?.draft_payload;
  if (!parentPayload || typeof parentPayload !== "object") return false;

  const cleanedParent = stripInvalidPushPayloadAttributes(
    /** @type {Record<string, unknown>} */ (parentPayload),
  );
  const productType = String(
    options.productType
    || cleanedParent.productType
    || parentRow.product_type
    || readInput("#amazonPushProductType")
    || "",
  ).trim();

  if (productType && !readInput("#amazonPushProductType")) {
    setInput("#amazonPushProductType", productType);
  }

  if (!readInput("#amazonPushBrand") && cleanedParent.brand) {
    setInput("#amazonPushBrand", String(cleanedParent.brand));
  }
  if (!readInput("#amazonPushDescription") && cleanedParent.description) {
    setInput("#amazonPushDescription", String(cleanedParent.description));
  }

  const parentBullets = Array.isArray(cleanedParent.bulletPoints)
    ? cleanedParent.bulletPoints.map((line) => String(line).trim()).filter(Boolean)
    : Array.isArray(cleanedParent.bullet_point)
      ? cleanedParent.bullet_point.map((line) => String(line).trim()).filter(Boolean)
      : [];
  if (!readInput("#amazonPushBulletPoints") && parentBullets.length) {
    setInput("#amazonPushBulletPoints", parentBullets.join("\n"));
  }

  if (!readInput("#amazonPushConditionType") && cleanedParent.conditionType) {
    setInput("#amazonPushConditionType", String(cleanedParent.conditionType));
  }
  if (!readInput("#amazonPushFulfillmentChannel") && cleanedParent.fulfillmentChannel) {
    setInput("#amazonPushFulfillmentChannel", String(cleanedParent.fulfillmentChannel));
  }

  const parentTitle = String(cleanedParent.title || cleanedParent.item_name || "").trim();
  if (!readInput("#amazonPushAmazonTitle") && parentTitle) {
    const variantTitle = titleWithVariantColor(
      parentTitle,
      options.variantLabel || "",
    );
    setInput("#amazonPushAmazonTitle", variantTitle || parentTitle);
  } else if (readInput("#amazonPushAmazonTitle") && options.variantLabel) {
    setInput(
      "#amazonPushAmazonTitle",
      titleWithVariantColor(readInput("#amazonPushAmazonTitle"), options.variantLabel),
    );
  } else if (!readInput("#amazonPushAmazonTitle") && options.productTitle && options.variantLabel) {
    setInput(
      "#amazonPushAmazonTitle",
      titleWithVariantColor(options.productTitle, options.variantLabel),
    );
  }

  const inheritedExtras = extractInheritedExtras(cleanedParent);
  const attributeNames = filterFormAttributeNames(
    mergeAttributeNameLists(
      getLoadedRequiredAttributes(),
      getLoadedAttributeNames(),
      getExtendedAttributeHints(productType),
      Object.keys(inheritedExtras),
    ),
    productType,
  );

  if (attributeNames.length) {
    renderExtraAttributeFields(attributeNames, inheritedExtras, {
      productType,
      attributeEnums: getLoadedAttributeEnums(),
    });
    applyExtraAttributeDefaults(attributeNames, {
      productType,
      attributeEnums: getLoadedAttributeEnums(),
    });

    for (const [name, value] of Object.entries(inheritedExtras)) {
      if (name === "color" && options.variantLabel) {
        const control = qs(`#amazonPushExtraAttributes [data-amazon-attr="${name}"]`);
        if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
          if (!control.value.trim()) control.value = options.variantLabel;
        }
        continue;
      }
      const control = qs(`#amazonPushExtraAttributes [data-amazon-attr="${name}"]`);
      if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) continue;
      if (!control.value.trim()) control.value = value;
    }
  }

  showAmazonNotification(
    "Copied shared fields from the parent draft (product type, compliance attributes, description, bullets). Adjust color, images, SKU, and title for this variant, then save.",
    { tone: "info" },
  );
  return true;
}

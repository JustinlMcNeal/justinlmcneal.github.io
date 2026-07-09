// Convert amazon_listing_drafts payload into conservative Listings Items PUT body.

import { signSpApiRequest, spApiHintForHttpStatus } from "./amazonSigV4Utils.ts";
import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";
import type { ValidationIssue } from "./amazonDraftValidationUtils.ts";

export type DraftRowForListing = {
  seller_sku: string | null;
  marketplace_id: string | null;
  product_type: string | null;
  requirements: string | null;
  matched_asin: string | null;
  asin: string | null;
  draft_payload: Record<string, unknown> | null;
  variation_role?: string | null;
  parent_seller_sku?: string | null;
  variation_theme?: string | null;
  parentage_level?: string | null;
};

export type ListingsItemRequestBody = {
  productType: string;
  requirements: string;
  attributes: Record<string, unknown>;
};

export type PutListingsResult =
  | {
    ok: true;
    httpStatus: number;
    submissionId: string | null;
    submissionStatus: string;
    issues: Record<string, unknown>[];
    rawResponse: Record<string, unknown>;
  }
  | { ok: false; error: string; httpStatus?: number; hint?: string };

/** @deprecated Use PutListingsResult */
export type PutListingsPreviewResult = PutListingsResult;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function numericValue(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function marketplaceAttribute(
  marketplaceId: string,
  value: string,
  languageTag = "en_US",
): Record<string, unknown>[] {
  return [{
    marketplace_id: marketplaceId,
    language_tag: languageTag,
    value,
  }];
}

const RESERVED_DRAFT_PAYLOAD_KEYS = new Set([
  "title",
  "item_name",
  "itemName",
  "brand",
  "description",
  "product_description",
  "productDescription",
  "bulletPoints",
  "bullet_point",
  "bulletPoint",
  "conditionType",
  "condition_type",
  "price",
  "quantity",
  "fulfillmentChannel",
  "fulfillment_channel",
  "productType",
  "matchedAsin",
  "matched_asin",
  "asin",
  "upc",
  "ean",
  "amazonProductTypeRecommendation",
  "list_price",
  "item_dimensions",
  "item_length_width_height",
  "imageUrls",
  "image_urls",
  "mainImageUrl",
  "variation_role",
  "parent_seller_sku",
]);

const BOOLEAN_ATTRIBUTES = new Set([
  "supplier_declared_has_product_identifier_exemption",
  "is_assembly_required",
  "batteries_required",
  "batteries_included",
  "is_refurbished",
]);

function parseBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

const LANGUAGE_TAG_ATTRIBUTES = new Set([
  "item_name",
  "brand",
  "product_description",
  "bullet_point",
  "target_audience_keyword",
  "target_audience",
  "lining_description",
  "special_feature",
  "age_range_description",
  "material",
  "included_components",
  "generic_keyword",
  "educational_objective",
  "model_name",
  "manufacturer",
  "color",
  "theme",
  "subject_character",
  "department",
  "import_designation",
  "size",
  "care_instructions",
  "fabric_type",
  "title_differentiation",
  "special_size_type",
  "lifestyle",
  "pattern_type",
  "gem_type",
  "special_feature",
  "style",
  "strap_type",
]);

/** Browse-tree codes and similar attrs use marketplace_id only (no language_tag). */
const MARKETPLACE_ONLY_ATTRIBUTES = new Set([
  "item_type_keyword",
]);

const THEME_VALUE_ALIASES: Record<string, string> = {
  flowers: "Floral",
  flower: "Floral",
};

const ITEM_TYPE_KEYWORD_ALIASES: Record<string, string> = {
  "stuffed-animal-toys": "plush-animal-toys",
  "plush-pillows": "childrens-plush-toy-pillows",
  "plush-figure": "plush-figure-toys",
  keychain: "key-chains",
  keychains: "key-chains",
  "brooches-and-pins": "brooches-and-pins",
  "brooches_and_pins": "brooches-and-pins",
  "lapel-pins": "brooches-and-pins",
  "enamel-pins": "brooches-and-pins",
};

const MARKETPLACE_ENUM_ATTRIBUTES = new Set([
  "cpsia_cautionary_statement",
  "safety_warning",
  "toy_figure_type",
  "parentage_level",
  "package_level",
]);

const NUMERIC_ATTRIBUTES = new Set([
  "manufacturer_minimum_age",
  "manufacturer_maximum_age",
  "number_of_items",
  "number_of_compartments",
]);

const PRODUCT_TYPE_EXCLUDED_ATTRIBUTES: Record<string, Set<string>> = {
  TOY_FIGURE: new Set([
    "educational_objective",
    "item_dimensions",
    "supplier_declared_dg_hz_regulation",
  ]),
  HAT: new Set([
    "package_level",
    "included_components",
    "variation_role",
    "closure",
    "size",
    "special_feature",
    "cpsia_cautionary_statement",
    "safety_warning",
    "toy_figure_type",
    "subject_character",
    "educational_objective",
    "plant_or_animal_product_type",
    "specific_uses_for_product",
    "indoor_outdoor_usage",
    "item_dimensions",
    "item_length_width_height",
  ]),
  KEYCHAIN: new Set([
    "cpsia_cautionary_statement",
    "safety_warning",
    "educational_objective",
    "is_assembly_required",
    "target_audience_keyword",
    "age_range_description",
    "manufacturer_minimum_age",
    "manufacturer_maximum_age",
    "toy_figure_type",
    "subject_character",
    "item_length_width_height",
    "item_dimensions",
    "package_level",
  ]),
  APPAREL_PIN: new Set([
    "package_level",
    "included_components",
    "theme",
    "variation_role",
    "closure",
    "special_feature",
    "fabric_type",
    "cpsia_cautionary_statement",
    "safety_warning",
    "toy_figure_type",
    "subject_character",
    "educational_objective",
    "plant_or_animal_product_type",
  ]),
  APPAREL_BELT: new Set([
    "package_level",
    "included_components",
    "theme",
    "variation_role",
    "parentage_level",
    "child_parent_sku_relationship",
    "variation_theme",
    "closure",
    "special_feature",
    "headwear_size",
    "seasons",
    "style",
    "metals",
    "metal_type",
    "stones",
    "gem_type",
    "cpsia_cautionary_statement",
    "safety_warning",
    "toy_figure_type",
    "subject_character",
    "educational_objective",
    "plant_or_animal_product_type",
    "specific_uses_for_product",
    "indoor_outdoor_usage",
    "item_shape",
    "container",
    "is_refurbished",
    "item_depth_width_height",
  ]),
  HANDBAG: new Set([
    "package_level",
    "variation_role",
    "parentage_level",
    "child_parent_sku_relationship",
    "variation_theme",
    "headwear_size",
    "special_size_type",
    "care_instructions",
    "metals",
    "metal_type",
    "stones",
    "gem_type",
    "size",
    "cpsia_cautionary_statement",
    "safety_warning",
    "toy_figure_type",
    "subject_character",
    "educational_objective",
    "plant_or_animal_product_type",
    "specific_uses_for_product",
    "indoor_outdoor_usage",
    "item_shape",
    "container",
    "is_refurbished",
    "item_depth_width_height",
    "target_audience_keyword",
  ]),
  TOTE_BAG: new Set([
    "package_level",
    "included_components",
    "variation_role",
    "parentage_level",
    "child_parent_sku_relationship",
    "variation_theme",
    "headwear_size",
    "special_size_type",
    "care_instructions",
    "metals",
    "metal_type",
    "stones",
    "gem_type",
    "size",
    "cpsia_cautionary_statement",
    "safety_warning",
    "toy_figure_type",
    "subject_character",
    "educational_objective",
    "plant_or_animal_product_type",
    "specific_uses_for_product",
    "indoor_outdoor_usage",
    "item_shape",
    "container",
    "is_refurbished",
    "item_depth_width_height",
    "item_dimensions",
    "target_audience_keyword",
    "target_audience",
  ]),
};

const VARIATION_ATTRIBUTES = new Set([
  "parentage_level",
  "child_parent_sku_relationship",
  "variation_theme",
]);

const BAG_LIKE_PRODUCT_TYPES = new Set(["HANDBAG", "TOTE_BAG"]);

function isBagLikeProductType(productType = ""): boolean {
  return BAG_LIKE_PRODUCT_TYPES.has(String(productType || "").trim().toUpperCase());
}

function readParentSkuFromPayload(draftPayload: Record<string, unknown>): string | null {
  const rel = draftPayload.child_parent_sku_relationship;
  if (typeof rel === "string") return textValue(rel);
  if (Array.isArray(rel) && rel[0] && typeof rel[0] === "object") {
    return textValue((rel[0] as Record<string, unknown>).parent_sku);
  }
  return textValue(draftPayload.parent_seller_sku);
}

/** Merge draft row variation columns into payload for build + validation. */
export function enrichDraftPayloadFromRow(draft: DraftRowForListing): Record<string, unknown> {
  const payload = { ...(asRecord(draft.draft_payload) ?? {}) };
  const role = String(draft.variation_role || payload.variation_role || "").trim().toLowerCase();
  const parentageCol = String(draft.parentage_level || "").trim().toLowerCase();
  const parentagePayload = textValue(payload.parentage_level)?.toLowerCase() || "";

  if (role === "child" || parentageCol === "child" || parentagePayload === "child") {
    payload.parentage_level = payload.parentage_level || "child";
    payload.variation_role = "child";
  } else if (role === "parent" || parentageCol === "parent" || parentagePayload === "parent") {
    payload.parentage_level = payload.parentage_level || "parent";
    payload.variation_role = "parent";
  }

  const parentSku = textValue(draft.parent_seller_sku) || readParentSkuFromPayload(payload);
  if (parentSku && !readParentSkuFromPayload(payload)) {
    payload.child_parent_sku_relationship = parentSku;
    payload.parent_seller_sku = parentSku;
  }

  const theme = textValue(draft.variation_theme) || textValue(payload.variation_theme);
  if (theme) payload.variation_theme = theme;

  return payload;
}

function hasCompleteVariationSetup(draftPayload: Record<string, unknown>): boolean {
  const parentageLevel = textValue(draftPayload.parentage_level)?.toLowerCase();
  const childRelationship = readParentSkuFromPayload(draftPayload);
  const variationTheme = textValue(draftPayload.variation_theme);

  if (parentageLevel === "parent") return Boolean(variationTheme);
  if (parentageLevel === "child") return Boolean(childRelationship && variationTheme);
  return false;
}

function stripIncompleteVariationAttributes(
  attributes: Record<string, unknown>,
  draftPayload: Record<string, unknown>,
): void {
  if (hasCompleteVariationSetup(draftPayload)) return;
  for (const key of VARIATION_ATTRIBUTES) {
    delete attributes[key];
  }
}

function buildVariationThemeAttribute(
  theme: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const name = theme.trim();
  if (!name) return null;
  return [{ name, marketplace_id: marketplaceId }];
}

function buildChildParentSkuRelationshipAttribute(
  parentSku: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const sku = parentSku.trim();
  if (!sku) return null;
  return [{
    marketplace_id: marketplaceId,
    child_relationship_type: "variation",
    parent_sku: sku,
  }];
}

function appendVariationAttributesFromPayload(
  attributes: Record<string, unknown>,
  draftPayload: Record<string, unknown>,
  marketplaceId: string,
): void {
  if (!hasCompleteVariationSetup(draftPayload)) {
    stripIncompleteVariationAttributes(attributes, draftPayload);
    return;
  }

  const parentageLevel = textValue(draftPayload.parentage_level)?.toLowerCase();
  const variationTheme = textValue(draftPayload.variation_theme);
  const parentSku = readParentSkuFromPayload(draftPayload);

  if (parentageLevel === "parent" || parentageLevel === "child") {
    attributes.parentage_level = buildSimpleAttribute(
      "parentage_level",
      marketplaceId,
      parentageLevel,
    );
  }

  if (variationTheme) {
    const themeAttr = buildVariationThemeAttribute(variationTheme, marketplaceId);
    if (themeAttr) attributes.variation_theme = themeAttr;
  }

  if (parentageLevel === "child" && parentSku) {
    const rel = buildChildParentSkuRelationshipAttribute(parentSku, marketplaceId);
    if (rel) attributes.child_parent_sku_relationship = rel;
  }
}

export function isVariationParentDraftPayload(draftPayload: Record<string, unknown>): boolean {
  return textValue(draftPayload.parentage_level)?.toLowerCase() === "parent";
}

const AMAZON_ENUM_ALIASES: Record<string, string> = {
  nowarningapplicable: "no_warning_applicable",
  "no warning applicable": "no_warning_applicable",
  no_warning_applicable: "no_warning_applicable",
  chokinghazardsmallparts: "choking_hazard_small_parts",
  "choking hazard small parts": "choking_hazard_small_parts",
  plush: "stuffed_toy",
  stuffed: "stuffed_toy",
  stuffed_animal: "stuffed_toy",
  soft_toy: "stuffed_toy",
  "stuffed toy": "stuffed_toy",
};

function normalizeAmazonEnumValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const folded = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  return AMAZON_ENUM_ALIASES[folded] || AMAZON_ENUM_ALIASES[trimmed.toLowerCase()] || trimmed;
}

function parseDimensionUnit(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("centimeter") || lower.includes(" cm")) return "centimeters";
  if (lower.includes("millimeter") || lower.includes(" mm")) return "millimeters";
  return "inches";
}

function buildItemDimensionsFromText(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "item_dimensions") return null;

  const numbers = cleaned.match(/[\d.]+/g);
  if (!numbers || numbers.length < 3) return null;

  const unit = parseDimensionUnit(cleaned);
  const height = Number(numbers[0]);
  const width = Number(numbers[1]);
  const length = Number(numbers[2]);
  if (![height, width, length].every(Number.isFinite)) return null;

  return [{
    marketplace_id: marketplaceId,
    height: { value: height, unit },
    width: { value: width, unit },
    length: { value: length, unit },
  }];
}

function buildItemLengthWidthHeightFromText(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "item_length_width_height") return null;

  const numbers = cleaned.match(/[\d.]+/g);
  if (!numbers || numbers.length < 3) return null;

  const unit = parseDimensionUnit(cleaned);
  const length = Number(numbers[0]);
  const width = Number(numbers[1]);
  const height = Number(numbers[2]);
  if (![length, width, height].every(Number.isFinite)) return null;

  return [{
    marketplace_id: marketplaceId,
    length: { value: length, unit },
    width: { value: width, unit },
    height: { value: height, unit },
  }];
}

function buildItemDepthWidthHeightFromText(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "item_depth_width_height") return null;

  const numbers = cleaned.match(/[\d.]+/g);
  if (!numbers || numbers.length < 3) return null;

  const unit = parseDimensionUnit(cleaned);
  const depth = Number(numbers[0]);
  const width = Number(numbers[1]);
  const height = Number(numbers[2]);
  if (![depth, width, height].every(Number.isFinite)) return null;

  return [{
    marketplace_id: marketplaceId,
    depth: { value: depth, unit },
    width: { value: width, unit },
    height: { value: height, unit },
  }];
}

function buildItemPackageDimensionsFromText(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const dimensions = buildItemLengthWidthHeightFromText(text, marketplaceId);
  if (!dimensions) return null;
  return dimensions.map((entry) => ({
    ...entry,
    length: { ...(entry.length as Record<string, unknown>), unit: "inches" },
    width: { ...(entry.width as Record<string, unknown>), unit: "inches" },
    height: { ...(entry.height as Record<string, unknown>), unit: "inches" },
  }));
}

function parseWeightUnit(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("ounce") || /\boz\b/.test(lower)) return "ounces";
  if (lower.includes("gram") || /\bg\b/.test(lower)) return "grams";
  if (lower.includes("kilogram") || /\bkg\b/.test(lower)) return "kilograms";
  return "pounds";
}

function buildWeightFromText(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const numbers = cleaned.match(/[\d.]+/g);
  if (!numbers?.length) return null;

  const value = Number(numbers[0]);
  if (!Number.isFinite(value) || value <= 0) return null;

  return [{
    marketplace_id: marketplaceId,
    value,
    unit: parseWeightUnit(cleaned),
  }];
}

function buildItemPackageWeightFromText(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  return buildWeightFromText(text, marketplaceId);
}

function buildItemWeightFromText(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  return buildWeightFromText(text, marketplaceId);
}

function buildClosureAttribute(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "closure") return null;

  return [{
    marketplace_id: marketplaceId,
    type: [{
      value: cleaned,
      language_tag: "en_US",
    }],
  }];
}

function normalizeSizeInfoToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "small";
  const folded = trimmed.toLowerCase().replace(/[\s/]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (folded === "mini" || folded === "mini_small" || folded === "small") return "small";
  if (folded.includes("mini") && folded.includes("small")) return "small";
  if (folded === "one_size" || folded === "one size") return "one_size";
  if (folded === "medium" || folded === "med") return "medium";
  if (folded === "large") return "large";
  return folded;
}

function buildSizeInfoAttribute(
  text: string,
  marketplaceId: string,
  productType = "",
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "size_info") return null;

  let displayName = cleaned;
  if (cleaned.includes("|")) {
    const parts = cleaned.split("|").map((part) => part.trim());
    displayName = parts[2] || parts[1] || parts[0] || cleaned;
  }

  if (isBagLikeProductType(productType)) {
    return [{
      marketplace_id: marketplaceId,
      display_name: [{
        value: displayName,
        language_tag: "en_US",
      }],
    }];
  }

  let sizeClass = "alpha";
  let size = "small";

  if (cleaned.includes("|")) {
    const parts = cleaned.split("|").map((part) => part.trim());
    sizeClass = normalizeHeadwearSizeToken(parts[0] || "alpha") || "alpha";
    size = normalizeSizeInfoToken(parts[1] || "small");
    displayName = parts[2] || parts[1] || cleaned;
  } else if (cleaned.includes("/")) {
    displayName = cleaned;
    size = normalizeSizeInfoToken(cleaned);
  } else {
    size = normalizeSizeInfoToken(cleaned);
    displayName = cleaned;
  }

  if (sizeClass === "size_info") sizeClass = "alpha";

  return [{
    marketplace_id: marketplaceId,
    size_system: "as1",
    size_class: sizeClass,
    size,
    size_display_name: [{
      value: displayName,
      language_tag: "en_US",
    }],
  }];
}

function normalizeCapacityUnit(raw: string): string {
  const folded = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!folded) return "liters";
  if (folded.includes("cubic") && folded.includes("inch")) return "cubic_inches";
  if (folded.includes("cubic") && (folded.includes("centimeter") || folded.includes("cm"))) {
    return "cubic_centimeters";
  }
  if (folded.includes("liter") || folded === "l") return "liters";
  if (folded.includes("ounce") || folded === "oz") return "fluid_ounces";
  return folded;
}

function buildCapacityAttribute(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "capacity") return null;

  let value: number | null = null;
  let unit = "liters";

  if (cleaned.includes("|")) {
    const [rawValue, rawUnit = "liters"] = cleaned.split("|").map((part) => part.trim());
    value = numericValue(rawValue);
    unit = normalizeCapacityUnit(rawUnit);
  } else {
    const numbers = cleaned.match(/[\d.]+/g);
    value = numbers?.length ? Number(numbers[0]) : null;
    unit = normalizeCapacityUnit(cleaned);
    if (!numbers?.length) {
      value = 1.5;
      unit = "liters";
    }
  }

  if (value === null || !Number.isFinite(value) || value <= 0) return null;

  return [{
    marketplace_id: marketplaceId,
    value,
    unit,
  }];
}

function buildMaterialLayerAttribute(
  text: string,
  marketplaceId: string,
  attributeName: "outer" | "inner",
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === attributeName) return null;

  return [{
    marketplace_id: marketplaceId,
    material: [{
      value: cleaned,
      language_tag: "en_US",
    }],
  }];
}

function normalizeHeadwearSizeToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().replace(/\s+/g, " ") === "one size") return "one_size";
  return trimmed.replace(/\s+/g, "_").toLowerCase();
}

function buildHeadwearSizeAttribute(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "headwear_size") return null;

  let sizeClass = "alpha";
  let sizeValue = "one_size";

  if (cleaned.includes("|")) {
    const parts = cleaned.split("|").map((part) => part.trim());
    sizeClass = normalizeHeadwearSizeToken(parts[0] || "alpha") || "alpha";
    sizeValue = normalizeHeadwearSizeToken(parts[1] || "one_size") || "one_size";
  } else {
    sizeValue = normalizeHeadwearSizeToken(cleaned) || "one_size";
  }

  if (sizeClass === "headwear_size") sizeClass = "alpha";

  return [{
    marketplace_id: marketplaceId,
    size_system: "as1",
    size_class: sizeClass,
    headwear_size_class: sizeClass,
    size: sizeValue,
  }];
}

function normalizeMetalsCompositeType(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Alloy";
  if (trimmed.toLowerCase() === "alloy") return "Alloy";
  if (trimmed.toLowerCase() === "stainless-steel" || trimmed.toLowerCase() === "stainless steel") {
    return "Stainless Steel";
  }
  return trimmed;
}

function normalizeMetalStampValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "No Metal Stamp";
  const folded = trimmed.toLowerCase();
  if (folded === "no stamp" || folded === "no metal stamp" || folded === "no-metal-stamp") {
    return "No Metal Stamp";
  }
  return trimmed;
}

function parseCompositeId(value: string): number {
  const num = Number.parseInt(value.trim(), 10);
  return Number.isFinite(num) && num > 0 ? num : 1;
}

function jewelryLanguageValue(value: string, fallback: string): Record<string, string> {
  const cleaned = value.trim() || fallback;
  return { value: cleaned, language_tag: "en_US" };
}

function normalizeStoneTreatmentValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Not Treated";
  const folded = trimmed.toLowerCase();
  if (folded === "not applicable" || folded === "not_applicable" || folded === "n/a") {
    return "Not Treated";
  }
  return trimmed;
}

function normalizeStoneCreationValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Unknown";
  const folded = trimmed.toLowerCase();
  if (folded === "not applicable" || folded === "not_applicable" || folded === "n/a") {
    return "Unknown";
  }
  return trimmed;
}

function buildMetalsAttribute(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "metals") return null;

  let metalType = "Alloy";
  let metalStamp = "No Metal Stamp";
  let id = 1;

  if (cleaned.includes("|")) {
    const parts = cleaned.split("|").map((part) => part.trim());
    metalType = normalizeMetalsCompositeType(parts[0] || "Alloy");
    metalStamp = normalizeMetalStampValue(parts[1] || "No Metal Stamp");
    id = parseCompositeId(parts[2] || "1");
  } else {
    metalType = normalizeMetalsCompositeType(cleaned);
  }

  return [{
    marketplace_id: marketplaceId,
    id,
    metal_type: jewelryLanguageValue(metalType, "Alloy"),
    metal_stamp: jewelryLanguageValue(metalStamp, "No Metal Stamp"),
  }];
}

function normalizeStoneTypeToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "No Gemstone";
  const folded = trimmed.toLowerCase().replace(/[\s_-]+/g, " ");
  if (folded === "no gemstone" || folded === "none" || folded === "no stone") return "No Gemstone";
  return trimmed;
}

function buildStonesAttribute(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "stones") return null;

  let stoneType = "No Gemstone";
  let treatmentMethod = "Not Treated";
  let creationMethod = "Unknown";
  let id = 1;

  if (cleaned.includes("|")) {
    const parts = cleaned.split("|").map((part) => part.trim());
    stoneType = normalizeStoneTypeToken(parts[0] || "No Gemstone");
    if (parts.length >= 4) {
      treatmentMethod = normalizeStoneTreatmentValue(parts[1] || "Not Treated");
      creationMethod = normalizeStoneCreationValue(parts[2] || "Unknown");
      id = parseCompositeId(parts[3] || "1");
    } else {
      id = parseCompositeId(parts[1] || "1");
    }
  } else {
    stoneType = normalizeStoneTypeToken(cleaned);
  }

  return [{
    marketplace_id: marketplaceId,
    id,
    type: jewelryLanguageValue(stoneType, "No Gemstone"),
    treatment_method: jewelryLanguageValue(treatmentMethod, "Not Treated"),
    creation_method: jewelryLanguageValue(creationMethod, "Unknown"),
  }];
}

function buildContainerAttribute(
  text: string,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned === "container") return null;

  return [{
    marketplace_id: marketplaceId,
    type: [{
      value: cleaned,
      language_tag: "en_US",
    }],
  }];
}

const ARTIFICIAL_PLANT_OR_ANIMAL_TYPES = new Set([
  "Artificial Plant",
  "Artificial Flower",
]);

function normalizePlantOrAnimalProductType(value: string): string {
  const trimmed = value.trim();
  if (ARTIFICIAL_PLANT_OR_ANIMAL_TYPES.has(trimmed)) return trimmed;
  return "Artificial Plant";
}

function normalizeIndoorOutdoorUsage(value: string): string {
  const folded = value.trim().toLowerCase().replace(/[\s-/]+/g, "_");
  if (folded === "indoor" || folded === "indoor_only") return "indoor";
  if (folded === "outdoor" || folded === "outdoor_only") return "outdoor";
  if (folded === "indoor_outdoor" || folded === "indoor_and_outdoor" || folded === "indooroutdoor") {
    return "indoor_outdoor";
  }
  return folded;
}

function normalizeAttributeTextValue(attributeName: string, value: string): string {
  if (attributeName === "theme") {
    const alias = THEME_VALUE_ALIASES[value.trim().toLowerCase()];
    if (alias) return alias;
  }
  if (attributeName === "item_type_keyword") {
    const alias = ITEM_TYPE_KEYWORD_ALIASES[value.trim().toLowerCase()];
    if (alias) return alias;
  }
  return value;
}

function buildSimpleAttribute(
  attributeName: string,
  marketplaceId: string,
  value: string,
): Record<string, unknown>[] {
  const aliasedValue = normalizeAttributeTextValue(attributeName, value);
  const normalizedValue = MARKETPLACE_ENUM_ATTRIBUTES.has(attributeName)
    ? normalizeAmazonEnumValue(aliasedValue)
    : aliasedValue;
  if (MARKETPLACE_ONLY_ATTRIBUTES.has(attributeName)) {
    return [{ value: normalizedValue, marketplace_id: marketplaceId }];
  }
  if (BOOLEAN_ATTRIBUTES.has(attributeName)) {
    const boolValue = parseBooleanValue(normalizedValue);
    if (boolValue === null) return [{ value: normalizedValue, marketplace_id: marketplaceId }];
    return [{ value: boolValue, marketplace_id: marketplaceId }];
  }
  if (NUMERIC_ATTRIBUTES.has(attributeName)) {
    const num = numericValue(normalizedValue);
    if (num === null) return [{ value: normalizedValue, marketplace_id: marketplaceId }];
    return [{ value: num, marketplace_id: marketplaceId }];
  }
  if (LANGUAGE_TAG_ATTRIBUTES.has(attributeName)) {
    return marketplaceAttribute(marketplaceId, normalizedValue);
  }
  return [{ value: normalizedValue, marketplace_id: marketplaceId }];
}

function appendProductImages(
  attributes: Record<string, unknown>,
  draftPayload: Record<string, unknown>,
  marketplaceId: string,
) {
  const rawUrls = draftPayload.imageUrls ?? draftPayload.image_urls;
  const urls = Array.isArray(rawUrls)
    ? rawUrls
      .map((entry) => textValue(entry))
      .filter((entry): entry is string => Boolean(entry))
    : [];
  const fallback = textValue(draftPayload.mainImageUrl);
  if (!urls.length && fallback) urls.push(fallback);
  if (!urls.length || attributes.main_product_image_locator) return;

  attributes.main_product_image_locator = [{
    marketplace_id: marketplaceId,
    media_location: urls[0],
  }];

  urls.slice(1, 9).forEach((url, index) => {
    attributes[`other_product_image_locator_${index + 1}`] = [{
      marketplace_id: marketplaceId,
      media_location: url,
    }];
  });
}

function appendGenericPtdAttributes(
  attributes: Record<string, unknown>,
  draftPayload: Record<string, unknown>,
  marketplaceId: string,
  productType = "",
) {
  const excluded = PRODUCT_TYPE_EXCLUDED_ATTRIBUTES[productType.toUpperCase()] || null;

  const IMAGE_LOCATOR_KEYS = /^other_product_image_locator_\d+$/;

  for (const [key, rawValue] of Object.entries(draftPayload)) {
    if (RESERVED_DRAFT_PAYLOAD_KEYS.has(key)) continue;
    if (excluded?.has(key)) continue;
    if (VARIATION_ATTRIBUTES.has(key)) continue;
    if (
      key === "main_product_image_locator"
      || key === "swatch_product_image_locator"
      || IMAGE_LOCATOR_KEYS.test(key)
    ) {
      continue;
    }
    if (key === "item_dimensions") {
      const dimensions = typeof rawValue === "string"
        ? buildItemDimensionsFromText(rawValue, marketplaceId)
        : null;
      if (dimensions) attributes.item_dimensions = dimensions;
      continue;
    }
    if (key === "item_length_width_height") {
      const dimensions = typeof rawValue === "string"
        ? buildItemLengthWidthHeightFromText(rawValue, marketplaceId)
        : null;
      if (dimensions) attributes.item_length_width_height = dimensions;
      continue;
    }
    if (key === "item_depth_width_height") {
      const dimensions = typeof rawValue === "string"
        ? buildItemDepthWidthHeightFromText(rawValue, marketplaceId)
        : null;
      if (dimensions) attributes.item_depth_width_height = dimensions;
      continue;
    }
    if (key === "item_package_dimensions") {
      const dimensions = typeof rawValue === "string"
        ? buildItemPackageDimensionsFromText(rawValue, marketplaceId)
        : null;
      if (dimensions) attributes.item_package_dimensions = dimensions;
      continue;
    }
    if (key === "item_package_weight") {
      const weight = typeof rawValue === "string"
        ? buildItemPackageWeightFromText(rawValue, marketplaceId)
        : null;
      if (weight) attributes.item_package_weight = weight;
      continue;
    }
    if (key === "item_weight") {
      const weight = typeof rawValue === "string"
        ? buildItemWeightFromText(rawValue, marketplaceId)
        : null;
      if (weight) attributes.item_weight = weight;
      continue;
    }
    if (key === "closure") {
      const closure = typeof rawValue === "string"
        ? buildClosureAttribute(rawValue, marketplaceId)
        : null;
      if (closure) attributes.closure = closure;
      continue;
    }
    if (key === "size_info") {
      const sizeInfo = typeof rawValue === "string"
        ? buildSizeInfoAttribute(rawValue, marketplaceId, productType)
        : null;
      if (sizeInfo) attributes.size_info = sizeInfo;
      continue;
    }
    if (key === "capacity") {
      const capacity = typeof rawValue === "string"
        ? buildCapacityAttribute(rawValue, marketplaceId)
        : null;
      if (capacity) attributes.capacity = capacity;
      continue;
    }
    if (key === "outer") {
      const outer = typeof rawValue === "string"
        ? buildMaterialLayerAttribute(rawValue, marketplaceId, "outer")
        : null;
      if (outer) attributes.outer = outer;
      continue;
    }
    if (key === "inner") {
      const inner = typeof rawValue === "string"
        ? buildMaterialLayerAttribute(rawValue, marketplaceId, "inner")
        : null;
      if (inner) attributes.inner = inner;
      continue;
    }
    if (key === "headwear_size") {
      const headwearSize = typeof rawValue === "string"
        ? buildHeadwearSizeAttribute(rawValue, marketplaceId)
        : null;
      if (headwearSize) attributes.headwear_size = headwearSize;
      continue;
    }
    if (key === "metals") {
      const metals = typeof rawValue === "string"
        ? buildMetalsAttribute(rawValue, marketplaceId)
        : null;
      if (metals) attributes.metals = metals;
      continue;
    }
    if (key === "stones") {
      const stones = typeof rawValue === "string"
        ? buildStonesAttribute(rawValue, marketplaceId)
        : null;
      if (stones) attributes.stones = stones;
      continue;
    }
    if (key === "container") {
      const container = typeof rawValue === "string"
        ? buildContainerAttribute(rawValue, marketplaceId)
        : null;
      if (container) attributes.container = container;
      continue;
    }
    if (key === "plant_or_animal_product_type") {
      const value = textValue(rawValue);
      if (!value || value === key) continue;
      attributes.plant_or_animal_product_type = [{
        value: normalizePlantOrAnimalProductType(value),
        marketplace_id: marketplaceId,
      }];
      continue;
    }
    if (key === "indoor_outdoor_usage") {
      const value = textValue(rawValue);
      if (!value || value === key) continue;
      attributes.indoor_outdoor_usage = [{
        value: normalizeIndoorOutdoorUsage(value),
        marketplace_id: marketplaceId,
      }];
      continue;
    }
    if (BOOLEAN_ATTRIBUTES.has(key)) {
      const boolValue = parseBooleanValue(rawValue);
      if (boolValue === null) continue;
      attributes[key] = [{ value: boolValue, marketplace_id: marketplaceId }];
      continue;
    }
    if (attributes[key]) continue;
    if (NUMERIC_ATTRIBUTES.has(key)) {
      const num = numericValue(rawValue);
      if (num === null) continue;
      attributes[key] = [{ value: num, marketplace_id: marketplaceId }];
      continue;
    }
    const value = textValue(rawValue);
    if (!value || value === key) continue;
    attributes[key] = buildSimpleAttribute(key, marketplaceId, value);
  }

  appendVariationAttributesFromPayload(attributes, draftPayload, marketplaceId);
}

export type ListingsItemBuildContext = {
  mode: "offer_only" | "full_listing";
  productType: string;
  requirements: string;
  catalogProductType: string | null;
  matchedAsin: string | null;
};

function readMatchedAsin(
  draft: DraftRowForListing,
  draftPayload: Record<string, unknown>,
): string | null {
  return textValue(draft.matched_asin) || textValue(draft.asin) ||
    textValue(draftPayload.matchedAsin) || textValue(draftPayload.asin) ||
    textValue(draftPayload.merchant_suggested_asin);
}

export function resolveListingsItemBuildContext(
  draft: DraftRowForListing,
): { ok: true; context: ListingsItemBuildContext } | { ok: false; error: string } {
  const draftPayload = enrichDraftPayloadFromRow(draft);
  const marketplaceId = textValue(draft.marketplace_id);
  const catalogProductType = textValue(draft.product_type) || textValue(draftPayload.productType);
  const requirements = textValue(draft.requirements) || "LISTING";
  const matchedAsin = readMatchedAsin(draft, draftPayload);

  if (!marketplaceId) return { ok: false, error: "listing_payload_error" };

  const useOfferOnly = requirements === "LISTING_OFFER_ONLY";

  if (useOfferOnly) {
    if (!matchedAsin) return { ok: false, error: "listing_payload_error" };
    return {
      ok: true,
      context: {
        mode: "offer_only",
        productType: "PRODUCT",
        requirements: "LISTING_OFFER_ONLY",
        catalogProductType,
        matchedAsin,
      },
    };
  }

  if (!catalogProductType) return { ok: false, error: "listing_payload_error" };
  return {
    ok: true,
    context: {
      mode: "full_listing",
      productType: catalogProductType,
      requirements,
      catalogProductType,
      matchedAsin,
    },
  };
}

function buildOfferOnlyListingsItemRequestBody(
  draft: DraftRowForListing,
  context: ListingsItemBuildContext,
): { ok: true; body: ListingsItemRequestBody } | { ok: false; error: string } {
  const draftPayload = enrichDraftPayloadFromRow(draft);
  const marketplaceId = textValue(draft.marketplace_id);
  const matchedAsin = context.matchedAsin;

  if (!marketplaceId || !matchedAsin) {
    return { ok: false, error: "listing_payload_error" };
  }

  const attributes: Record<string, unknown> = {
    merchant_suggested_asin: [{
      value: matchedAsin,
      marketplace_id: marketplaceId,
    }],
  };

  const conditionType = textValue(draftPayload.conditionType) ||
    textValue(draftPayload.condition_type) ||
    "new_new";
  attributes.condition_type = [{ value: conditionType, marketplace_id: marketplaceId }];

  const price = numericValue(draftPayload.price);
  if (price !== null && price >= 0) {
    attributes.purchasable_offer = [{
      marketplace_id: marketplaceId,
      currency: "USD",
      our_price: [{
        schedule: [{ value_with_tax: price }],
      }],
    }];
    attributes.list_price = [{
      marketplace_id: marketplaceId,
      currency: "USD",
      value: price,
    }];
  }

  const quantity = numericValue(draftPayload.quantity);
  const fulfillmentChannel = textValue(draftPayload.fulfillmentChannel) ||
    textValue(draftPayload.fulfillment_channel) ||
    "DEFAULT";
  if (quantity !== null && quantity >= 0) {
    attributes.fulfillment_availability = [{
      fulfillment_channel_code: fulfillmentChannel,
      quantity,
    }];
  }

  return {
    ok: true,
    body: {
      productType: context.productType,
      requirements: context.requirements,
      attributes,
    },
  };
}

function buildBulletPoints(
  draftPayload: Record<string, unknown>,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const raw = draftPayload.bulletPoints ?? draftPayload.bullet_point;
  const lines = Array.isArray(raw)
    ? raw.map((entry) => String(entry).trim()).filter(Boolean)
    : typeof raw === "string"
    ? raw.split("\n").map((line) => line.trim()).filter(Boolean)
    : [];

  if (!lines.length) return null;
  return lines.map((line) => ({
    marketplace_id: marketplaceId,
    language_tag: "en_US",
    value: line,
  }));
}

export function buildListingsItemRequestBody(
  draft: DraftRowForListing,
): { ok: true; body: ListingsItemRequestBody } | { ok: false; error: string } {
  const buildContext = resolveListingsItemBuildContext(draft);
  if (!buildContext.ok) return buildContext;

  if (buildContext.context.mode === "offer_only") {
    return buildOfferOnlyListingsItemRequestBody(draft, buildContext.context);
  }

  const draftPayload = enrichDraftPayloadFromRow(draft);
  const marketplaceId = textValue(draft.marketplace_id);
  const productType = buildContext.context.productType;
  const requirements = buildContext.context.requirements;

  if (!marketplaceId || !productType) {
    return { ok: false, error: "listing_payload_error" };
  }

  const attributes: Record<string, unknown> = {};
  const title = textValue(draftPayload.title) || textValue(draftPayload.item_name);
  const brand = textValue(draftPayload.brand);
  const description = textValue(draftPayload.description) ||
    textValue(draftPayload.product_description);

  if (title) attributes.item_name = marketplaceAttribute(marketplaceId, title);
  if (brand) attributes.brand = marketplaceAttribute(marketplaceId, brand);
  if (description) {
    attributes.product_description = marketplaceAttribute(marketplaceId, description);
  }

  const bullets = buildBulletPoints(draftPayload, marketplaceId);
  if (bullets) attributes.bullet_point = bullets;

  const conditionType = textValue(draftPayload.conditionType) ||
    textValue(draftPayload.condition_type) ||
    "new_new";
  attributes.condition_type = [{ value: conditionType, marketplace_id: marketplaceId }];

  const price = numericValue(draftPayload.price);
  if (price !== null && price >= 0) {
    attributes.purchasable_offer = [{
      marketplace_id: marketplaceId,
      currency: "USD",
      our_price: [{
        schedule: [{ value_with_tax: price }],
      }],
    }];
    attributes.list_price = [{
      marketplace_id: marketplaceId,
      currency: "USD",
      value: price,
    }];
  }

  const quantity = numericValue(draftPayload.quantity);
  const fulfillmentChannel = textValue(draftPayload.fulfillmentChannel) ||
    textValue(draftPayload.fulfillment_channel) ||
    "DEFAULT";
  if (quantity !== null && quantity >= 0) {
    attributes.fulfillment_availability = [{
      fulfillment_channel_code: fulfillmentChannel,
      quantity,
    }];
  }

  appendGenericPtdAttributes(attributes, draftPayload, marketplaceId, productType);
  delete attributes.merchant_suggested_asin;

  if (isVariationParentDraftPayload(draftPayload)) {
    delete attributes.purchasable_offer;
    delete attributes.list_price;
    delete attributes.fulfillment_availability;
    delete attributes.color;
  }

  const dimensionsRaw = textValue(draftPayload.item_length_width_height) ||
    textValue(draftPayload.item_dimensions);
  if (productType.toUpperCase() === "TOY_FIGURE") {
    if (dimensionsRaw && !attributes.item_length_width_height) {
      const dimensions = buildItemLengthWidthHeightFromText(dimensionsRaw, marketplaceId);
      if (dimensions) attributes.item_length_width_height = dimensions;
    }
    const packageDimensionsRaw = textValue(draftPayload.item_package_dimensions) || dimensionsRaw;
    if (packageDimensionsRaw && !attributes.item_package_dimensions) {
      const packageDimensions = buildItemPackageDimensionsFromText(packageDimensionsRaw, marketplaceId);
      if (packageDimensions) attributes.item_package_dimensions = packageDimensions;
    }
    const packageWeightRaw = textValue(draftPayload.item_package_weight) || "0.5 pounds";
    if (!attributes.item_package_weight) {
      const packageWeight = buildItemPackageWeightFromText(packageWeightRaw, marketplaceId);
      if (packageWeight) attributes.item_package_weight = packageWeight;
    }
    if (!attributes.package_level) {
      attributes.package_level = [{ value: "unit", marketplace_id: marketplaceId }];
    }
    if (!attributes.batteries_required) {
      attributes.batteries_required = [{ value: false, marketplace_id: marketplaceId }];
    }
    delete attributes.item_dimensions;
  } else if (productType.toUpperCase() === "ARTIFICIAL_PLANT") {
    const depthRaw = textValue(draftPayload.item_depth_width_height);
    if (depthRaw) {
      const depthDimensions = buildItemDepthWidthHeightFromText(depthRaw, marketplaceId);
      if (depthDimensions) attributes.item_depth_width_height = depthDimensions;
    }

    const containerRaw = textValue(draftPayload.container);
    if (containerRaw) {
      const container = buildContainerAttribute(containerRaw, marketplaceId);
      if (container) attributes.container = container;
    }

    const plantTypeRaw = textValue(draftPayload.plant_or_animal_product_type);
    if (plantTypeRaw) {
      attributes.plant_or_animal_product_type = [{
        value: normalizePlantOrAnimalProductType(plantTypeRaw),
        marketplace_id: marketplaceId,
      }];
    }

    const indoorRaw = textValue(draftPayload.indoor_outdoor_usage);
    if (indoorRaw) {
      attributes.indoor_outdoor_usage = [{
        value: normalizeIndoorOutdoorUsage(indoorRaw),
        marketplace_id: marketplaceId,
      }];
    }

    const refurbished = parseBooleanValue(draftPayload.is_refurbished);
    if (refurbished !== null) {
      attributes.is_refurbished = [{ value: refurbished, marketplace_id: marketplaceId }];
    }
  } else if (productType.toUpperCase() === "HAT" || isBagLikeProductType(productType)) {
    if (!attributes.batteries_required) {
      const batteriesRaw = textValue(draftPayload.batteries_required);
      const batteries = parseBooleanValue(batteriesRaw);
      attributes.batteries_required = [{
        value: batteries ?? false,
        marketplace_id: marketplaceId,
      }];
    }
    if (productType.toUpperCase() === "HANDBAG") {
      if (dimensionsRaw && !attributes.item_dimensions) {
        const dimensions = buildItemDimensionsFromText(dimensionsRaw, marketplaceId);
        if (dimensions) attributes.item_dimensions = dimensions;
      }
    }
    if (productType.toUpperCase() === "TOTE_BAG") {
      if (dimensionsRaw && !attributes.item_length_width_height) {
        const dimensions = buildItemLengthWidthHeightFromText(dimensionsRaw, marketplaceId);
        if (dimensions) attributes.item_length_width_height = dimensions;
      }
    }
    if (isBagLikeProductType(productType)) {
      const packageDimensionsRaw = textValue(draftPayload.item_package_dimensions) || dimensionsRaw;
      if (packageDimensionsRaw && !attributes.item_package_dimensions) {
        const packageDimensions = buildItemPackageDimensionsFromText(packageDimensionsRaw, marketplaceId);
        if (packageDimensions) attributes.item_package_dimensions = packageDimensions;
      }
      const packageWeightRaw = textValue(draftPayload.item_package_weight);
      if (packageWeightRaw && !attributes.item_package_weight) {
        const packageWeight = buildItemPackageWeightFromText(packageWeightRaw, marketplaceId);
        if (packageWeight) attributes.item_package_weight = packageWeight;
      }
      const sizeInfoRaw = textValue(draftPayload.size_info);
      if (sizeInfoRaw) {
        const sizeInfo = buildSizeInfoAttribute(sizeInfoRaw, marketplaceId, productType);
        if (sizeInfo) attributes.size_info = sizeInfo;
      }
    }
  } else if (productType.toUpperCase() === "KEYCHAIN") {
    if (!attributes.batteries_required) {
      const batteriesRaw = textValue(draftPayload.batteries_required);
      const batteries = parseBooleanValue(batteriesRaw);
      attributes.batteries_required = [{
        value: batteries ?? false,
        marketplace_id: marketplaceId,
      }];
    }
  } else if (dimensionsRaw && !attributes.item_dimensions) {
    const dimensions = buildItemDimensionsFromText(dimensionsRaw, marketplaceId);
    if (dimensions) attributes.item_dimensions = dimensions;
  }

  const hasProductIdentifier = Boolean(
    textValue(draftPayload.upc) ||
      textValue(draftPayload.ean) ||
      attributes.externally_assigned_product_identifier,
  );
  if (!hasProductIdentifier && !attributes.supplier_declared_has_product_identifier_exemption) {
    attributes.supplier_declared_has_product_identifier_exemption = [{
      value: true,
      marketplace_id: marketplaceId,
    }];
  }

  appendProductImages(attributes, draftPayload, marketplaceId);
  stripIncompleteVariationAttributes(attributes, draftPayload);

  if (productType.toUpperCase() === "TOTE_BAG") {
    const sizeInfoRaw = textValue(draftPayload.size_info);
    if (sizeInfoRaw) {
      const sizeInfo = buildSizeInfoAttribute(sizeInfoRaw, marketplaceId, productType);
      if (sizeInfo) attributes.size_info = sizeInfo;
    }
    if (dimensionsRaw) {
      const dimensions = buildItemLengthWidthHeightFromText(dimensionsRaw, marketplaceId);
      if (dimensions) attributes.item_length_width_height = dimensions;
    }
    delete attributes.target_audience;
    delete attributes.item_dimensions;
    delete attributes.package_level;
    delete attributes.included_components;
  }

  if (Object.keys(attributes).length === 0) {
    return { ok: false, error: "listing_payload_error" };
  }

  return {
    ok: true,
    body: {
      productType,
      requirements,
      attributes,
    },
  };
}

export function mapAmazonListingIssues(
  issues: unknown[],
  fallbackMessage = "Amazon validation issue reported during preview submit.",
): ValidationIssue[] {
  const rows: ValidationIssue[] = [];

  for (const issue of issues) {
    const rec = asRecord(issue);
    if (!rec) continue;
    const severityRaw = String(rec.severity || "warning").toLowerCase();
    const severity = severityRaw === "error" ? "error" : "warning";
    const attributeNames = asArray(rec.attributeNames).map((name) => String(name));
    const field = attributeNames[0] || String(rec.code || "amazon_issue");
    const message = typeof rec.message === "string" && rec.message.trim()
      ? rec.message.trim()
      : fallbackMessage;

    rows.push({ field, severity, message });
  }

  return rows;
}

export function normalizeSubmissionStatus(status: string | null | undefined): string | null {
  if (!status?.trim()) return null;
  const upper = status.trim().toUpperCase();
  if (upper === "VALID") return "VALID";
  if (upper === "INVALID") return "INVALID";
  if (upper === "ACCEPTED") return "ACCEPTED";
  if (upper === "PROCESSING") return "processing";
  if (upper === "FAILED") return "failed";
  console.log("[normalizeSubmissionStatus] unknown status", status);
  return "failed";
}

export function resolveDraftStatusAfterAmazonPreview(input: {
  submissionStatus: string;
  amazonIssues: ValidationIssue[];
  localIssues: ValidationIssue[];
}): string {
  const submissionStatus = input.submissionStatus.toUpperCase();
  const hasAmazonErrors = input.amazonIssues.some((issue) => issue.severity === "error");
  const hasLocalErrors = input.localIssues.some((issue) => issue.severity === "error");

  if (submissionStatus === "INVALID" || hasAmazonErrors) {
    return hasLocalErrors ? "needs_attributes" : "rejected";
  }
  if (submissionStatus === "VALID" || submissionStatus === "ACCEPTED") {
    // Recommended PTD fields and Amazon warnings should not block live submit once preview is valid.
    return "ready_to_submit";
  }
  return "needs_attributes";
}

export function resolveDraftStatusAfterLiveSubmit(input: {
  submissionStatus: string;
  amazonIssues: ValidationIssue[];
}): string {
  const submissionStatus = input.submissionStatus.toUpperCase();
  const hasAmazonErrors = input.amazonIssues.some((issue) => issue.severity === "error");

  if (submissionStatus === "INVALID" || hasAmazonErrors) {
    return "rejected";
  }
  if (submissionStatus === "ACCEPTED") {
    return "submitted";
  }
  return "needs_attributes";
}

export type LiveSubmitBlockReason =
  | "draft_status_not_ready"
  | "missing_product_type"
  | "missing_last_validation_result"
  | "ptd_preview_required"
  | "amazon_validation_preview_required"
  | "open_validation_errors"
  | "open_push_errors";

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isPtdPreviewCurrent(draft: Record<string, unknown>): boolean {
  const lastResult = asRecord(draft.last_validation_result);
  if (!lastResult) return false;

  const previewedAt = parseIsoMs(lastResult.previewedAt);
  if (previewedAt === null) return false;

  const productType = textValue(draft.product_type);
  const previewProductType = textValue(lastResult.productType);
  if (!productType || previewProductType !== productType) return false;

  const updatedAt = parseIsoMs(draft.updated_at);
  if (updatedAt === null) return true;

  const amazonPreviewAt = parseIsoMs(lastResult.amazonPreviewAt);
  const freshnessAnchor = amazonPreviewAt !== null && amazonPreviewAt >= previewedAt
    ? amazonPreviewAt
    : previewedAt;

  return updatedAt <= freshnessAnchor;
}

/** Draft reached ready_to_submit after a successful Amazon validation preview. */
export function hasValidatedAmazonPreview(draft: Record<string, unknown>): boolean {
  if (String(draft.draft_status || "") !== "ready_to_submit") return false;

  const submissionStatus = String(draft.submission_status || "").toUpperCase();
  if (submissionStatus !== "VALID" && submissionStatus !== "ACCEPTED") return false;

  const lastResponse = asRecord(draft.last_submission_response);
  if (lastResponse?.mode !== "VALIDATION_PREVIEW") return false;

  const lastResult = asRecord(draft.last_validation_result);
  const stored = String(lastResult?.lastAmazonPreviewStatus || "").toUpperCase();
  return stored === "VALID" || stored === "ACCEPTED";
}

export function evaluateDraftLiveSubmitReadiness(
  draft: Record<string, unknown>,
  openIssues: Array<{ source?: string; severity?: string }>,
): { ready: boolean; reasons: LiveSubmitBlockReason[] } {
  const reasons: LiveSubmitBlockReason[] = [];
  const amazonPreviewFresh = hasRecentValidationPreview(draft);
  const validatedPreview = hasValidatedAmazonPreview(draft);
  const previewGateSatisfied = amazonPreviewFresh || validatedPreview;

  if (String(draft.draft_status) !== "ready_to_submit" && !previewGateSatisfied) {
    reasons.push("draft_status_not_ready");
  }
  if (!textValue(draft.product_type)) {
    reasons.push("missing_product_type");
  }

  const lastResult = asRecord(draft.last_validation_result);
  if (!lastResult || Object.keys(lastResult).length === 0) {
    reasons.push("missing_last_validation_result");
  }
  if (!previewGateSatisfied && !isPtdPreviewCurrent(draft)) {
    reasons.push("ptd_preview_required");
  }
  if (!previewGateSatisfied) {
    reasons.push("amazon_validation_preview_required");
  }

  if (openIssues.some((issue) => issue.source === "validation" && issue.severity === "error")) {
    reasons.push("open_validation_errors");
  }
  if (openIssues.some((issue) => issue.source === "push" && issue.severity === "error")) {
    reasons.push("open_push_errors");
  }

  return { ready: reasons.length === 0, reasons };
}

export function hasRecentValidationPreview(draft: Record<string, unknown>): boolean {
  const lastResult = asRecord(draft.last_validation_result);
  const amazonPreviewAt = parseIsoMs(lastResult?.amazonPreviewAt);
  const storedPreviewStatus = String(lastResult?.lastAmazonPreviewStatus || "").toUpperCase();

  if (
    amazonPreviewAt !== null
    && (storedPreviewStatus === "VALID" || storedPreviewStatus === "ACCEPTED")
  ) {
    const updatedAt = parseIsoMs(draft.updated_at);
    if (updatedAt === null) return true;
    return updatedAt <= amazonPreviewAt;
  }

  const lastResponse = asRecord(draft.last_submission_response);
  if (!lastResponse || lastResponse.mode !== "VALIDATION_PREVIEW") return false;
  const status = String(lastResponse.status || draft.submission_status || "").toUpperCase();
  if (status !== "VALID" && status !== "ACCEPTED") return false;

  const previewedAt = parseIsoMs(lastResult?.previewedAt);
  const updatedAt = parseIsoMs(draft.updated_at);
  if (previewedAt === null || updatedAt === null) return true;
  return updatedAt <= previewedAt;
}

async function putListingsItemRequest(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  body: ListingsItemRequestBody;
  mode?: "VALIDATION_PREVIEW";
  userAgent: string;
  failureError: string;
}): Promise<PutListingsResult> {
  const query = new URLSearchParams({ marketplaceIds: params.marketplaceId });
  if (params.mode) query.set("mode", params.mode);

  const url =
    `${params.creds.endpoint}/listings/2021-08-01/items/${encodeURIComponent(params.sellerId)}/${encodeURIComponent(params.sellerSku)}?${query.toString()}`;
  const requestBody = JSON.stringify(params.body);

  const baseHeaders: Record<string, string> = {
    "x-amz-access-token": params.creds.accessToken,
    "content-type": "application/json",
    "user-agent": params.userAgent,
  };

  if (!params.creds.aws) {
    return { ok: false, error: "server_misconfigured" };
  }

  const fetchHeaders = await signSpApiRequest({
    method: "PUT",
    url,
    region: params.creds.aws.region,
    service: "execute-api",
    accessKeyId: params.creds.aws.accessKeyId,
    secretAccessKey: params.creds.aws.secretAccessKey,
    sessionToken: params.creds.aws.sessionToken,
    headers: baseHeaders,
    body: requestBody,
  });

  const resp = await fetch(url, {
    method: "PUT",
    headers: fetchHeaders,
    body: requestBody,
  });

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: params.failureError,
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, true),
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: params.failureError,
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, true),
    };
  }

  const issues = asArray(data.issues)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  return {
    ok: true,
    httpStatus: resp.status,
    submissionId: typeof data.submissionId === "string" ? data.submissionId : null,
    submissionStatus: typeof data.status === "string" ? data.status : "INVALID",
    issues,
    rawResponse: data,
  };
}

export async function putListingsItemValidationPreview(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  body: ListingsItemRequestBody;
}): Promise<PutListingsResult> {
  return putListingsItemRequest({
    ...params,
    mode: "VALIDATION_PREVIEW",
    userAgent: "KarryKraze-AmazonSubmitPreview/1.0",
    failureError: "sp_api_validation_failed",
  });
}

export async function putListingsItemLiveSubmit(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  body: ListingsItemRequestBody;
}): Promise<PutListingsResult> {
  return putListingsItemRequest({
    ...params,
    userAgent: "KarryKraze-AmazonLiveSubmit/1.0",
    failureError: "sp_api_submit_failed",
  });
}

export async function syncPushIssues(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  amazonIssues: ValidationIssue[],
  submissionId: string | null,
  now: string,
  issueType = "amazon_validation",
) {
  await client
    .from("amazon_listing_issues")
    .delete()
    .eq("draft_id", draftId)
    .eq("source", "push")
    .eq("status", "open");

  if (amazonIssues.length === 0) return;

  const rows = amazonIssues.map((issue) => ({
    draft_id: draftId,
    issue_code: issue.field,
    issue_type: issueType,
    severity: issue.severity,
    message: issue.message,
    source: "push",
    status: "open",
    categories: [],
    attribute_names: issue.field ? [issue.field] : [],
    enforcements: {},
    raw_error: issue,
    source_submission_id: submissionId,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await client.from("amazon_listing_issues").insert(rows);
  if (error) {
    console.log("[syncPushIssues] insert_failed", error.message);
    throw new Error("database_error");
  }
}

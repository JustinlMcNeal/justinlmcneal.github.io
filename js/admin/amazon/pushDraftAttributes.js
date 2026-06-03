import { qs } from "./dom.js";
import { escapeHtml } from "./renderListings.js";

/** Attributes already covered by the main push form fields. */
export const COVERED_BY_MAIN_FORM = new Set([
  "item_name",
  "brand",
  "product_description",
  "bullet_point",
  "condition_type",
  "purchasable_offer",
  "fulfillment_availability",
  "externally_assigned_product_identifier",
]);

/** Set from product image strip — never manual text fields in Additional Attributes. */
export const PUSH_IMAGE_LOCATOR_ATTRIBUTES = new Set([
  "main_product_image_locator",
  "swatch_product_image_locator",
  "other_product_image_locator_1",
  "other_product_image_locator_2",
  "other_product_image_locator_3",
  "other_product_image_locator_4",
  "other_product_image_locator_5",
  "other_product_image_locator_6",
  "other_product_image_locator_7",
  "other_product_image_locator_8",
]);

export const PUSH_EXTRA_ATTRIBUTE_DENYLIST = new Set([
  ...PUSH_IMAGE_LOCATOR_ATTRIBUTES,
  "list_price",
  "merchant_shipping_group",
  "fulfillment_availability",
  "purchasable_offer",
  "condition_type",
]);

import {
  resolvePushWorkflowFromSuggestedAsin,
  resolveSuggestedAsinForSubmit,
  shouldHydrateSuggestedAsin,
} from "./pushDraftWorkflow.js";

export {
  resolvePushWorkflowFromSuggestedAsin,
  resolveSuggestedAsinForSubmit,
  shouldHydrateSuggestedAsin,
};

/** Known extra PTD fields with labels and safe defaults. */
export const ATTRIBUTE_FIELD_META = {
  country_of_origin: {
    label: "Country of Origin",
    placeholder: "CN",
    hint: "ISO country code (e.g. CN, US)",
    defaultValue: "CN",
  },
  supplier_declared_dg_hz_regulation: {
    label: "Hazmat / DG Regulation",
    placeholder: "not_applicable",
    hint: "Use not_applicable for most plush/accessory items",
    defaultValue: "not_applicable",
  },
  supplier_declared_has_product_identifier_exemption: {
    label: "Product ID Exemption",
    placeholder: "true",
    hint: "Use true when you do not have UPC/EAN/GTIN",
    defaultValue: "true",
  },
  cpsia_cautionary_statement: {
    label: "CPSIA Cautionary Statement",
    placeholder: "no_warning_applicable",
    hint: "Amazon enum code. Use no_warning_applicable if no CPSIA warning applies. For small parts: choking_hazard_small_parts",
    defaultValue: "no_warning_applicable",
  },
  is_assembly_required: {
    label: "Assembly Required",
    placeholder: "false",
    defaultValue: "false",
  },
  target_audience_keyword: {
    label: "Target Audience",
    placeholder: "unisex-children",
    defaultValue: "unisex-adult",
  },
  age_range_description: {
    label: "Age Range Description",
    placeholder: "Adult",
    defaultValue: "Adult",
  },
  manufacturer_minimum_age: {
    label: "Manufacturer Min Age (months)",
    placeholder: "0",
    defaultValue: "0",
  },
  manufacturer_maximum_age: {
    label: "Manufacturer Max Age (months)",
    placeholder: "1188",
    defaultValue: "1188",
  },
  number_of_items: {
    label: "Number of Items",
    placeholder: "1",
    defaultValue: "1",
  },
  safety_warning: {
    label: "Safety Warning",
    placeholder: "no_warning_applicable",
    hint: "Amazon enum code. Usually no_warning_applicable for items without a safety warning.",
    defaultValue: "no_warning_applicable",
  },
  model_name: {
    label: "Model Name",
    placeholder: "Plush Flower Bouquet",
  },
  target_gender: {
    label: "Target Gender",
    placeholder: "unisex",
    defaultValue: "unisex",
  },
  part_number: {
    label: "Part Number",
    placeholder: "KK-1050",
  },
  item_type_keyword: {
    label: "Item Type Keyword",
    placeholder: "key-chains",
    hint: "Amazon browse-tree code for this product type.",
  },
  included_components: {
    label: "Included Components",
    placeholder: "Keychain with charms",
  },
  material: {
    label: "Material",
    placeholder: "Polyester",
    defaultValue: "Polyester",
  },
  manufacturer: {
    label: "Manufacturer",
    placeholder: "Generic",
    defaultValue: "Generic",
  },
  generic_keyword: {
    label: "Generic Keywords",
    placeholder: "keychain charm bag accessory",
  },
  educational_objective: {
    label: "Educational Objective",
    placeholder: "Not Applicable",
    defaultValue: "Not Applicable",
  },
  item_dimensions: {
    label: "Item Dimensions (H x W x L)",
    placeholder: "8 x 6 x 4 in",
    hint: "Height x Width x Length, e.g. 8 x 6 x 4 in",
    defaultValue: "8 x 6 x 4 in",
  },
  merchant_suggested_asin: {
    label: "Suggested ASIN (optional — repush only)",
    placeholder: "Leave blank for new catalog listings",
    hint: "Only for selling on an existing Amazon ASIN (offer-only repush). Leave blank for new listings with GTIN exemption (Option B). If offer repush fails, clear this field and save.",
  },
  toy_figure_type: {
    label: "Toy Figure Type",
    placeholder: "stuffed_toy",
    hint: "Amazon enum code. Plush/stuffed items use stuffed_toy (not plush). Other values: action_figure, doll, play_figure, squishy, miniature_figure, roly_poly, interactive_gaming_figure.",
    defaultValue: "stuffed_toy",
  },
  subject_character: {
    label: "Subject Character",
    placeholder: "Flower",
    hint: "Character or subject shown by the figure, e.g. Flower or Smiling Flower.",
    defaultValue: "Flower",
  },
  color: {
    label: "Color",
    placeholder: "Multicolor",
    hint: "Primary color description. Multicolor works for mixed plush flower bouquets.",
    defaultValue: "Multicolor",
  },
  theme: {
    label: "Theme",
    placeholder: "Floral",
    hint: "Use Amazon theme enum values such as Floral, Love, or Fantasy.",
    defaultValue: "Floral",
  },
  item_length_width_height: {
    label: "Item Length x Width x Height",
    placeholder: "8 x 6 x 4 in",
    hint: "Required for TOY_FIGURE. Length x Width x Height with unit, e.g. 8 x 6 x 4 in",
    defaultValue: "8 x 6 x 4 in",
  },
  item_package_dimensions: {
    label: "Package Dimensions (L x W x H)",
    placeholder: "8 x 6 x 4 in",
    hint: "Shipping box dimensions. Defaults to item dimensions when blank.",
    defaultValue: "8 x 6 x 4 in",
  },
  item_package_weight: {
    label: "Package Weight",
    placeholder: "3 ounces",
    hint: "Weight including packaging, e.g. 3 ounces or 0.2 pounds",
    defaultValue: "3 ounces",
  },
  item_weight: {
    label: "Item Weight",
    placeholder: "1.2 ounces",
    hint: "Product weight without packaging. Working keychains often use 1–3 ounces.",
    defaultValue: "1.2 ounces",
  },
  package_level: {
    label: "Package Level",
    placeholder: "unit",
    hint: "Use unit for standalone SKUs.",
    defaultValue: "unit",
  },
  batteries_required: {
    label: "Batteries Required",
    placeholder: "false",
    hint: "Use false for plush items without batteries.",
    defaultValue: "false",
  },
  parentage_level: {
    label: "Parentage Level",
    placeholder: "parent or child",
    hint: "Leave blank for standalone SKUs. Only set parent/child when building a variation family with child_parent_sku_relationship and variation_theme.",
  },
  department: {
    label: "Department Name",
    placeholder: "Unisex",
    hint: "Who the product is intended for, e.g. Unisex, Mens, Womens.",
    defaultValue: "Unisex",
  },
  import_designation: {
    label: "Import Designation",
    placeholder: "Imported",
    hint: "Country of manufacture/import status.",
    defaultValue: "Imported",
  },
  size: {
    label: "Size",
    placeholder: "Small",
    hint: "Size name such as Small, Medium, Large, or One Size.",
    defaultValue: "Small",
    enumValues: ["Small", "Medium", "Large", "One Size"],
  },
  special_feature: {
    label: "Special Features",
    placeholder: "Quick Release",
    hint: "Notable feature from Amazon's allowed list.",
    defaultValue: "Quick Release",
  },
  closure: {
    label: "Closure Type",
    placeholder: "Lobster Clasp",
    hint: "How the keychain attaches, e.g. Lobster Clasp or Split Ring.",
    defaultValue: "Lobster Clasp",
  },
  model_number: {
    label: "Model Number",
    placeholder: "KK_0066",
  },
  style: {
    label: "Style",
    placeholder: "Casual",
    hint: "Hat style such as Casual, Fashion, or Novelty.",
    defaultValue: "Casual",
  },
  care_instructions: {
    label: "Care Instructions",
    placeholder: "Hand Wash Only",
    hint: "Amazon care enum for HAT (e.g. Hand Wash Only, Machine Wash).",
    defaultValue: "Hand Wash Only",
    enumValues: [
      "Hand Wash Only",
      "Machine Wash",
      "Dry Clean Only",
      "Do Not Wash",
    ],
  },
  seasons: {
    label: "Seasons",
    placeholder: "Fall",
    hint: "Primary season(s) for this hat.",
    defaultValue: "Fall",
    enumValues: ["Spring", "Summer", "Fall", "Winter", "All Seasons"],
  },
  headwear_size: {
    label: "Headwear Size",
    placeholder: "One Size",
    hint: "Use One Size for stretch beanies. Rendered as Amazon headwear_size (size class + value).",
    defaultValue: "One Size",
    composite: "headwear_size",
  },
  fabric_type: {
    label: "Fabric Type",
    placeholder: "Plush",
    hint: "Material/fabric description for artificial plants and plush decor.",
    defaultValue: "Plush",
  },
  specific_uses_for_product: {
    label: "Specific Uses For Product",
    placeholder: "Home Decor",
    hint: "Amazon enum for ARTIFICIAL_PLANT, e.g. Home Decor or Wedding Decor.",
  },
  indoor_outdoor_usage: {
    label: "Indoor Outdoor Usage",
    placeholder: "indoor",
    hint: "Amazon coded value: indoor, outdoor, or indoor_outdoor (not display labels like Indoor).",
    defaultValue: "indoor",
    enumValues: ["indoor", "outdoor", "indoor_outdoor"],
  },
  item_shape: {
    label: "Item Shape",
    placeholder: "Round",
    hint: "Shape enum such as Round, Flower, or Bouquet.",
  },
  is_refurbished: {
    label: "Is Refurbished",
    placeholder: "false",
    defaultValue: "false",
  },
  item_depth_width_height: {
    label: "Item Depth x Width x Height",
    placeholder: "8 x 6 x 4 in",
    hint: "Depth x Width x Height with unit, e.g. 8 x 6 x 4 in",
    defaultValue: "8 x 6 x 4 in",
  },
  container: {
    label: "Container Type",
    placeholder: "Wrap",
    hint: "How the item is packaged or presented, e.g. Wrap or Box.",
  },
  plant_or_animal_product_type: {
    label: "Plant or Animal Product Type",
    placeholder: "Artificial Plant",
    hint: "Use Artificial Plant for faux flower bouquets.",
    defaultValue: "Artificial Plant",
  },
};

const SHARED_ATTRIBUTE_HINTS = [
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "cpsia_cautionary_statement",
  "is_assembly_required",
  "included_components",
  "manufacturer",
  "material",
  "model_name",
  "part_number",
  "generic_keyword",
  "number_of_items",
  "safety_warning",
];

/** Extra fields Amazon often requires beyond the short PTD required list. */
export const AMAZON_EXTENDED_ATTRIBUTE_HINTS = [
  ...SHARED_ATTRIBUTE_HINTS,
  "item_dimensions",
  "target_audience_keyword",
  "age_range_description",
  "manufacturer_minimum_age",
  "manufacturer_maximum_age",
  "target_gender",
  "educational_objective",
  "item_type_keyword",
];

const TOY_FIGURE_SHARED_ATTRIBUTE_HINTS = SHARED_ATTRIBUTE_HINTS.filter(
  (name) => name !== "supplier_declared_dg_hz_regulation",
);

export const AMAZON_TOY_FIGURE_ATTRIBUTE_HINTS = [
  ...TOY_FIGURE_SHARED_ATTRIBUTE_HINTS,
  "toy_figure_type",
  "subject_character",
  "color",
  "theme",
  "item_length_width_height",
  "item_package_dimensions",
  "item_package_weight",
  "package_level",
  "batteries_required",
  "item_type_keyword",
  "target_audience_keyword",
  "age_range_description",
  "manufacturer_minimum_age",
  "manufacturer_maximum_age",
  "target_gender",
];

export const AMAZON_KEYCHAIN_ATTRIBUTE_HINTS = [
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "item_type_keyword",
  "department",
  "import_designation",
  "size",
  "special_feature",
  "closure",
  "manufacturer",
  "material",
  "model_name",
  "model_number",
  "part_number",
  "generic_keyword",
  "number_of_items",
  "target_gender",
  "color",
  "theme",
  "style",
  "included_components",
  "item_weight",
  "item_package_dimensions",
  "item_package_weight",
];

export const AMAZON_HAT_ATTRIBUTE_HINTS = [
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "item_type_keyword",
  "fabric_type",
  "headwear_size",
  "department",
  "care_instructions",
  "age_range_description",
  "import_designation",
  "style",
  "seasons",
  "manufacturer",
  "material",
  "model_name",
  "model_number",
  "part_number",
  "generic_keyword",
  "target_gender",
  "color",
  "theme",
  "item_package_dimensions",
  "item_package_weight",
];

/** Fields Amazon ignores or rejects on HAT — hide from form and payload merge. */
export const HAT_FORM_DENYLIST = new Set([
  "package_level",
  "included_components",
  "variation_role",
  "parentage_level",
  "child_parent_sku_relationship",
  "variation_theme",
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
]);

export const AMAZON_GENERIC_ATTRIBUTE_HINTS = [
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "item_type_keyword",
  "manufacturer",
  "material",
  "model_name",
  "part_number",
  "generic_keyword",
  "number_of_items",
  "included_components",
  "item_package_dimensions",
  "item_package_weight",
  "package_level",
  "target_gender",
  "color",
  "theme",
];

export const AMAZON_ARTIFICIAL_PLANT_ATTRIBUTE_HINTS = [
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "item_type_keyword",
  "fabric_type",
  "manufacturer",
  "material",
  "model_name",
  "model_number",
  "part_number",
  "generic_keyword",
  "number_of_items",
  "included_components",
  "item_package_dimensions",
  "item_package_weight",
  "package_level",
  "color",
  "specific_uses_for_product",
  "indoor_outdoor_usage",
  "item_shape",
  "is_refurbished",
  "item_depth_width_height",
  "container",
  "plant_or_animal_product_type",
];

/** Fields to hide from push forms / AI for ARTIFICIAL_PLANT (conditional schema noise). */
export const ARTIFICIAL_PLANT_FORM_DENYLIST = new Set([
  "variation_theme",
  "child_parent_sku_relationship",
  "externally_assigned_product_identifier",
  "merchant_suggested_asin",
  "package_contains_sku",
  "item_package_quantity",
  "ring",
  "lens",
  "flavor",
  "edition",
  "orientation",
  "team_name",
  "league_name",
  "scent",
  "base",
  "length_range",
  "width_range",
  "flower_count",
  "plant_style",
  "set_name",
  "plant_type",
  "government_contract_information",
  "list_price",
  "merchant_shipping_group",
  "item_display_weight",
  "item_display_dimensions",
  "occasion",
  "occasion_type",
  "pattern",
  "item_form",
  "unit_count",
  "customer_package_type",
  "style",
  "batteries_required",
  "batteries_included",
  "battery",
  "num_batteries",
  "number_of_lithium_metal_cells",
  "number_of_lithium_ion_cells",
  "lithium_battery",
  "ghs",
  "safety_data_sheet_url",
  "hazmat",
  "has_multiple_battery_powered_components",
  "contains_battery_or_cell",
  "battery_contains_free_unabsorbed_liquid",
  "is_battery_non_spillable",
  "non_lithium_battery_packaging",
  "has_less_than_30_percent_state_of_charge",
  "battery_installation_device_type",
  "baa_taa_compliance_acknowledgement",
  "taa_compliant_country",
]);

/**
 * Remove server-managed / invalid keys from draft payload before render or save.
 * @param {Record<string, unknown>} [payload]
 */
export function stripInvalidPushPayloadAttributes(payload = {}) {
  /** @type {Record<string, unknown>} */
  const cleaned = { ...payload };
  for (const key of Object.keys(cleaned)) {
    if (PUSH_EXTRA_ATTRIBUTE_DENYLIST.has(key)) {
      delete cleaned[key];
      continue;
    }
    const value = cleaned[key];
    if (typeof value === "string" && isBlankAttributeValue(key, value)) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

/** @param {string[]} names @param {string} [productType] */
export function filterFormAttributeNames(names, productType = "") {
  let filtered = (names || []).filter((name) => !PUSH_EXTRA_ATTRIBUTE_DENYLIST.has(name));
  const normalized = String(productType || "").trim().toUpperCase();
  if (normalized === "ARTIFICIAL_PLANT") {
    filtered = filtered.filter((name) => !ARTIFICIAL_PLANT_FORM_DENYLIST.has(name));
  }
  if (normalized === "HAT") {
    filtered = filtered.filter((name) => !HAT_FORM_DENYLIST.has(name));
  }
  return filtered;
}

/** @param {string} [productType] */
export function getExtendedAttributeHints(productType = "") {
  const normalized = String(productType || "").trim().toUpperCase();
  if (normalized === "TOY_FIGURE") return [...AMAZON_TOY_FIGURE_ATTRIBUTE_HINTS];
  if (normalized === "KEYCHAIN") return [...AMAZON_KEYCHAIN_ATTRIBUTE_HINTS];
  if (normalized === "ARTIFICIAL_PLANT") return [...AMAZON_ARTIFICIAL_PLANT_ATTRIBUTE_HINTS];
  if (normalized === "HAT") return [...AMAZON_HAT_ATTRIBUTE_HINTS];
  return [...AMAZON_GENERIC_ATTRIBUTE_HINTS];
}

/** Product-type browse-tree / enum hints for AI autofill (fallback when schema enums unavailable). */
const PRODUCT_TYPE_ENUM_HINTS = {
  TOY_FIGURE: {
    item_type_keyword: [
      "plush-figure-toys",
      "plush-animal-toys",
      "childrens-plush-toy-pillows",
      "action-figures",
      "dolls",
    ],
    toy_figure_type: ["stuffed_toy", "action_figure", "doll", "play_figure", "squishy"],
    theme: ["Floral", "Love", "Animal", "Fantasy", "Cartoon", "Princess"],
  },
  KEYCHAIN: {
    item_type_keyword: ["key-chains", "novelty-keychains", "automotive-key-chains", "party-favor-keyring-packs"],
    department: ["Unisex", "Mens", "Womens", "Boys", "Girls"],
    import_designation: ["Imported", "Made in the USA", "Made in the USA and Imported", "Made in the USA or Imported"],
    special_feature: ["Quick Release", "Lightweight", "Scratch Resistant", "Glow in the Dark"],
    closure: ["Lobster Clasp", "Split Ring", "C Hook", "Snap Hook", "Clip"],
    size: ["Small", "Medium", "Large", "One Size"],
    theme: ["Meme", "Animal", "Cartoon", "Fantasy", "Fun"],
  },
  HAT: {
    item_type_keyword: ["cold-weather-hats", "baseball-caps", "skullies-and-beanies", "sun-hats"],
    department: ["Unisex", "Mens", "Womens", "Boys", "Girls"],
    import_designation: ["Imported", "Made in the USA", "Made in the USA and Imported"],
    care_instructions: ["Hand Wash Only", "Machine Wash", "Dry Clean Only", "Do Not Wash"],
    style: ["Casual", "Fashion", "Novelty", "Athletic", "Classic"],
    seasons: ["Spring", "Summer", "Fall", "Winter", "All Seasons"],
    theme: ["Animal", "Cartoon", "Fantasy", "Meme", "Solid"],
    material: ["Acrylic", "Polyester", "Wool", "Cotton", "Faux Fur"],
  },
  ARTIFICIAL_PLANT: {
    item_type_keyword: ["artificial-flowers", "artificial-plants", "dried-plants", "wreaths"],
    specific_uses_for_product: ["Home Decor", "Wedding Decor", "Party Decor", "Office Decor"],
    indoor_outdoor_usage: ["indoor", "outdoor", "indoor_outdoor"],
    item_shape: ["Round", "Flower", "Bouquet", "Heart"],
    container: ["Wrap", "Box", "Bag", "Pot"],
    plant_or_animal_product_type: ["Artificial Plant", "Artificial Flower"],
    included_components: ["Arrangement Accessories", "Flower", "Stem"],
    is_refurbished: ["false", "true"],
  },
};

/**
 * Resolve labels, defaults, and enum options for a field (schema enums win over static hints).
 * @param {string} name
 * @param {string} [productType]
 * @param {Record<string, string[]>} [attributeEnums]
 */
export function resolveFieldMeta(name, productType = "", attributeEnums = {}) {
  const base = ATTRIBUTE_FIELD_META[name] || {};
  const pt = String(productType || "").trim().toUpperCase();
  const enumValues = attributeEnums[name]?.length
    ? attributeEnums[name]
    : (PRODUCT_TYPE_ENUM_HINTS[pt]?.[name] || base.enumValues || []);

  /** @type {{ label?: string, placeholder?: string, hint?: string, defaultValue?: string, enumValues?: string[] }} */
  const meta = {
    ...base,
    enumValues: Array.isArray(enumValues) ? enumValues : [],
  };

  if (name === "item_type_keyword") {
    if (pt === "KEYCHAIN") {
      meta.defaultValue = meta.defaultValue || "key-chains";
      meta.hint = "Browse-tree code. Most charm keychains use key-chains.";
    } else if (pt === "TOY_FIGURE") {
      meta.defaultValue = meta.defaultValue || "plush-figure-toys";
      meta.hint = "Browse-tree code. Plush items: plush-figure-toys or plush-animal-toys.";
    } else if (pt === "ARTIFICIAL_PLANT") {
      meta.defaultValue = meta.defaultValue || "artificial-flowers";
      meta.hint = "Browse-tree code. Faux bouquets usually use artificial-flowers.";
    }
  }

  if (name === "included_components" && pt === "KEYCHAIN") {
    meta.defaultValue = meta.defaultValue || "Keychain with charms";
  }

  if (name === "material" && pt === "KEYCHAIN") {
    meta.defaultValue = meta.defaultValue || "Metal, Acrylic";
    meta.placeholder = meta.placeholder || "Metal, Acrylic";
  }

  if (name === "item_weight" && pt === "KEYCHAIN") {
    meta.defaultValue = meta.defaultValue || "1.2 ounces";
  }

  if (name === "item_package_weight" && pt === "KEYCHAIN") {
    meta.defaultValue = meta.defaultValue || "3 ounces";
  }

  if (name === "item_type_keyword" && pt === "KEYCHAIN" && meta.enumValues.includes("key-chains")) {
    meta.defaultValue = "key-chains";
  }

  if (pt === "HAT") {
    if (name === "item_type_keyword") {
      meta.defaultValue = meta.defaultValue || "cold-weather-hats";
      meta.hint = "Browse-tree code. Beanies/earflap hats usually use cold-weather-hats.";
    }
    if (name === "material") {
      meta.defaultValue = meta.defaultValue || "Acrylic";
    }
    if (name === "style" && !meta.defaultValue) {
      meta.defaultValue = "Casual";
    }
    if (name === "headwear_size" && !meta.defaultValue) {
      meta.defaultValue = "One Size";
    }
  }

  return meta;
}

export function mergeAttributeNameLists(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

/** @param {string[]} attributeNames @param {import("./variationFamily.js").VariationRole | string} [variationRole] */
export function filterAttributesForVariationRole(attributeNames, variationRole = "standalone") {
  if (variationRole !== "parent") return attributeNames || [];
  const skip = new Set(["color", "merchant_suggested_asin"]);
  return (attributeNames || []).filter((name) => !skip.has(String(name || "").trim()));
}

/**
 * Build structured hints for amazon-ai-autofill from required + extended attribute names.
 * @param {string[]} attributeNames
 * @param {string} [productType]
 */
export function buildAttributeHintsForAi(attributeNames, productType = "", attributeEnums = {}) {
  const pt = String(productType || "").trim().toUpperCase();
  return (attributeNames || []).map((name) => {
    const meta = resolveFieldMeta(name, pt, attributeEnums);
    return {
      name,
      label: meta.label || formatAttributeLabel(name),
      hint: meta.hint || "",
      defaultValue: meta.defaultValue || "",
      enumValues: meta.enumValues || [],
    };
  });
}

function normalizeAmazonEnumFieldValue(name, value) {
  if (!value) return value;
  const folded = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (name === "cpsia_cautionary_statement" || name === "safety_warning") {
    if (folded === "nowarningapplicable" || folded === "no_warning_applicable") {
      return "no_warning_applicable";
    }
  }
  if (name === "toy_figure_type") {
    if (folded === "plush" || folded === "stuffed" || folded === "stuffed_animal" || folded === "soft_toy") {
      return "stuffed_toy";
    }
  }
  if (name === "theme" && (folded === "flowers" || folded === "flower")) {
    return "Floral";
  }
  if (name === "item_type_keyword") {
    if (folded === "stuffed_animal_toys") return "plush-animal-toys";
    if (folded === "plush_pillows") return "childrens-plush-toy-pillows";
    if (folded === "plush_figure") return "plush-figure-toys";
    if (folded === "keychain" || folded === "keychains") return "key-chains";
  }
  if (name === "indoor_outdoor_usage") {
    if (folded === "indoor" || value === "Indoor") return "indoor";
    if (folded === "outdoor" || value === "Outdoor") return "outdoor";
    if (folded === "indoor_outdoor" || folded === "indooroutdoor" || value === "Indoor/Outdoor") {
      return "indoor_outdoor";
    }
  }
  if (name === "plant_or_animal_product_type") {
    if (value === "Artificial Plant" || value === "Artificial Flower") return value;
    return "Artificial Plant";
  }
  return value;
}

function isBlankAttributeValue(name, value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (text === name) return true;
  if (text.replace(/_/g, " ").toLowerCase() === name.replace(/_/g, " ").toLowerCase()) return true;
  return false;
}

function queryAttributeControl(container, name) {
  return container.querySelector(`[data-amazon-attr="${name}"]`);
}

const HEADWEAR_SIZE_CLASS_OPTIONS = ["alpha", "numeric", "age"];
const HEADWEAR_SIZE_VALUE_OPTIONS = [
  "One Size",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
];

function parseHeadwearSizeFormValue(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "headwear_size") {
    return { sizeClass: "alpha", sizeValue: "One Size" };
  }
  if (raw.includes("|")) {
    const [sizeClass = "alpha", sizeValue = "One Size"] = raw.split("|").map((part) => part.trim());
    return { sizeClass, sizeValue };
  }
  const folded = raw.toLowerCase().replace(/\s+/g, "_");
  if (folded.includes("one_size") || folded === "one size") {
    return { sizeClass: "alpha", sizeValue: "One Size" };
  }
  return { sizeClass: "alpha", sizeValue: raw };
}

function serializeHeadwearSizeFormValue(sizeClass, sizeValue) {
  return `${sizeClass || "alpha"}|${sizeValue || "One Size"}`;
}

function renderHeadwearSizeControl(name, value, inputId) {
  const parsed = parseHeadwearSizeFormValue(value);
  const controlClass = "border-2 border-black px-3 py-2 min-h-[44px] w-full font-mono text-xs bg-white";
  const classOptions = HEADWEAR_SIZE_CLASS_OPTIONS.map((option) => {
    const selected = option === parsed.sizeClass ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");
  const sizeValues = HEADWEAR_SIZE_VALUE_OPTIONS.includes(parsed.sizeValue)
    ? HEADWEAR_SIZE_VALUE_OPTIONS
    : [...HEADWEAR_SIZE_VALUE_OPTIONS, parsed.sizeValue];
  const sizeOptions = sizeValues.map((option) => {
    const selected = option === parsed.sizeValue ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");

  return `
    <div
      class="grid grid-cols-1 sm:grid-cols-2 gap-2"
      data-amazon-attr="${escapeHtml(name)}"
      data-headwear-composite="true"
      id="${escapeHtml(inputId)}"
    >
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Size class</span>
        <select data-headwear-part="size_class" class="${controlClass}">${classOptions}</select>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Size value</span>
        <select data-headwear-part="size_value" class="${controlClass}">
          ${sizeOptions}
        </select>
      </div>
      <input type="hidden" data-headwear-serialized value="${escapeHtml(serializeHeadwearSizeFormValue(parsed.sizeClass, parsed.sizeValue))}" />
    </div>
  `;
}

function renderAttributeControl(name, meta, value, inputId) {
  if (meta.composite === "headwear_size" || name === "headwear_size") {
    return renderHeadwearSizeControl(name, value, inputId);
  }

  const enumValues = meta.enumValues || [];
  const controlClass = "border-2 border-black px-3 py-2 min-h-[44px] w-full font-mono text-xs";

  if (enumValues.length) {
    const options = enumValues.map((option) => {
      const selected = option === value ? " selected" : "";
      return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
    }).join("");
    const blankSelected = isBlankAttributeValue(name, value) ? " selected" : "";
    return `
      <select
        id="${escapeHtml(inputId)}"
        data-amazon-attr="${escapeHtml(name)}"
        class="${controlClass} bg-white"
      >
        <option value=""${blankSelected}>— Select —</option>
        ${options}
      </select>
    `;
  }

  return `
    <input
      id="${escapeHtml(inputId)}"
      type="text"
      data-amazon-attr="${escapeHtml(name)}"
      value="${escapeHtml(isBlankAttributeValue(name, value) ? "" : value)}"
      placeholder="${escapeHtml(meta.placeholder || name)}"
      class="${controlClass}"
    />
  `;
}

function formatAttributeLabel(name) {
  if (ATTRIBUTE_FIELD_META[name]?.label) return ATTRIBUTE_FIELD_META[name].label;
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function readDraftValue(draftPayload, name) {
  if (!draftPayload || typeof draftPayload !== "object") return "";
  const value = draftPayload[name];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Render inputs for required PTD attributes not covered by the main form.
 * @param {string[]} requiredAttributes
 * @param {Record<string, unknown>} [draftPayload]
 * @param {{ productType?: string, attributeEnums?: Record<string, string[]> }} [options]
 */
export function renderExtraAttributeFields(requiredAttributes, draftPayload = {}, options = {}) {
  const section = qs("#amazonPushExtraAttributesSection");
  const container = qs("#amazonPushExtraAttributes");
  if (!section || !container) return;

  const productType = options.productType || "";
  const attributeEnums = options.attributeEnums || {};
  const extras = (requiredAttributes || []).filter((name) => !COVERED_BY_MAIN_FORM.has(name));
  if (!extras.length) {
    section.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  container.innerHTML = extras.map((name) => {
    const meta = resolveFieldMeta(name, productType, attributeEnums);
    const label = meta.label || formatAttributeLabel(name);
    const hint = meta.hint || "";
    const rawValue = readDraftValue(draftPayload, name) || meta.defaultValue || "";
    const value = normalizeAmazonEnumFieldValue(name, rawValue);
    const inputId = `amazonPushAttr_${name}`;

    return `
      <div class="flex flex-col gap-1 sm:col-span-1">
        <label for="${escapeHtml(inputId)}" class="text-gray-400 font-bold uppercase tracking-wide text-[10px]">
          ${escapeHtml(label)}
          <span class="font-mono normal-case text-gray-400">(${escapeHtml(name)})</span>
        </label>
        ${renderAttributeControl(name, meta, value, inputId)}
        ${hint ? `<p class="text-[10px] text-gray-500">${escapeHtml(hint)}</p>` : ""}
      </div>
    `;
  }).join("");
}

export function resetExtraAttributeFields() {
  renderExtraAttributeFields([]);
}

/** @returns {Record<string, string>} */
export function readExtraAttributesFromForm() {
  const container = qs("#amazonPushExtraAttributes");
  if (!container) return {};

  /** @type {Record<string, string>} */
  const values = {};

  container.querySelectorAll('[data-headwear-composite="true"]').forEach((wrapper) => {
    if (!(wrapper instanceof HTMLElement)) return;
    const name = wrapper.dataset.amazonAttr || "headwear_size";
    const sizeClass = wrapper.querySelector('[data-headwear-part="size_class"]');
    const sizeValue = wrapper.querySelector('[data-headwear-part="size_value"]');
    const classVal = sizeClass instanceof HTMLSelectElement ? sizeClass.value.trim() : "alpha";
    const sizeVal = sizeValue instanceof HTMLSelectElement ? sizeValue.value.trim() : "One Size";
    if (name && sizeVal) {
      values[name] = serializeHeadwearSizeFormValue(classVal, sizeVal);
    }
  });

  container.querySelectorAll("[data-amazon-attr]").forEach((el) => {
    if (el instanceof HTMLElement && el.dataset.headwearComposite === "true") return;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement)) return;
    const name = el.dataset.amazonAttr || "";
    const value = el.value.trim();
    if (name && value && !isBlankAttributeValue(name, value)) values[name] = value;
  });
  return values;
}

/** Fill empty extra attribute inputs with known defaults. */
export function applyExtraAttributeDefaults(requiredAttributes, options = {}) {
  const container = qs("#amazonPushExtraAttributes");
  if (!container) return;

  const productType = options.productType || "";
  const attributeEnums = options.attributeEnums || {};
  const sellerSkuEl = qs("#amazonPushSellerSku");
  const sellerSku = sellerSkuEl instanceof HTMLInputElement ? sellerSkuEl.value.trim() : "";

  for (const name of requiredAttributes || []) {
    if (COVERED_BY_MAIN_FORM.has(name)) continue;
    const control = queryAttributeControl(container, name);
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) continue;

    const current = control.value.trim();
    const normalizedCurrent = normalizeAmazonEnumFieldValue(name, current);
    if (normalizedCurrent !== current) {
      control.value = normalizedCurrent;
      continue;
    }
    if (current && !isBlankAttributeValue(name, current)) continue;
    if (isBlankAttributeValue(name, current)) control.value = "";

    if ((name === "part_number" || name === "model_name" || name === "model_number") && sellerSku) {
      control.value = sellerSku;
      continue;
    }

    if (productType.toUpperCase() === "ARTIFICIAL_PLANT") {
      if (name === "plant_or_animal_product_type") {
        const allowed = new Set(["Artificial Plant", "Artificial Flower"]);
        if (!allowed.has(current)) {
          control.value = "Artificial Plant";
          continue;
        }
      }
      if (name === "plant_or_animal_product_type" && !current) {
        control.value = "Artificial Plant";
        continue;
      }
      if (name === "specific_uses_for_product" && !current) {
        control.value = "Home Decor";
        continue;
      }
      if (name === "item_shape" && !current) {
        control.value = "Round";
        continue;
      }
      if (name === "container" && !current) {
        control.value = "Wrap";
        continue;
      }
      if (name === "indoor_outdoor_usage" && !current) {
        control.value = "indoor";
        continue;
      }
      if (name === "is_refurbished" && !current) {
        control.value = "false";
        continue;
      }
    }

    if (name === "item_length_width_height") {
      const dimensionsInput = queryAttributeControl(container, "item_dimensions");
      if (dimensionsInput instanceof HTMLInputElement && dimensionsInput.value.trim()) {
        control.value = dimensionsInput.value.trim();
        continue;
      }
    }

    if (name === "headwear_size") {
      const wrapper = container.querySelector('[data-headwear-composite="true"]');
      if (wrapper instanceof HTMLElement) {
        const sizeClass = wrapper.querySelector('[data-headwear-part="size_class"]');
        const sizeValue = wrapper.querySelector('[data-headwear-part="size_value"]');
        if (sizeClass instanceof HTMLSelectElement) sizeClass.value = "alpha";
        if (sizeValue instanceof HTMLSelectElement) sizeValue.value = "One Size";
        const hidden = wrapper.querySelector("[data-headwear-serialized]");
        if (hidden instanceof HTMLInputElement) {
          hidden.value = serializeHeadwearSizeFormValue("alpha", "One Size");
        }
        continue;
      }
    }

    if (productType.toUpperCase() === "HAT") {
      if (name === "fabric_type" && !current) {
        control.value = "100% Acrylic";
        continue;
      }
      if (name === "department" && !current) {
        control.value = "Unisex";
        continue;
      }
      if (name === "import_designation" && !current) {
        control.value = "Imported";
        continue;
      }
      if (name === "care_instructions" && !current) {
        control.value = "Hand Wash Only";
        continue;
      }
      if (name === "seasons" && !current) {
        control.value = "Fall";
        continue;
      }
      if (name === "style" && !current) {
        control.value = "Casual";
        continue;
      }
    }

    const meta = resolveFieldMeta(name, productType, attributeEnums);
    if (meta.defaultValue) control.value = meta.defaultValue;
  }
}

/** @param {Array<{ name?: string, value?: string }>} attributes @param {{ overwrite?: boolean }} [options] */
export function applyAiAttributesToForm(attributes, options = {}) {
  if (!Array.isArray(attributes)) return;
  const container = qs("#amazonPushExtraAttributes");
  if (!container) return;
  const overwrite = options.overwrite === true;

  for (const entry of attributes) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const rawValue = typeof entry?.value === "string" ? entry.value.trim() : "";
    const value = normalizeAmazonEnumFieldValue(name, rawValue);
    if (!name || !value || isBlankAttributeValue(name, value)) continue;
    if (PUSH_EXTRA_ATTRIBUTE_DENYLIST.has(name)) continue;
    const control = queryAttributeControl(container, name);
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) continue;
    const current = control.value.trim();
    if (!overwrite && current && !isBlankAttributeValue(name, current)) continue;
    control.value = value;
  }
}

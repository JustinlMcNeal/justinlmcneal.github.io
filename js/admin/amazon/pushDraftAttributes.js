import { qs } from "./dom.js";
import { escapeHtml } from "./renderListings.js";

const BAG_LIKE_PRODUCT_TYPES = new Set(["HANDBAG", "TOTE_BAG"]);

/** @param {string} [productType] */
export function isBagLikeProductType(productType = "") {
  return BAG_LIKE_PRODUCT_TYPES.has(String(productType || "").trim().toUpperCase());
}

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
  target_audience: {
    label: "Target Audience",
    placeholder: "Women",
    hint: "Amazon audience enum for bags (e.g. Women, Unisex-Adults).",
    defaultValue: "Women",
  },
  lining_description: {
    label: "Lining Description",
    placeholder: "Polyester",
    hint: "Interior lining material (e.g. Polyester, Cotton).",
    defaultValue: "Polyester",
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
  size_info: {
    label: "Size Info",
    placeholder: "alpha|small|Mini / Small",
    hint: "Size class, Amazon size code, and customer-facing label. Mini totes: alpha | small | Mini / Small.",
    defaultValue: "alpha|small|Mini / Small",
    composite: "size_info",
  },
  capacity: {
    label: "Capacity",
    placeholder: "1.5|liters",
    hint: "Numeric capacity and unit (liters, cubic_inches). Mini bags often use 1.5|liters.",
    defaultValue: "1.5|liters",
    composite: "capacity",
  },
  outer: {
    label: "Outer Material",
    placeholder: "Faux Leather with heart embossing",
    hint: "Exterior material description shown to customers.",
    defaultValue: "Faux Leather",
  },
  inner: {
    label: "Inner Material",
    placeholder: "Polyester lining with slip pocket",
    hint: "Interior lining / compartment material description.",
    defaultValue: "Polyester lining",
  },
  strap_type: {
    label: "Strap Type",
    placeholder: "Shoulder",
    hint: "How the bag is carried, e.g. Shoulder, Cross-Body, or Hand-Carry.",
    defaultValue: "Shoulder",
    enumValues: ["Adjustable", "Cross-Body", "Hand-Carry", "Shoulder", "Waist Strap"],
  },
  number_of_compartments: {
    label: "Number Of Compartments",
    placeholder: "1",
    hint: "Count of separate storage compartments inside the bag.",
    defaultValue: "1",
    enumValues: ["1", "2", "3", "4"],
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
    hint: "Use false for hats and accessories without batteries.",
    defaultValue: "false",
    enumValues: ["false", "true"],
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
    hint: "Product style such as Casual, Fashion, or Novelty.",
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
    hint: "Primary season(s) for this item.",
    defaultValue: "Fall",
    enumValues: ["Spring", "Summer", "Fall", "Winter", "All Seasons"],
  },
  special_size_type: {
    label: "Special Size Type",
    placeholder: "Standard",
    hint: "Amazon special size category. Use Standard for regular one-size beanies and hats.",
    defaultValue: "Standard",
  },
  lifestyle: {
    label: "Lifestyle",
    placeholder: "Casual",
    hint: "Amazon lifestyle enum for HAT (e.g. Casual, Comfort).",
    defaultValue: "Casual",
  },
  pattern_type: {
    label: "Pattern Type",
    placeholder: "Graphic",
    hint: "Primary pattern on the hat (e.g. Graphic, Animal Print, Solid).",
    defaultValue: "Graphic",
  },
  headwear_size: {
    label: "Headwear Size",
    placeholder: "One Size",
    hint: "Use One Size for stretch beanies. Rendered as Amazon headwear_size (size class + value).",
    defaultValue: "One Size",
    composite: "headwear_size",
  },
  metals: {
    label: "Metals",
    hint: "Amazon metals composite: type, stamp, and ID (required for APPAREL_PIN).",
    defaultValue: "Alloy|No Metal Stamp|1",
    composite: "metals",
  },
  metal_type: {
    label: "Metal Type",
    placeholder: "alloy",
    hint: "Top-level metal type enum (required alongside metals composite for APPAREL_PIN).",
    defaultValue: "alloy",
    enumValues: ["alloy", "brass", "copper", "stainless-steel", "zinc"],
  },
  stones: {
    label: "Stones",
    hint: "Stone composite: type, treatment, creation method, and ID. Use No Gemstone for enamel-only pins.",
    defaultValue: "No Gemstone|Not Treated|Unknown|1",
    composite: "stones",
  },
  gem_type: {
    label: "Gem Type",
    placeholder: "No Gemstone",
    hint: "Required for pins. Use No Gemstone when the pin has no stone.",
    defaultValue: "No Gemstone",
    enumValues: [
      "No Gemstone",
      "Crystal",
      "Glass",
      "Rhinestone",
      "Pearl",
      "Cubic Zirconia",
    ],
  },
  title_differentiation: {
    label: "Title Differentiation",
    placeholder: "Enamel Pin",
    hint: "Short differentiator Amazon uses for similar titles (e.g. Enamel Pin, Lapel Pin).",
    defaultValue: "Enamel Pin",
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
  "title_differentiation",
  "special_size_type",
  "headwear_size",
  "department",
  "care_instructions",
  "age_range_description",
  "import_designation",
  "style",
  "seasons",
  "lifestyle",
  "pattern_type",
  "manufacturer",
  "material",
  "model_name",
  "model_number",
  "part_number",
  "generic_keyword",
  "target_gender",
  "color",
  "theme",
  "number_of_items",
  "batteries_required",
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

export const AMAZON_PIN_ATTRIBUTE_HINTS = [
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "item_type_keyword",
  "material",
  "metal_type",
  "metals",
  "stones",
  "gem_type",
  "size",
  "department",
  "title_differentiation",
  "manufacturer",
  "model_number",
  "model_name",
  "part_number",
  "generic_keyword",
  "target_gender",
  "color",
  "item_package_dimensions",
  "item_package_weight",
];

/** Hide invalid fields for enamel pins. */
export const APPAREL_PIN_FORM_DENYLIST = new Set([
  "package_level",
  "included_components",
  "theme",
  "variation_role",
  "parentage_level",
  "child_parent_sku_relationship",
  "variation_theme",
  "closure",
  "special_feature",
  "fabric_type",
  "cpsia_cautionary_statement",
  "safety_warning",
  "toy_figure_type",
  "subject_character",
  "educational_objective",
  "plant_or_animal_product_type",
]);

export const AMAZON_BELT_ATTRIBUTE_HINTS = [
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "item_type_keyword",
  "fabric_type",
  "title_differentiation",
  "department",
  "size",
  "care_instructions",
  "import_designation",
  "age_range_description",
  "manufacturer",
  "model_name",
  "model_number",
  "part_number",
  "generic_keyword",
  "material",
  "target_gender",
  "color",
  "number_of_items",
  "item_package_dimensions",
  "item_package_weight",
];

/** Hide invalid fields for fashion belts. */
export const APPAREL_BELT_FORM_DENYLIST = new Set([
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
]);

export const AMAZON_HANDBAG_ATTRIBUTE_HINTS = [
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "item_type_keyword",
  "fabric_type",
  "title_differentiation",
  "lining_description",
  "special_feature",
  "target_audience",
  "style",
  "department",
  "target_gender",
  "age_range_description",
  "import_designation",
  "seasons",
  "size_info",
  "capacity",
  "outer",
  "inner",
  "item_dimensions",
  "closure",
  "strap_type",
  "number_of_compartments",
  "manufacturer",
  "material",
  "model_name",
  "model_number",
  "part_number",
  "generic_keyword",
  "number_of_items",
  "included_components",
  "batteries_required",
  "theme",
  "item_package_dimensions",
  "item_package_weight",
];

/** TOTE_BAG uses item_length_width_height instead of item_dimensions. */
export const AMAZON_TOTE_BAG_ATTRIBUTE_HINTS = AMAZON_HANDBAG_ATTRIBUTE_HINTS
  .filter((name) => name !== "item_dimensions" && name !== "included_components" && name !== "target_audience")
  .concat(["item_length_width_height"]);

/** Hide on TOTE_BAG forms and strip before save/payload. */
export const TOTE_BAG_FORM_EXTRA_DENYLIST = new Set([
  "target_audience",
  "package_level",
  "included_components",
]);

/** Hide invalid fields for handbags / mini totes. */
export const HANDBAG_FORM_DENYLIST = new Set([
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
 * @param {string} [productType]
 */
export function stripInvalidPushPayloadAttributes(payload = {}, productType = "") {
  /** @type {Record<string, unknown>} */
  const cleaned = { ...payload };
  for (const key of Object.keys(cleaned)) {
    if (PUSH_EXTRA_ATTRIBUTE_DENYLIST.has(key)) {
      delete cleaned[key];
      continue;
    }
    const value = cleaned[key];
    if (typeof value === "string" && isBlankAttributeValue(key, value, productType)) {
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
  if (normalized === "APPAREL_PIN") {
    filtered = filtered.filter((name) => !APPAREL_PIN_FORM_DENYLIST.has(name));
  }
  if (normalized === "APPAREL_BELT") {
    filtered = filtered.filter((name) => !APPAREL_BELT_FORM_DENYLIST.has(name));
  }
  if (normalized === "HANDBAG") {
    filtered = filtered.filter((name) => !HANDBAG_FORM_DENYLIST.has(name));
  }
  if (normalized === "TOTE_BAG") {
    filtered = filtered.filter((name) => !HANDBAG_FORM_DENYLIST.has(name));
    filtered = filtered.filter((name) => !TOTE_BAG_FORM_EXTRA_DENYLIST.has(name));
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
  if (normalized === "APPAREL_PIN") return [...AMAZON_PIN_ATTRIBUTE_HINTS];
  if (normalized === "APPAREL_BELT") return [...AMAZON_BELT_ATTRIBUTE_HINTS];
  if (normalized === "HANDBAG") return [...AMAZON_HANDBAG_ATTRIBUTE_HINTS];
  if (normalized === "TOTE_BAG") return [...AMAZON_TOTE_BAG_ATTRIBUTE_HINTS];
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
    special_size_type: [
      "Standard",
      "Big",
      "Tall",
      "Plus Size",
      "Petite",
      "Big & Tall",
    ],
    lifestyle: ["Casual", "Comfort", "Business Casual", "Formal", "Evening"],
    pattern_type: [
      "Graphic",
      "Animal Print",
      "Solid",
      "Geometric",
      "Camouflage",
      "Floral",
    ],
  },
  APPAREL_BELT: {
    item_type_keyword: [
      "apparel-belts",
      "novelty-apparel-belts",
      "gun-belts",
      "baseball-belts",
      "sports-fan-belts",
    ],
    department: ["Unisex", "Womens", "Mens", "Girls", "Boys"],
    import_designation: ["Imported", "Made in the USA", "Made in the USA and Imported", "Made in the USA or Imported"],
    care_instructions: ["Wipe Clean", "Hand Wash Only", "Machine Wash", "Dry Clean Only", "Do Not Wash"],
    age_range_description: ["Adult", "Big Kid", "Little Kid", "Toddler", "Infant"],
    target_gender: ["unisex", "female", "male"],
    material: ["Faux Leather", "PU Leather", "Leather", "Polyurethane", "Synthetic Leather"],
  },
  HANDBAG: {
    item_type_keyword: [
      "top-handle-handbags",
      "cross-body-handbags",
      "shoulder-handbags",
      "clutch-handbags",
      "handbags",
      "messenger-bags",
    ],
    department: ["Unisex", "Womens", "Mens", "Girls", "Boys"],
    target_audience: ["Women", "Unisex-Adults", "Girls", "Men", "Unisex-Youth"],
    special_feature: [
      "Detachable Strap",
      "Convertible",
      "Cell Phone Holder",
      "Anti-Theft",
      "Lightweight",
    ],
    style: ["Casual", "Fashion", "Evening", "Classic", "Novelty"],
    theme: ["Love", "Floral", "Animal", "Fantasy", "Solid"],
    material: ["Faux Leather", "PU Leather", "Polyurethane", "Leather", "Polyester"],
    fabric_type: ["Faux Leather", "PU Leather", "Polyurethane", "Leather"],
    lining_description: ["Polyester", "Cotton", "Nylon", "Satin"],
    included_components: ["Shoulder Strap", "Detachable Strap", "Bag"],
    seasons: ["Spring", "Summer", "Fall", "Winter", "All Seasons"],
    closure: ["Zipper", "Magnetic", "Snap", "Flap", "Drawstring", "Open Top"],
    strap_type: ["Adjustable", "Cross-Body", "Hand-Carry", "Shoulder", "Waist Strap"],
    import_designation: ["Imported", "Made in the USA", "Made in the USA and Imported", "Made in the USA or Imported"],
    age_range_description: ["Adult", "Big Kid", "Little Kid", "Toddler", "Infant"],
    number_of_compartments: ["1", "2", "3", "4"],
  },
  TOTE_BAG: {
    item_type_keyword: [
      "reusable-grocery-bags",
      "shopping-totes",
      "top-handle-handbags",
      "shoulder-handbags",
    ],
    department: ["Unisex", "Womens", "Mens", "Girls", "Boys"],
    target_audience: ["Women", "Unisex-Adults", "Girls", "Men", "Unisex-Youth"],
    special_feature: ["Reusable", "Lightweight", "Foldable", "Eco-Friendly"],
    style: ["Casual", "Fashion", "Classic", "Novelty"],
    material: ["Cotton", "Canvas", "Polyester", "Polyurethane"],
    fabric_type: ["Canvas", "100% Cotton", "Cotton Canvas"],
    lining_description: ["Unlined", "Polyester", "Cotton", "Nylon"],
    seasons: ["Spring", "Summer", "Fall", "Winter", "All Seasons"],
    closure: ["Open Top", "Zipper", "Magnetic", "Snap", "Flap", "Drawstring"],
    strap_type: ["Adjustable", "Cross-Body", "Hand-Carry", "Shoulder", "Waist Strap"],
    import_designation: ["Imported", "Made in the USA", "Made in the USA and Imported", "Made in the USA or Imported"],
    age_range_description: ["Adult", "Big Kid", "Little Kid", "Toddler", "Infant"],
    number_of_compartments: ["1", "2", "3", "4"],
  },
  APPAREL_PIN: {
    item_type_keyword: ["brooches-and-pins", "lapel-pins", "enamel-pins", "novelty-pins"],
    department: ["Unisex", "Mens", "Womens", "Boys", "Girls"],
    gem_type: ["No Gemstone", "Crystal", "Glass", "Plastic", "Resin"],
    size: ["Small", "Medium", "Large", "One Size"],
    metal_type: ["alloy", "brass", "copper", "stainless-steel", "zinc"],
    material: ["Metal", "Enamel", "Zinc Alloy", "Brass"],
    stone_type: ["No Gemstone", "Crystal", "Glass", "Plastic", "Resin"],
    treatment_method: ["Not Treated", "Coated", "Dyed", "Heat Treated", "Irradiated", "Bleached"],
    creation_method: ["Unknown", "Simulated", "Natural", "Lab-Created", "Compressed"],
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
    if (name === "fabric_type") {
      meta.placeholder = "100% Acrylic";
      meta.hint = "Fiber content for the knit (e.g. 100% Acrylic). Never Plush or plant fabric terms.";
      meta.defaultValue = meta.defaultValue || "100% Acrylic";
    }
    if (name === "title_differentiation") {
      meta.label = "Item Highlight";
      meta.placeholder = "Faux fur cat ears";
      meta.hint = "Short benefit phrase for Amazon Item Highlights (max 125 chars).";
      meta.defaultValue = "";
    }
    if (name === "special_size_type") {
      meta.defaultValue = meta.defaultValue || "Standard";
      meta.hint = "Use Standard for regular one-size beanies and stretch hats.";
    }
    if (name === "material") {
      meta.defaultValue = meta.defaultValue || "Acrylic";
    }
    if (name === "color") {
      meta.placeholder = "Black";
      meta.hint = "Primary hat color (e.g. Black, Gray). Avoid Multicolor unless truly multi-color.";
      meta.defaultValue = meta.defaultValue || "Black";
    }
    if (name === "style" && !meta.defaultValue) {
      meta.defaultValue = "Casual";
    }
    if (name === "headwear_size" && !meta.defaultValue) {
      meta.defaultValue = "One Size";
    }
    if (name === "lifestyle" && !meta.defaultValue) {
      meta.defaultValue = "Casual";
    }
    if (name === "pattern_type" && !meta.defaultValue) {
      meta.defaultValue = "Graphic";
    }
    if (name === "batteries_required" && !meta.defaultValue) {
      meta.defaultValue = "false";
    }
  }

  if (isBagLikeProductType(pt)) {
    const isTote = pt === "TOTE_BAG";
    if (name === "item_type_keyword") {
      meta.defaultValue = meta.defaultValue || (isTote ? "reusable-grocery-bags" : "top-handle-handbags");
      meta.hint = isTote
        ? "Browse-tree code. Canvas mini totes often use reusable-grocery-bags."
        : "Browse-tree code. Mini totes often use top-handle-handbags or cross-body-handbags.";
    }
    if (name === "fabric_type") {
      meta.placeholder = isTote ? "Canvas" : "Faux Leather";
      meta.hint = isTote
        ? "Exterior material (e.g. Canvas, 100% Cotton). Never Plush or plant fabric terms."
        : "Exterior material (e.g. Faux Leather, PU Leather). Never Plush or plant fabric terms.";
      meta.defaultValue = meta.defaultValue || (isTote ? "Canvas" : "Faux Leather");
    }
    if (name === "title_differentiation") {
      meta.label = "Item Highlight";
      meta.placeholder = isTote ? "Mini pastel canvas tote" : "Heart-quilted faux leather";
      meta.hint = "Short benefit phrase for Amazon Item Highlights (max 125 chars).";
      meta.defaultValue = "";
    }
    if (name === "material") {
      meta.defaultValue = meta.defaultValue || (isTote ? "Cotton" : "Faux Leather");
      if (!meta.enumValues?.length) {
        meta.enumValues = isTote
          ? ["Cotton", "Canvas", "Polyester", "Polyurethane"]
          : ["Faux Leather", "PU Leather", "Polyurethane", "Leather", "Polyester"];
      }
    }
    if (name === "lining_description" && !meta.defaultValue) {
      meta.defaultValue = isTote ? "Unlined" : "Polyester";
    }
    if (name === "target_audience" && !meta.defaultValue) {
      meta.defaultValue = isTote ? "Unisex-Adults" : "Women";
    }
    if (name === "special_feature" && !meta.defaultValue) {
      meta.defaultValue = isTote ? "Reusable" : "Detachable Strap";
    }
    if (!isTote && name === "included_components" && !meta.defaultValue) {
      meta.defaultValue = "Shoulder Strap";
    }
    if (name === "style") {
      meta.hint = "Bag style such as Casual, Fashion, or Evening.";
      meta.defaultValue = meta.defaultValue || "Casual";
    }
    if (name === "department" && !meta.defaultValue) {
      meta.defaultValue = isTote ? "Unisex" : "Womens";
    }
    if (name === "theme" && !meta.defaultValue) {
      meta.defaultValue = isTote ? "" : "Love";
    }
    if (name === "color") {
      meta.placeholder = "Black";
      meta.hint = "Primary bag color. Variation parents: leave blank — color goes on child SKUs.";
      meta.defaultValue = "";
    }
    if (name === "batteries_required" && !meta.defaultValue) {
      meta.defaultValue = "false";
    }
    if (name === "closure") {
      meta.placeholder = isTote ? "Open Top" : "Zipper";
      meta.hint = "How the bag closes, e.g. Zipper, Magnetic, Snap, or Open Top.";
      meta.defaultValue = meta.defaultValue || (isTote ? "Open Top" : "Zipper");
      if (!meta.enumValues?.length) {
        meta.enumValues = ["Zipper", "Magnetic", "Snap", "Flap", "Drawstring", "Open Top"];
      }
    }
    if (name === "seasons" && !meta.defaultValue) {
      meta.defaultValue = "Fall";
    }
    if (name === "import_designation" && !meta.defaultValue) {
      meta.defaultValue = "Imported";
    }
    if (name === "age_range_description" && !meta.defaultValue) {
      meta.defaultValue = "Adult";
    }
    if (name === "size_info") {
      meta.label = "Size Display Name";
      meta.placeholder = "Mini / Small";
      meta.hint = "Customer-facing size label shown when shoppers only see the photo.";
      meta.defaultValue = meta.defaultValue || "Mini / Small";
      delete meta.composite;
    }
    if (name === "capacity" && !meta.defaultValue) {
      meta.defaultValue = "1.5|liters";
      meta.composite = "capacity";
    }
    if (name === "outer" && !meta.defaultValue) {
      meta.defaultValue = isTote ? "Canvas" : "Faux Leather";
    }
    if (name === "inner" && !meta.defaultValue) {
      meta.defaultValue = isTote ? "Unlined (canvas interior)" : "Polyester lining";
    }
    if (name === "strap_type" && !meta.defaultValue) {
      meta.defaultValue = isTote ? "Hand-Carry" : "Shoulder";
    }
    if (name === "number_of_compartments" && !meta.defaultValue) {
      meta.defaultValue = "1";
    }
    if (!isTote && name === "item_dimensions" && !meta.defaultValue) {
      meta.defaultValue = "8 x 6 x 4 in";
    }
    if (isTote && name === "item_length_width_height") {
      meta.label = "Item Length x Width x Height";
      meta.placeholder = "8 x 6 x 4 in";
      meta.hint = "Length x Width x Height with unit, e.g. 8 x 6 x 4 in";
      meta.defaultValue = meta.defaultValue || "8 x 6 x 4 in";
    }
  }

  if (name === "material" && pt === "APPAREL_PIN") {
    meta.defaultValue = meta.defaultValue || "Metal";
    if (!meta.enumValues?.length) {
      meta.enumValues = ["Metal", "Enamel", "Zinc Alloy", "Brass", "Acrylic"];
    }
  }

  if (pt === "APPAREL_BELT") {
    if (name === "item_type_keyword") {
      meta.defaultValue = meta.defaultValue || "apparel-belts";
      meta.hint = "Browse-tree code. Fashion/western belts usually use apparel-belts.";
    }
    if (name === "fabric_type") {
      meta.label = "Fabric Type";
      meta.placeholder = "100% Faux Leather";
      meta.hint = "Strap material description (e.g. 100% Faux Leather, PU Leather).";
      meta.defaultValue = meta.defaultValue || "100% Faux Leather";
    }
    if (name === "title_differentiation") {
      meta.label = "Item Highlight";
      meta.placeholder = "Antique heart buckle";
      meta.hint = "Short benefit phrase for Amazon Item Highlights (max 125 chars).";
      meta.defaultValue = "";
    }
    if (name === "material") {
      meta.defaultValue = meta.defaultValue || "Faux Leather";
      if (!meta.enumValues?.length) {
        meta.enumValues = ["Faux Leather", "PU Leather", "Leather", "Polyurethane"];
      }
    }
    if (name === "department" && !meta.defaultValue) {
      meta.defaultValue = "Unisex";
    }
    if (name === "size" && !meta.defaultValue) {
      meta.placeholder = "One Size";
      meta.hint = "Belt size customers select. Use One Size for adjustable belts.";
      meta.defaultValue = "One Size";
    }
    if (name === "import_designation" && !meta.defaultValue) {
      meta.defaultValue = "Imported";
    }
    if (name === "care_instructions" && !meta.defaultValue) {
      meta.defaultValue = "Wipe Clean";
    }
    if (name === "age_range_description" && !meta.defaultValue) {
      meta.defaultValue = "Adult";
    }
    if (name === "color") {
      meta.placeholder = "Black";
      meta.hint = "Primary strap or buckle color (e.g. Black, Brown).";
      meta.defaultValue = meta.defaultValue || "Black";
    }
  }

  if (pt === "APPAREL_PIN") {
    if (name === "item_type_keyword") {
      meta.defaultValue = meta.defaultValue || "brooches-and-pins";
      meta.hint = "Browse-tree code. Enamel/lapel pins usually use brooches-and-pins.";
    }
    if (name === "metals" && !meta.defaultValue) {
      meta.defaultValue = "Alloy|No Metal Stamp|1";
    }
    if (name === "metal_type" && !meta.defaultValue) {
      meta.defaultValue = "alloy";
    }
    if (name === "stones" && !meta.defaultValue) {
      meta.defaultValue = "No Gemstone|Not Treated|Unknown|1";
    }
    if (name === "gem_type" && !meta.defaultValue) {
      meta.defaultValue = "No Gemstone";
    }
    if (name === "size" && !meta.defaultValue) {
      meta.defaultValue = "Small";
    }
    if (name === "department" && !meta.defaultValue) {
      meta.defaultValue = "Unisex";
    }
    if (name === "title_differentiation" && !meta.defaultValue) {
      meta.defaultValue = "Enamel Pin";
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
    if (folded === "brooches_and_pins" || folded === "lapel_pins" || folded === "enamel_pins") {
      return "brooches-and-pins";
    }
    if (folded === "apparel_belts" || folded === "belts" || folded === "fashion_belts") {
      return "apparel-belts";
    }
    if (folded === "novelty_belts" || folded === "western_belts") {
      return "novelty-apparel-belts";
    }
    if (folded === "mini_tote" || folded === "mini_totes" || folded === "handbag" || folded === "handbags") {
      return "top-handle-handbags";
    }
    if (folded === "crossbody" || folded === "cross_body") {
      return "cross-body-handbags";
    }
    if (folded === "reusable_grocery_bags" || folded === "reusable_grocery_bag" || folded === "grocery_tote") {
      return "reusable-grocery-bags";
    }
    if (folded === "shopping_totes" || folded === "shopping_tote" || folded === "canvas_tote") {
      return "shopping-totes";
    }
  }
  if (name === "indoor_outdoor_usage") {
    if (folded === "indoor" || value === "Indoor") return "indoor";
    if (folded === "outdoor" || value === "Outdoor") return "outdoor";
    if (folded === "indoor_outdoor" || folded === "indooroutdoor" || value === "Indoor/Outdoor") {
      return "indoor_outdoor";
    }
  }
  if (name === "treatment_method" || name === "stones") {
    if (folded === "not applicable" || folded === "not_applicable" || folded === "n/a") {
      return "Not Treated";
    }
  }
  if (name === "creation_method") {
    if (folded === "not applicable" || folded === "not_applicable" || folded === "n/a") {
      return "Unknown";
    }
  }
  if (name === "metals" && value.includes("|")) {
    const parts = value.split("|").map((part) => part.trim());
    if (parts[0]?.toLowerCase() === "alloy") parts[0] = "Alloy";
    if (parts[1]?.toLowerCase() === "no metal stamp" || parts[1]?.toLowerCase() === "no stamp") {
      parts[1] = "No Metal Stamp";
    }
    return parts.join("|");
  }
  if (name === "plant_or_animal_product_type") {
    if (value === "Artificial Plant" || value === "Artificial Flower") return value;
    return "Artificial Plant";
  }
  return value;
}

function isBlankAttributeValue(name, value, productType = "") {
  const text = String(value || "").trim();
  if (!text) return true;
  if (text.toLowerCase() === "default") return true;
  if (text === name) return true;
  if (text.replace(/_/g, " ").toLowerCase() === name.replace(/_/g, " ").toLowerCase()) return true;
  return shouldReplaceAttributeValue(name, text, productType);
}

/** True when an existing value should be replaced by defaults or AI (wrong product-type placeholder). */
export function shouldReplaceAttributeValue(name, value, productType = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  const pt = String(productType || "").trim().toUpperCase();
  if (pt === "APPAREL_BELT") {
    if (name === "fabric_type" && text.toLowerCase() === "plush") return true;
    if (name === "material" && text.toLowerCase() === "polyester") return true;
    if (name === "color" && text.toLowerCase() === "multicolor") return true;
    if (name === "title_differentiation") {
      const folded = text.toLowerCase();
      if (folded === "default" || folded === "enamel pin" || folded === "lapel pin") return true;
    }
  }
  if (pt === "HAT") {
    if (name === "fabric_type" && text.toLowerCase() === "plush") return true;
    if (name === "material" && text.toLowerCase() === "polyester") return true;
    if (name === "color" && text.toLowerCase() === "multicolor") return true;
    if (name === "special_size_type" && text.toLowerCase() === "special_size_type") return true;
    if (name === "title_differentiation") {
      const folded = text.toLowerCase();
      if (folded === "default" || folded === "enamel pin" || folded === "lapel pin") return true;
    }
  }
  if (isBagLikeProductType(pt)) {
    if (name === "fabric_type" && text.toLowerCase() === "plush") return true;
    if (name === "color" && text.toLowerCase() === "multicolor") return true;
    if (name === "closure" && text.toLowerCase() === "lobster clasp") return true;
    if (name === "capacity" && !/[\d.]/.test(text)) return true;
    if (name === "title_differentiation") {
      const folded = text.toLowerCase();
      if (folded === "default" || folded === "enamel pin" || folded === "lapel pin") return true;
    }
    if (name === "package_level") return true;
    if (name === "included_components") return true;
  }
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

const SIZE_INFO_CLASS_OPTIONS = ["alpha", "numeric"];
const SIZE_INFO_VALUE_OPTIONS = ["small", "medium", "large", "one_size"];
const CAPACITY_UNIT_OPTIONS = ["liters", "cubic_inches", "cubic_centimeters", "fluid_ounces"];

function parseSizeInfoFormValue(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "size_info") {
    return { sizeClass: "alpha", size: "small", displayName: "Mini / Small" };
  }
  if (raw.includes("|")) {
    const parts = raw.split("|").map((part) => part.trim());
    if (parts.length >= 3) {
      return {
        sizeClass: parts[0] || "alpha",
        size: parts[1] || "small",
        displayName: parts[2] || "Mini / Small",
      };
    }
    return {
      sizeClass: "alpha",
      size: parts[0] || "small",
      displayName: parts[1] || parts[0] || "Mini / Small",
    };
  }
  return { sizeClass: "alpha", size: "small", displayName: raw };
}

function serializeSizeInfoFormValue(sizeClass, size, displayName) {
  return `${sizeClass || "alpha"}|${size || "small"}|${displayName || "Mini / Small"}`;
}

function parseCapacityFormValue(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "capacity") {
    return { amount: "1.5", unit: "liters" };
  }
  if (raw.includes("|")) {
    const [amount = "1.5", unit = "liters"] = raw.split("|").map((part) => part.trim());
    return { amount, unit: unit || "liters" };
  }
  const numbers = raw.match(/[\d.]+/g);
  return {
    amount: numbers?.[0] || "1.5",
    unit: "liters",
  };
}

function serializeCapacityFormValue(amount, unit) {
  return `${amount || "1.5"}|${unit || "liters"}`;
}

function renderSizeInfoControl(name, value, inputId) {
  const parsed = parseSizeInfoFormValue(value);
  const controlClass = "border-2 border-black px-3 py-2 min-h-[44px] w-full font-mono text-xs bg-white";
  const classOptions = SIZE_INFO_CLASS_OPTIONS.map((option) => {
    const selected = option === parsed.sizeClass ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");
  const sizeOptions = SIZE_INFO_VALUE_OPTIONS.map((option) => {
    const selected = option === parsed.size ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");
  return `
    <div
      class="grid grid-cols-1 gap-2"
      data-size-info-composite="true"
      data-amazon-attr="${escapeHtml(name)}"
    >
      <select data-size-info-part="size_class" class="${controlClass}">${classOptions}</select>
      <select data-size-info-part="size" class="${controlClass}">${sizeOptions}</select>
      <input
        id="${escapeHtml(inputId)}"
        type="text"
        data-size-info-part="display_name"
        value="${escapeHtml(parsed.displayName)}"
        placeholder="Mini / Small"
        class="${controlClass}"
      />
    </div>
  `;
}

function renderCapacityControl(name, value, inputId) {
  const parsed = parseCapacityFormValue(value);
  const controlClass = "border-2 border-black px-3 py-2 min-h-[44px] w-full font-mono text-xs bg-white";
  const unitOptions = CAPACITY_UNIT_OPTIONS.map((option) => {
    const selected = option === parsed.unit ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");
  return `
    <div
      class="grid grid-cols-1 gap-2"
      data-capacity-composite="true"
      data-amazon-attr="${escapeHtml(name)}"
    >
      <input
        id="${escapeHtml(inputId)}"
        type="text"
        data-capacity-part="amount"
        value="${escapeHtml(parsed.amount)}"
        placeholder="1.5"
        class="${controlClass}"
      />
      <select data-capacity-part="unit" class="${controlClass}">${unitOptions}</select>
    </div>
  `;
}

const METALS_TYPE_OPTIONS = ["Alloy", "Brass", "Copper", "Stainless Steel", "Zinc"];
const METALS_STAMP_OPTIONS = ["No Metal Stamp", "925 Silver", "14K", "18K"];
const STONES_TYPE_OPTIONS = ["No Gemstone", "Crystal", "Glass", "Plastic", "Resin"];
const STONES_TREATMENT_OPTIONS = [
  "Not Treated",
  "Coated",
  "Dyed",
  "Heat Treated",
  "Irradiated",
  "Bleached",
];
const STONES_CREATION_OPTIONS = ["Unknown", "Simulated", "Natural", "Lab-Created", "Compressed"];

function parseStonesFormValue(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "stones") {
    return {
      stoneType: "No Gemstone",
      treatmentMethod: "Not Treated",
      creationMethod: "Unknown",
      id: "1",
    };
  }
  if (raw.includes("|")) {
    const parts = raw.split("|").map((part) => part.trim());
    if (parts.length >= 4) {
      return {
        stoneType: parts[0] || "No Gemstone",
        treatmentMethod: parts[1] || "Not Treated",
        creationMethod: parts[2] || "Unknown",
        id: parts[3] || "1",
      };
    }
    return {
      stoneType: parts[0] || "No Gemstone",
      treatmentMethod: "Not Treated",
      creationMethod: "Unknown",
      id: parts[1] || "1",
    };
  }
  if (STONES_TYPE_OPTIONS.includes(raw)) {
    return {
      stoneType: raw,
      treatmentMethod: "Not Treated",
      creationMethod: "Unknown",
      id: "1",
    };
  }
  return {
    stoneType: "No Gemstone",
    treatmentMethod: "Not Treated",
    creationMethod: "Unknown",
    id: "1",
  };
}

function serializeStonesFormValue(stoneType, treatmentMethod, creationMethod, id) {
  return `${stoneType || "No Gemstone"}|${treatmentMethod || "Not Treated"}|${creationMethod || "Unknown"}|${id || "1"}`;
}

function parseMetalsFormValue(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "metals") {
    return { metalType: "Alloy", metalStamp: "No Metal Stamp", id: "1" };
  }
  if (raw.includes("|")) {
    const [metalType = "Alloy", metalStamp = "No Metal Stamp", id = "1"] = raw.split("|").map((part) => part.trim());
    return { metalType, metalStamp, id: id || "1" };
  }
  if (METALS_TYPE_OPTIONS.includes(raw)) {
    return { metalType: raw, metalStamp: "No Metal Stamp", id: "1" };
  }
  if (raw.toLowerCase() === "alloy") {
    return { metalType: "Alloy", metalStamp: "No Metal Stamp", id: "1" };
  }
  return { metalType: "Alloy", metalStamp: "No Metal Stamp", id: "1" };
}

function serializeMetalsFormValue(metalType, metalStamp, id) {
  return `${metalType || "Alloy"}|${metalStamp || "No Metal Stamp"}|${id || "1"}`;
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

function renderMetalsCompositeControl(name, value, inputId) {
  const parsed = parseMetalsFormValue(value);
  const controlClass = "border-2 border-black px-3 py-2 min-h-[44px] w-full font-mono text-xs bg-white";
  const typeValues = METALS_TYPE_OPTIONS.includes(parsed.metalType)
    ? METALS_TYPE_OPTIONS
    : [...METALS_TYPE_OPTIONS, parsed.metalType];
  const stampValues = METALS_STAMP_OPTIONS.includes(parsed.metalStamp)
    ? METALS_STAMP_OPTIONS
    : [...METALS_STAMP_OPTIONS, parsed.metalStamp];
  const typeOptions = typeValues.map((option) => {
    const selected = option === parsed.metalType ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");
  const stampOptions = stampValues.map((option) => {
    const selected = option === parsed.metalStamp ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");

  return `
    <div
      class="grid grid-cols-1 sm:grid-cols-3 gap-2"
      data-amazon-attr="${escapeHtml(name)}"
      data-metals-composite="true"
      id="${escapeHtml(inputId)}"
    >
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Metal type</span>
        <select data-metals-part="metal_type" class="${controlClass}">${typeOptions}</select>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Metal stamp</span>
        <select data-metals-part="metal_stamp" class="${controlClass}">${stampOptions}</select>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Metal ID</span>
        <input
          type="text"
          data-metals-part="id"
          value="${escapeHtml(parsed.id || "1")}"
          placeholder="1"
          class="${controlClass}"
        />
      </div>
      <input
        type="hidden"
        data-metals-serialized
        value="${escapeHtml(serializeMetalsFormValue(parsed.metalType, parsed.metalStamp, parsed.id))}"
      />
    </div>
  `;
}

function renderStonesCompositeControl(name, value, inputId) {
  const parsed = parseStonesFormValue(value);
  const controlClass = "border-2 border-black px-3 py-2 min-h-[44px] w-full font-mono text-xs bg-white";
  const typeValues = STONES_TYPE_OPTIONS.includes(parsed.stoneType)
    ? STONES_TYPE_OPTIONS
    : [...STONES_TYPE_OPTIONS, parsed.stoneType];
  const treatmentValues = STONES_TREATMENT_OPTIONS.includes(parsed.treatmentMethod)
    ? STONES_TREATMENT_OPTIONS
    : [...STONES_TREATMENT_OPTIONS, parsed.treatmentMethod];
  const creationValues = STONES_CREATION_OPTIONS.includes(parsed.creationMethod)
    ? STONES_CREATION_OPTIONS
    : [...STONES_CREATION_OPTIONS, parsed.creationMethod];
  const typeOptions = typeValues.map((option) => {
    const selected = option === parsed.stoneType ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");
  const treatmentOptions = treatmentValues.map((option) => {
    const selected = option === parsed.treatmentMethod ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");
  const creationOptions = creationValues.map((option) => {
    const selected = option === parsed.creationMethod ? " selected" : "";
    return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
  }).join("");

  return `
    <div
      class="grid grid-cols-1 sm:grid-cols-2 gap-2"
      data-amazon-attr="${escapeHtml(name)}"
      data-stones-composite="true"
      id="${escapeHtml(inputId)}"
    >
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Stone type</span>
        <select data-stones-part="stone_type" class="${controlClass}">${typeOptions}</select>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Treatment method</span>
        <select data-stones-part="treatment_method" class="${controlClass}">${treatmentOptions}</select>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Creation method</span>
        <select data-stones-part="creation_method" class="${controlClass}">${creationOptions}</select>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-bold uppercase text-gray-500">Stone ID</span>
        <input
          type="text"
          data-stones-part="id"
          value="${escapeHtml(parsed.id || "1")}"
          placeholder="1"
          class="${controlClass}"
        />
      </div>
      <input
        type="hidden"
        data-stones-serialized
        value="${escapeHtml(serializeStonesFormValue(parsed.stoneType, parsed.treatmentMethod, parsed.creationMethod, parsed.id))}"
      />
    </div>
  `;
}

function formatSizeInfoDraftValue(value, productType = "") {
  if (!isBagLikeProductType(productType)) return value;
  return parseSizeInfoFormValue(value).displayName;
}

function renderAttributeControl(name, meta, value, inputId, productType = "") {
  if (meta.composite === "headwear_size" || name === "headwear_size") {
    return renderHeadwearSizeControl(name, value, inputId);
  }
  if (meta.composite === "size_info") {
    return renderSizeInfoControl(name, value, inputId);
  }
  if (meta.composite === "capacity") {
    return renderCapacityControl(name, value, inputId);
  }
  if (meta.composite === "metals" || name === "metals") {
    return renderMetalsCompositeControl(name, value, inputId);
  }
  if (meta.composite === "stones" || name === "stones") {
    return renderStonesCompositeControl(name, value, inputId);
  }

  const enumValues = meta.enumValues || [];
  const controlClass = "border-2 border-black px-3 py-2 min-h-[44px] w-full font-mono text-xs";

  if (enumValues.length) {
    const options = enumValues.map((option) => {
      const selected = option === value ? " selected" : "";
      return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
    }).join("");
    const blankSelected = isBlankAttributeValue(name, value, productType) ? " selected" : "";
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
      value="${escapeHtml(isBlankAttributeValue(name, value, productType) ? "" : value)}"
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
    const value = name === "size_info"
      ? formatSizeInfoDraftValue(normalizeAmazonEnumFieldValue(name, rawValue), productType)
      : normalizeAmazonEnumFieldValue(name, rawValue);
    const inputId = `amazonPushAttr_${name}`;

    return `
      <div class="flex flex-col gap-1 sm:col-span-1">
        <label for="${escapeHtml(inputId)}" class="text-gray-400 font-bold uppercase tracking-wide text-[10px]">
          ${escapeHtml(label)}
          <span class="font-mono normal-case text-gray-400">(${escapeHtml(name)})</span>
        </label>
        ${renderAttributeControl(name, meta, value, inputId, productType)}
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
  const productTypeEl = qs("#amazonPushProductType");
  const productType = productTypeEl instanceof HTMLInputElement ? productTypeEl.value.trim() : "";

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

  container.querySelectorAll('[data-metals-composite="true"]').forEach((wrapper) => {
    if (!(wrapper instanceof HTMLElement)) return;
    const name = wrapper.dataset.amazonAttr || "metals";
    const metalType = wrapper.querySelector('[data-metals-part="metal_type"]');
    const metalStamp = wrapper.querySelector('[data-metals-part="metal_stamp"]');
    const idPart = wrapper.querySelector('[data-metals-part="id"]');
    const typeVal = metalType instanceof HTMLSelectElement ? metalType.value.trim() : "alloy";
    const stampVal = metalStamp instanceof HTMLSelectElement ? metalStamp.value.trim() : "No Metal Stamp";
    const idVal = idPart instanceof HTMLInputElement ? idPart.value.trim() : "1";
    if (name && typeVal) {
      values[name] = serializeMetalsFormValue(typeVal, stampVal, idVal || "1");
    }
  });

  container.querySelectorAll('[data-stones-composite="true"]').forEach((wrapper) => {
    if (!(wrapper instanceof HTMLElement)) return;
    const name = wrapper.dataset.amazonAttr || "stones";
    const stoneType = wrapper.querySelector('[data-stones-part="stone_type"]');
    const treatmentMethod = wrapper.querySelector('[data-stones-part="treatment_method"]');
    const creationMethod = wrapper.querySelector('[data-stones-part="creation_method"]');
    const idPart = wrapper.querySelector('[data-stones-part="id"]');
    const typeVal = stoneType instanceof HTMLSelectElement ? stoneType.value.trim() : "No Gemstone";
    const treatmentVal = treatmentMethod instanceof HTMLSelectElement ? treatmentMethod.value.trim() : "Not Treated";
    const creationVal = creationMethod instanceof HTMLSelectElement ? creationMethod.value.trim() : "Unknown";
    const idVal = idPart instanceof HTMLInputElement ? idPart.value.trim() : "1";
    if (name && typeVal) {
      values[name] = serializeStonesFormValue(typeVal, treatmentVal, creationVal, idVal || "1");
    }
  });

  container.querySelectorAll('[data-size-info-composite="true"]').forEach((wrapper) => {
    if (!(wrapper instanceof HTMLElement)) return;
    const name = wrapper.dataset.amazonAttr || "size_info";
    const sizeClass = wrapper.querySelector('[data-size-info-part="size_class"]');
    const size = wrapper.querySelector('[data-size-info-part="size"]');
    const displayName = wrapper.querySelector('[data-size-info-part="display_name"]');
    const classVal = sizeClass instanceof HTMLSelectElement ? sizeClass.value.trim() : "alpha";
    const sizeVal = size instanceof HTMLSelectElement ? size.value.trim() : "small";
    const displayVal = displayName instanceof HTMLInputElement ? displayName.value.trim() : "Mini / Small";
    if (name && displayVal) {
      values[name] = isBagLikeProductType(productType)
        ? displayVal
        : serializeSizeInfoFormValue(classVal, sizeVal, displayVal);
    }
  });

  if (isBagLikeProductType(productType)) {
    const sizeInfoInput = container.querySelector('[data-amazon-attr="size_info"]');
    if (sizeInfoInput instanceof HTMLInputElement) {
      const displayVal = sizeInfoInput.value.trim();
      if (displayVal && !isBlankAttributeValue("size_info", displayVal, productType)) {
        values.size_info = displayVal;
      }
    }
  }

  container.querySelectorAll('[data-capacity-composite="true"]').forEach((wrapper) => {
    if (!(wrapper instanceof HTMLElement)) return;
    const name = wrapper.dataset.amazonAttr || "capacity";
    const amount = wrapper.querySelector('[data-capacity-part="amount"]');
    const unit = wrapper.querySelector('[data-capacity-part="unit"]');
    const amountVal = amount instanceof HTMLInputElement ? amount.value.trim() : "1.5";
    const unitVal = unit instanceof HTMLSelectElement ? unit.value.trim() : "liters";
    if (name && amountVal) {
      values[name] = serializeCapacityFormValue(amountVal, unitVal);
    }
  });

  container.querySelectorAll("[data-amazon-attr]").forEach((el) => {
    if (el instanceof HTMLElement && el.dataset.headwearComposite === "true") return;
    if (el instanceof HTMLElement && el.dataset.metalsComposite === "true") return;
    if (el instanceof HTMLElement && el.dataset.stonesComposite === "true") return;
    if (el instanceof HTMLElement && el.dataset.sizeInfoComposite === "true") return;
    if (el instanceof HTMLElement && el.dataset.capacityComposite === "true") return;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement)) return;
    const name = el.dataset.amazonAttr || "";
    const value = el.value.trim();
    if (name && value && !isBlankAttributeValue(name, value, productType)) values[name] = value;
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
    const meta = resolveFieldMeta(name, productType, attributeEnums);
    const control = queryAttributeControl(container, name);
    let current = "";
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) {
      // Composite controls are handled below.
      if (name !== "headwear_size" && name !== "metals" && name !== "stones"
        && name !== "size_info" && name !== "capacity") continue;
    }

    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      current = control.value.trim();
      const normalizedCurrent = normalizeAmazonEnumFieldValue(name, current);
      if (normalizedCurrent !== current) {
        control.value = normalizedCurrent;
        continue;
      }
      if (current && !isBlankAttributeValue(name, current, productType)) continue;
      if (isBlankAttributeValue(name, current, productType)) control.value = "";

      if ((name === "part_number" || name === "model_name" || name === "model_number") && sellerSku) {
        const currentModel = control.value.trim();
        if (!currentModel || /-PARENT$/i.test(currentModel)) {
          control.value = sellerSku;
        }
        continue;
      }
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

    if (name === "metals") {
      const wrapper = container.querySelector('[data-metals-composite="true"]');
      if (wrapper instanceof HTMLElement) {
        const hidden = wrapper.querySelector("[data-metals-serialized]");
        const existing = hidden instanceof HTMLInputElement ? hidden.value.trim() : "";
        if (existing && !isBlankAttributeValue(name, existing)) continue;
        const parsed = parseMetalsFormValue(meta.defaultValue || "Alloy|No Metal Stamp|1");
        const metalType = wrapper.querySelector('[data-metals-part="metal_type"]');
        const metalStamp = wrapper.querySelector('[data-metals-part="metal_stamp"]');
        const idPart = wrapper.querySelector('[data-metals-part="id"]');
        if (metalType instanceof HTMLSelectElement) metalType.value = parsed.metalType;
        if (metalStamp instanceof HTMLSelectElement) metalStamp.value = parsed.metalStamp;
        if (idPart instanceof HTMLInputElement) idPart.value = parsed.id;
        if (hidden instanceof HTMLInputElement) {
          hidden.value = serializeMetalsFormValue(parsed.metalType, parsed.metalStamp, parsed.id);
        }
        continue;
      }
    }

    if (name === "stones") {
      const wrapper = container.querySelector('[data-stones-composite="true"]');
      if (wrapper instanceof HTMLElement) {
        const hidden = wrapper.querySelector("[data-stones-serialized]");
        const existing = hidden instanceof HTMLInputElement ? hidden.value.trim() : "";
        if (existing && !isBlankAttributeValue(name, existing)) continue;
        const parsed = parseStonesFormValue(meta.defaultValue || "No Gemstone|Not Treated|Unknown|1");
        const stoneType = wrapper.querySelector('[data-stones-part="stone_type"]');
        const treatmentMethod = wrapper.querySelector('[data-stones-part="treatment_method"]');
        const creationMethod = wrapper.querySelector('[data-stones-part="creation_method"]');
        const idPart = wrapper.querySelector('[data-stones-part="id"]');
        if (stoneType instanceof HTMLSelectElement) stoneType.value = parsed.stoneType;
        if (treatmentMethod instanceof HTMLSelectElement) treatmentMethod.value = parsed.treatmentMethod;
        if (creationMethod instanceof HTMLSelectElement) creationMethod.value = parsed.creationMethod;
        if (idPart instanceof HTMLInputElement) idPart.value = parsed.id;
        if (hidden instanceof HTMLInputElement) {
          hidden.value = serializeStonesFormValue(
            parsed.stoneType,
            parsed.treatmentMethod,
            parsed.creationMethod,
            parsed.id,
          );
        }
        continue;
      }
    }

    if (name === "size_info") {
      const wrapper = container.querySelector('[data-size-info-composite="true"]');
      if (wrapper instanceof HTMLElement) {
        const parsed = parseSizeInfoFormValue(meta.defaultValue || "alpha|small|Mini / Small");
        const sizeClass = wrapper.querySelector('[data-size-info-part="size_class"]');
        const size = wrapper.querySelector('[data-size-info-part="size"]');
        const displayName = wrapper.querySelector('[data-size-info-part="display_name"]');
        const displayVal = displayName instanceof HTMLInputElement ? displayName.value.trim() : "";
        if (displayVal && !isBlankAttributeValue(name, displayVal, productType)) continue;
        if (sizeClass instanceof HTMLSelectElement) sizeClass.value = parsed.sizeClass;
        if (size instanceof HTMLSelectElement) size.value = parsed.size;
        if (displayName instanceof HTMLInputElement) displayName.value = parsed.displayName;
        continue;
      }
    }

    if (name === "capacity") {
      const wrapper = container.querySelector('[data-capacity-composite="true"]');
      if (wrapper instanceof HTMLElement) {
        const parsed = parseCapacityFormValue(meta.defaultValue || "1.5|liters");
        const amount = wrapper.querySelector('[data-capacity-part="amount"]');
        const unit = wrapper.querySelector('[data-capacity-part="unit"]');
        const amountVal = amount instanceof HTMLInputElement ? amount.value.trim() : "";
        if (amountVal && !isBlankAttributeValue(name, amountVal, productType)) continue;
        if (amount instanceof HTMLInputElement) amount.value = parsed.amount;
        if (unit instanceof HTMLSelectElement) unit.value = parsed.unit;
        continue;
      }
    }

    if (productType.toUpperCase() === "HAT") {
      if (name === "item_type_keyword" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "cold-weather-hats";
        continue;
      }
      if (name === "fabric_type" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "100% Acrylic";
        continue;
      }
      if (name === "material" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Acrylic";
        continue;
      }
      if (name === "color" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Black";
        continue;
      }
      if (name === "special_size_type" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Standard";
        continue;
      }
      if (name === "special_size_type" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Standard";
        continue;
      }
      if (name === "department" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Unisex";
        continue;
      }
      if (name === "import_designation" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Imported";
        continue;
      }
      if (name === "care_instructions" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Hand Wash Only";
        continue;
      }
      if (name === "age_range_description" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Adult";
        continue;
      }
      if (name === "seasons" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Fall";
        continue;
      }
      if (name === "style" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Casual";
        continue;
      }
      if (name === "lifestyle" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Casual";
        continue;
      }
      if (name === "pattern_type" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Graphic";
        continue;
      }
      if (name === "number_of_items" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "1";
        continue;
      }
      if (name === "target_gender" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "unisex";
        continue;
      }
      if (name === "batteries_required" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "false";
        continue;
      }
    }

    if (isBagLikeProductType(productType)) {
      const isTote = productType.toUpperCase() === "TOTE_BAG";
      if (name === "item_type_keyword" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "reusable-grocery-bags" : "top-handle-handbags";
        continue;
      }
      if (name === "fabric_type" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Canvas" : "Faux Leather";
        continue;
      }
      if (name === "material" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Cotton" : "Faux Leather";
        continue;
      }
      if (name === "title_differentiation" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "";
        continue;
      }
      if (name === "lining_description" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Unlined" : "Polyester";
        continue;
      }
      if (name === "target_audience" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Unisex-Adults" : "Women";
        continue;
      }
      if (name === "special_feature" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Reusable" : "Detachable Strap";
        continue;
      }
      if (!isTote && name === "included_components" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Shoulder Strap";
        continue;
      }
      if (name === "department" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Unisex" : "Womens";
        continue;
      }
      if (name === "style" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Casual";
        continue;
      }
      if (name === "theme" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Love";
        continue;
      }
      if (name === "age_range_description" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Adult";
        continue;
      }
      if (name === "number_of_items" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "1";
        continue;
      }
      if (name === "target_gender" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "unisex";
        continue;
      }
      if (name === "batteries_required" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "false";
        continue;
      }
      if (name === "size_info" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Mini / Small";
        continue;
      }
      if (isTote && name === "item_length_width_height" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "8 x 6 x 4 in";
        continue;
      }
      if (name === "capacity") {
        const wrapper = container.querySelector('[data-capacity-composite="true"]');
        if (wrapper instanceof HTMLElement) {
          const parsed = parseCapacityFormValue(meta.defaultValue || "1.5|liters");
          const amount = wrapper.querySelector('[data-capacity-part="amount"]');
          const unit = wrapper.querySelector('[data-capacity-part="unit"]');
          const amountVal = amount instanceof HTMLInputElement ? amount.value.trim() : "";
          if (!amountVal || isBlankAttributeValue(name, amountVal, productType)) {
            if (amount instanceof HTMLInputElement) amount.value = parsed.amount;
            if (unit instanceof HTMLSelectElement) unit.value = parsed.unit;
          }
          continue;
        }
      }
      if (name === "closure" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Open Top" : "Zipper";
        continue;
      }
      if (name === "outer" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Canvas" : "Faux Leather";
        continue;
      }
      if (name === "inner" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = isTote ? "Unlined (canvas interior)" : "Polyester lining";
        continue;
      }
      if (isTote && name === "outer" && control instanceof HTMLInputElement
        && (!control.value.trim() || /faux leather/i.test(control.value))) {
        control.value = "Canvas";
        continue;
      }
      if (isTote && name === "inner" && control instanceof HTMLInputElement
        && (!control.value.trim() || /polyester/i.test(control.value))) {
        control.value = "Unlined (canvas interior)";
        continue;
      }
      if (isTote && name === "material" && control instanceof HTMLInputElement
        && (!control.value.trim() || /polyester/i.test(control.value))) {
        control.value = "Cotton";
        continue;
      }
      if (isTote && name === "closure" && control instanceof HTMLSelectElement
        && (!control.value.trim() || control.value === "Clasp")) {
        control.value = "Open Top";
        continue;
      }
    }

    if (productType.toUpperCase() === "APPAREL_BELT") {
      if (name === "item_type_keyword" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "apparel-belts";
        continue;
      }
      if (name === "fabric_type" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "100% Faux Leather";
        continue;
      }
      if (name === "material" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Faux Leather";
        continue;
      }
      if (name === "color" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Black";
        continue;
      }
      if (name === "department" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Unisex";
        continue;
      }
      if (name === "size" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "One Size";
        continue;
      }
      if (name === "import_designation" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Imported";
        continue;
      }
      if (name === "care_instructions" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Wipe Clean";
        continue;
      }
      if (name === "age_range_description" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "Adult";
        continue;
      }
      if (name === "target_gender" && control instanceof HTMLSelectElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "unisex";
        continue;
      }
      if (name === "number_of_items" && control instanceof HTMLInputElement
        && isBlankAttributeValue(name, control.value, productType)) {
        control.value = "1";
        continue;
      }
    }

    if (productType.toUpperCase() === "APPAREL_PIN") {
      if (name === "department" && control instanceof HTMLSelectElement && !control.value.trim()) {
        control.value = "Unisex";
        continue;
      }
      if (name === "size" && control instanceof HTMLSelectElement && !control.value.trim()) {
        control.value = "Small";
        continue;
      }
      if (name === "gem_type" && control instanceof HTMLSelectElement && !control.value.trim()) {
        control.value = "No Gemstone";
        continue;
      }
      if (name === "metal_type" && control instanceof HTMLSelectElement && !control.value.trim()) {
        control.value = "alloy";
        continue;
      }
      if (name === "material" && control instanceof HTMLInputElement && !control.value.trim()) {
        control.value = "Metal";
        continue;
      }
      if (name === "title_differentiation" && control instanceof HTMLInputElement && !control.value.trim()) {
        control.value = "Enamel Pin";
        continue;
      }
    }

    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      if (meta.defaultValue && isBlankAttributeValue(name, control.value, productType)) {
        control.value = meta.defaultValue;
      }
    }
  }
}

/** @param {Array<{ name?: string, value?: string }>} attributes @param {{ overwrite?: boolean, productType?: string }} [options] */
export function applyAiAttributesToForm(attributes, options = {}) {
  if (!Array.isArray(attributes)) return;
  const container = qs("#amazonPushExtraAttributes");
  if (!container) return;
  const overwrite = options.overwrite === true;
  const productType = options.productType || "";

  function applyCompositeValue(name, value) {
    if (name === "headwear_size") {
      const wrapper = container.querySelector('[data-headwear-composite="true"]');
      if (!(wrapper instanceof HTMLElement)) return false;
      const parsed = parseHeadwearSizeFormValue(value);
      const sizeClass = wrapper.querySelector('[data-headwear-part="size_class"]');
      const sizeValue = wrapper.querySelector('[data-headwear-part="size_value"]');
      if (sizeClass instanceof HTMLSelectElement) sizeClass.value = parsed.sizeClass;
      if (sizeValue instanceof HTMLSelectElement) sizeValue.value = parsed.sizeValue;
      const hidden = wrapper.querySelector("[data-headwear-serialized]");
      if (hidden instanceof HTMLInputElement) {
        hidden.value = serializeHeadwearSizeFormValue(parsed.sizeClass, parsed.sizeValue);
      }
      return true;
    }
    if (name === "metals") {
      const wrapper = container.querySelector('[data-metals-composite="true"]');
      if (!(wrapper instanceof HTMLElement)) return false;
      const parsed = parseMetalsFormValue(value);
      const metalType = wrapper.querySelector('[data-metals-part="metal_type"]');
      const metalStamp = wrapper.querySelector('[data-metals-part="metal_stamp"]');
      const idPart = wrapper.querySelector('[data-metals-part="id"]');
      if (metalType instanceof HTMLSelectElement) metalType.value = parsed.metalType;
      if (metalStamp instanceof HTMLSelectElement) metalStamp.value = parsed.metalStamp;
      if (idPart instanceof HTMLInputElement) idPart.value = parsed.id;
      const hidden = wrapper.querySelector("[data-metals-serialized]");
      if (hidden instanceof HTMLInputElement) {
        hidden.value = serializeMetalsFormValue(parsed.metalType, parsed.metalStamp, parsed.id);
      }
      return true;
    }
    if (name === "stones") {
      const wrapper = container.querySelector('[data-stones-composite="true"]');
      if (!(wrapper instanceof HTMLElement)) return false;
      const parsed = parseStonesFormValue(value);
      const stoneType = wrapper.querySelector('[data-stones-part="stone_type"]');
      const treatmentMethod = wrapper.querySelector('[data-stones-part="treatment_method"]');
      const creationMethod = wrapper.querySelector('[data-stones-part="creation_method"]');
      const idPart = wrapper.querySelector('[data-stones-part="id"]');
      if (stoneType instanceof HTMLSelectElement) stoneType.value = parsed.stoneType;
      if (treatmentMethod instanceof HTMLSelectElement) treatmentMethod.value = parsed.treatmentMethod;
      if (creationMethod instanceof HTMLSelectElement) creationMethod.value = parsed.creationMethod;
      if (idPart instanceof HTMLInputElement) idPart.value = parsed.id;
      const hidden = wrapper.querySelector("[data-stones-serialized]");
      if (hidden instanceof HTMLInputElement) {
        hidden.value = serializeStonesFormValue(
          parsed.stoneType,
          parsed.treatmentMethod,
          parsed.creationMethod,
          parsed.id,
        );
      }
      return true;
    }
    if (name === "size_info") {
      const wrapper = container.querySelector('[data-size-info-composite="true"]');
      if (!(wrapper instanceof HTMLElement)) return false;
      const parsed = parseSizeInfoFormValue(value);
      const sizeClass = wrapper.querySelector('[data-size-info-part="size_class"]');
      const size = wrapper.querySelector('[data-size-info-part="size"]');
      const displayName = wrapper.querySelector('[data-size-info-part="display_name"]');
      if (sizeClass instanceof HTMLSelectElement) sizeClass.value = parsed.sizeClass;
      if (size instanceof HTMLSelectElement) size.value = parsed.size;
      if (displayName instanceof HTMLInputElement) displayName.value = parsed.displayName;
      return true;
    }
    if (name === "capacity") {
      const wrapper = container.querySelector('[data-capacity-composite="true"]');
      if (!(wrapper instanceof HTMLElement)) return false;
      const parsed = parseCapacityFormValue(value);
      const amount = wrapper.querySelector('[data-capacity-part="amount"]');
      const unit = wrapper.querySelector('[data-capacity-part="unit"]');
      if (amount instanceof HTMLInputElement) amount.value = parsed.amount;
      if (unit instanceof HTMLSelectElement) unit.value = parsed.unit;
      return true;
    }
    return false;
  }

  for (const entry of attributes) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const rawValue = typeof entry?.value === "string" ? entry.value.trim() : "";
    const value = normalizeAmazonEnumFieldValue(name, rawValue);
    if (!name || !value || isBlankAttributeValue(name, value, productType)) continue;
    if (PUSH_EXTRA_ATTRIBUTE_DENYLIST.has(name)) continue;

    if (name === "headwear_size" || name === "metals" || name === "stones"
      || name === "size_info" || name === "capacity") {
      if (name === "size_info" && isBagLikeProductType(productType)) {
        const control = queryAttributeControl(container, name);
        if (control instanceof HTMLInputElement) {
          const current = control.value.trim();
          if (!overwrite && current && !isBlankAttributeValue(name, current, productType)) continue;
          control.value = formatSizeInfoDraftValue(value, productType);
          continue;
        }
      }
      const wrapper = container.querySelector(`[data-amazon-attr="${name}"]`);
      if (wrapper instanceof HTMLElement) {
        const hidden = wrapper.querySelector("[data-headwear-serialized], [data-metals-serialized], [data-stones-serialized]");
        const current = hidden instanceof HTMLInputElement ? hidden.value.trim() : "";
        if (!overwrite && current && !isBlankAttributeValue(name, current, productType)) continue;
        if (applyCompositeValue(name, value)) continue;
      }
      if (applyCompositeValue(name, value)) continue;
    }

    const control = queryAttributeControl(container, name);
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) continue;
    const current = control.value.trim();
    if (!overwrite && current && !isBlankAttributeValue(name, current, productType)) continue;
    control.value = value;
  }
}

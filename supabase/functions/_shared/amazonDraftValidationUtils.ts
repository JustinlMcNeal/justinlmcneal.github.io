// Local + PTD draft validation helpers.

export type ValidationIssue = {
  field: string;
  severity: "error" | "warning";
  message: string;
};

export type DraftValidationOptions = {
  variationRole?: string | null;
};

const DRAFT_ATTRIBUTE_ALIASES: Record<string, string[]> = {
  item_name: ["title", "item_name", "itemName"],
  brand: ["brand"],
  product_description: ["description", "product_description", "productDescription"],
  bullet_point: ["bulletPoints", "bullet_point", "bulletPoint"],
  condition_type: ["conditionType", "condition_type"],
  purchasable_offer: ["price", "purchasable_offer", "purchasableOffer"],
  fulfillment_availability: ["quantity", "fulfillment_availability", "fulfillmentAvailability"],
  merchant_suggested_asin: ["asin", "matchedAsin", "matched_asin", "merchant_suggested_asin"],
  main_product_image_locator: ["imageUrls", "image_urls", "mainImageUrl", "main_product_image_locator"],
  externally_assigned_product_identifier: [
    "asin",
    "matchedAsin",
    "matched_asin",
    "upc",
    "ean",
    "supplier_declared_has_product_identifier_exemption",
  ],
};

const PARENT_SKIP_REQUIRED = new Set([
  "purchasable_offer",
  "fulfillment_availability",
  "list_price",
  "condition_type",
  "color",
  "merchant_suggested_asin",
]);

const PARENT_SKIP_RECOMMENDED = new Set([
  "main_product_image_locator",
  "other_product_image_locator_1",
  "other_product_image_locator_2",
  "other_product_image_locator_3",
  "other_product_image_locator_4",
  "other_product_image_locator_5",
  "other_product_image_locator_6",
  "other_product_image_locator_7",
  "other_product_image_locator_8",
  "swatch_product_image_locator",
]);

function resolveVariationRole(
  draftPayload: Record<string, unknown>,
  options: DraftValidationOptions = {},
): string {
  return String(
    options.variationRole
    || draftPayload.variation_role
    || draftPayload.parentage_level
    || "",
  ).trim().toLowerCase();
}

function isParentVariationDraft(
  draftPayload: Record<string, unknown>,
  options: DraftValidationOptions = {},
): boolean {
  return resolveVariationRole(draftPayload, options) === "parent";
}

function isChildVariationDraft(
  draftPayload: Record<string, unknown>,
  options: DraftValidationOptions = {},
): boolean {
  return resolveVariationRole(draftPayload, options) === "child";
}

function readParentSkuFromDraft(
  draftPayload: Record<string, unknown>,
): string {
  const rel = draftPayload.child_parent_sku_relationship;
  if (typeof rel === "string") return rel.trim();
  if (Array.isArray(rel) && rel[0] && typeof rel[0] === "object") {
    const parentSku = (rel[0] as Record<string, unknown>).parent_sku;
    return typeof parentSku === "string" ? parentSku.trim() : "";
  }
  const parentSellerSku = draftPayload.parent_seller_sku;
  return typeof parentSellerSku === "string" ? parentSellerSku.trim() : "";
}

function draftHasAttribute(attributeName: string, draftPayload: Record<string, unknown>): boolean {
  const aliases = DRAFT_ATTRIBUTE_ALIASES[attributeName] || [attributeName];
  for (const key of aliases) {
    const value = draftPayload[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "boolean") return true;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") return true;
      return true;
    }
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    return true;
  }
  return false;
}

export function validateLocalDraft(
  sellerSku: string,
  draftPayload: Record<string, unknown>,
  productType?: string | null,
  options: DraftValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const isParent = isParentVariationDraft(draftPayload, options);
  const title = typeof draftPayload.title === "string" ? draftPayload.title.trim() : "";

  if (!title) {
    issues.push({ field: "title", severity: "error", message: "Amazon title is required." });
  }
  if (!sellerSku.trim()) {
    issues.push({ field: "sellerSku", severity: "error", message: "Seller SKU is required." });
  }

  if (!isParent) {
    const price = draftPayload.price;
    const priceNum = typeof price === "number" ? price : Number(price);
    if (price === undefined || price === null || price === "" || !Number.isFinite(priceNum) || priceNum < 0) {
      issues.push({ field: "price", severity: "warning", message: "Amazon price should be set." });
    }

    const quantity = draftPayload.quantity;
    const qtyNum = typeof quantity === "number" ? quantity : Number(quantity);
    if (quantity === undefined || quantity === null || quantity === "" || !Number.isFinite(qtyNum) || qtyNum < 0) {
      issues.push({ field: "quantity", severity: "warning", message: "Quantity should be set." });
    }
  }

  const resolvedType = productType?.trim() ||
    (typeof draftPayload.productType === "string" ? draftPayload.productType.trim() : "");
  if (!resolvedType) {
    issues.push({ field: "productType", severity: "error", message: "Product type is required. Use KEYCHAIN for Heart Clasp Hook children." });
  }

  if (isChildVariationDraft(draftPayload, options)) {
    const parentSku = readParentSkuFromDraft(draftPayload);
    if (!parentSku) {
      issues.push({
        field: "parent_seller_sku",
        severity: "error",
        message: "Child listing requires a parent seller SKU (e.g. KK-0018-PARENT).",
      });
    }

    const theme = typeof draftPayload.variation_theme === "string"
      ? draftPayload.variation_theme.trim()
      : "";
    if (!theme) {
      issues.push({
        field: "variation_theme",
        severity: "error",
        message: "Child listing requires a variation theme (e.g. COLOR_NAME).",
      });
    }

    if (theme.toUpperCase().includes("COLOR") && !draftHasAttribute("color", draftPayload)) {
      issues.push({
        field: "color",
        severity: "error",
        message: "Child listing requires a color value for COLOR_NAME variations (e.g. Gold).",
      });
    }
  }

  return issues;
}

export function validateDraftAgainstPtd(
  draftPayload: Record<string, unknown>,
  requiredAttributes: string[],
  recommendedAttributes: string[],
  options: DraftValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const isParent = isParentVariationDraft(draftPayload, options);

  for (const attribute of requiredAttributes) {
    if (isParent && PARENT_SKIP_REQUIRED.has(attribute)) continue;
    if (draftHasAttribute(attribute, draftPayload)) continue;
    issues.push({
      field: attribute,
      severity: "error",
      message: `${attribute} is required by Amazon for this product type.`,
    });
  }

  for (const attribute of recommendedAttributes) {
    if (isParent && PARENT_SKIP_RECOMMENDED.has(attribute)) continue;
    if (draftHasAttribute(attribute, draftPayload)) continue;
    issues.push({
      field: attribute,
      severity: "warning",
      message: `${attribute} is recommended for this product type.`,
    });
  }

  return issues;
}

export function resolveDraftStatus(validationErrors: ValidationIssue[]): string {
  if (validationErrors.some((issue) => issue.severity === "error")) return "needs_attributes";
  if (validationErrors.some((issue) => issue.severity === "warning")) return "draft";
  return "ready_to_submit";
}

export function computeMissingRequiredAttributes(
  draftPayload: Record<string, unknown>,
  requiredAttributes: string[],
  options: DraftValidationOptions = {},
): string[] {
  const isParent = isParentVariationDraft(draftPayload, options);
  return requiredAttributes.filter((attribute) => {
    if (isParent && PARENT_SKIP_REQUIRED.has(attribute)) return false;
    return !draftHasAttribute(attribute, draftPayload);
  });
}

export async function syncValidationIssues(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  validationErrors: ValidationIssue[],
  now: string,
) {
  await client
    .from("amazon_listing_issues")
    .delete()
    .eq("draft_id", draftId)
    .eq("source", "validation")
    .eq("status", "open");

  if (validationErrors.length === 0) return;

  const rows = validationErrors.map((issue) => ({
    draft_id: draftId,
    issue_code: issue.field,
    issue_type: "draft_validation",
    severity: issue.severity,
    message: issue.message,
    source: "validation",
    status: "open",
    categories: [],
    attribute_names: issue.field ? [issue.field] : [],
    enforcements: {},
    raw_error: issue,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await client.from("amazon_listing_issues").insert(rows);
  if (error) throw new Error("database_error");
}

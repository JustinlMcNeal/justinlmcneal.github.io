// Local + PTD draft validation helpers.

export type ValidationIssue = {
  field: string;
  severity: "error" | "warning";
  message: string;
};

const DRAFT_ATTRIBUTE_ALIASES: Record<string, string[]> = {
  item_name: ["title", "item_name", "itemName"],
  brand: ["brand"],
  product_description: ["description", "product_description", "productDescription"],
  bullet_point: ["bulletPoints", "bullet_point", "bulletPoint"],
  condition_type: ["conditionType", "condition_type"],
  purchasable_offer: ["price", "purchasable_offer", "purchasableOffer"],
  fulfillment_availability: ["quantity", "fulfillment_availability", "fulfillmentAvailability"],
  merchant_suggested_asin: ["asin", "matchedAsin", "matched_asin"],
  externally_assigned_product_identifier: ["asin", "matchedAsin", "matched_asin", "upc", "ean"],
};

function draftHasAttribute(attributeName: string, draftPayload: Record<string, unknown>): boolean {
  const aliases = DRAFT_ATTRIBUTE_ALIASES[attributeName] || [attributeName];
  for (const key of aliases) {
    const value = draftPayload[key];
    if (value === undefined || value === null || value === "") continue;
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
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const title = typeof draftPayload.title === "string" ? draftPayload.title.trim() : "";

  if (!title) {
    issues.push({ field: "title", severity: "error", message: "Amazon title is required." });
  }
  if (!sellerSku.trim()) {
    issues.push({ field: "sellerSku", severity: "error", message: "Seller SKU is required." });
  }

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

  const resolvedType = productType?.trim() ||
    (typeof draftPayload.productType === "string" ? draftPayload.productType.trim() : "");
  if (!resolvedType) {
    issues.push({ field: "productType", severity: "warning", message: "Product type should be set." });
  }

  return issues;
}

export function validateDraftAgainstPtd(
  draftPayload: Record<string, unknown>,
  requiredAttributes: string[],
  recommendedAttributes: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const attribute of requiredAttributes) {
    if (draftHasAttribute(attribute, draftPayload)) continue;
    issues.push({
      field: attribute,
      severity: "error",
      message: `${attribute} is required by Amazon for this product type.`,
    });
  }

  for (const attribute of recommendedAttributes) {
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
): string[] {
  return requiredAttributes.filter((attribute) => !draftHasAttribute(attribute, draftPayload));
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

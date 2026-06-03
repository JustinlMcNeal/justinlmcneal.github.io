import { defaultParentSellerSku } from "./variationFamily.js";

/** @typedef {Record<string, unknown>} ReadyRow */

/**
 * @param {ReadyRow} row
 */
export function isParentShellRow(row) {
  if (String(row.ready_row_kind || "") === "parent_shell") return true;
  const variantId = row.kk_variant_id;
  if (variantId != null && String(variantId).trim() !== "") return false;
  return Number(row.variants_total || 0) > 1;
}

/**
 * @param {ReadyRow} row
 */
export function isVariantReadyRow(row) {
  return !isParentShellRow(row);
}

/**
 * Client-side fallback when DB view has not been migrated yet (parent draft on every variant row).
 * @param {ReadyRow[]} rows
 */
export function normalizeReadyToPushRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const hasShellFromView = rows.some(isParentShellRow);
  if (hasShellFromView) {
    return sortReadyRows(rows);
  }

  /** @type {Map<string, ReadyRow[]>} */
  const byProduct = new Map();
  for (const row of rows) {
    const productId = String(row.kk_product_id || "");
    if (!productId) continue;
    if (!byProduct.has(productId)) byProduct.set(productId, []);
    byProduct.get(productId).push(row);
  }

  /** @type {ReadyRow[]} */
  const normalized = [];
  for (const group of byProduct.values()) {
    normalized.push(...expandLegacyProductGroup(group));
  }
  return sortReadyRows(normalized);
}

/**
 * @param {ReadyRow[]} rows
 */
function sortReadyRows(rows) {
  return [...rows].sort((a, b) => {
    const productCmp = String(a.kk_product_id || "").localeCompare(String(b.kk_product_id || ""));
    if (productCmp !== 0) return productCmp;
    if (isParentShellRow(a) && !isParentShellRow(b)) return -1;
    if (!isParentShellRow(a) && isParentShellRow(b)) return 1;
    return String(a.kk_variant_label || "").localeCompare(String(b.kk_variant_label || ""));
  });
}

/**
 * @param {ReadyRow[]} group
 */
function expandLegacyProductGroup(group) {
  const variants = group.filter((row) => row.kk_variant_id);
  if (variants.length <= 1) return group;

  const first = variants[0] || {};
  const variantsTotal = Number(first.variants_total || variants.length);
  if (variantsTotal <= 1) return group;

  if (Boolean(first.parent_listing_ready)) {
    return stripLegacyParentDraftFromVariants(variants);
  }

  let parentDraftId = "";
  let parentDraftStatus = "";
  let parentDraftUpdated = "";
  for (const row of variants) {
    if (String(row.draft_variation_role || "") === "parent" && row.draft_id) {
      parentDraftId = String(row.draft_id);
      parentDraftStatus = String(row.draft_status || "");
      parentDraftUpdated = String(row.last_draft_updated_at || "");
      break;
    }
  }

  const cleanedVariants = stripLegacyParentDraftFromVariants(variants);
  const parentShell = buildParentShellRow(first, {
    draftId: parentDraftId,
    draftStatus: parentDraftStatus,
    lastDraftUpdated: parentDraftUpdated,
  });

  return [parentShell, ...cleanedVariants];
}

/**
 * @param {ReadyRow[]} variants
 */
function stripLegacyParentDraftFromVariants(variants) {
  return variants.map((row) => {
    if (String(row.draft_variation_role || "") !== "parent") return row;
    return {
      ...row,
      has_active_draft: false,
      draft_id: null,
      draft_status: null,
      draft_variation_role: "",
    };
  });
}

/**
 * @param {ReadyRow} seed
 * @param {{ draftId?: string, draftStatus?: string, lastDraftUpdated?: string }} [parentDraft]
 */
function buildParentShellRow(seed, parentDraft = {}) {
  const productCode = String(seed.kk_sku || "");
  const draftId = parentDraft.draftId || "";
  return {
    ...seed,
    kk_variant_id: null,
    kk_variant_label: null,
    kk_stock: 0,
    ready_row_kind: "parent_shell",
    suggested_seller_sku: defaultParentSellerSku(productCode) || `${productCode}-PARENT`,
    parent_listing_ready: false,
    has_active_draft: Boolean(draftId),
    draft_id: draftId || null,
    draft_status: parentDraft.draftStatus || null,
    draft_variation_role: draftId ? "parent" : "parent",
    last_draft_updated_at: parentDraft.lastDraftUpdated || null,
    eligibility_status: "ready",
    eligibility_warnings: [],
    has_stock: true,
  };
}

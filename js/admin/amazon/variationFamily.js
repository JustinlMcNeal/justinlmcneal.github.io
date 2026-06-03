// Amazon push modal — variation family (parent + child) helpers (Phase 7A.2).

import { escapeHtml } from "./renderListings.js";

/** @typedef {'standalone' | 'parent' | 'child'} VariationRole */

export const VARIATION_ROLES = {
  STANDALONE: "standalone",
  PARENT: "parent",
  CHILD: "child",
};

const COMMON_VARIATION_THEMES = [
  "COLOR_NAME",
  "SIZE_NAME",
  "COLOR_NAME/SIZE_NAME",
  "STYLE_NAME",
];

/**
 * @param {string} productCode
 */
export function defaultParentSellerSku(productCode) {
  const code = String(productCode || "").trim();
  return code ? `${code}-PARENT` : "";
}

/**
 * @param {Array<Record<string, unknown>>} variants
 */
export function inferVariationTheme(variants) {
  const names = (variants || [])
    .map((v) => String(v?.option_name || "").toLowerCase())
    .filter(Boolean);
  const hasSize = names.some((n) => n.includes("size"));
  const hasColor = names.some((n) => n.includes("color"));
  if (hasSize && hasColor) return "COLOR_NAME/SIZE_NAME";
  if (hasSize) return "SIZE_NAME";
  return "COLOR_NAME";
}

/**
 * @param {Record<string, unknown> | null | undefined} context
 */
export function canAddChildToFamily(context) {
  if (!context) return false;
  return Boolean(context.parentDraft || context.parentSellerSku);
}

/**
 * @param {string} productCode
 * @param {Array<Record<string, unknown>>} variants
 * @param {Record<string, unknown> | null | undefined} familyContext
 * @param {VariationRole} [preferredRole]
 * @param {string} [currentDraftId]
 */
export function initAmazonVariationFamilyPanel(
  productCode,
  variants,
  familyContext = null,
  preferredRole = VARIATION_ROLES.STANDALONE,
  currentDraftId = "",
) {
  const section = document.getElementById("amazonPushVariationSection");
  const roleList = document.getElementById("amazonPushVariationRoleList");
  const themeSelect = document.getElementById("amazonPushVariationTheme");
  const parentSkuInput = document.getElementById("amazonPushParentSellerSku");
  const roleHidden = document.getElementById("amazonPushVariationRole");
  const parentDraftHidden = document.getElementById("amazonPushParentDraftId");

  const multiVariant = Array.isArray(variants) && variants.length > 1;
  if (!section || !roleList) return preferredRole;

  if (!multiVariant) {
    section.classList.add("hidden");
    roleList.innerHTML = "";
    if (roleHidden instanceof HTMLInputElement) roleHidden.value = VARIATION_ROLES.STANDALONE;
    if (parentDraftHidden instanceof HTMLInputElement) parentDraftHidden.value = "";
    return VARIATION_ROLES.STANDALONE;
  }

  section.classList.remove("hidden");
  const existingParentDraftId = familyContext?.parentDraft?.id
    ? String(familyContext.parentDraft.id)
    : "";
  const editingDraftId = String(currentDraftId || "").trim();
  const anotherParentExists = Boolean(
    canAddChildToFamily(familyContext)
    && existingParentDraftId
    && (!editingDraftId || existingParentDraftId !== editingDraftId),
  );
  const defaultTheme = familyContext?.variationTheme
    || inferVariationTheme(variants);
  const defaultParentSku = familyContext?.parentSellerSku
    || defaultParentSellerSku(productCode);

  const roles = [
    {
      id: VARIATION_ROLES.STANDALONE,
      label: "Standalone SKU",
      hint: "Separate Amazon product page per variant (Option A).",
    },
    {
      id: VARIATION_ROLES.PARENT,
      label: "Parent listing",
      hint: "Catalog shell for a variation family — submit this before any children.",
      hidden: anotherParentExists,
    },
    {
      id: VARIATION_ROLES.CHILD,
      label: "Child listing",
      hint: "Links to the parent SKU on one product page with a variant dropdown.",
      hidden: false,
    },
  ].filter((entry) => !entry.hidden);

  let selected = preferredRole;
  if (!roles.some((r) => r.id === selected)) {
    selected = anotherParentExists ? VARIATION_ROLES.CHILD : VARIATION_ROLES.STANDALONE;
  }

  roleList.innerHTML = roles.map((entry) => {
    const checked = entry.id === selected ? "checked" : "";
    return `
      <label class="flex items-start gap-2 p-2 rounded-lg border border-gray-200 bg-gray-50 cursor-pointer hover:border-black">
        <input type="radio" name="amazonPushVariationRole" class="mt-1 accent-pink-500" value="${escapeHtml(entry.id)}" ${checked} data-action="amazon-select-variation-role" />
        <span class="min-w-0 flex-1">
          <span class="block text-xs font-bold">${escapeHtml(entry.label)}</span>
          <span class="block text-[10px] text-gray-500 mt-0.5">${escapeHtml(entry.hint)}</span>
        </span>
      </label>`;
  }).join("");

  if (themeSelect instanceof HTMLSelectElement) {
    const themes = [...new Set([defaultTheme, ...COMMON_VARIATION_THEMES])];
    themeSelect.innerHTML = themes.map((theme) =>
      `<option value="${escapeHtml(theme)}"${theme === defaultTheme ? " selected" : ""}>${escapeHtml(theme)}</option>`,
    ).join("");
    themeSelect.disabled = selected === VARIATION_ROLES.STANDALONE;
  }

  if (parentSkuInput instanceof HTMLInputElement) {
    parentSkuInput.value = defaultParentSku;
    parentSkuInput.readOnly = selected !== VARIATION_ROLES.PARENT;
  }

  if (parentDraftHidden instanceof HTMLInputElement) {
    parentDraftHidden.value = familyContext?.parentDraft?.id
      ? String(familyContext.parentDraft.id)
      : "";
  }

  if (roleHidden instanceof HTMLInputElement) roleHidden.value = selected;

  updateVariationRoleUi(selected);

  return selected;
}

const PARENT_HIDDEN_ATTRS = new Set(["color", "merchant_suggested_asin"]);

/** @param {VariationRole} role */
export function updateVariationRoleUi(role) {
  const familyFields = document.getElementById("amazonPushVariationFamilyFields");
  const themeSelect = document.getElementById("amazonPushVariationTheme");
  const parentSkuInput = document.getElementById("amazonPushParentSellerSku");
  const parentSkuLabel = familyFields?.querySelector("label[for='amazonPushParentSellerSku']");
  const priceInput = document.getElementById("amazonPushPrice");
  const qtyInput = document.getElementById("amazonPushQuantity");
  const priceLabel = priceInput?.closest(".flex.flex-col");
  const qtyLabel = qtyInput?.closest(".flex.flex-col");
  const conditionLabel = document.getElementById("amazonPushConditionType")?.closest(".flex.flex-col");
  const fulfillmentLabel = document.getElementById("amazonPushFulfillmentChannel")?.closest(".flex.flex-col");
  const imagesSection = document.getElementById("amazonPushImagesSection");
  const variantSection = document.getElementById("amazonPushVariantSection");
  const noteEl = document.getElementById("amazonPushVariationRoleNote");
  const copyParentBtn = document.querySelector('[data-action="copy-parent-draft-fields"]');
  const parentDraftHidden = document.getElementById("amazonPushParentDraftId");
  const isParent = role === VARIATION_ROLES.PARENT;

  if (familyFields) {
    familyFields.classList.toggle("hidden", role === VARIATION_ROLES.STANDALONE);
  }
  if (variantSection) variantSection.classList.toggle("hidden", isParent);
  if (parentSkuLabel) {
    parentSkuLabel.textContent = role === VARIATION_ROLES.CHILD
      ? "Link to Parent SKU"
      : "Parent Seller SKU";
  }

  if (priceLabel) priceLabel.classList.toggle("hidden", isParent);
  if (qtyLabel) qtyLabel.classList.toggle("hidden", isParent);
  if (conditionLabel) conditionLabel.classList.toggle("hidden", isParent);
  if (fulfillmentLabel) fulfillmentLabel.classList.toggle("hidden", isParent);
  if (imagesSection) imagesSection.classList.toggle("hidden", isParent);
  if (priceInput instanceof HTMLInputElement) priceInput.disabled = isParent;
  if (qtyInput instanceof HTMLInputElement) qtyInput.disabled = isParent;

  document.querySelectorAll("[data-push-parent-hidden]").forEach((el) => {
    el.classList.toggle("hidden", isParent);
  });

  const extraContainer = document.getElementById("amazonPushExtraAttributes");
  if (extraContainer) {
    extraContainer.querySelectorAll("[data-amazon-attr]").forEach((control) => {
      const name = control instanceof HTMLElement ? control.dataset.amazonAttr || "" : "";
      if (!PARENT_HIDDEN_ATTRS.has(name)) return;
      control.closest(".flex.flex-col")?.classList.toggle("hidden", isParent);
    });
  }

  if (themeSelect instanceof HTMLSelectElement) {
    themeSelect.disabled = role === VARIATION_ROLES.STANDALONE;
  }
  if (parentSkuInput instanceof HTMLInputElement) {
    parentSkuInput.readOnly = role !== VARIATION_ROLES.PARENT;
    if (role === VARIATION_ROLES.CHILD && !parentSkuInput.value.trim()) {
      const kkSku = document.getElementById("amazonPushKkSku")?.textContent?.trim() || "";
      parentSkuInput.value = defaultParentSellerSku(kkSku);
    }
  }

  if (copyParentBtn instanceof HTMLButtonElement) {
    const hasParentDraft = parentDraftHidden instanceof HTMLInputElement
      && Boolean(parentDraftHidden.value.trim());
    copyParentBtn.classList.toggle("hidden", role !== VARIATION_ROLES.CHILD || !hasParentDraft);
  }

  if (noteEl) {
    if (role === VARIATION_ROLES.PARENT) {
      noteEl.textContent = "Parent listings are not buyable. Submit and verify the parent before submitting child SKUs.";
      noteEl.classList.remove("hidden");
    } else if (role === VARIATION_ROLES.CHILD) {
      noteEl.textContent = "Child must use the same variation theme as the parent. Parent must be submitted to Amazon first.";
      noteEl.classList.remove("hidden");
    } else {
      noteEl.textContent = "";
      noteEl.classList.add("hidden");
    }
  }
}

/** @returns {VariationRole} */
export function readVariationRole() {
  const hidden = document.getElementById("amazonPushVariationRole");
  if (hidden instanceof HTMLInputElement && hidden.value) return /** @type {VariationRole} */ (hidden.value);
  const checked = document.querySelector('input[name="amazonPushVariationRole"]:checked');
  if (checked instanceof HTMLInputElement && checked.value) {
    return /** @type {VariationRole} */ (checked.value);
  }
  return VARIATION_ROLES.STANDALONE;
}

export function readParentSellerSku() {
  const el = document.getElementById("amazonPushParentSellerSku");
  return el instanceof HTMLInputElement ? el.value.trim() : "";
}

export function readVariationTheme() {
  const el = document.getElementById("amazonPushVariationTheme");
  return el instanceof HTMLSelectElement ? el.value.trim() : "";
}

export function readParentDraftId() {
  const el = document.getElementById("amazonPushParentDraftId");
  return el instanceof HTMLInputElement ? el.value.trim() : "";
}

/**
 * @param {Record<string, unknown>} extraAttributes
 * @param {VariationRole} role
 * @param {{ parentSellerSku?: string, variationTheme?: string, variantColor?: string }} opts
 */
export function applyVariationAttributes(extraAttributes, role, opts = {}) {
  delete extraAttributes.parentage_level;
  delete extraAttributes.variation_theme;
  delete extraAttributes.child_parent_sku_relationship;

  if (role === VARIATION_ROLES.STANDALONE) return;

  const theme = String(opts.variationTheme || "").trim();
  if (theme) extraAttributes.variation_theme = theme;

  if (role === VARIATION_ROLES.PARENT) {
    extraAttributes.parentage_level = "parent";
    return;
  }

  if (role === VARIATION_ROLES.CHILD) {
    extraAttributes.parentage_level = "child";
    const parentSku = String(opts.parentSellerSku || "").trim();
    if (parentSku) extraAttributes.child_parent_sku_relationship = parentSku;
    const color = String(opts.variantColor || "").trim();
    if (color && theme.includes("COLOR")) {
      extraAttributes.color = color;
    }
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} variant
 */
export function variantColorValue(variant) {
  if (!variant) return "";
  return String(variant.option_value || variant.title || "").trim();
}

/** @param {(role: VariationRole) => void} onChange */
export function wireAmazonVariationFamilyPanel(onChange) {
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name !== "amazonPushVariationRole") return;
    const role = /** @type {VariationRole} */ (target.value || VARIATION_ROLES.STANDALONE);
    const roleHidden = document.getElementById("amazonPushVariationRole");
    if (roleHidden instanceof HTMLInputElement) roleHidden.value = role;
    updateVariationRoleUi(role);
    onChange?.(role);
  });
}

export function resetAmazonVariationFamilyPanel() {
  const section = document.getElementById("amazonPushVariationSection");
  const roleList = document.getElementById("amazonPushVariationRoleList");
  if (section) section.classList.add("hidden");
  if (roleList) roleList.innerHTML = "";
  const roleHidden = document.getElementById("amazonPushVariationRole");
  if (roleHidden instanceof HTMLInputElement) roleHidden.value = VARIATION_ROLES.STANDALONE;
  const parentDraftHidden = document.getElementById("amazonPushParentDraftId");
  if (parentDraftHidden instanceof HTMLInputElement) parentDraftHidden.value = "";
  updateVariationRoleUi(VARIATION_ROLES.STANDALONE);
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} productCode
 * @param {Array<Record<string, unknown>>} variants
 * @param {Record<string, unknown> | null | undefined} familyContext
 */
export function hydrateVariationFamilyFromDraft(row, productCode, variants, familyContext) {
  const role = String(row.variation_role || VARIATION_ROLES.STANDALONE);
  initAmazonVariationFamilyPanel(
    productCode,
    variants,
    familyContext,
    /** @type {VariationRole} */ (role),
    String(row.draft_id || ""),
  );

  const theme = String(row.variation_theme || inferVariationTheme(variants));
  const themeSelect = document.getElementById("amazonPushVariationTheme");
  if (themeSelect instanceof HTMLSelectElement && theme) themeSelect.value = theme;

  const parentSku = String(row.parent_seller_sku || "");
  const parentSkuInput = document.getElementById("amazonPushParentSellerSku");
  if (parentSkuInput instanceof HTMLInputElement && parentSku) parentSkuInput.value = parentSku;

  const parentDraftHidden = document.getElementById("amazonPushParentDraftId");
  if (parentDraftHidden instanceof HTMLInputElement && row.parent_draft_id) {
    parentDraftHidden.value = String(row.parent_draft_id);
  }

  updateVariationRoleUi(/** @type {VariationRole} */ (role));
}

import { qs } from "./dom.js";
import { escapeHtml } from "./renderListings.js";
import { readExtraAttributesFromForm } from "./pushDraftAttributes.js";

/** @typedef {{ severity: "high" | "medium", title: string, detail: string }} ComplianceWarning */

/** @type {Record<string, Omit<ComplianceWarning, "severity"> & { severity?: ComplianceWarning["severity"] }>} */
const PRODUCT_TYPE_COMPLIANCE = {
  TOY_FIGURE: {
    severity: "high",
    title: "Children's product compliance likely",
    detail:
      "Toy product types often trigger CPC/lab testing, CPSIA, and children's product certificate requests in Seller Central. KK admin cannot upload compliance docs — resolve those in Seller Central or choose a non-toy product type.",
  },
  TOYS_AND_GAMES: {
    severity: "high",
    title: "Toy category compliance likely",
    detail:
      "Amazon may require children's product certificates, safety testing, or CPSIA documentation depending on how the listing is classified.",
  },
  STUFFED_ANIMAL_TOY: {
    severity: "high",
    title: "Stuffed toy compliance likely",
    detail:
      "Plush and stuffed toy types are commonly treated as children's products. Expect CPC/testing requests unless the item is clearly adult-only decor.",
  },
  BABY_PRODUCT: {
    severity: "high",
    title: "Baby product compliance likely",
    detail:
      "Baby product types usually require additional safety documentation and certificates in Seller Central.",
  },
  CHILDCARE_PRODUCT: {
    severity: "high",
    title: "Childcare product compliance likely",
    detail:
      "Childcare categories often require safety certificates and compliance review beyond what KK admin can submit.",
  },
};

/** @type {{ field: string, pattern: RegExp, warning: Omit<ComplianceWarning, "severity"> & { severity?: ComplianceWarning["severity"] } }[]} */
const ATTRIBUTE_COMPLIANCE_TRIGGERS = [
  {
    field: "target_audience_keyword",
    pattern: /child|kid|toddler|infant|baby/i,
    warning: {
      severity: "high",
      title: "Children's audience selected",
      detail:
        "Attributes aimed at children increase the chance Amazon will request CPC, lab testing, or CPSIA documentation.",
    },
  },
  {
    field: "item_type_keyword",
    pattern: /children|child|kids|toy|plush-figure|plush-animal|stuffed/i,
    warning: {
      severity: "medium",
      title: "Toy / children's browse-tree keyword",
      detail:
        "Browse-tree keywords like plush toys or children's items can push the listing into toy compliance review even if the product type looks harmless.",
    },
  },
  {
    field: "age_range_description",
    pattern: /month|year|kid|child|toddler|infant|baby|\d+\s*-\s*\d+/i,
    warning: {
      severity: "medium",
      title: "Age range provided",
      detail:
        "Age-related attributes signal a children's product to Amazon and can trigger certificate requests.",
    },
  },
  {
    field: "cpsia_cautionary_statement",
    pattern: /choking|small.?part|warning/i,
    warning: {
      severity: "medium",
      title: "CPSIA warning selected",
      detail:
        "A CPSIA cautionary statement usually means Amazon expects children's product safety documentation.",
    },
  },
];

/**
 * @param {string} productType
 * @param {Record<string, unknown>} [extraAttributes]
 * @returns {ComplianceWarning[]}
 */
export function getPushComplianceWarnings(productType = "", extraAttributes = {}) {
  const normalized = String(productType || "").trim().toUpperCase();
  /** @type {ComplianceWarning[]} */
  const warnings = [];
  const seen = new Set();

  function addWarning(warning) {
    const key = `${warning.severity}:${warning.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({
      severity: warning.severity || "medium",
      title: warning.title,
      detail: warning.detail,
    });
  }

  if (normalized && PRODUCT_TYPE_COMPLIANCE[normalized]) {
    addWarning(PRODUCT_TYPE_COMPLIANCE[normalized]);
  } else if (normalized.includes("TOY") || normalized.includes("DOLL") || normalized.includes("GAME")) {
    addWarning({
      severity: "high",
      title: "Possible toy / children's compliance",
      detail:
        "This product type name suggests toys or games. Amazon may request children's product certificates or lab testing.",
    });
  }

  for (const trigger of ATTRIBUTE_COMPLIANCE_TRIGGERS) {
    const raw = extraAttributes[trigger.field];
    const value = Array.isArray(raw) ? raw.join(" ") : String(raw || "").trim();
    if (!value || !trigger.pattern.test(value)) continue;
    addWarning(trigger.warning);
  }

  return warnings;
}

/** @param {ComplianceWarning[]} warnings @param {string} [panelId] */
export function renderPushCompliancePanel(warnings = [], panelId = "#amazonPushCompliancePanel") {
  const panel = qs(panelId);
  if (!panel) return;

  if (!warnings.length) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const hasHigh = warnings.some((warning) => warning.severity === "high");
  panel.classList.remove("hidden");
  panel.className = hasHigh
    ? "rounded-xl border-2 border-red-400 bg-red-50/50 px-4 py-3"
    : "rounded-xl border-2 border-amber-400 bg-amber-50/50 px-4 py-3";

  panel.innerHTML = `
    <p class="text-xs font-black uppercase tracking-wide ${hasHigh ? "text-red-900" : "text-amber-900"}">
      Compliance review may be required on Amazon
    </p>
    <ul class="mt-2 space-y-2 text-xs ${hasHigh ? "text-red-900" : "text-amber-900"}">
      ${warnings.map((warning) => `
        <li>
          <p class="font-bold">${escapeHtml(warning.title)}</p>
          <p class="mt-0.5">${escapeHtml(warning.detail)}</p>
        </li>
      `).join("")}
    </ul>
    <p class="mt-2 text-[11px] ${hasHigh ? "text-red-800" : "text-amber-800"}">
      KK admin can submit catalog data only. Certificates, lab reports, and appeals are handled in Seller Central.
    </p>
  `;
}

export function hidePushCompliancePanel() {
  renderPushCompliancePanel([]);
}

/**
 * @param {() => string} readProductType
 */
export function updatePushComplianceWarnings(readProductType) {
  const productType = readProductType();
  let extraAttributes = {};
  try {
    extraAttributes = readExtraAttributesFromForm();
  } catch {
    extraAttributes = {};
  }
  renderPushCompliancePanel(getPushComplianceWarnings(productType, extraAttributes));
}

/** @param {ComplianceWarning[]} warnings */
export function formatComplianceConfirmMessage(warnings = []) {
  const high = warnings.filter((warning) => warning.severity === "high");
  if (!high.length) return "";
  const titles = high.map((warning) => warning.title).join("; ");
  return `\n\nCompliance warning: ${titles}. Amazon may block the listing until Seller Central documents are provided. Continue anyway?`;
}

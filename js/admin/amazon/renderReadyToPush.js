import { qs } from "./dom.js";

import { escapeHtml } from "./renderListings.js";

import { isParentShellRow } from "./readyToPushNormalize.js";

import {

  buildProductGroupSummary,

  groupReadyRowsByProduct,

} from "./readyToPushQueue.js";



const DRAFT_BADGES = {

  draft: { label: "Draft saved", className: "bg-blue-50 text-blue-700" },

  needs_attributes: { label: "Needs attributes", className: "bg-amber-100 text-amber-800" },

  ready_to_submit: { label: "Ready to submit", className: "bg-green-100 text-green-800" },

  rejected: { label: "Rejected", className: "bg-red-100 text-red-800" },

};



const ELIGIBILITY_BADGES = {

  ready: { label: "Ready", className: "bg-green-100 text-green-800" },

  needs_review: { label: "Needs Review", className: "bg-amber-100 text-amber-800" },

  blocked: { label: "Blocked", className: "bg-red-100 text-red-800" },

};



function formatPrice(value) {

  const num = Number(value);

  if (!Number.isFinite(num)) return "—";

  try {

    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);

  } catch {

    return `$${num.toFixed(2)}`;

  }

}



function formatDate(value) {

  if (!value) return "";

  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

}



function draftBadge(status) {

  return DRAFT_BADGES[status] || null;

}



function eligibilityBadge(status) {

  return ELIGIBILITY_BADGES[status] || ELIGIBILITY_BADGES.ready;

}



function normalizeWarnings(row) {

  const raw = row.eligibility_warnings;

  if (Array.isArray(raw)) {

    return raw.map((entry) => String(entry)).filter(Boolean);

  }

  if (typeof raw === "string" && raw.startsWith("{")) {

    try {

      const parsed = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed.map(String) : [];

    } catch {

      return [];

    }

  }

  return [];

}



function warningChips(warnings) {

  if (!warnings.length) return "";

  return `<div class="flex flex-wrap gap-1 mt-2">${warnings.map((warning) =>

    `<span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-gray-100 text-gray-700">${escapeHtml(warning)}</span>`,

  ).join("")}</div>`;

}



/**

 * Variation parent shell row (KK-XXXX-PARENT) — not a buyable color variant.

 * @param {Record<string, unknown>} row

 */

export function buildReadyToPushParentCard(row) {

  const productId = String(row.kk_product_id || "");

  const baseSku = escapeHtml(row.kk_sku || "");

  const parentSku = escapeHtml(String(row.suggested_seller_sku || `${row.kk_sku || ""}-PARENT`));

  const titleBase = escapeHtml(row.kk_product_title || baseSku || "Untitled product");

  const category = escapeHtml(row.category || "");

  const draftId = row.draft_id ? String(row.draft_id) : "";

  const draftStatus = String(row.draft_status || "");

  const hasDraft = Boolean(row.has_active_draft && draftId);

  const imageUrl = row.image_url ? String(row.image_url) : "";

  const draftUpdated = formatDate(row.last_draft_updated_at);

  const draftBadgeInfo = hasDraft ? draftBadge(draftStatus) : null;

  const warningsAttr = "";



  const thumb = imageUrl

    ? `<img src="${escapeHtml(imageUrl)}" alt="" class="w-14 h-14 rounded-lg object-cover border border-dashed border-gray-300 flex-shrink-0 opacity-90" loading="lazy" />`

    : `<div class="w-14 h-14 rounded-lg bg-gray-100 border border-dashed border-gray-300 flex-shrink-0" aria-hidden="true"></div>`;



  const badgeHtml = draftBadgeInfo

    ? `<span class="inline-flex self-start sm:self-end px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${draftBadgeInfo.className}">${escapeHtml(draftBadgeInfo.label)}</span>`

    : `<span class="inline-flex self-start sm:self-end px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-violet-100 text-violet-800">Parent shell</span>`;



  const submittedPending = draftStatus === "submitted";
  const draftMeta = hasDraft && draftUpdated
    ? submittedPending
      ? `<p class="text-[10px] text-amber-700 mt-1">Parent submitted ${escapeHtml(draftUpdated)} — waiting for Amazon <span class="font-bold">ACCEPTED</span> before children can go live.</p>`
      : `<p class="text-[10px] text-gray-500 mt-1">Parent draft updated ${escapeHtml(draftUpdated)}. Submit on Amazon (not buyable) before child colors.</p>`
    : `<p class="text-[10px] text-gray-500 mt-1">Submit this before child color/size SKUs. Not buyable on Amazon.</p>`;



  const continueBtn = hasDraft

    ? `<button type="button" data-action="continue-amazon-draft" data-draft-id="${escapeHtml(draftId)}" data-kk-product-id="${escapeHtml(productId)}" data-ready-row-kind="parent_shell" data-variation-role="parent" data-suggested-seller-sku="${parentSku}" data-sku="${baseSku}" class="flex-1 sm:flex-none border-4 border-black bg-black text-white px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:opacity-90">Continue Parent Draft</button>`

    : "";



  const deleteBtn = hasDraft

    ? `<button type="button" data-action="delete-amazon-draft" data-draft-id="${escapeHtml(draftId)}" data-draft-status="${escapeHtml(draftStatus)}" data-sku="${parentSku}" title="Removes local parent draft only" class="flex-1 sm:flex-none border-2 border-red-600 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-red-700 min-h-[44px] hover:bg-red-50">Delete Parent Draft</button>`

    : "";



  const pushBtn = hasDraft

    ? ""

    : `<button type="button" data-action="push-product-to-amazon" data-kk-product-id="${escapeHtml(productId)}" data-ready-row-kind="parent_shell" data-variation-role="parent" data-suggested-seller-sku="${parentSku}" data-sku="${baseSku}" title="Create variation parent listing (KK-XXXX-PARENT)" class="flex-1 sm:flex-none border-4 border-violet-700 bg-violet-700 text-white px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:opacity-90">Push Parent</button>`;



  const createBtn = hasDraft

    ? ""

    : `<button type="button" data-action="create-amazon-draft" data-kk-product-id="${escapeHtml(productId)}" data-ready-row-kind="parent_shell" data-variation-role="parent" data-suggested-seller-sku="${parentSku}" data-sku="${baseSku}" title="Open parent draft workflow" class="flex-1 sm:flex-none border-2 border-violet-700 bg-white text-violet-900 px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:bg-violet-50">Create Parent Draft</button>`;



  return `

    <article

      class="amazon-ready-card amazon-ready-parent-shell bg-violet-50/40 rounded-xl border border-dashed border-violet-300 p-4 shadow-sm"

      data-kk-product-id="${escapeHtml(productId)}"

      data-ready-row-kind="parent_shell"

      data-suggested-seller-sku="${parentSku}"

      data-sku="${baseSku}"

      data-image-url="${escapeHtml(imageUrl)}"

      data-draft-id="${escapeHtml(draftId)}"

      data-draft-status="${escapeHtml(draftStatus)}"

      data-eligibility-status="ready"

      data-eligibility-warnings="${warningsAttr}"

    >

      <div class="flex flex-col sm:flex-row sm:items-center gap-4">

        <div class="flex items-center gap-3 flex-1 min-w-0">

          ${thumb}

          <div class="min-w-0">

            <p class="text-[10px] font-black uppercase tracking-[.14em] text-violet-700">Variation parent</p>

            <h3 class="font-bold text-sm leading-tight">${titleBase}</h3>

            <p class="text-[11px] font-mono text-gray-600 mt-0.5">${parentSku} · family shell · base ${baseSku}</p>

            <dl class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">

              ${category ? `<div><span class="text-gray-400">Category</span> <span>${category}</span></div>` : ""}

              <div><span class="text-gray-400">Role</span> <span class="font-bold">Parent (not a color variant)</span></div>

            </dl>

            ${draftMeta}

          </div>

        </div>

        <div class="flex flex-col sm:items-end gap-2 shrink-0">

          ${badgeHtml}

          <div class="flex flex-wrap gap-2 w-full sm:w-auto">

            ${continueBtn}

            ${deleteBtn}

            ${pushBtn}

            ${createBtn}

          </div>

        </div>

      </div>

    </article>

  `;

}



/**

 * @param {Record<string, unknown>} row

 */

export function buildReadyToPushCard(row) {

  if (isParentShellRow(row)) return buildReadyToPushParentCard(row);



  const productId = String(row.kk_product_id || "");

  const variantId = row.kk_variant_id ? String(row.kk_variant_id) : "";

  const variantLabel = row.kk_variant_label ? String(row.kk_variant_label) : "";

  const sku = escapeHtml(row.kk_sku || "");

  const suggestedSku = escapeHtml(String(row.suggested_seller_sku || row.kk_sku || ""));

  const titleBase = escapeHtml(row.kk_product_title || sku || "Untitled product");

  const title = variantLabel

    ? `${titleBase} <span class="text-gray-500 font-normal">· ${escapeHtml(variantLabel)}</span>`

    : titleBase;

  const price = escapeHtml(formatPrice(row.kk_price));

  const stock = escapeHtml(String(row.kk_stock ?? "0"));

  const variantsTotal = Number(row.variants_total || 0);

  const variantsMapped = Number(row.variants_mapped || 0);

  const variantProgress = variantsTotal > 1

    ? `<div><span class="text-gray-400">On Amazon</span> <span class="font-bold">${variantsMapped}/${variantsTotal} variants</span></div>`

    : "";

  const category = escapeHtml(row.category || "");

  const draftId = row.draft_id ? String(row.draft_id) : "";

  const draftStatus = String(row.draft_status || "");

  const hasDraft = Boolean(row.has_active_draft && draftId);

  const eligibilityStatus = String(row.eligibility_status || "ready");

  const warnings = normalizeWarnings(row);

  const warningsAttr = escapeHtml(warnings.join("|"));

  const draftBadgeInfo = hasDraft ? draftBadge(draftStatus) : null;

  const eligibilityInfo = eligibilityBadge(eligibilityStatus);

  const imageUrl = row.image_url ? String(row.image_url) : "";

  const draftUpdated = formatDate(row.last_draft_updated_at);

  const blocked = eligibilityStatus === "blocked";

  const needsReview = eligibilityStatus === "needs_review";

  const parentReady = Boolean(row.parent_listing_ready);



  const thumb = imageUrl

    ? `<img src="${escapeHtml(imageUrl)}" alt="" class="w-14 h-14 rounded-lg object-cover border border-gray-200 flex-shrink-0" loading="lazy" />`

    : `<div class="w-14 h-14 rounded-lg bg-kkpeach/60 border border-gray-200 flex-shrink-0" aria-hidden="true"></div>`;



  const badgeHtml = draftBadgeInfo

    ? `<span class="inline-flex self-start sm:self-end px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${draftBadgeInfo.className}">${escapeHtml(draftBadgeInfo.label)}</span>`

    : `<span class="inline-flex self-start sm:self-end px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${eligibilityInfo.className}">${escapeHtml(eligibilityInfo.label)}</span>`;



  const draftMeta = hasDraft && draftUpdated

    ? `<p class="text-[10px] text-gray-500 mt-1">Draft updated ${escapeHtml(draftUpdated)}</p>`

    : "";



  const parentHint = variantsTotal > 1 && !parentReady

    ? `<p class="text-[10px] text-violet-700 mt-1">Finish the <span class="font-bold">variation parent</span> row above before submitting children.</p>`

    : "";



  const cardBorder = blocked && !hasDraft

    ? "border-red-300 bg-red-50/30"

    : needsReview && !hasDraft

      ? "border-amber-300 bg-amber-50/30"

      : "border-gray-200";



  const blockNewActions = blocked && !hasDraft;

  const disabledClass = blockNewActions

    ? "opacity-50 cursor-not-allowed"

    : needsReview && !hasDraft

      ? "border-amber-400"

      : "";

  const disabledAttrs = blockNewActions ? 'disabled aria-disabled="true"' : "";



  const continueBtn = hasDraft

    ? `<button type="button" data-action="continue-amazon-draft" data-draft-id="${escapeHtml(draftId)}" data-kk-product-id="${escapeHtml(productId)}" data-kk-variant-id="${escapeHtml(variantId)}" data-ready-row-kind="variant" data-suggested-seller-sku="${suggestedSku}" data-sku="${sku}" data-eligibility-status="${escapeHtml(eligibilityStatus)}" data-eligibility-warnings="${warningsAttr}" class="flex-1 sm:flex-none border-4 border-black bg-black text-white px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:opacity-90">Continue Draft</button>`

    : "";



  const deleteBtn = hasDraft

    ? `<button type="button" data-action="delete-amazon-draft" data-draft-id="${escapeHtml(draftId)}" data-draft-status="${escapeHtml(draftStatus)}" data-sku="${sku}" class="flex-1 sm:flex-none border-2 border-red-600 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-red-700 min-h-[44px] hover:bg-red-50">Delete Draft</button>`

    : "";



  const pushBtn = `<button type="button" ${disabledAttrs} data-action="push-product-to-amazon" data-kk-product-id="${escapeHtml(productId)}" data-kk-variant-id="${escapeHtml(variantId)}" data-ready-row-kind="variant" data-suggested-seller-sku="${suggestedSku}" data-sku="${sku}" data-draft-id="${escapeHtml(draftId)}" data-draft-status="${escapeHtml(draftStatus)}" data-eligibility-status="${escapeHtml(eligibilityStatus)}" data-eligibility-warnings="${warningsAttr}" title="Open child variation push workflow" class="flex-1 sm:flex-none border-4 border-black ${hasDraft ? "bg-white text-black hover:bg-gray-50" : "bg-black text-white hover:opacity-90"} px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] ${disabledClass}">Push to Amazon</button>`;



  const createBtn = hasDraft

    ? ""

    : `<button type="button" ${disabledAttrs} data-action="create-amazon-draft" data-kk-product-id="${escapeHtml(productId)}" data-kk-variant-id="${escapeHtml(variantId)}" data-ready-row-kind="variant" data-suggested-seller-sku="${suggestedSku}" data-sku="${sku}" data-eligibility-status="${escapeHtml(eligibilityStatus)}" data-eligibility-warnings="${warningsAttr}" title="Open draft workflow" class="flex-1 sm:flex-none border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-gray-700 min-h-[44px] hover:bg-gray-50 ${disabledClass}">Create Draft</button>`;



  return `

    <article

      class="amazon-ready-card bg-white rounded-xl border p-4 shadow-sm ${cardBorder}"

      data-kk-product-id="${escapeHtml(productId)}"

      data-kk-variant-id="${escapeHtml(variantId)}"

      data-ready-row-kind="variant"

      data-suggested-seller-sku="${suggestedSku}"

      data-kk-stock="${stock}"

      data-sku="${sku}"

      data-image-url="${escapeHtml(imageUrl)}"

      data-draft-id="${escapeHtml(draftId)}"

      data-draft-status="${escapeHtml(draftStatus)}"

      data-eligibility-status="${escapeHtml(eligibilityStatus)}"

      data-eligibility-warnings="${warningsAttr}"

    >

      <div class="flex flex-col sm:flex-row sm:items-center gap-4">

        <div class="flex items-center gap-3 flex-1 min-w-0">

          ${thumb}

          <div class="min-w-0">

            <h3 class="font-bold text-sm leading-tight">${title}</h3>

            <p class="text-[11px] font-mono text-gray-500 mt-0.5">${suggestedSku !== sku ? `${suggestedSku} · base ${sku}` : sku}</p>

            <dl class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">

              <div><span class="text-gray-400">KK Price</span> <span class="font-bold">${price}</span></div>

              <div><span class="text-gray-400">Variant Stock</span> <span class="font-bold">${stock}</span></div>

              ${variantProgress}

              ${category ? `<div><span class="text-gray-400">Category</span> <span>${category}</span></div>` : ""}

            </dl>

            ${warningChips(warnings)}

            ${draftMeta}

            ${parentHint}

          </div>

        </div>

        <div class="flex flex-col sm:items-end gap-2 shrink-0">

          ${badgeHtml}

          <div class="flex flex-wrap gap-2 w-full sm:w-auto">

            ${continueBtn}

            ${deleteBtn}

            ${pushBtn}

            ${createBtn}

          </div>

        </div>

      </div>

    </article>

  `;

}



/**

 * @param {Array<Record<string, unknown>>} productRows

 */

function buildProductGroupHeader(productRows) {

  const variantRows = productRows.filter((row) => !isParentShellRow(row));

  if (variantRows.length <= 1 && !productRows.some(isParentShellRow)) return "";



  const first = variantRows[0] || productRows[0] || {};

  const productId = String(first.kk_product_id || "");

  const title = escapeHtml(String(first.kk_product_title || first.kk_sku || "Product"));

  const sku = escapeHtml(String(first.kk_sku || ""));

  const summary = buildProductGroupSummary(productRows);

  const progressLabel = `${summary.onAmazon}/${summary.total} variants on Amazon`;



  const pushRemainingBtn = summary.remaining >= 1

    ? `<button type="button" data-action="push-remaining-variants" data-kk-product-id="${escapeHtml(productId)}" class="border-2 border-black bg-black text-white px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[36px] hover:opacity-90">Push remaining (${summary.remaining})</button>`

    : "";



  const parentNote = summary.parentNeedsAttention

    ? `<p class="text-[10px] text-violet-700 mt-1">Submit the <span class="font-bold">variation parent</span> row first, then push child colors.</p>`

    : "";



  return `

    <header class="amazon-ready-product-group-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 pb-1">

      <div class="min-w-0">

        <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-400">Multi-variant product</p>

        <h2 class="font-bold text-sm truncate">${title}</h2>

        <p class="text-[11px] text-gray-500 font-mono">${sku} · <span class="font-bold text-gray-700">${progressLabel}</span></p>

        ${parentNote}

      </div>

      ${pushRemainingBtn}

    </header>

  `;

}



/**

 * @param {Array<Record<string, unknown>>} rows

 * @param {{ total?: number, totalVariantTargets?: number, fullTotal?: number, searchQuery?: string }} [meta]

 */

export function renderReadyToPush(rows, meta = {}) {

  const container = qs("#amazonReadyToPushList");

  const countLabel = qs("#amazonReadyToPushCountLabel");

  if (!container) return;



  const totalVariants = Number(meta.totalVariantTargets ?? meta.total ?? rows.length);

  const fullTotal = Number(meta.fullTotal ?? totalVariants);

  const searchQuery = String(meta.searchQuery || "").trim();

  const searchActive = searchQuery.length > 0;



  if (!rows.length && totalVariants === 0) {

    if (searchActive && fullTotal > 0) {

      container.innerHTML = `

        <div class="bg-white rounded-xl border border-gray-200 p-8 text-center">

          <p class="text-sm font-bold">No matches</p>

          <p class="text-xs text-gray-400 mt-2 max-w-md mx-auto">Nothing in Ready to Push matched <span class="font-mono font-bold text-gray-600">${escapeHtml(searchQuery)}</span>. Try title, SKU, or variant label.</p>

        </div>

      `;

    } else {

      container.innerHTML = `

      <div class="bg-white rounded-xl border border-gray-200 p-8 text-center">

        <p class="text-sm font-bold">No products ready to push</p>

        <p class="text-xs text-gray-400 mt-2 max-w-md mx-auto">Products appear here when an active variant (or single-SKU product) is not yet mapped to a live Amazon listing. Legacy product-level mappings do not block other variants.</p>

        <p class="text-xs text-gray-500 mt-3 max-w-md mx-auto">Multi-variant families show a <span class="font-bold">variation parent</span> row (KK-XXXX-PARENT) — submit that before child colors.</p>

      </div>

    `;

    }

  } else {

    const groups = groupReadyRowsByProduct(rows);

    container.innerHTML = groups.map((productRows) => {

      const cards = productRows.map((row) => buildReadyToPushCard(row)).join("");

      const hasGroupChrome = productRows.length > 1 || productRows.some(isParentShellRow);

      if (!hasGroupChrome) return cards;

      return `

        <section class="amazon-ready-product-group space-y-3" data-kk-product-id="${escapeHtml(String(productRows[0]?.kk_product_id || ""))}">

          ${buildProductGroupHeader(productRows)}

          <div class="space-y-3 pl-0 sm:pl-2 border-l-0 sm:border-l-2 sm:border-gray-100">${cards}</div>

        </section>

      `;

    }).join("");

  }



  if (countLabel) {

    if (fullTotal === 0) {

      countLabel.textContent = "0 variant targets · live";

    } else if (searchActive && totalVariants !== fullTotal) {

      countLabel.textContent = `${totalVariants} of ${fullTotal} variant target${fullTotal === 1 ? "" : "s"} · filtered`;

    } else {

      countLabel.textContent = `${fullTotal} variant target${fullTotal === 1 ? "" : "s"} · live`;

    }

  }



  const tabCount = qs("#amazonTabReadyToPush [data-count]");

  if (tabCount) tabCount.textContent = String(fullTotal);

}



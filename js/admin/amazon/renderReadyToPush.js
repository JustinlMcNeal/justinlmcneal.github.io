import { qs } from "./dom.js";
import { escapeHtml } from "./renderListings.js";

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
 * @param {Record<string, unknown>} row
 */
export function buildReadyToPushCard(row) {
  const productId = String(row.kk_product_id || "");
  const sku = escapeHtml(row.kk_sku || "");
  const title = escapeHtml(row.kk_product_title || sku || "Untitled product");
  const price = escapeHtml(formatPrice(row.kk_price));
  const stock = escapeHtml(String(row.kk_stock ?? "0"));
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

  const thumb = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" class="w-14 h-14 rounded-lg object-cover border border-gray-200 flex-shrink-0" loading="lazy" />`
    : `<div class="w-14 h-14 rounded-lg bg-kkpeach/60 border border-gray-200 flex-shrink-0" aria-hidden="true"></div>`;

  const badgeHtml = draftBadgeInfo
    ? `<span class="inline-flex self-start sm:self-end px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${draftBadgeInfo.className}">${escapeHtml(draftBadgeInfo.label)}</span>`
    : `<span class="inline-flex self-start sm:self-end px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${eligibilityInfo.className}">${escapeHtml(eligibilityInfo.label)}</span>`;

  const draftMeta = hasDraft && draftUpdated
    ? `<p class="text-[10px] text-gray-500 mt-1">Draft updated ${escapeHtml(draftUpdated)}</p>`
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
    ? `<button type="button" data-action="continue-amazon-draft" data-draft-id="${escapeHtml(draftId)}" data-kk-product-id="${escapeHtml(productId)}" data-sku="${sku}" data-eligibility-status="${escapeHtml(eligibilityStatus)}" data-eligibility-warnings="${warningsAttr}" class="flex-1 sm:flex-none border-4 border-black bg-black text-white px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:opacity-90">Continue Draft</button>`
    : "";

  const deleteBtn = hasDraft
    ? `<button type="button" data-action="delete-amazon-draft" data-draft-id="${escapeHtml(draftId)}" data-draft-status="${escapeHtml(draftStatus)}" data-sku="${sku}" class="flex-1 sm:flex-none border-2 border-red-600 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-red-700 min-h-[44px] hover:bg-red-50">Delete Draft</button>`
    : "";

  const pushBtn = `<button type="button" ${disabledAttrs} data-action="push-product-to-amazon" data-kk-product-id="${escapeHtml(productId)}" data-sku="${sku}" data-draft-id="${escapeHtml(draftId)}" data-draft-status="${escapeHtml(draftStatus)}" data-eligibility-status="${escapeHtml(eligibilityStatus)}" data-eligibility-warnings="${warningsAttr}" title="Open push workflow" class="flex-1 sm:flex-none border-4 border-black ${hasDraft ? "bg-white text-black hover:bg-gray-50" : "bg-black text-white hover:opacity-90"} px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] ${disabledClass}">Push to Amazon</button>`;

  const createBtn = hasDraft
    ? ""
    : `<button type="button" ${disabledAttrs} data-action="create-amazon-draft" data-kk-product-id="${escapeHtml(productId)}" data-sku="${sku}" data-eligibility-status="${escapeHtml(eligibilityStatus)}" data-eligibility-warnings="${warningsAttr}" title="Open draft workflow" class="flex-1 sm:flex-none border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-gray-700 min-h-[44px] hover:bg-gray-50 ${disabledClass}">Create Draft</button>`;

  return `
    <article
      class="amazon-ready-card bg-white rounded-xl border p-4 shadow-sm ${cardBorder}"
      data-kk-product-id="${escapeHtml(productId)}"
      data-sku="${sku}"
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
            <p class="text-[11px] font-mono text-gray-500 mt-0.5">${sku}</p>
            <dl class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              <div><span class="text-gray-400">KK Price</span> <span class="font-bold">${price}</span></div>
              <div><span class="text-gray-400">Website Stock</span> <span class="font-bold">${stock}</span></div>
              ${category ? `<div><span class="text-gray-400">Category</span> <span>${category}</span></div>` : ""}
            </dl>
            ${warningChips(warnings)}
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
 * @param {Array<Record<string, unknown>>} rows
 */
export function renderReadyToPush(rows) {
  const container = qs("#amazonReadyToPushList");
  const countLabel = qs("#amazonReadyToPushCountLabel");
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = `
      <div class="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p class="text-sm font-bold">No products ready to push</p>
        <p class="text-xs text-gray-400 mt-2">Eligible KK products are mapped to Amazon or have submitted drafts awaiting verification.</p>
      </div>
    `;
  } else {
    container.innerHTML = rows.map((row) => buildReadyToPushCard(row)).join("");
  }

  const count = rows.length;
  if (countLabel) {
    countLabel.textContent = count === 0
      ? "0 products · live"
      : `${count} product${count === 1 ? "" : "s"} · live`;
  }

  const tabCount = qs("#amazonTabReadyToPush [data-count]");
  if (tabCount) tabCount.textContent = String(count);
}

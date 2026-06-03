import { qs } from "./dom.js";
import { escapeHtml } from "./renderListings.js";

const STATUS_BADGES = {
  draft: { label: "Draft", className: "bg-blue-50 text-blue-700" },
  needs_attributes: { label: "Needs Attributes", className: "bg-amber-100 text-amber-800" },
  ready_to_submit: { label: "Ready", className: "bg-green-100 text-green-800" },
  submitted: { label: "Submitted", className: "bg-gray-200 text-gray-700" },
  published: { label: "Published", className: "bg-green-100 text-green-800" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-800" },
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildVerifyRetryMeta(row) {
  if (String(row.draft_status) !== "submitted") return "";

  const attempts = Number(row.verify_attempts || 0);
  const lastCheck = row.last_verify_attempt_at;
  const nextCheck = row.next_verify_after;
  const verifyStatus = String(row.verify_status || "");
  const hasMeta = attempts > 0 || lastCheck || nextCheck ||
    ["not_found", "failed", "max_attempts", "running", "queued"].includes(verifyStatus);

  if (!hasMeta) return "";

  const lines = [];
  if (attempts > 0) {
    lines.push(`<div><dt class="text-gray-400">Verification attempts</dt><dd class="font-bold">${attempts}</dd></div>`);
  }
  if (nextCheck && verifyStatus !== "max_attempts") {
    lines.push(`<div><dt class="text-gray-400">Next auto-check</dt><dd class="text-gray-600">${escapeHtml(formatDateTime(nextCheck))}</dd></div>`);
  }
  if (lastCheck) {
    lines.push(`<div><dt class="text-gray-400">Last check</dt><dd class="text-gray-600">${escapeHtml(formatDateTime(lastCheck))}</dd></div>`);
  }
  if (verifyStatus === "max_attempts") {
    lines.push(`<div class="col-span-2"><dt class="text-gray-400">Auto-verify</dt><dd class="text-red-700 font-medium">Max attempts reached</dd></div>`);
  }

  if (!lines.length) return "";

  return `<dl class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs border-t border-amber-200/60 pt-2">${lines.join("")}</dl>`;
}

function statusBadge(status) {
  return STATUS_BADGES[status] || { label: status || "Draft", className: "bg-gray-100 text-gray-700" };
}

/**
 * @param {Record<string, unknown>} row
 */
export function buildDraftIssueCard(row) {
  const draftId = String(row.draft_id || "");
  const status = String(row.draft_status || "draft");
  const draftVariationRole = String(row.draft_variation_role || row.variation_role || "standalone");
  const badge = statusBadge(status);
  const title = escapeHtml(row.kk_product_title || row.kk_sku || "Untitled draft");
  const sku = escapeHtml(row.kk_sku || row.seller_sku || "—");
  const sellerSku = escapeHtml(row.seller_sku || "—");
  const marketplace = escapeHtml(row.marketplace_id || "—");
  const productType = escapeHtml(row.product_type || "—");
  const issueCount = Number(row.issue_count || 0);
  const updated = escapeHtml(formatDate(row.updated_at));
  const verifyStatus = String(row.verify_status || "");
  const roleBadge = draftVariationRole === "parent"
    ? { label: "Parent", className: "bg-purple-100 text-purple-800" }
    : draftVariationRole === "child"
      ? { label: "Child", className: "bg-sky-100 text-sky-800" }
      : { label: "Standalone", className: "bg-gray-100 text-gray-700" };
  const verifyBtn = status === "submitted"
    ? `<button type="button" data-action="verify-submitted-draft" data-draft-id="${escapeHtml(draftId)}" class="flex-1 sm:flex-none border-4 border-black bg-emerald-100 px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:bg-emerald-200">Verify Listing</button>`
    : "";

  const requeueBtn = status === "submitted" && verifyStatus === "max_attempts"
    ? `<button type="button" data-action="requeue-draft-verification" data-draft-id="${escapeHtml(draftId)}" class="flex-1 sm:flex-none border-4 border-black bg-sky-100 px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:bg-sky-200">Requeue Auto-Verify</button>`
    : "";

  const maxAttemptsAlert = status === "submitted" && verifyStatus === "max_attempts"
    ? `<div class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 mt-2 text-xs text-red-900"><p class="font-bold">Auto verification stopped after max attempts.</p><p class="mt-1">Use Verify Listing manually or requeue automatic checks.</p></div>`
    : "";

  const autoRetryHelper = status === "submitted" &&
    (verifyStatus === "not_found" || verifyStatus === "failed") &&
    row.next_verify_after
    ? `<p class="text-[11px] text-gray-600 mt-1">Auto-check will retry at ${escapeHtml(formatDateTime(row.next_verify_after))}.</p>`
    : "";

  const statusHelper = status === "submitted"
    ? `<p class="text-[11px] text-amber-700 mt-2 font-medium">Waiting for Amazon verification</p>`
    : status === "published"
      ? `<p class="text-[11px] text-green-700 mt-2 font-medium">Verified from Amazon sync</p>`
      : "";

  const verifyRetryMeta = buildVerifyRetryMeta(row);

  const cardBorder = status === "submitted"
    ? "border-amber-300 bg-amber-50/40"
    : "border-gray-200";

  return `
    <article
      class="amazon-draft-card bg-white rounded-xl border p-4 shadow-sm ${cardBorder}"
      data-draft-id="${escapeHtml(draftId)}"
      data-kk-product-id="${escapeHtml(row.kk_product_id || "")}"
      data-kk-sku="${sku}"
      data-seller-sku="${escapeHtml(row.seller_sku || "")}"
      data-marketplace-id="${marketplace}"
      data-product-type="${productType}"
      data-draft-status="${escapeHtml(status)}"
      ${status === "submitted" ? 'data-submitted-draft="true"' : ""}
      ${status === "submitted" && verifyStatus === "max_attempts" ? 'data-max-attempt-draft="true"' : ""}
    >
      <div class="flex flex-col sm:flex-row sm:items-start gap-4">
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-bold text-sm">${title}</h3>
            <span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${badge.className}">${escapeHtml(badge.label)}</span>
            <span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${roleBadge.className}">${escapeHtml(roleBadge.label)}</span>
          </div>
          <p class="text-[11px] font-mono text-gray-500 mt-0.5">${sku}</p>
          ${statusHelper}
          ${maxAttemptsAlert}
          ${autoRetryHelper}
          ${verifyRetryMeta}
          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs">
            <div><dt class="text-gray-400">Product type</dt><dd>${productType}</dd></div>
            <div><dt class="text-gray-400">Marketplace</dt><dd>${marketplace}</dd></div>
            <div><dt class="text-gray-400">Issues</dt><dd class="font-bold">${issueCount}</dd></div>
            <div><dt class="text-gray-400">Updated</dt><dd class="text-gray-600">${updated}</dd></div>
            <div><dt class="text-gray-400">Seller SKU</dt><dd class="font-mono">${sellerSku}</dd></div>
          </dl>
        </div>
        <div class="flex flex-wrap gap-2 shrink-0 w-full sm:w-auto">
          ${verifyBtn}
          ${requeueBtn}
          <button type="button" data-action="continue-amazon-draft" data-draft-id="${escapeHtml(draftId)}" class="flex-1 sm:flex-none border-4 border-black bg-black text-white px-3 py-2 text-[10px] font-black uppercase tracking-wide min-h-[44px] hover:opacity-90">${draftVariationRole === "parent" ? "Continue Parent Draft" : "Continue Draft"}</button>
          <button type="button" data-action="view-amazon-details" data-draft-id="${escapeHtml(draftId)}" class="flex-1 sm:flex-none border-2 border-black bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-gray-700 min-h-[44px] hover:bg-gray-50">View Details</button>
          <button type="button" data-action="delete-amazon-draft" data-draft-id="${escapeHtml(draftId)}" data-draft-status="${escapeHtml(status)}" data-sku="${sku}" class="flex-1 sm:flex-none border-2 border-red-600 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-red-700 min-h-[44px] hover:bg-red-50">Delete Draft</button>
        </div>
      </div>
    </article>
  `;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function renderDraftsIssues(rows) {
  const container = qs("#amazonDraftsIssuesList");
  const countLabel = qs("#amazonDraftsIssuesCountLabel");
  const reminder = qs("#amazonDraftsIssuesReminder");
  const maxAttemptsBanner = qs("#amazonDraftsMaxAttemptsBanner");
  if (!container) return;

  const submittedCount = rows.filter((row) => String(row.draft_status) === "submitted").length;
  const maxAttemptsCount = rows.filter((row) =>
    String(row.draft_status) === "submitted" && String(row.verify_status) === "max_attempts",
  ).length;

  if (reminder) {
    reminder.classList.toggle("hidden", submittedCount === 0);
    const countEl = reminder.querySelector("[data-submitted-count]");
    if (countEl) {
      countEl.textContent = String(submittedCount);
    }
  }

  if (maxAttemptsBanner) {
    maxAttemptsBanner.classList.toggle("hidden", maxAttemptsCount === 0);
    const countEl = maxAttemptsBanner.querySelector("[data-max-attempts-count]");
    if (countEl) {
      countEl.textContent = String(maxAttemptsCount);
    }
    const bulkBtn = maxAttemptsBanner.querySelector('[data-action="bulk-requeue-max-attempt-drafts"]');
    if (bulkBtn instanceof HTMLButtonElement) {
      bulkBtn.disabled = maxAttemptsCount === 0;
      bulkBtn.setAttribute("aria-disabled", maxAttemptsCount === 0 ? "true" : "false");
    }
  }

  if (!rows.length) {
    container.innerHTML = `
      <div class="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p class="text-sm font-bold">No drafts or validation issues yet</p>
        <p class="text-xs text-gray-400 mt-2">Save a local push draft from Ready to Push or the header action.</p>
      </div>
    `;
  } else {
    container.innerHTML = rows.map((row) => buildDraftIssueCard(row)).join("");
  }

  if (countLabel) {
    const maxSuffix = maxAttemptsCount > 0 ? ` · ${maxAttemptsCount} max attempts` : "";
    countLabel.textContent = rows.length === 0
      ? "0 drafts · live"
      : `${rows.length} drafts · live${maxSuffix}`;
  }

  const tabCount = qs("#amazonTabDraftsIssues [data-count]");
  if (tabCount) tabCount.textContent = String(rows.length);
}

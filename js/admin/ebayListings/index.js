/**
 * index.js — eBay Listings admin page main module.
 *
 * Orchestrates the product list, push modal (create listing), edit modal,
 * bulk operations, setup/migrate panel, and init.
 */

import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter   } from "/js/shared/footer.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAdmin } from "/js/shared/guard.js";

import {
  esc,
  sanitizeForEbay,
  wrapDescription,
  isComplexHtml,
  buildImageUrls,
  buildPackageWeightAndSize,
  getSelectedPolicies,
  getBestOfferTerms,
  variantSkuFromOption,
} from "./utils.js";

import {
  quillToolbar,
  descState,
  resetQuillEditorMount,
  toggleDescMode,
  getDescriptionHtml,
} from "./editor.js";

import { renderImageStrip, showGalleryPicker } from "./images.js";
import { addVolTier, getVolTiers, setVolTiers } from "./volPricing.js";
import { buildEstimate, renderPreview } from "./profitPreview.js";
import { computeHealth } from "./listingHealth.js";
import { openSalesHistory, closeSalesHistory } from "./salesHistory.js";
import { buildPriceRef, renderPriceRef, fetchSalesMetrics } from "./priceReference.js";

// ── Init Supabase ─────────────────────────────────────────────
const supabase    = getSupabaseClient();
const SUPABASE_URL = "https://yxdzvzscufkvewecvagq.supabase.co";

// ── Shared State ──────────────────────────────────────────────
let allProducts            = [];
let filteredProducts       = [];
let currentView            = window.innerWidth < 640 ? "cards" : "table";
let currentProduct         = null;
let currentAspects         = [];
let pushQuill              = null;
let editQuill              = null;
let pushImageUrls          = [];
let editImageUrls          = [];
let editVariantImageOverrides = {};
let editVariantQtyOverrides   = {};
let pushVariants           = [];
let isVariantListing       = false;
let editProduct            = null;
let editAspects            = [];
let cachedPolicies         = null;
let bulkMode               = "price";
let searchTimeout;
let pushSalesMetrics = null;   // Phase 5: cached per push-modal session
let editSalesMetrics = null;   // Phase 5: cached per edit-modal session
let pageAdRatePct    = 0;      // Phase 6: assumed promoted listing ad rate for main-page estimates
let editOfferLookupCache = new Map();
let linkAuditRunId = 0;

// ── Edge Function Helper ──────────────────────────────────────
async function callEdge(fnName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated — please refresh the page");
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok && !resp.headers.get("content-type")?.includes("application/json")) {
    return { success: false, error: `HTTP ${resp.status} from ${fnName}` };
  }
  const data = await resp.json().catch(() => ({ success: false, error: `Non-JSON response from ${fnName} (HTTP ${resp.status})` }));
  if (!data?.success && fnName === "ebay-manage-listing") {
    console.warn("[ebay-listing] edge action failed", {
      action: body?.action,
      sku: body?.sku,
      offerId: body?.offerId,
      inventoryItemGroupKey: body?.inventoryItemGroupKey,
      code: data?.code,
      status: data?.status || data?.upstreamStatus || resp.status,
      message: data?.message || data?.error,
    });
  }
  return data;
}

function shortDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ebayErrorIds(payload) {
  const errors = payload?.errors || payload?.upstream?.errors || payload?.upstreamData?.errors || [];
  return Array.isArray(errors) ? errors.map(e => Number(e?.errorId)).filter(Number.isFinite) : [];
}

function isTransientGetItemFailure(result) {
  const status = Number(result?.upstreamStatus || result?.status || 0);
  const ids    = ebayErrorIds(result);
  const detail = `${result?.error || ""} ${JSON.stringify(result?.upstream || result?.upstreamData || {})}`;
  return status >= 500 || ids.includes(25001) || /system error|api_inventory|25001/i.test(detail);
}

async function getItemForEdit(sku) {
  try {
    const first = await callEdge("ebay-manage-listing", { action: "get_item", sku });
    if (first.success) return { ...first, retried: false };
    if (!isTransientGetItemFailure(first)) {
      console.warn(`[edit] get_item failed for ${sku}; using fallback:`, first.error || first);
      return { ...first, success: false, retried: false, fallback: true };
    }

    console.warn(`[edit] get_item failed for ${sku}; retrying once:`, first.error || first);
    await shortDelay(600);
    const second = await callEdge("ebay-manage-listing", { action: "get_item", sku });
    if (second.success) return { ...second, retried: true };

    console.warn(`[edit] get_item failed for ${sku} after retry; using fallback:`, second.error || second);
    return { ...second, success: false, retried: true, fallback: true };
  } catch (e) {
    console.warn(`[edit] get_item error for ${sku}; retrying once:`, e.message);
    await shortDelay(600);
    try {
      const retry = await callEdge("ebay-manage-listing", { action: "get_item", sku });
      if (retry.success) return { ...retry, retried: true };
      console.warn(`[edit] get_item failed for ${sku} after retry; using fallback:`, retry.error || retry);
      return { ...retry, success: false, retried: true, fallback: true };
    } catch (retryErr) {
      console.warn(`[edit] get_item error for ${sku} after retry; using fallback:`, retryErr.message);
      return { success: false, error: retryErr.message, retried: true, fallback: true };
    }
  }
}

async function getOffersForEdit(sku, context = "edit") {
  const key = String(sku || "").trim();
  if (!key) return { success: false, offers: [], error: "sku is required", cached: false };
  if (editOfferLookupCache.has(key)) {
    return { ...editOfferLookupCache.get(key), cached: true };
  }

  const result = await callEdge("ebay-manage-listing", { action: "get_offers", sku: key });
  const normalized = result?.success
    ? { ...result, cached: false }
    : {
        ...result,
        success: false,
        offers: [],
        cached: false,
        error: result?.message || result?.error || "Offer lookup failed",
      };

  editOfferLookupCache.set(key, normalized);
  if (!normalized.success) {
    console.warn(`[edit:${context}] get_offers failed for ${key}; cached failure to avoid repeated requests`, normalized);
  }
  return normalized;
}

function offerUpdateErrorMessage(result, fallback) {
  if (result?.code === "STALE_OFFER_RELINK_REQUIRED") {
    return result.message || "This eBay offer appears to be stale after manual relist activity. Refresh/relink this listing before editing.";
  }
  if (result?.code === "OFFER_LOCATION_RELINK_REQUIRED") {
    return result.message || "Location data for this eBay offer is missing or invalid. Rebuild/relink the offer from the current eBay state before editing.";
  }
  return result?.message || result?.error || fallback;
}

function isLinkedOnEbay(p) {
  const status = p?.ebay_status || "not_listed";
  return status === "active" && (p.ebay_sku || p.ebay_offer_id || p.ebay_listing_id || p.ebay_item_group_key);
}

function isStaleLinkCheck(check) {
  return Boolean(check?.success && ["stale", "ambiguous", "no_active_match"].includes(check.state));
}

function staleLinkLabel(check) {
  if (!check) return "Checking eBay link…";
  if (check.state === "stale") return "Local eBay link may be stale";
  if (check.state === "ambiguous") return "Multiple active eBay matches found";
  if (check.state === "no_active_match") return "No active eBay match found";
  return "eBay link verified";
}

function staleLinkMessage(check) {
  return check?.message || "Local eBay link may be stale. Active eBay listing may be different. Refresh/relink before editing.";
}

function currentActiveListingId(check) {
  return check?.activeMatch?.listingId || null;
}

async function reconcileEbayLink(product, relink = false) {
  const sku = product.ebay_sku || product.code;
  const result = await callEdge("ebay-manage-listing", {
    action: "reconcile_listing",
    productCode: product.code,
    sku,
    inventoryItemGroupKey: product.ebay_item_group_key || undefined,
    localOfferId: product.ebay_offer_id || undefined,
    localListingId: product.ebay_listing_id || undefined,
    relink,
  });
  if (result?.state === "no_active_match" && product.ebay_status !== "active") {
    result.state = "no_active_match_non_active";
    result.stale = false;
  }
  product._linkCheck = result;
  return result;
}

function ebayCodeLinkHtml(p, compact = false) {
  const check = p._linkCheck;
  if (isStaleLinkCheck(check)) {
    const activeId = currentActiveListingId(check);
    const relinkBtn = check.safeRelink
      ? ` <button onclick="relinkEbayListing('${esc(p.code)}')" class="text-amber-700 hover:underline font-bold">Relink</button>`
      : "";
    const activeLink = activeId
      ? ` <a href="https://www.ebay.com/itm/${esc(activeId)}" target="_blank" class="text-amber-700 hover:underline">active match ↗</a>`
      : "";
    return `<span class="text-amber-700 font-bold" title="${esc(staleLinkMessage(check))}">⚠ ${compact ? "Stale" : esc(p.code)}</span>${activeLink}${relinkBtn}`;
  }
  if (p.ebay_listing_id) {
    return `<a href="https://www.ebay.com/itm/${esc(p.ebay_listing_id)}" target="_blank" class="text-blue-500 hover:underline">${esc(p.code)}</a>`;
  }
  return esc(p.code);
}

async function auditListingLinks(products = allProducts) {
  const runId = ++linkAuditRunId;
  const candidates = products.filter(isLinkedOnEbay);
  if (!candidates.length) return;
  let staleCount = 0;
  for (const product of candidates) {
    if (runId !== linkAuditRunId) return;
    try {
      const check = await reconcileEbayLink(product, false);
      if (isStaleLinkCheck(check)) staleCount++;
    } catch (err) {
      console.warn("eBay link audit failed", product.code, err);
      product._linkCheck = { success: false, error: err.message || String(err) };
    }
  }
  if (runId !== linkAuditRunId) return;
  renderAll();
  if (staleCount) showStatus(`⚠️ ${staleCount} eBay link${staleCount === 1 ? "" : "s"} may be stale. Refresh/relink before editing.`, true);
}

window.relinkEbayListing = async function relinkEbayListing(code) {
  const product = allProducts.find(p => p.code === code);
  if (!product) return;
  if (!confirm(`Relink ${product.code} to the single active eBay match found for this SKU? No new listing will be created.`)) return;
  showStatus(`Relinking ${product.code} to current active eBay listing…`);
  try {
    const result = await reconcileEbayLink(product, true);
    if (!result.success || !result.relinked) {
      showStatus(`❌ ${result.message || result.error || "Relink was not safe"}`, true);
      renderAll();
      return;
    }
    showStatus(`✅ Relinked ${product.code} to active eBay listing ${result.activeMatch?.listingId || ""}`);
    await loadProducts();
  } catch (err) {
    showStatus(`❌ ${err.message || String(err)}`, true);
  }
};

function renderEditLinkWarning(check) {
  const box = document.getElementById("editLinkWarning");
  const text = document.getElementById("editLinkWarningText");
  const meta = document.getElementById("editLinkWarningMeta");
  const btn = document.getElementById("btnEditRelink");
  if (!box || !text || !meta || !btn) return;
  if (!isStaleLinkCheck(check)) {
    box.classList.add("hidden");
    btn.classList.add("hidden");
    return;
  }
  const activeId = currentActiveListingId(check);
  text.textContent = staleLinkMessage(check);
  meta.innerHTML = activeId
    ? `Current active match found: <a href="https://www.ebay.com/itm/${esc(activeId)}" target="_blank" class="underline font-bold">${esc(activeId)} ↗</a>`
    : staleLinkLabel(check);
  btn.classList.toggle("hidden", !check.safeRelink);
  box.classList.remove("hidden");
}

// ── Status Bar ────────────────────────────────────────────────
function showStatus(msg, isError = false) {
  const bar = document.getElementById("statusBar");
  bar.textContent = msg;
  bar.className   = `mt-3 text-xs ${isError ? "text-red-500" : "text-gray-500"}`;
  bar.classList.remove("hidden");
}

// ── Policies Cache ────────────────────────────────────────────
async function loadPoliciesCache() {
  if (cachedPolicies) return cachedPolicies;
  try {
    const result = await callEdge("ebay-manage-listing", { action: "get_policies" });
    if (result.success) {
      cachedPolicies = result.policies;
      populatePolicyDropdowns();
    }
  } catch (e) { console.warn("Policy load failed:", e); }
  return cachedPolicies;
}

function populatePolicyDropdowns() {
  if (!cachedPolicies) return;
  const defaultFulfill = "266551432012";
  const defaultReturn  = "266551433012";
  const defaultPayment = "266551437012";

  function fill(selectId, policyType, defaultId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const raw  = cachedPolicies[policyType];
    const list = raw?.policies || raw?.fulfillmentPolicies || raw?.returnPolicies || raw?.paymentPolicies || [];
    sel.innerHTML = list.map(p => {
      const id       = p.fulfillmentPolicyId || p.returnPolicyId || p.paymentPolicyId || "";
      const name     = p.name || p.policyName || "Unnamed";
      const selected = id === defaultId ? " selected" : "";
      return `<option value="${id}"${selected}>${name}</option>`;
    }).join("") || '<option value="">No policies found</option>';
  }

  fill("modalFulfillmentPolicy", "fulfillment_policy", defaultFulfill);
  fill("modalReturnPolicy",      "return_policy",      defaultReturn);
  fill("modalPaymentPolicy",     "payment_policy",     defaultPayment);
  fill("editFulfillmentPolicy",  "fulfillment_policy", defaultFulfill);
  fill("editReturnPolicy",       "return_policy",      defaultReturn);
  fill("editPaymentPolicy",      "payment_policy",     defaultPayment);
}

// ── Workspace Metrics (Phase 1: read-only, non-blocking) ────────────────────
// Fetches v_ebay_listing_workspace and merges workspace metrics onto product rows.
// If the view is unavailable, products load normally and metric badges show "—".
async function mergeWorkspaceMetrics(products) {
  try {
    const { data: wsData, error: wsErr } = await supabase
      .from("v_ebay_listing_workspace")
      .select("product_code, sold_qty_30d, sold_qty_90d, last_sold_at, avg_sold_price_cents_90d, gallery_image_count, active_variant_count, active_variant_stock_total, issue_flags, issue_count");
    if (wsErr || !wsData) {
      console.warn("[workspace] metrics unavailable:", wsErr?.message);
      return products;
    }
    const map = Object.fromEntries(wsData.map(row => [row.product_code, row]));
    return products.map(p => ({ ...p, _ws: map[p.code] || null }));
  } catch (e) {
    console.warn("[workspace] metrics skipped:", e.message);
    return products;
  }
}

// Relative date formatter for "last sold" badges.
function formatRelativeDate(dtStr) {
  if (!dtStr) return null;
  const dt    = new Date(dtStr);
  const diffMs = Date.now() - dt.getTime();
  const days  = Math.floor(diffMs / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30)  return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Build compact workspace chip HTML for a product row/card.
// Returns empty string when _ws is null (view unavailable) — no crash, no badge.
// health parameter (optional) — if provided, improves the issue chip tooltip/label.
function wsChips(p, health = null) {
  const ws = p._ws;
  if (!ws) return "";
  const chips = [];

  const sold30 = ws.sold_qty_30d ?? 0;
  if (sold30 > 0) {
    chips.push(`<span class="ws-chip ws-chip-sales" title="Units sold in last 30 days">${sold30} sold</span>`);
  }
  if (ws.last_sold_at) {
    const ago = formatRelativeDate(ws.last_sold_at);
    if (ago) chips.push(`<span class="ws-chip ws-chip-date" title="Last eBay sale">${ago}</span>`);
  }
  if (p.ebay_volume_promo_id) {
    chips.push(`<span class="ws-chip ws-chip-promo" title="Has volume promotion">PROMO</span>`);
  }
  // Phase 5: underpriced vs internal avg sold (only for active/draft, ≥2 obs)
  const priceStatus = p.ebay_status || "not_listed";
  if (["active", "draft"].includes(priceStatus)) {
    const avgSold90d = ws.avg_sold_price_cents_90d;
    const soldQty90d = ws.sold_qty_90d ?? 0;
    if (p.ebay_price_cents && avgSold90d != null && soldQty90d >= 2 && p.ebay_price_cents < avgSold90d) {
      const kkFmt  = `$${(p.ebay_price_cents / 100).toFixed(2)}`;
      const avgFmt = `$${(avgSold90d / 100).toFixed(2)}`;
      chips.push(`<span class="ws-chip ws-chip-underpriced" title="eBay price (${kkFmt}) is below recent avg sold (${avgFmt})">&#8595; avg</span>`);
    }
  }
  const issues = health ? health.flags.length : (ws.issue_count ?? 0);
  if (issues > 0) {
    // Use human-readable flag labels from health object if available; fall back to raw flag keys.
    const tooltip = health?.flagLabels?.length
      ? health.flagLabels.join(" | ")
      : ws.issue_flags ? Object.keys(ws.issue_flags).join(", ") : "";
    chips.push(`<span class="ws-chip ws-chip-issue" title="${esc(tooltip)}">⚠ ${issues}</span>`);
  }
  if (!chips.length) return "";
  return `<div class="ws-chips">${chips.join("")}</div>`;
}

// ── Est Profit Helpers (Phase 6) ──────────────────────────────
function epCls(marginPct) {
  if (marginPct == null) return "ep-na";
  if (marginPct < 0)    return "ep-neg";
  if (marginPct < 10)   return "ep-warn";
  if (marginPct < 20)   return "ep-low";
  return "ep-ok";
}

function rowEstProfitHtml(p) {
  if (!p.ebay_price_cents) return '<span class="ep-badge ep-na">—</span>';
  const est = buildEstimate({
    priceCents:   p.ebay_price_cents,
    kkPriceCents: p.price     ? Math.round(Number(p.price) * 100) : null,
    unitCostUsd:  p.unit_cost != null ? Number(p.unit_cost) : null,
    weightG:      p.weight_g  ?? null,
    labelWeightG: p.weight_g  ?? null,   // product weight used as proxy for packaged weight
    adRatePct:    pageAdRatePct,
  });
  if (est.netProfitCents !== null) {
    const sign    = est.netProfitCents >= 0 ? "+" : "";
    const cls     = epCls(est.marginPct);
    const value   = `${sign}$${(Math.abs(est.netProfitCents) / 100).toFixed(2)}`;
    const pctTxt  = est.marginPct !== null ? `${est.marginPct}%` : "";
    const partial = est.complete ? "" : "*";
    const tipBase = `Est. net profit${pageAdRatePct > 0 ? ` (incl. ${pageAdRatePct}% promo ad rate)` : ""}`;
    const tip     = est.complete ? tipBase : `${tipBase} — *partial (label unknown)`;
    return `<span class="ep-badge ep-${cls}" title="${esc(tip)}">~${value}${partial}${pctTxt ? `<br><span class="ep-pct">${pctTxt}</span>` : ""}</span>`;
  }
  if (!p.unit_cost) {
    return '<span class="ep-badge ep-na" title="Set unit cost on product to enable estimate">no cost</span>';
  }
  return '<span class="ep-badge ep-na">—</span>';
}

// ── Load Products ─────────────────────────────────────────────
async function loadProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, slug, price, weight_g, unit_cost, catalog_image_url, catalog_hover_url, primary_image_url, is_active, ebay_sku, ebay_offer_id, ebay_listing_id, ebay_status, ebay_category_id, ebay_price_cents, ebay_item_group_key, ebay_volume_promo_id, ebay_store_category, product_gallery_images(url, position, is_active), product_variants(id, option_name, option_value, stock, preview_image_url, sort_order, is_active)")
    .order("code");

  if (error) {
    showStatus("Failed to load products: " + error.message, true);
    return;
  }

  allProducts = await mergeWorkspaceMetrics(data || []);
  applyFilters();
  updateStats();
  auditListingLinks(allProducts);
}

// ── Search / Filter / View ────────────────────────────────────
function applyFilters() {
  const query     = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
  const statusVal = document.getElementById("statusFilter")?.value || "";
  const quickVal  = document.getElementById("quickFilter")?.value || "";

  filteredProducts = allProducts.filter(p => {
    if (query) {
      const haystack = `${p.name} ${p.code} ${p.ebay_sku || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (statusVal) {
      const pStatus = p.ebay_status || "not_listed";
      if (pStatus !== statusVal) return false;
    }
    if (quickVal === "needs_work") {
      if (!p._ws || (p._ws.issue_count ?? 0) === 0) return false;
    } else if (quickVal === "no_sales_30d") {
      const st = p.ebay_status || "not_listed";
      if (st !== "active") return false;
      if (p._ws && (p._ws.sold_qty_30d ?? 0) > 0) return false;
    } else if (quickVal === "has_promo") {
      if (!p.ebay_volume_promo_id) return false;
    } else if (quickVal === "low_score") {
      const h = computeHealth(p);
      if (h.score === null || h.score >= 60) return false;
    } else if (quickVal === "draft_stalled") {
      if (p.ebay_status !== "draft" || p.ebay_offer_id) return false;
    } else if (quickVal === "missing_basics") {
      const basicFlags = ["missing_category", "missing_ebay_price", "missing_listing_id"];
      const wsFlags    = p._ws?.issue_flags || {};
      const hasMissing = basicFlags.some(f => !!wsFlags[f]);
      if (!hasMissing) return false;
    }
    return true;
  });

  document.getElementById("countLabel").textContent =
    `${filteredProducts.length} item${filteredProducts.length !== 1 ? "s" : ""}`;
  renderAll();
}

function renderAll() {
  if (currentView === "cards") {
    document.getElementById("tableSection").classList.add("hidden");
    document.getElementById("cardSection").classList.remove("hidden");
    renderCards();
  } else {
    document.getElementById("tableSection").classList.remove("hidden");
    document.getElementById("cardSection").classList.add("hidden");
    renderTable();
  }
}

function setView(view) {
  currentView = view;
  document.querySelectorAll(".view-toggle-btn").forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.className = `view-toggle-btn px-2 py-1 text-xs font-bold ${isActive ? "bg-black text-white" : "bg-white text-black"}`;
  });
  renderAll();
}

// ── Render Table ──────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById("productsBody");
  if (!filteredProducts.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-400">No products found</td></tr>';
    return;
  }

  tbody.innerHTML = filteredProducts.map(p => {
    const kkPrice   = p.price             ? `$${Number(p.price).toFixed(2)}`            : "—";
    const ebayPrice = p.ebay_price_cents  ? `$${(p.ebay_price_cents / 100).toFixed(2)}` : "—";
    const status      = p.ebay_status || "not_listed";
    const statusLabel = { active: "Active", draft: "Draft", ended: "Ended", not_listed: "Not Listed" }[status] || status;
    const isListed    = status === "active" || status === "draft";

    const health      = computeHealth(p);
    const scoreBadge  = health.score !== null
      ? `<span class="health-badge health-${health.severity}" title="${esc(health.primaryLabel ? `${health.primaryLabel} — ${health.actionLabel}` : 'No issues found')}">${health.score}</span>`
      : "";

    return `<tr class="product-row border-b border-gray-100">
      <td class="py-2 pr-2">
        ${isListed ? `<input type="checkbox" class="bulk-check accent-kkpink" data-code="${esc(p.code)}" data-offer="${esc(p.ebay_offer_id || '')}" data-sku="${esc(p.ebay_sku || p.code)}" />` : ""}
      </td>
      <td class="py-2 pr-3">
        <div class="flex items-start gap-2">
          ${p.catalog_image_url ? `<img src="${p.catalog_image_url}" class="w-8 h-8 object-cover rounded flex-shrink-0" />` : '<div class="w-8 h-8 bg-gray-100 rounded flex-shrink-0"></div>'}
          <div class="min-w-0">
            <a href="/pages/admin/products.html?q=${encodeURIComponent(p.name)}" target="_blank" class="font-medium text-sm line-clamp-1 text-blue-600 hover:underline">${esc(p.name)}</a>
            <div class="text-[10px] font-mono text-gray-400 leading-none mt-0.5">${ebayCodeLinkHtml(p)}</div>
            ${wsChips(p, health)}
          </div>
        </div>
      </td>
      <td class="py-2 pr-3 text-xs">${kkPrice}</td>
      <td class="py-2 pr-3 text-xs">${ebayPrice}</td>
      <td class="py-2 pr-3 text-xs">${rowEstProfitHtml(p)}</td>
      <td class="py-2 pr-3">
        <div class="flex flex-col items-start gap-0.5">
          <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ebay-${status}">${statusLabel}</span>
          ${scoreBadge}
        </div>
      </td>
      <td class="py-2">
        <div class="flex gap-1">
          ${status === "not_listed"
            ? `<button onclick="openPush('${esc(p.code)}')" class="bg-black text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-kkpink hover:text-black transition-all">Push</button>`
            : ""}
          ${status === "active"
            ? `<button onclick="openEdit('${esc(p.code)}')" class="bg-blue-600 text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-blue-700 transition-all">Edit</button>
               <button onclick="doWithdraw('${esc(p.code)}', '${esc(p.ebay_offer_id)}', '${esc(p.ebay_item_group_key)}')" class="border border-red-300 text-red-600 px-2 py-1 rounded text-[10px] font-bold hover:bg-red-50 transition-all">End</button>`
            : ""}
          ${status === "draft"
            ? `<button onclick="openEdit('${esc(p.code)}')" class="bg-blue-600 text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-blue-700 transition-all">Edit</button>
               ${p.ebay_offer_id
                 ? `<button onclick="doPublish('${esc(p.code)}', '${esc(p.ebay_offer_id)}', '${esc(p.ebay_item_group_key)}')" class="bg-green-600 text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-green-700 transition-all">Publish</button>`
                 : `<button onclick="openPush('${esc(p.code)}')" class="bg-black text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-kkpink hover:text-black transition-all">Resume Push</button>`}`
            : ""}
          ${status === "ended"
            ? `<button onclick="openPush('${esc(p.code)}')" class="bg-black text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-kkpink hover:text-black transition-all">Re-list</button>`
            : ""}
          ${status !== "not_listed"
            ? `<button class="border border-gray-200 text-gray-400 px-1.5 py-1 rounded text-[10px] hover:bg-gray-100 hover:text-black transition-all" data-action="open-sales" data-code="${esc(p.code)}" title="Sales history">📊</button>`
            : ""}
        </div>
      </td>
    </tr>`;
  }).join("");

  updateBulkBar();
}

// ── Render Cards ──────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById("cardsGrid");
  if (!filteredProducts.length) {
    grid.innerHTML = '<p class="col-span-full text-center text-gray-400 py-8">No products found</p>';
    return;
  }

  grid.innerHTML = filteredProducts.map(p => {
    const kkPrice   = p.price            ? `$${Number(p.price).toFixed(2)}`            : "—";
    const ebayPrice = p.ebay_price_cents ? `$${(p.ebay_price_cents / 100).toFixed(2)}` : "—";
    const status      = p.ebay_status || "not_listed";
    const statusLabel = { active: "Active", draft: "Draft", ended: "Ended", not_listed: "Not Listed" }[status] || status;

    const health     = computeHealth(p);
    const scoreBadge = health.score !== null
      ? `<span class="health-badge health-${health.severity}" title="${esc(health.primaryLabel ? `${health.primaryLabel} — ${health.actionLabel}` : 'No issues found')}">${health.score}</span>`
      : "";

    let actions = "";
    if (status === "not_listed") {
      actions = `<button onclick="openPush('${esc(p.code)}')" class="flex-1 bg-black text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-kkpink hover:text-black transition-all">Push</button>`;
    } else if (status === "active") {
      actions = `<button onclick="openEdit('${esc(p.code)}')" class="flex-1 bg-blue-600 text-white px-2 py-1.5 rounded text-xs font-bold">Edit</button>
                 <button onclick="doWithdraw('${esc(p.code)}', '${esc(p.ebay_offer_id)}', '${esc(p.ebay_item_group_key)}')" class="flex-1 border border-red-300 text-red-600 px-2 py-1.5 rounded text-xs font-bold">End</button>`;
    } else if (status === "draft") {
      actions = `<button onclick="openEdit('${esc(p.code)}')" class="flex-1 bg-blue-600 text-white px-2 py-1.5 rounded text-xs font-bold">Edit</button>
                 ${p.ebay_offer_id
                   ? `<button onclick="doPublish('${esc(p.code)}', '${esc(p.ebay_offer_id)}', '${esc(p.ebay_item_group_key)}')" class="flex-1 bg-green-600 text-white px-2 py-1.5 rounded text-xs font-bold">Publish</button>`
                   : `<button onclick="openPush('${esc(p.code)}')" class="flex-1 bg-black text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-kkpink hover:text-black transition-all">Resume Push</button>`}`;
    } else if (status === "ended") {
      actions = `<button onclick="openPush('${esc(p.code)}')" class="flex-1 bg-black text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-kkpink hover:text-black transition-all">Re-list</button>`;
    }

    return `<div class="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      <div class="aspect-square bg-gray-50">
        ${p.catalog_image_url ? `<img src="${p.catalog_image_url}" class="w-full h-full object-cover" />` : '<div class="w-full h-full flex items-center justify-center text-gray-300 text-3xl">📦</div>'}
      </div>
      <div class="p-3">
        <a href="/pages/admin/products.html?q=${encodeURIComponent(p.name)}" target="_blank" class="font-bold text-sm line-clamp-2 leading-tight text-blue-600 hover:underline">${esc(p.name)}</a>
        <p class="text-[10px] font-mono text-gray-400 mt-1">${ebayCodeLinkHtml(p, true)}</p>
        <div class="flex items-center justify-between mt-2">
          <div class="text-xs">
            <span class="text-gray-500">KK</span> <span class="font-bold">${kkPrice}</span>
            <span class="text-gray-300 mx-1">|</span>
            <span class="text-gray-500">eBay</span> <span class="font-bold">${ebayPrice}</span>
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ebay-${status}">${statusLabel}</span>
            ${scoreBadge}
          </div>
        </div>
        <div class="flex items-center justify-between mt-1.5">
          <span class="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">Est Profit</span>
          ${rowEstProfitHtml(p)}
        </div>
        ${wsChips(p, health)}
        <div class="flex gap-1 mt-3">${actions}</div>
        ${status !== "not_listed"
          ? `<button class="w-full mt-1 border border-gray-100 text-gray-400 py-1 rounded text-[9px] font-semibold hover:bg-gray-50 hover:text-black transition-all" data-action="open-sales" data-code="${esc(p.code)}">📊 Sales History</button>`
          : ""}
      </div>
    </div>`;
  }).join("");
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
  document.getElementById("statTotal").textContent    = allProducts.length;
  document.getElementById("statActive").textContent   = allProducts.filter(p => p.ebay_status === "active").length;
  document.getElementById("statDraft").textContent    = allProducts.filter(p => p.ebay_status === "draft").length;
  document.getElementById("statNotListed").textContent = allProducts.filter(p => !p.ebay_status || p.ebay_status === "not_listed").length;
}

// ── Bulk Selection ────────────────────────────────────────────
function getSelectedItems() {
  return [...document.querySelectorAll(".bulk-check:checked")].map(cb => ({
    code:    cb.dataset.code,
    offerId: cb.dataset.offer,
    sku:     cb.dataset.sku,
  }));
}

function updateBulkBar() {
  const selected = getSelectedItems();
  const bar      = document.getElementById("bulkBar");
  if (selected.length > 0) {
    bar.classList.remove("hidden");
    bar.classList.add("flex");
    document.getElementById("bulkCount").textContent = `${selected.length} selected`;
  } else {
    bar.classList.add("hidden");
    bar.classList.remove("flex");
  }
}

// ── Enable/disable step buttons ───────────────────────────────
function enableBtn(id, enabled) {
  const btn = document.getElementById(id);
  btn.disabled = !enabled;
  if (enabled) {
    btn.classList.remove("border-gray-300", "bg-gray-100", "text-gray-400");
    btn.classList.add("border-black", "bg-black", "text-white", "hover:bg-kkpink", "hover:border-kkpink", "hover:text-black");
  } else {
    btn.classList.add("border-gray-300", "bg-gray-100", "text-gray-400");
    btn.classList.remove("border-black", "bg-black", "text-white", "hover:bg-kkpink", "hover:border-kkpink", "hover:text-black");
  }
}

// ── Variant Panel ─────────────────────────────────────────────
function imageOptionLabel(url, idx) {
  let file = (url || "").split("/").pop()?.split("?")[0] || `Image ${idx + 1}`;
  try { file = decodeURIComponent(file); } catch (_) {}
  return file.length > 34 ? `${file.slice(0, 31)}...` : file;
}

function renderVariantAssignedImages(container, urls) {
  container.innerHTML = urls.length
    ? urls.map((url, i) => `
      <div class="relative w-14 h-14 rounded border-2 ${i === 0 ? "border-kkpink" : "border-gray-200"} overflow-hidden flex-shrink-0" data-assigned-url="${esc(url)}">
        <img src="${esc(url)}" alt="" class="w-full h-full object-cover" />
        ${i === 0 ? `<span class="absolute left-0 bottom-0 bg-kkpink text-black text-[8px] font-black px-1">Main</span>` : `<button type="button" class="absolute left-0 bottom-0 bg-white/90 text-[8px] font-bold px-1" data-set-main-url="${esc(url)}">Main</button>`}
        <button type="button" class="absolute -top-1 -right-1 bg-black text-white rounded-full w-4 h-4 text-[10px] leading-4" data-remove-assigned-url="${esc(url)}">×</button>
      </div>`).join("")
    : `<div class="text-[10px] text-gray-400 border border-dashed border-gray-300 rounded px-2 py-3">No variant images assigned</div>`;
}

function getAssignedVariantImages(row) {
  if (!row) return [];
  return [...row.querySelectorAll("[data-assigned-url]")].map(el => el.dataset.assignedUrl).filter(Boolean);
}

function setAssignedVariantImages(row, urls) {
  const container = row.querySelector("[data-variant-assigned-images]");
  if (container) renderVariantAssignedImages(container, [...new Set(urls.filter(Boolean))].slice(0, 24));
}

function renderVariantCandidatePicker(urls) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return `<div class="text-[10px] text-gray-400 border border-dashed border-gray-200 rounded px-2 py-3">No candidate images available</div>`;
  return `
    <div class="grid grid-cols-2 gap-1" data-variant-candidate-list>
      ${unique.map((url, i) => `
        <button type="button" data-add-candidate-url="${esc(url)}" class="variant-candidate flex items-center gap-2 text-left border border-gray-200 rounded p-1 bg-white hover:border-kkpink hover:bg-pink-50 transition-colors">
          <img src="${esc(url)}" alt="" loading="lazy" class="w-9 h-9 rounded object-cover border border-gray-100 flex-shrink-0" />
          <span class="text-[9px] leading-tight text-gray-600 truncate">${esc(imageOptionLabel(url, i))}</span>
        </button>`).join("")}
    </div>
    <div data-no-variant-candidates class="hidden text-[10px] text-gray-400 border border-dashed border-gray-200 rounded px-2 py-3">All candidate images are already assigned.</div>`;
}

function refreshVariantCandidateButtons(row) {
  const assigned = new Set(getAssignedVariantImages(row));
  const buttons = [...row.querySelectorAll("[data-add-candidate-url]")];
  let visible = 0;
  buttons.forEach(btn => {
    const isAssigned = assigned.has(btn.dataset.addCandidateUrl);
    btn.classList.toggle("hidden", isAssigned);
    if (!isAssigned) visible++;
  });
  row.querySelector("[data-no-variant-candidates]")?.classList.toggle("hidden", visible !== 0);
}

function wireVariantImageSetControls(row, onChange) {
  row.addEventListener("click", (e) => {
    const toggle = e.target?.closest?.("[data-toggle-variant-picker]");
    if (toggle) {
      row.querySelector("[data-variant-picker]")?.classList.toggle("hidden");
      return;
    }
    const candidate = e.target?.closest?.("[data-add-candidate-url]");
    if (candidate) {
      setAssignedVariantImages(row, [...getAssignedVariantImages(row), candidate.dataset.addCandidateUrl]);
      row.querySelector("[data-variant-picker]")?.classList.add("hidden");
      refreshVariantCandidateButtons(row);
      onChange?.(getAssignedVariantImages(row));
      return;
    }
    const removeUrl = e.target?.dataset?.removeAssignedUrl;
    const mainUrl = e.target?.dataset?.setMainUrl;
    if (!removeUrl && !mainUrl) return;
    const urls = getAssignedVariantImages(row);
    if (removeUrl) setAssignedVariantImages(row, urls.filter(u => u !== removeUrl));
    if (mainUrl) setAssignedVariantImages(row, [mainUrl, ...urls.filter(u => u !== mainUrl)]);
    refreshVariantCandidateButtons(row);
    onChange?.(getAssignedVariantImages(row));
  });
  refreshVariantCandidateButtons(row);
}

function renderVariantPanel(variants, baseCode) {
  const list = document.getElementById("variantList");
  const availableImages = buildImageUrls(currentProduct);
  list.innerHTML = variants.map((v, i) => {
    const suffix  = v.option_value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
    const sku     = `${baseCode}-${suffix}`;
    const qty     = v.stock ?? 0;
    const oosNote = qty === 0 ? `<span class="text-[9px] text-orange-500 font-semibold ml-1">OOS</span>` : "";
    const assignedImages = v.preview_image_url ? [v.preview_image_url] : [];
    const candidatePicker = renderVariantCandidatePicker([...availableImages, ...assignedImages]);
    return `<div class="p-2 rounded-lg border border-gray-200 bg-gray-50">
      <div class="flex items-center gap-2">
        <input type="checkbox" class="variant-check accent-pink-500" data-idx="${i}" checked />
      <div class="flex-1 min-w-0">
        <div class="text-xs font-bold truncate">${esc(v.option_value)}${oosNote}</div>
        <div class="text-[10px] text-gray-400 font-mono">${esc(sku)}</div>
      </div>
      <input type="number" class="variant-qty w-14 border border-gray-300 rounded px-1 py-0.5 text-xs text-center" value="${qty}" min="0" data-idx="${i}" />
      <span class="text-[10px] text-gray-400">qty</span>
      </div>
      <div class="mt-2">
        <div class="text-[9px] text-gray-500 uppercase font-bold mb-1">Images assigned to ${esc(v.option_value)}</div>
        <div class="flex flex-wrap gap-1 mb-2" data-variant-assigned-images data-idx="${i}"></div>
        <button type="button" class="text-[10px] font-bold text-blue-600 hover:text-kkpink" data-toggle-variant-picker>+ Add image</button>
        <div class="hidden mt-2 rounded border border-gray-200 bg-white p-2" data-variant-picker>${candidatePicker}</div>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-variant-assigned-images]").forEach(container => {
    const variant = variants[Number(container.dataset.idx)];
    renderVariantAssignedImages(container, variant?.preview_image_url ? [variant.preview_image_url] : []);
  });
  [...list.children].forEach(row => {
    wireVariantImageSetControls(row);
  });

  document.getElementById("variantCount").textContent      = variants.length;
  document.getElementById("variantSkuPattern").textContent = `${baseCode}-{COLOR}`;
}

function getCheckedVariants() {
  const checks = document.querySelectorAll(".variant-check");
  const qtys   = document.querySelectorAll(".variant-qty");
  const rows   = document.querySelectorAll("#variantList > div");
  const result = [];
  checks.forEach((cb, i) => {
    if (cb.checked && pushVariants[i]) {
      const v      = pushVariants[i];
      const suffix = v.option_value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
      const rawQty = parseInt(qtys[i]?.value, 10);
      const qty    = Number.isFinite(rawQty) && rawQty >= 0 ? rawQty : 0;
      result.push({ ...v, sku: `${currentProduct.code}-${suffix}`, quantity: qty, variant_image_urls: getAssignedVariantImages(rows[i]) });
    }
  });
  return result;
}

function publishQuantityForProduct(product) {
  const variants = (product?.product_variants || []).filter(v => v.is_active);
  const variantStock = variants.reduce((sum, v) => sum + (parseInt(v.stock, 10) || 0), 0);
  return variantStock > 0 ? variantStock : 1;
}

// ── AI Badge ──────────────────────────────────────────────────
function addAiBadge(inputId, source) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const label = input.closest("div")?.querySelector("label");
  if (!label) return;
  const existing = label.querySelector(".ai-badge");
  if (existing) existing.remove();
  const badge    = document.createElement("span");
  badge.className = `ai-badge ai-badge-${source}`;
  badge.textContent = source === "generated" ? "AI" : source === "from_data" ? "From data" : source;
  label.appendChild(badge);
}

// ── Category / Aspects (Push Modal) ──────────────────────────
async function fetchAspects(categoryId) {
  const section      = document.getElementById("aspectsSection");
  const reqContainer = document.getElementById("aspectsRequired");
  const optContainer = document.getElementById("aspectsOptional");
  const loading      = document.getElementById("aspectsLoading");

  section.classList.remove("hidden");
  loading.classList.remove("hidden");
  reqContainer.innerHTML = "";
  optContainer.innerHTML = "";
  currentAspects = [];

  try {
    const result = await callEdge("ebay-taxonomy", { action: "get_aspects", categoryId });
    if (!result.success || !result.aspects?.length) {
      loading.textContent = "No item specifics found for this category";
      return;
    }

    currentAspects = result.aspects;
    const defaults  = { Brand: "Unbranded", Condition: "New" };
    const required  = result.aspects.filter(a => a.required);
    const optional  = result.aspects.filter(a => !a.required).slice(0, 15);

    required.forEach(a => reqContainer.appendChild(buildAspectField(a, defaults, true)));
    optional.forEach(a => optContainer.appendChild(buildAspectField(a, defaults, false)));
    loading.classList.add("hidden");
  } catch (e) {
    loading.textContent = "Failed to load item specifics: " + e.message;
  }
}

function buildAspectField(aspect, defaults, isRequired) {
  const div    = document.createElement("div");
  const listId = `dl_${aspect.name.replace(/\W/g, "_")}`;
  const defaultVal = defaults[aspect.name] || "";
  const label  = isRequired ? `${aspect.name} <span class="text-red-500">*</span>` : aspect.name;

  div.innerHTML = `
    <label class="block text-[10px] font-bold uppercase tracking-wider ${isRequired ? "text-black" : "text-gray-500"} mb-0.5">${label}</label>
    <input type="text" data-aspect="${esc(aspect.name)}" data-required="${isRequired}"
      value="${esc(defaultVal)}" list="${listId}"
      class="w-full border-2 ${isRequired ? "border-black" : "border-gray-300"} px-2 py-1.5 text-xs outline-none focus:border-kkpink transition-colors" />
    ${aspect.values?.length
      ? `<datalist id="${listId}">${aspect.values.slice(0, 30).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`
      : ""}
  `;
  return div;
}

function collectAspects() {
  const aspects = {};
  document.querySelectorAll("[data-aspect]").forEach(input => {
    const val = input.value.trim();
    if (val) aspects[input.dataset.aspect] = [val];
  });
  return aspects;
}

function validateRequiredAspects() {
  const missing = [];
  document.querySelectorAll("[data-aspect][data-required='true']").forEach(input => {
    if (!input.value.trim()) missing.push(input.dataset.aspect);
  });
  return missing;
}

// ── Push Modal ────────────────────────────────────────────────
window.openPush = async function openPush(code) {
  currentProduct = allProducts.find(p => p.code === code);
  if (!currentProduct) return;

  document.getElementById("modalProductName").textContent = currentProduct.name;
  document.getElementById("modalProductCode").textContent = currentProduct.code;
  document.getElementById("modalSku").value      = currentProduct.ebay_sku || currentProduct.code;
  document.getElementById("modalTitle").value    = currentProduct.name;
  document.getElementById("modalPrice").value    = currentProduct.price ? Number(currentProduct.price).toFixed(2) : "";
  document.getElementById("modalQuantity").value = "1";
  document.getElementById("modalCondition").value = "NEW";
  document.getElementById("modalLotEnabled").checked = false;
  document.getElementById("modalLotFields").classList.add("hidden");
  document.getElementById("modalLotSize").value = "2";
  document.getElementById("modalVolEnabled").checked = false;
  document.getElementById("modalVolFields").classList.add("hidden");
  document.getElementById("modalVolTiers").innerHTML = "";
  document.getElementById("modalCatSearch").value = currentProduct.name;
  document.getElementById("modalCatSelect").classList.add("hidden");
  document.getElementById("modalCatSelected").classList.add("hidden");
  document.getElementById("modalStatus").textContent = "";

  // Init Quill (destroy previous if exists)
  resetQuillEditorMount("modalDescriptionEditor");
  const editorEl = document.getElementById("modalDescriptionEditor");
  pushQuill = new Quill(editorEl, { theme: "snow", modules: { toolbar: quillToolbar } });

  // Reset description mode
  descState.pushMode = "visual";
  document.getElementById("modalDescriptionHtml").value = "";
  document.getElementById("modalDescriptionHtml").classList.add("hidden");
  document.getElementById("modalDescriptionPreview").classList.add("hidden");
  document.getElementById("btnPushVisual").classList.add("active");
  document.getElementById("btnPushHtml").classList.remove("active");
  document.getElementById("btnPushPreview").classList.remove("active");

  // Build image strip
  pushImageUrls = buildImageUrls(currentProduct);
  renderImageStrip("modalImageStrip", pushImageUrls, pushImageUrls);
  document.getElementById("modalImagePicker").classList.add("hidden");

  // Reset aspects
  currentAspects = [];
  document.getElementById("aspectsSection").classList.add("hidden");
  document.getElementById("aspectsRequired").innerHTML = "";
  document.getElementById("aspectsOptional").innerHTML = "";

  // Auto-fill weight (grams → ounces)
  document.getElementById("modalWeightOz").value =
    currentProduct.weight_g ? (currentProduct.weight_g / 28.3495).toFixed(1) : "4";

  // Detect variants
  const activeVariants = (currentProduct.product_variants || []).filter(v => v.is_active);
  pushVariants     = activeVariants;
  isVariantListing = activeVariants.length > 1;

  if (isVariantListing) {
    document.getElementById("variantPanel").classList.remove("hidden");
    renderVariantPanel(activeVariants, currentProduct.code);
    document.getElementById("btnCreateItem").textContent  = "1. Create Items";
    document.getElementById("btnCreateOffer").textContent = "2. Create Group + Offer";
    // eBay does not allow Best Offer on group (variant) listings
    document.getElementById("modalBestOffer").checked = false;
    document.getElementById("modalBestOfferFields").classList.add("hidden");
    document.getElementById("modalBestOffer").closest("div").classList.add("hidden");
  } else {
    document.getElementById("variantPanel").classList.add("hidden");
    document.getElementById("variantProgress").classList.add("hidden");
    pushVariants     = [];
    isVariantListing = false;
    document.getElementById("btnCreateItem").textContent  = "1. Create Item";
    document.getElementById("btnCreateOffer").textContent = "2. Create Offer";
    document.getElementById("modalBestOffer").closest("div").classList.remove("hidden");
  }

  enableBtn("btnCreateItem",  true);
  enableBtn("btnCreateOffer", false);
  enableBtn("btnPublish",     false);

  document.getElementById("pushModal").classList.remove("hidden");

  // ── Resume draft: pre-load existing eBay item data ──────────
  const isResumableDraft = currentProduct.ebay_status === "draft"
    && currentProduct.ebay_sku
    && !currentProduct.ebay_offer_id;

  if (isResumableDraft) {
    showStatus("Loading your previous draft from eBay…");
    try {
      const itemResult = await callEdge("ebay-manage-listing", { action: "get_item", sku: currentProduct.ebay_sku });
      if (itemResult.success && itemResult.item) {
        const ebayItem = itemResult.item;
        const prod     = ebayItem.product || {};

        if (prod.title) document.getElementById("modalTitle").value = prod.title;

        if (prod.description) {
          if (isComplexHtml(prod.description)) {
            document.getElementById("modalDescriptionHtml").value = prod.description;
            descState.pushMode = "html";
            toggleDescMode("html", "modal", pushQuill);
          } else {
            pushQuill.root.innerHTML = prod.description;
          }
        }

        if (ebayItem.condition) document.getElementById("modalCondition").value = ebayItem.condition;
        const qty = ebayItem.availability?.shipToLocationAvailability?.quantity;
        if (qty !== undefined) document.getElementById("modalQuantity").value = qty;

        const pkg = ebayItem.packageWeightAndSize || {};
        if (pkg.weight?.value) document.getElementById("modalWeightOz").value = pkg.weight.value;

        if (prod.imageUrls?.length) {
          pushImageUrls = [...prod.imageUrls];
          renderImageStrip("modalImageStrip", pushImageUrls, pushImageUrls);
        }

        const btn1 = document.getElementById("btnCreateItem");
        btn1.textContent = "✓ Item Created";
        btn1.disabled    = true;
        btn1.classList.add("border-gray-300", "bg-gray-100", "text-gray-400");
        btn1.classList.remove("border-black", "bg-black", "text-white", "hover:bg-kkpink", "hover:border-kkpink", "hover:text-black");
        enableBtn("btnCreateOffer", true);

        showStatus("📋 Draft resumed — your previous data has been loaded. Continue from Step 2.");
      } else {
        showStatus("Could not load previous draft — starting from Step 1.", true);
      }
    } catch (e) {
      console.warn("Resume draft pre-load failed:", e.message);
      showStatus("Could not load previous draft — starting from Step 1.", true);
    }
  }

  document.getElementById("modalAdRate").value = String(pageAdRatePct);
  refreshPushPreview();
  pushSalesMetrics = null;
  loadAndRenderPriceRef("modalPriceRef", currentProduct, "push");
};

// ── Edit Modal ────────────────────────────────────────────────
window.openEdit = async function openEdit(code) {
  editProduct = allProducts.find(p => p.code === code);
  if (!editProduct) return;

  const isGroupListing = !!editProduct.ebay_item_group_key;

  document.getElementById("editModal").classList.remove("hidden");
  document.getElementById("editLoading").classList.remove("hidden");
  document.getElementById("editForm").classList.add("hidden");
  document.getElementById("editStatus").textContent = "";
  renderEditLinkWarning(null);
  document.getElementById("editPriceQtyGrid").classList.toggle("grid-cols-1", isGroupListing);
  document.getElementById("editPriceQtyGrid").classList.toggle("grid-cols-2", !isGroupListing);
  document.getElementById("editQuantityField").classList.toggle("hidden", isGroupListing);
  document.getElementById("editQuantity").disabled = isGroupListing;
  document.getElementById("editVariantQtyNote").classList.toggle("hidden", !isGroupListing);
  editOfferLookupCache = new Map();
  editVariantImageOverrides = {};
  editVariantQtyOverrides   = {};
  document.getElementById("editVariantImagesSection").classList.add("hidden");
  document.getElementById("editVariantImagesList").innerHTML = "";

  document.getElementById("editProductName").textContent = editProduct.name;
  document.getElementById("editProductCode").textContent = editProduct.code + (isGroupListing ? " (Multi-Variant)" : "");

  let variantFetchSummary = null;

  const ebayLink = document.getElementById("editEbayLink");
  if (editProduct.ebay_listing_id) {
    ebayLink.href = `https://www.ebay.com/itm/${editProduct.ebay_listing_id}`;
    ebayLink.textContent = "View on eBay ↗";
    ebayLink.classList.remove("hidden");
  } else {
    ebayLink.classList.add("hidden");
  }

  try {
    try {
      const linkCheck = await reconcileEbayLink(editProduct, false);
      renderEditLinkWarning(linkCheck);
      if (isStaleLinkCheck(linkCheck)) {
        const activeId = currentActiveListingId(linkCheck);
        if (activeId) {
          ebayLink.href = `https://www.ebay.com/itm/${activeId}`;
          ebayLink.textContent = "View active match ↗";
          ebayLink.classList.remove("hidden");
        } else {
          ebayLink.classList.add("hidden");
        }
        document.getElementById("editStatus").textContent = "⚠️ Local eBay link may be stale. Refresh/relink before editing.";
      }
    } catch (linkErr) {
      console.warn("Edit link reconciliation failed:", linkErr);
      document.getElementById("editStatus").textContent = "⚠️ Could not verify eBay link freshness. Save will re-check before writing.";
    }

    let product = {};
    let item    = {};
    let offer   = {};

    if (isGroupListing) {
      const groupResult = await callEdge("ebay-manage-listing", {
        action: "get_item_group",
        inventoryItemGroupKey: editProduct.ebay_item_group_key,
      });
      if (!groupResult.success) throw new Error(groupResult.error || "Failed to fetch item group");

      const group = groupResult.itemGroup;
      product = {
        title:       group.title || "",
        description: group.description || "",
        imageUrls:   group.imageUrls || [],
        aspects:     group.aspects || {},
      };
      editProduct._groupData = group;
      editProduct._isGroup   = true;

      const firstVariantSku = group.variantSKUs?.[0];
      if (firstVariantSku) {
        const [offersResult, variantItemResult] = await Promise.all([
          getOffersForEdit(firstVariantSku, "open"),
          getItemForEdit(firstVariantSku),
        ]);
        offer = (offersResult.offers || [])[0] || {};
        if (variantItemResult.success) item = variantItemResult.item;
      }
      if (!offer.pricingSummary?.price?.value && editProduct.ebay_price_cents) {
        offer.pricingSummary = { price: { value: (editProduct.ebay_price_cents / 100).toFixed(2) } };
      }
    } else {
      const sku = editProduct.ebay_sku || editProduct.code;
      const [itemResult, offerResult] = await Promise.all([
        callEdge("ebay-manage-listing", { action: "get_item", sku }),
        editProduct.ebay_offer_id
          ? getOffersForEdit(sku, "open")
          : Promise.resolve({ success: true, offers: [] }),
      ]);

      if (!itemResult.success) throw new Error(itemResult.error || "Failed to fetch item");
      item    = itemResult.item;
      product = item.product || {};
      editProduct._isGroup = false;
      offer = (offerResult.offers || []).find(o => o.offerId === editProduct.ebay_offer_id) || {};
    }

    // Pre-fill fields
    document.getElementById("editTitle").value    = product.title || editProduct.name;
    document.getElementById("editCondition").value = item.condition || "NEW";
    document.getElementById("editQuantity").value  = item.availability?.shipToLocationAvailability?.quantity ?? 1;

    const existingLotSize = item.lotSize || 0;
    document.getElementById("editLotEnabled").checked = existingLotSize > 1;
    document.getElementById("editLotFields").classList.toggle("hidden", existingLotSize <= 1);
    document.getElementById("editLotSize").value = existingLotSize > 1 ? existingLotSize : 2;

    // Init Quill for edit (destroy previous)
    resetQuillEditorMount("editDescriptionEditor");
    const editEditorEl = document.getElementById("editDescriptionEditor");
    editQuill = new Quill(editEditorEl, { theme: "snow", modules: { toolbar: quillToolbar } });

    const existingDesc = product.description || "";
    document.getElementById("editDescriptionPreview").classList.add("hidden");
    document.getElementById("btnEditPreview").classList.remove("active");
    if (existingDesc && isComplexHtml(existingDesc)) {
      descState.editMode = "html";
      document.getElementById("editDescriptionHtml").value = existingDesc;
      document.getElementById("editDescriptionHtml").classList.remove("hidden");
      editEditorEl.style.display = "none";
      const tb = editEditorEl.previousElementSibling;
      if (tb?.classList?.contains("ql-toolbar")) tb.style.display = "none";
      document.getElementById("btnEditVisual").classList.remove("active");
      document.getElementById("btnEditHtml").classList.add("active");
    } else {
      if (existingDesc) editQuill.root.innerHTML = existingDesc;
      descState.editMode = "visual";
      document.getElementById("editDescriptionHtml").value = "";
      document.getElementById("editDescriptionHtml").classList.add("hidden");
      document.getElementById("btnEditVisual").classList.add("active");
      document.getElementById("btnEditHtml").classList.remove("active");
    }

    // Build edit image strip
    const ebayImages = product.imageUrls || [];
    editImageUrls = ebayImages.length ? [...ebayImages] : buildImageUrls(editProduct);
    renderImageStrip("editImageStrip", editImageUrls, editImageUrls);

    if (isGroupListing) {
      variantFetchSummary = await renderEditVariantImageControls(editProduct, editProduct._groupData);
    }

    const offerPrice = offer.pricingSummary?.price?.value;
    document.getElementById("editPrice").value = offerPrice
      ? parseFloat(offerPrice).toFixed(2)
      : editProduct.ebay_price_cents
        ? (editProduct.ebay_price_cents / 100).toFixed(2)
        : Number(editProduct.price).toFixed(2);

    const pkg = item.packageWeightAndSize || {};
    if (pkg.weight) {
      document.getElementById("editWeightOz").value = pkg.weight.value || "";
    } else if (editProduct.weight_g) {
      document.getElementById("editWeightOz").value = (editProduct.weight_g / 28.3495).toFixed(1);
    }
    if (pkg.dimensions) {
      document.getElementById("editDimL").value = pkg.dimensions.length || "";
      document.getElementById("editDimW").value = pkg.dimensions.width  || "";
      document.getElementById("editDimH").value = pkg.dimensions.height || "";
    }

    // Policy dropdowns
    await loadPoliciesCache();
    const lp = offer.listingPolicies || {};
    if (lp.fulfillmentPolicyId) document.getElementById("editFulfillmentPolicy").value = lp.fulfillmentPolicyId;
    if (lp.returnPolicyId)      document.getElementById("editReturnPolicy").value      = lp.returnPolicyId;
    if (lp.paymentPolicyId)     document.getElementById("editPaymentPolicy").value     = lp.paymentPolicyId;

    // Best Offer — not permitted on group (variant) listings
    const bot = lp.bestOfferTerms || {};
    if (isGroupListing) {
      document.getElementById("editBestOffer").checked = false;
      document.getElementById("editBestOfferFields").classList.add("hidden");
      document.getElementById("editBestOffer").closest("div").classList.add("hidden");
    } else {
      document.getElementById("editBestOffer").closest("div").classList.remove("hidden");
      document.getElementById("editBestOffer").checked = !!bot.bestOfferEnabled;
      document.getElementById("editBestOfferFields").classList.toggle("hidden", !bot.bestOfferEnabled);
      document.getElementById("editAutoAccept").value  = bot.autoAcceptPrice?.value  || "";
      document.getElementById("editAutoDecline").value = bot.autoDeclinePrice?.value || "";
    }

    // Store Category — local DB first, eBay GET as fallback
    const storeCats = offer.storeCategoryNames || [];
    document.getElementById("editStoreCategory").value = editProduct.ebay_store_category || storeCats[0] || "";

    // Volume Pricing
    const volPromoId = editProduct.ebay_volume_promo_id;
    if (volPromoId) {
      try {
        const promoResult = await callEdge("ebay-manage-listing", { action: "get_volume_discount", promotionId: volPromoId });
        if (promoResult.success && promoResult.promotion?.discountRules?.length) {
          document.getElementById("editVolEnabled").checked = true;
          document.getElementById("editVolFields").classList.remove("hidden");
          setVolTiers("edit", promoResult.promotion.discountRules);
          editProduct._volPromoId = volPromoId;
        } else {
          document.getElementById("editVolEnabled").checked = false;
          document.getElementById("editVolFields").classList.add("hidden");
          document.getElementById("editVolTiers").innerHTML = "";
        }
      } catch (ve) {
        console.warn("Volume pricing fetch failed:", ve);
        document.getElementById("editVolEnabled").checked = false;
        document.getElementById("editVolFields").classList.add("hidden");
        document.getElementById("editVolTiers").innerHTML = "";
      }
    } else {
      document.getElementById("editVolEnabled").checked = false;
      document.getElementById("editVolFields").classList.add("hidden");
      document.getElementById("editVolTiers").innerHTML = "";
    }

    // Aspects
    const categoryId       = editProduct.ebay_category_id || offer.categoryId || item.categoryId || "";
    document.getElementById("editCategoryId").value = categoryId || "";
    const existingAspects  = product.aspects || {};
    const reqContainer     = document.getElementById("editAspectsRequired");
    const optContainer     = document.getElementById("editAspectsOptional");
    reqContainer.innerHTML = "";
    optContainer.innerHTML = "";
    editAspects = [];

    if (categoryId) {
      const aspectResult = await callEdge("ebay-taxonomy", { action: "get_aspects", categoryId });
      if (aspectResult.success && aspectResult.aspects?.length) {
        editAspects     = aspectResult.aspects;
        const required  = aspectResult.aspects.filter(a => a.required);
        const optional  = aspectResult.aspects.filter(a => !a.required).slice(0, 15);

        const defaults = {};
        for (const [key, val] of Object.entries(existingAspects)) {
          defaults[key] = Array.isArray(val) ? val[0] : val;
        }
        if (isGroupListing && !defaults.Color) {
          const colorSpec = editProduct._groupData?.variesBy?.specifications?.find(s => s?.name === "Color");
          if (colorSpec?.values?.length) defaults.Color = colorSpec.values.join(", ");
        }

        required.forEach(a => reqContainer.appendChild(buildEditAspectField(a, defaults, true)));
        optional.forEach(a => optContainer.appendChild(buildEditAspectField(a, defaults, false)));
      }
    } else if (!editProduct.ebay_offer_id) {
      document.getElementById("editStatus").textContent = "⚠️ This draft has no category/offer yet. Use Resume Push from the list to choose a category and create the offer.";
    }

    document.getElementById("editLoading").classList.add("hidden");
    document.getElementById("editForm").classList.remove("hidden");
    const offerLookupFailures = [...editOfferLookupCache.values()].filter(r => !r.success);
    if (isStaleLinkCheck(editProduct._linkCheck)) {
      document.getElementById("editStatus").textContent = "⚠️ Local eBay link may be stale. Refresh/relink before editing.";
    } else if (offerLookupFailures.length) {
      document.getElementById("editStatus").textContent = "⚠️ eBay offer details could not be loaded for part of this listing. The modal remains usable, but offer updates may need a refresh/relink if this persists.";
    } else if (variantFetchSummary?.failures?.length) {
      document.getElementById("editStatus").textContent = `⚠️ ${variantFetchSummary.failures.length} variant eBay detail lookup(s) failed. Fallback image/qty controls are shown where available; you can still edit and save.`;
    }
    document.getElementById("editAdRate").value = String(pageAdRatePct);
    refreshEditPreview();
    editSalesMetrics = null;
    loadAndRenderPriceRef("editPriceRef", editProduct, "edit");
  } catch (e) {
    document.getElementById("editLoading").textContent = "❌ " + e.message;
  }
};

function buildEditAspectField(aspect, defaults, isRequired) {
  const div    = document.createElement("div");
  const listId = `edl_${aspect.name.replace(/\W/g, "_")}`;
  const defaultVal = defaults[aspect.name] || "";
  const label  = isRequired ? `${aspect.name} <span class="text-red-500">*</span>` : aspect.name;

  div.innerHTML = `
    <label class="block text-[10px] font-bold uppercase tracking-wider ${isRequired ? "text-black" : "text-gray-500"} mb-0.5">${label}</label>
    <input type="text" data-edit-aspect="${esc(aspect.name)}" data-required="${isRequired}"
      value="${esc(defaultVal)}" list="${listId}"
      class="w-full border-2 ${isRequired ? "border-black" : "border-gray-300"} px-2 py-1.5 text-xs outline-none focus:border-kkpink transition-colors" />
    ${aspect.values?.length
      ? `<datalist id="${listId}">${aspect.values.slice(0, 30).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`
      : ""}
  `;
  return div;
}

// ── Variant Image Controls (Edit Modal) ───────────────────────
async function renderEditVariantImageControls(product, group) {
  const section   = document.getElementById("editVariantImagesSection");
  const list      = document.getElementById("editVariantImagesList");
  list.innerHTML  = "";

  const variantSKUs = group?.variantSKUs || [];
  if (!variantSKUs.length) { section.classList.add("hidden"); return; }

  const variants = (product.product_variants || []).filter(v => v.is_active);
  const bySku    = new Map();
  variants.forEach(v => {
    const sku = variantSkuFromOption(product.code, v.option_value);
    bySku.set(sku, v);
  });

  const rows = await Promise.all(variantSKUs.map(async (sku) => {
    const local       = bySku.get(sku);
    let currentImages = local?.preview_image_url ? [local.preview_image_url] : [];
    let currentQty = 0;
    const r = await getItemForEdit(sku);
    if (r.success) {
      currentImages = r.item?.product?.imageUrls?.length ? [...r.item.product.imageUrls] : currentImages;
      currentQty  = r.item?.availability?.shipToLocationAvailability?.quantity ?? 0;
    }
    editVariantImageOverrides[sku] = currentImages;
    editVariantQtyOverrides[sku]   = currentQty;
    return { sku, label: local?.option_value || sku, images: currentImages, qty: currentQty, failed: !r.success, retried: !!r.retried, error: r.error || "eBay item lookup failed" };
  }));

  const failures = rows.filter(r => r.failed);
  if (failures.length) {
    const warning = document.createElement("div");
    warning.className = "text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2";
    warning.textContent = `${failures.length} variant detail lookup(s) failed; fallback controls are shown for: ${failures.map(f => f.sku).join(", ")}`;
    list.appendChild(warning);
  }

  rows.forEach(r => {
    const row = document.createElement("div");
    row.className   = "mb-3";
    const assignedImages = [...new Set((r.images || []).filter(Boolean))];
    const candidateImages = [...new Set([...editImageUrls, ...assignedImages].filter(Boolean))];
    const candidatePicker = renderVariantCandidatePicker(candidateImages);

    row.innerHTML = `
      <div class="flex items-center gap-3 mb-1">
        <span class="text-[10px] font-bold text-gray-700">${esc(r.label)}</span>
        ${assignedImages.length ? `<span class="text-[9px] text-green-700 bg-green-50 border border-green-200 rounded px-1">${assignedImages.length} variant image${assignedImages.length === 1 ? "" : "s"}</span>` : `<span class="text-[9px] text-gray-500 bg-gray-100 border border-gray-200 rounded px-1">no variant images assigned</span>`}
        ${r.failed ? `<span class="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1" title="${esc(r.error)}">fallback${r.retried ? " after retry" : ""}</span>` : ""}
        <label class="flex items-center gap-1 ml-auto">
          <span class="text-[9px] text-gray-500 uppercase font-bold">Qty</span>
          <input type="number" min="0" value="${r.qty}"
            data-var-qty-sku="${esc(r.sku)}"
            class="w-14 border-2 border-gray-300 rounded px-1 py-0.5 text-xs text-center focus:border-kkpink outline-none" />
        </label>
      </div>
      <div class="text-[9px] text-gray-500 mb-1">Images assigned to this variant. First image is the eBay main image for this variant.</div>
      <div class="flex flex-wrap gap-1 mb-2" data-variant-assigned-images></div>
      <button type="button" class="text-[10px] font-bold text-blue-600 hover:text-kkpink" data-toggle-variant-picker>+ Add image</button>
      <div class="hidden mt-2 rounded border border-gray-200 bg-white p-2" data-variant-picker>${candidatePicker}</div>`;

    setAssignedVariantImages(row, assignedImages);
    wireVariantImageSetControls(row, (urls) => { editVariantImageOverrides[r.sku] = urls; });
    row.querySelectorAll("[data-var-qty-sku]").forEach(input => {
      input.addEventListener("change", () => {
        editVariantQtyOverrides[input.dataset.varQtySku] = parseInt(input.value) || 0;
      });
    });
    list.appendChild(row);
  });

  section.classList.remove("hidden");
  return { rows, failures };
}

// ── Withdraw / Publish (from table) ──────────────────────────
window.doWithdraw = async function doWithdraw(code, offerId, itemGroupKey) {
  if (!confirm(`End eBay listing for ${code}?`)) return;
  showStatus("Withdrawing…");
  try {
    const hasGroup = itemGroupKey && String(itemGroupKey).trim();
    const hasOffer = offerId && String(offerId).trim();
    if (!hasGroup && !hasOffer) {
      showStatus("❌ Cannot end listing: missing offer ID/group key", true);
      return;
    }
    const result = hasGroup
      ? await callEdge("ebay-manage-listing", { action: "withdraw_group", inventoryItemGroupKey: String(itemGroupKey).trim(), sku: code })
      : await callEdge("ebay-manage-listing", { action: "withdraw", offerId: String(offerId).trim(), sku: code });
    if (result.success) { showStatus("✅ Listing ended"); loadProducts(); }
    else showStatus("❌ " + (result.error || "Withdraw failed"), true);
  } catch (e) { showStatus("❌ " + e.message, true); }
};

window.doPublish = async function doPublish(code, offerId, itemGroupKey) {
  showStatus("Publishing…");
  try {
    const hasGroup = itemGroupKey && String(itemGroupKey).trim();
    const product = allProducts.find(p => p.code === code);
    const variantQuantities = Object.fromEntries((product?.product_variants || [])
      .filter(v => v.is_active && (parseInt(v.stock, 10) || 0) > 0)
      .map(v => {
        const suffix = v.option_value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
        return [`${code}-${suffix}`, parseInt(v.stock, 10) || 0];
      }));
    variantQuantities[code] = publishQuantityForProduct(product);
    const result   = hasGroup
      ? await callEdge("ebay-manage-listing", { action: "publish_group", inventoryItemGroupKey: String(itemGroupKey).trim(), sku: code, variantQuantities })
      : await callEdge("ebay-manage-listing", { action: "publish", offerId, sku: code, quantity: publishQuantityForProduct(product) });
    if (result.success) {
      showStatus(`✅ Published! Listing ID: ${result.listingId}`);
      loadProducts();
    } else {
      showStatus("❌ " + (result.error || "Publish failed"), true);
    }
  } catch (e) { showStatus("❌ " + e.message, true); }
};

// ── Migrate / Import ──────────────────────────────────────────
function renderMigrateResults(items) {
  const panel = document.getElementById("migrateResults");
  const tbody = document.getElementById("migrateBody");
  if (!items.length) { panel.classList.add("hidden"); return; }
  tbody.innerHTML = items.map(item => `
    <tr class="border-b border-gray-100">
      <td class="py-1 pr-2 font-mono">${esc(item.sku)}</td>
      <td class="py-1 pr-2">${esc(item.title)}</td>
      <td class="py-1 pr-2">${item.quantity ?? "—"}</td>
      <td class="py-1 ${item.matchedCode || item.code ? "text-green-600 font-bold" : "text-red-400"}">${esc(item.matchedCode || item.code || "—")}</td>
    </tr>
  `).join("");
  panel.classList.remove("hidden");
}

// ── Profit Preview Helpers (Phase 2) ───────────────────────────────────────

function refreshPushPreview() {
  if (!currentProduct) return;
  const priceVal  = parseFloat(document.getElementById("modalPrice")?.value);
  const ozVal     = parseFloat(document.getElementById("modalWeightOz")?.value);
  const pushAdRate = parseInt(document.getElementById("modalAdRate")?.value ?? "0", 10) || 0;
  renderPreview("modalProfitPreview", buildEstimate({
    priceCents:   isNaN(priceVal) ? null : Math.round(priceVal * 100),
    kkPriceCents: currentProduct.price      ? Math.round(Number(currentProduct.price) * 100) : null,
    unitCostUsd:  currentProduct.unit_cost != null ? Number(currentProduct.unit_cost) : null,
    weightG:      currentProduct.weight_g  ?? null,
    labelWeightG: isNaN(ozVal) ? null : Math.round(ozVal * 28.3495),
    adRatePct:    pushAdRate,
  }));
}

function refreshEditPreview() {
  if (!editProduct) return;
  const priceVal   = parseFloat(document.getElementById("editPrice")?.value);
  const ozVal      = parseFloat(document.getElementById("editWeightOz")?.value);
  const editAdRate = parseInt(document.getElementById("editAdRate")?.value ?? "0", 10) || 0;
  renderPreview("editProfitPreview", buildEstimate({
    priceCents:   isNaN(priceVal) ? null : Math.round(priceVal * 100),
    kkPriceCents: editProduct.price      ? Math.round(Number(editProduct.price) * 100) : null,
    unitCostUsd:  editProduct.unit_cost != null ? Number(editProduct.unit_cost) : null,
    weightG:      editProduct.weight_g  ?? null,
    labelWeightG: isNaN(ozVal) ? null : Math.round(ozVal * 28.3495),
    adRatePct:    editAdRate,
  }));
}

// ── Price Reference Helpers (Phase 5) ─────────────────────────────────────────

/** Re-render push modal price reference using the current price input value. */
function refreshPushRef() {
  if (!currentProduct) return;
  const priceVal = parseFloat(document.getElementById("modalPrice")?.value);
  const ref = buildPriceRef(
    currentProduct,
    pushSalesMetrics,
    isNaN(priceVal) ? null : Math.round(priceVal * 100),
  );
  // loading=true only while metrics are still being fetched (pushSalesMetrics===null)
  renderPriceRef("modalPriceRef", ref, pushSalesMetrics === null);
}

/** Re-render edit modal price reference using the current price input value. */
function refreshEditRef() {
  if (!editProduct) return;
  const priceVal = parseFloat(document.getElementById("editPrice")?.value);
  const ref = buildPriceRef(
    editProduct,
    editSalesMetrics,
    isNaN(priceVal) ? null : Math.round(priceVal * 100),
  );
  renderPriceRef("editPriceRef", ref, editSalesMetrics === null);
}

/**
 * Load sales metrics async, then re-render the price reference panel.
 * Renders immediately with loading=true, then again with full data once fetched.
 *
 * @param {string} containerId — 'modalPriceRef' or 'editPriceRef'
 * @param {object} product     — the product being opened
 * @param {string} type        — 'push' or 'edit'
 */
async function loadAndRenderPriceRef(containerId, product, type) {
  // Initial render — instant data only, loading=true for async range
  const priceInput = document.getElementById(type === "push" ? "modalPrice" : "editPrice");
  const priceVal0  = parseFloat(priceInput?.value);
  const initRef    = buildPriceRef(
    product,
    null,
    isNaN(priceVal0) ? null : Math.round(priceVal0 * 100),
  );
  renderPriceRef(containerId, initRef, true);

  // Async fetch min/max from v_ebay_product_recent_sales
  const metrics = await fetchSalesMetrics(product.code);
  if (type === "push") pushSalesMetrics = metrics;
  else                  editSalesMetrics = metrics;

  // Guard: only update if the same product is still open
  const stillActive = type === "push"
    ? currentProduct?.code === product.code
    : editProduct?.code    === product.code;
  if (!stillActive) return;

  const priceVal = parseFloat(priceInput?.value);
  const fullRef  = buildPriceRef(
    product,
    metrics,
    isNaN(priceVal) ? null : Math.round(priceVal * 100),
  );
  renderPriceRef(containerId, fullRef, false);
}

// ── Event Listeners ────────────────────────────────────────────

// Search
document.getElementById("searchInput").addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(applyFilters, 250);
  document.getElementById("searchClear").classList.toggle("hidden", !document.getElementById("searchInput").value);
});
document.getElementById("searchClear").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  document.getElementById("searchClear").classList.add("hidden");
  applyFilters();
});
document.getElementById("statusFilter").addEventListener("change", applyFilters);
document.getElementById("quickFilter").addEventListener("change", applyFilters);
document.getElementById("adRateFilter").addEventListener("change", e => {
  pageAdRatePct = parseInt(e.target.value, 10) || 0;
  renderAll();
});

// View toggle
document.querySelectorAll(".view-toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

// Push Modal — close
document.getElementById("btnCloseModal").addEventListener("click", () => {
  document.getElementById("pushModal").classList.add("hidden");
  document.getElementById("modalImagePicker").classList.add("hidden");
  currentProduct = null;
});

// Push Modal — profit preview + price reference live update
document.getElementById("modalPrice").addEventListener("input", refreshPushPreview);
document.getElementById("modalPrice").addEventListener("input", refreshPushRef);
document.getElementById("modalWeightOz").addEventListener("input", refreshPushPreview);

// Push Modal — Add image
document.getElementById("btnAddImgPush").addEventListener("click", () => {
  if (!currentProduct) return;
  showGalleryPicker("modalImagePicker", "modalImageStrip", pushImageUrls, currentProduct);
});

// Push Modal — Description mode
document.getElementById("btnPushVisual").addEventListener("click", () => {
  descState.pushMode = "visual";
  toggleDescMode("visual", "modal", pushQuill);
});
document.getElementById("btnPushHtml").addEventListener("click", () => {
  descState.pushMode = "html";
  toggleDescMode("html", "modal", pushQuill);
});
document.getElementById("btnPushPreview").addEventListener("click", () => {
  toggleDescMode("preview", "modal", pushQuill);
});

// Push Modal — Category Search
document.getElementById("btnSearchCat").addEventListener("click", async () => {
  const query = document.getElementById("modalCatSearch").value.trim();
  if (!query) return;
  const btn = document.getElementById("btnSearchCat");
  btn.disabled = true; btn.textContent = "...";
  try {
    const result = await callEdge("ebay-taxonomy", { action: "suggest_category", query });
    const sel    = document.getElementById("modalCatSelect");
    if (result.suggestions?.length) {
      sel.innerHTML = result.suggestions.map(s =>
        `<option value="${s.categoryId}">${esc(s.categoryName)} (${s.categoryId})</option>`
      ).join("");
      sel.classList.remove("hidden");
      sel.onchange = () => {
        const opt = sel.options[sel.selectedIndex];
        document.getElementById("modalCatSelected").textContent = `✓ ${opt.text}`;
        document.getElementById("modalCatSelected").classList.remove("hidden");
        fetchAspects(opt.value);
      };
      sel.selectedIndex = 0;
      sel.dispatchEvent(new Event("change"));
    } else {
      sel.innerHTML = '<option>No categories found</option>';
      sel.classList.remove("hidden");
    }
  } catch (e) {
    document.getElementById("modalStatus").textContent = "Category search failed: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Search";
  }
});

// Push Modal — AI Auto-Fill
document.getElementById("btnAiFill").addEventListener("click", async () => {
  if (!currentProduct) return;
  const btn      = document.getElementById("btnAiFill");
  const statusEl = document.getElementById("aiFillStatus");
  btn.disabled   = true;
  btn.innerHTML  = '<span class="animate-pulse">✨ Generating...</span>';
  statusEl.textContent = "Analyzing product images and generating listing...";
  statusEl.classList.remove("hidden");

  try {
    const existingAspects = currentAspects.map(a => a.name);
    let categoryName = document.getElementById("modalStoreCategory")?.value || "";
    if (!categoryName) {
      const catMap = { headwear: "Headwear", jewelry: "Jewelry", bags: "Bags", accessories: "Accessories", plushies: "Plushies", lego: "Lego" };
      for (const [key, val] of Object.entries(catMap)) {
        if (currentProduct.name?.toLowerCase().includes(key) || currentProduct.code?.toLowerCase().startsWith(key.substring(0, 2).toUpperCase())) {
          categoryName = val; break;
        }
      }
    }

    const result = await callEdge("ebay-ai-autofill", {
      productName: currentProduct.name,
      productCode: currentProduct.code,
      category:    categoryName,
      price:       currentProduct.price ? Number(currentProduct.price) : undefined,
      imageUrls:   pushImageUrls.slice(0, 4),
      existingAspects,
    });

    if (!result.success) {
      statusEl.textContent = "AI fill failed: " + (result.error || "Unknown error");
      statusEl.className   = "text-[10px] text-red-500 text-center";
      return;
    }

    const ai = result.data;
    if (ai.title?.value) {
      document.getElementById("modalTitle").value = ai.title.value;
      addAiBadge("modalTitle", ai.title.source || "generated");
    }
    if (ai.description_html?.value) {
      descState.pushMode = "html";
      document.getElementById("modalDescriptionHtml").value = ai.description_html.value;
      toggleDescMode("html", "modal", pushQuill);
      addAiBadge("modalDescriptionHtml", ai.description_html.source || "generated");
    }
    if (ai.item_specifics?.length && currentAspects.length) {
      for (const spec of ai.item_specifics) {
        const input = document.querySelector(`[data-aspect="${spec.name}"]`);
        if (input && spec.value) {
          input.value = spec.value;
          const badge = document.createElement("span");
          badge.className = `ai-badge ai-badge-${spec.source || "inferred"}`;
          badge.textContent = spec.source === "default" ? "Default" : spec.source === "from_data" ? "From data" : "AI";
          const existing = input.parentElement.querySelector(".ai-badge");
          if (existing) existing.remove();
          input.parentElement.appendChild(badge);
        }
      }
    }

    const notes = ai.notes || [];
    if (notes.length) {
      statusEl.innerHTML  = "✅ AI filled fields. Notes:<br>" + notes.map(n => `• ${esc(n)}`).join("<br>");
      statusEl.className  = "text-[10px] text-amber-600 text-center";
    } else {
      statusEl.textContent = "✅ AI auto-fill complete — review fields before proceeding.";
      statusEl.className   = "text-[10px] text-green-600 text-center";
    }
  } catch (e) {
    statusEl.textContent = "AI fill error: " + e.message;
    statusEl.className   = "text-[10px] text-red-500 text-center";
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<span>✨</span> AI Auto-Fill';
  }
});

// Push Modal — Step 1: Create Item(s)
document.getElementById("btnCreateItem").addEventListener("click", async () => {
  const btn        = document.getElementById("btnCreateItem");
  const status     = document.getElementById("modalStatus");
  const progressEl = document.getElementById("variantProgress");
  btn.disabled = true; btn.textContent = "Creating...";

  const sku       = document.getElementById("modalSku").value.trim();
  const title     = document.getElementById("modalTitle").value.trim();
  const rawHtml   = getDescriptionHtml("modal", pushQuill);
  const description = descState.pushMode === "html" ? sanitizeForEbay(rawHtml) : wrapDescription(title, rawHtml);
  const condition = document.getElementById("modalCondition").value;
  const quantity  = parseInt(document.getElementById("modalQuantity").value) || 1;
  const lotSize   = document.getElementById("modalLotEnabled").checked ? (parseInt(document.getElementById("modalLotSize").value) || 0) : 0;

  if (!sku || !title) {
    status.textContent = "❌ SKU and title required";
    btn.disabled = false; btn.textContent = isVariantListing ? "1. Create Items" : "1. Create Item";
    return;
  }

  const missingAspects = validateRequiredAspects();
  if (missingAspects.length) {
    status.textContent = `❌ Required item specifics missing: ${missingAspects.join(", ")}`;
    btn.disabled = false; btn.textContent = isVariantListing ? "1. Create Items" : "1. Create Item";
    return;
  }

  const aspects   = collectAspects();
  const imageUrls = [...pushImageUrls];

  try {
    if (isVariantListing) {
      const checked = getCheckedVariants();
      if (!checked.length) {
        status.textContent = "❌ Select at least one variant";
        btn.disabled = false; btn.textContent = "1. Create Items";
        return;
      }

      const generatedSkus = checked.map(v => v.sku);
      const uniqueSkus    = new Set(generatedSkus);
      if (uniqueSkus.size !== generatedSkus.length) {
        const dupes = [...new Set(generatedSkus.filter((s, i) => generatedSkus.indexOf(s) !== i))];
        status.textContent = `❌ SKU collision: ${dupes.join(", ")} — rename variant options so the first 6 letters/digits are unique`;
        btn.disabled = false; btn.textContent = "1. Create Items";
        return;
      }

      progressEl.classList.remove("hidden");
      let created       = 0;
      const errors      = [];
      const createdSkus = [];
      // Include all checked variants — even qty=0 (out of stock).
      // They'll be created on eBay with qty 0 and can be restocked via Edit later.
      const validVariants = checked;
      const hasAnyStock   = checked.some(v => v.quantity > 0);

      if (!validVariants.length) {
        status.textContent = "❌ Select at least one variant";
        btn.disabled = false; btn.textContent = "1. Create Items";
        return;
      }
      if (!hasAnyStock) {
        status.textContent = "❌ At least one variant must have quantity > 0 to publish";
        btn.disabled = false; btn.textContent = "1. Create Items";
        return;
      }

      for (const v of validVariants) {
        progressEl.textContent = `Creating ${v.option_value} (${v.sku})... (${created + 1}/${validVariants.length})`;
        const variantAspects = { ...aspects, Color: [v.option_value] };
        const variantImages = [...new Set((v.variant_image_urls || []).filter(Boolean))];

        const variantProduct = { title, description, condition, quantity: v.quantity, imageUrls: variantImages.slice(0, 24), aspects: variantAspects };
        if (lotSize > 1) variantProduct.lotSize = lotSize;

        const result = await callEdge("ebay-manage-listing", {
          action:               "create_item",
          sku:                  v.sku,
          product:              variantProduct,
          packageWeightAndSize: buildPackageWeightAndSize("modal"),
        });

        if (result.success) { created++; createdSkus.push(v.sku); }
        else errors.push(`${v.option_value}: ${result.error || "Failed"}`);
      }

      currentProduct._createdVariantSKUs = createdSkus;

      if (created === validVariants.length && !errors.length) {
        status.textContent   = `✅ ${created} variant items created — now create group + offer`;
        progressEl.textContent = `All ${created} items created ✓`;
        enableBtn("btnCreateItem",  false);
        enableBtn("btnCreateOffer", true);
      } else if (created > 0) {
        status.textContent = `⚠️ ${created}/${validVariants.length} created. Errors: ${errors.join("; ")}. You can still proceed.`;
        enableBtn("btnCreateItem",  false);
        enableBtn("btnCreateOffer", true);
      } else {
        status.textContent = `❌ No items created. Errors: ${errors.join("; ")}`;
      }
    } else {
      const productPayload = { title, description, condition, quantity, imageUrls, aspects };
      if (lotSize > 1) productPayload.lotSize = lotSize;

      const result = await callEdge("ebay-manage-listing", {
        action:               "create_item",
        sku,
        product:              productPayload,
        packageWeightAndSize: buildPackageWeightAndSize("modal"),
      });

      if (result.success) {
        status.textContent = "✅ Inventory item created — now create an offer";
        enableBtn("btnCreateItem",  false);
        enableBtn("btnCreateOffer", true);
      } else {
        status.textContent = "❌ " + (result.error || "Create failed");
      }
    }
  } catch (e) {
    status.textContent = "❌ Error: " + e.message;
  } finally {
    btn.disabled    = false;
    btn.textContent = isVariantListing ? "1. Create Items" : "1. Create Item";
  }
});

// Push Modal — Step 2: Create Offer (or Group + Offer)
document.getElementById("btnCreateOffer").addEventListener("click", async () => {
  const btn        = document.getElementById("btnCreateOffer");
  const status     = document.getElementById("modalStatus");
  const progressEl = document.getElementById("variantProgress");
  btn.disabled = true; btn.textContent = "Creating...";

  const sku        = document.getElementById("modalSku").value.trim();
  const categoryId = document.getElementById("modalCatSelect")?.value;
  const price      = parseFloat(document.getElementById("modalPrice").value) || 0;
  const quantity   = parseInt(document.getElementById("modalQuantity").value) || 1;

  if (!categoryId || categoryId === "No categories found") {
    status.textContent = "❌ Select a category first";
    btn.disabled = false; btn.textContent = isVariantListing ? "2. Create Group + Offer" : "2. Create Offer";
    return;
  }

  try {
    const checked       = getCheckedVariants();
    // Always use all active checked SKUs — some may already exist on eBay from a prior run,
    // and create_group_offer handles 25002 (already exists) gracefully.
    const publishableVariants = checked.filter(v => v.quantity > 0);
    const allActiveSkus = publishableVariants.map(v => v.sku);
    const effectiveSkus = allActiveSkus;

    if (isVariantListing && allActiveSkus.length < 2) {
      if (allActiveSkus.length === 0) {
        status.textContent = "❌ No valid items to create an offer for — check quantities";
        btn.disabled = false; btn.textContent = "2. Create Offer";
        return;
      }
      const variantItem = publishableVariants.find(v => v.sku === allActiveSkus[0]) || publishableVariants[0];
      const vSku        = variantItem.sku;
      const vQty        = variantItem.quantity;
      const storeCat    = document.getElementById("modalStoreCategory").value;
      const result      = await callEdge("ebay-manage-listing", {
        action:           "create_offer",
        sku:              vSku,
        categoryId,
        priceCents:       Math.round(price * 100),
        quantity:         vQty,
        policies:         getSelectedPolicies("modal"),
        bestOfferTerms:   getBestOfferTerms("modal"),
        storeCategoryNames: storeCat ? [storeCat] : [],
      });
      if (result.success) {
        status.textContent = `✅ Offer created (${result.offerId}) — ready to publish`;
        currentProduct._offerId = result.offerId;
        enableBtn("btnCreateOffer", false);
        enableBtn("btnPublish",     true);
      } else {
        status.textContent = "❌ " + (result.error || "Offer creation failed");
      }
      btn.disabled = false; btn.textContent = "2. Create Offer";
      return;
    }

    if (isVariantListing) {
      const groupKey    = `${currentProduct.code}-GROUP`;
      const title       = document.getElementById("modalTitle").value.trim();
      const rawHtml     = getDescriptionHtml("modal", pushQuill);
      const description = descState.pushMode === "html" ? sanitizeForEbay(rawHtml) : wrapDescription(title, rawHtml);
      const aspects     = collectAspects();
      delete aspects.Color;

      // Always use all active checked SKUs — some may already exist on eBay from a prior run,
      // and create_group_offer handles 25002 (already exists) gracefully.
      const variantSKUs = allActiveSkus;
      if (!variantSKUs.length) {
        status.textContent = "❌ No active variants found — complete step 1 first";
        btn.disabled = false; btn.textContent = "2. Create Group + Offer";
        return;
      }
      const colorValues = publishableVariants.filter(v => variantSKUs.includes(v.sku)).map(v => v.option_value);
      const variesBy        = { aspectsImageVariesBy: ["Color"], specifications: [{ name: "Color", values: colorValues }] };

      progressEl.textContent = "Creating inventory item group...";
      const groupResult = await callEdge("ebay-manage-listing", {
        action:               "create_item_group",
        inventoryItemGroupKey: groupKey,
        title, description,
        imageUrls:            [...pushImageUrls].slice(0, 24),
        aspects, variantSKUs, variesBy,
        baseProductCode:      currentProduct.code,
      });

      if (!groupResult.success) {
        status.textContent = "❌ Group creation failed: " + (groupResult.error || "Unknown");
        btn.disabled = false; btn.textContent = "2. Create Group + Offer";
        return;
      }

      progressEl.textContent = "Group created ✓ — Creating offer...";
      const storeCat    = document.getElementById("modalStoreCategory").value;
      const variantQuantities = Object.fromEntries(publishableVariants.map(v => [v.sku, v.quantity]));
      const offerResult = await callEdge("ebay-manage-listing", {
        action:               "create_group_offer",
        inventoryItemGroupKey: groupKey,
        variantSKUs, categoryId,
        variantQuantities,
        priceCents:           Math.round(price * 100),
        policies:             getSelectedPolicies("modal"),
        bestOfferTerms:       getBestOfferTerms("modal"),
        storeCategoryNames:   storeCat ? [storeCat] : [],
        baseProductCode:      currentProduct.code,
      });

      if (offerResult.success) {
        status.textContent     = `✅ Group + Offers created (${offerResult.count || 0} variants) — ready to publish`;
        progressEl.textContent = `Group "${groupKey}" + ${offerResult.count || 0} offers created ✓`;
        currentProduct._groupKey      = groupKey;
        currentProduct._groupOfferIds = offerResult.offerIds || [];
        enableBtn("btnCreateOffer", false);
        enableBtn("btnPublish",     true);
      } else {
        status.textContent = "❌ Offer creation failed: " + (offerResult.error || "Unknown");
      }
    } else {
      const storeCat = document.getElementById("modalStoreCategory").value;
      const result   = await callEdge("ebay-manage-listing", {
        action:           "create_offer",
        sku, categoryId,
        priceCents:       Math.round(price * 100),
        quantity,
        policies:         getSelectedPolicies("modal"),
        bestOfferTerms:   getBestOfferTerms("modal"),
        storeCategoryNames: storeCat ? [storeCat] : [],
      });
      if (result.success) {
        status.textContent = `✅ Offer created (${result.offerId}) — ready to publish`;
        currentProduct._offerId = result.offerId;
        enableBtn("btnCreateOffer", false);
        enableBtn("btnPublish",     true);
      } else {
        status.textContent = "❌ " + (result.error || "Offer creation failed");
      }
    }
  } catch (e) {
    status.textContent = "❌ Error: " + e.message;
  } finally {
    btn.disabled    = false;
    btn.textContent = isVariantListing ? "2. Create Group + Offer" : "2. Create Offer";
  }
});

// Push Modal — Step 3: Publish
document.getElementById("btnPublish").addEventListener("click", async () => {
  const btn    = document.getElementById("btnPublish");
  const status = document.getElementById("modalStatus");
  btn.disabled = true; btn.textContent = "Publishing...";

  const sku      = document.getElementById("modalSku").value.trim();
  const offerId  = currentProduct._offerId || currentProduct.ebay_offer_id;
  const groupKey = currentProduct._groupKey || currentProduct.ebay_item_group_key || `${currentProduct.code}-GROUP`;
  const checked = getCheckedVariants().filter(v => v.quantity > 0);
  const variantQuantities = Object.fromEntries(checked.map(v => [v.sku, v.quantity]));
  variantQuantities[currentProduct.code] = checked.reduce((sum, v) => sum + v.quantity, 0) || (parseInt(document.getElementById("modalQuantity").value, 10) || 1);

  if (!isVariantListing && !offerId) {
    status.textContent = "❌ No offer ID";
    btn.disabled = false; btn.textContent = "3. Publish";
    return;
  }

  try {
    const categoryId = document.getElementById("modalCatSelect")?.value || "";
  const price       = parseFloat(document.getElementById("modalPrice").value) || 0;
  const priceCents  = Math.round(price * 100);

  const result = isVariantListing
      ? await callEdge("ebay-manage-listing", { action: "publish_group", inventoryItemGroupKey: groupKey, sku: currentProduct.code, categoryId, priceCents, variantQuantities })
      : await callEdge("ebay-manage-listing", { action: "publish", offerId, sku, categoryId, priceCents, quantity: parseInt(document.getElementById("modalQuantity").value, 10) || 1 });

    if (result.success) {
      status.textContent = `✅ Published! Listing ID: ${result.listingId}`;
      enableBtn("btnPublish", false);

      if (document.getElementById("modalVolEnabled").checked) {
        const volTiers = getVolTiers("modal");
        if (volTiers.length && result.listingId) {
          try {
            status.textContent += " — Creating volume discount...";
            const volResult = await callEdge("ebay-manage-listing", {
              action: "create_volume_discount",
              listingId:   result.listingId,
              tiers:       volTiers,
              productCode: currentProduct.code,
            });
            if (volResult.success) {
              status.textContent = `✅ Published + Volume pricing set! Listing ID: ${result.listingId}`;
              setTimeout(() => { document.getElementById("pushModal").classList.add("hidden"); loadProducts(); }, 1500);
            } else {
              status.textContent = `✅ Published (Listing ${result.listingId}) — ⚠️ Volume pricing failed: ${volResult.error || JSON.stringify(volResult)} (close manually when done)`;
            }
          } catch (ve) {
            status.textContent = `✅ Published (Listing ${result.listingId}) — ⚠️ Volume pricing error: ${ve.message} (close manually when done)`;
          }
          return;
        }
      }

      setTimeout(() => { document.getElementById("pushModal").classList.add("hidden"); loadProducts(); }, 1500);
    } else {
      status.textContent = "❌ " + (result.error || "Publish failed");
    }
  } catch (e) {
    status.textContent = "❌ Error: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "3. Publish";
  }
});

// Edit Modal — close
document.getElementById("btnCloseEdit").addEventListener("click", () => {
  document.getElementById("editModal").classList.add("hidden");
  document.getElementById("editImagePicker").classList.add("hidden");
  editProduct = null;
});

document.getElementById("btnEditRelink").addEventListener("click", async () => {
  if (!editProduct) return;
  await window.relinkEbayListing(editProduct.code);
});

// Edit Modal — profit preview + price reference live update
document.getElementById("editPrice").addEventListener("input", refreshEditPreview);
document.getElementById("editPrice").addEventListener("input", refreshEditRef);
document.getElementById("editWeightOz").addEventListener("input", refreshEditPreview);
document.getElementById("modalAdRate").addEventListener("change", () => { refreshPushPreview(); refreshPushRef(); });
document.getElementById("editAdRate").addEventListener("change",  () => { refreshEditPreview(); refreshEditRef(); });

// Sales History Modal — delegated from stable section parents (table and cards containers)
// Uses data-action="open-sales" on buttons generated inside renderTable/renderCards.
// Delegated to stable parents so listeners survive re-renders without re-binding.
document.getElementById("tableSection").addEventListener("click", e => {
  const btn = e.target.closest("[data-action='open-sales']");
  if (!btn) return;
  const product = allProducts.find(p => p.code === btn.dataset.code);
  if (product) openSalesHistory(product);
});
document.getElementById("cardSection").addEventListener("click", e => {
  const btn = e.target.closest("[data-action='open-sales']");
  if (!btn) return;
  const product = allProducts.find(p => p.code === btn.dataset.code);
  if (product) openSalesHistory(product);
});
document.getElementById("btnCloseSales").addEventListener("click", closeSalesHistory);

// Edit Modal — Add image
document.getElementById("btnAddImgEdit").addEventListener("click", () => {
  if (!editProduct) return;
  showGalleryPicker("editImagePicker", "editImageStrip", editImageUrls, editProduct);
});

// Edit Modal — Description mode
document.getElementById("btnEditVisual").addEventListener("click", () => {
  descState.editMode = "visual";
  toggleDescMode("visual", "edit", editQuill);
});
document.getElementById("btnEditHtml").addEventListener("click", () => {
  descState.editMode = "html";
  toggleDescMode("html", "edit", editQuill);
});
document.getElementById("btnEditPreview").addEventListener("click", () => {
  toggleDescMode("preview", "edit", editQuill);
});

// Edit Modal — AI Auto-Fill
document.getElementById("btnEditAiFill").addEventListener("click", async () => {
  if (!editProduct) return;
  const btn      = document.getElementById("btnEditAiFill");
  const statusEl = document.getElementById("editAiFillStatus");
  btn.disabled   = true;
  btn.innerHTML  = '<span class="animate-pulse">✨ Generating...</span>';
  statusEl.textContent = "Analyzing product images and generating listing...";
  statusEl.classList.remove("hidden");

  try {
    const existingAspects = editAspects.map(a => a.name);
    let categoryName = document.getElementById("editStoreCategory")?.value || "";
    if (!categoryName) {
      const catMap = { headwear: "Headwear", jewelry: "Jewelry", bags: "Bags", accessories: "Accessories", plushies: "Plushies", lego: "Lego" };
      for (const [key, val] of Object.entries(catMap)) {
        if (editProduct.name?.toLowerCase().includes(key) || editProduct.code?.toLowerCase().startsWith(key.substring(0, 2).toUpperCase())) {
          categoryName = val; break;
        }
      }
    }

    const result = await callEdge("ebay-ai-autofill", {
      productName: editProduct.name,
      productCode: editProduct.code,
      category:    categoryName,
      price:       editProduct.price ? Number(editProduct.price) : undefined,
      imageUrls:   editImageUrls.slice(0, 4),
      existingAspects,
    });

    if (!result.success) {
      statusEl.textContent = "AI fill failed: " + (result.error || "Unknown error");
      statusEl.className   = "text-[10px] text-red-500 text-center";
      return;
    }

    const ai = result.data;
    if (ai.title?.value) {
      document.getElementById("editTitle").value = ai.title.value;
      addAiBadge("editTitle", ai.title.source || "generated");
    }
    if (ai.description_html?.value) {
      descState.editMode = "html";
      document.getElementById("editDescriptionHtml").value = ai.description_html.value;
      toggleDescMode("html", "edit", editQuill);
      addAiBadge("editDescriptionHtml", ai.description_html.source || "generated");
    }
    if (ai.item_specifics?.length && editAspects.length) {
      for (const spec of ai.item_specifics) {
        const input = document.querySelector(`[data-edit-aspect="${spec.name}"]`);
        if (input && spec.value && (!input.value || input.value === "Unbranded")) {
          input.value = spec.value;
          const badge = document.createElement("span");
          badge.className   = `ai-badge ai-badge-${spec.source || "inferred"}`;
          badge.textContent = spec.source === "default" ? "Default" : spec.source === "from_data" ? "From data" : "AI";
          const existing = input.parentElement.querySelector(".ai-badge");
          if (existing) existing.remove();
          input.parentElement.appendChild(badge);
        }
      }
    }

    const notes = ai.notes || [];
    if (notes.length) {
      statusEl.innerHTML = "✅ AI filled fields. Notes:<br>" + notes.map(n => `• ${esc(n)}`).join("<br>");
      statusEl.className = "text-[10px] text-amber-600 text-center";
    } else {
      statusEl.textContent = "✅ AI auto-fill complete — review fields before saving.";
      statusEl.className   = "text-[10px] text-green-600 text-center";
    }
  } catch (e) {
    statusEl.textContent = "AI fill error: " + e.message;
    statusEl.className   = "text-[10px] text-red-500 text-center";
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<span>✨</span> AI Auto-Fill';
  }
});

// Edit Modal — Save Changes
document.getElementById("btnSaveEdit").addEventListener("click", async () => {
  if (!editProduct) return;
  const btn    = document.getElementById("btnSaveEdit");
  const status = document.getElementById("editStatus");
  btn.disabled = true; btn.textContent = "Saving...";

  const sku         = editProduct.ebay_sku || editProduct.code;
  const title       = document.getElementById("editTitle").value.trim();
  const rawHtml     = getDescriptionHtml("edit", editQuill);
  const description = descState.editMode === "html" ? sanitizeForEbay(rawHtml) : wrapDescription(title, rawHtml);
  const condition   = document.getElementById("editCondition").value;
  const quantity    = parseInt(document.getElementById("editQuantity").value) || 1;
  const price       = parseFloat(document.getElementById("editPrice").value) || 0;
  const editLotSize = document.getElementById("editLotEnabled").checked ? (parseInt(document.getElementById("editLotSize").value) || 0) : 0;

  if (!title) { status.textContent = "❌ Title required"; btn.disabled = false; btn.textContent = "Save Changes"; return; }

  // Validate required aspects
  const missing = [];
  document.querySelectorAll("[data-edit-aspect][data-required='true']").forEach(input => {
    if (!input.value.trim()) missing.push(input.dataset.editAspect);
  });
  if (missing.length) {
    status.textContent = `❌ Required: ${missing.join(", ")}`;
    btn.disabled = false; btn.textContent = "Save Changes";
    return;
  }

  // Collect aspects
  const aspects = {};
  document.querySelectorAll("[data-edit-aspect]").forEach(input => {
    const val = input.value.trim();
    if (val) aspects[input.dataset.editAspect] = [val];
  });

  const imageUrls = [...editImageUrls];

  try {
    if (editProduct.ebay_status === "active") {
      status.textContent = "Checking eBay linkage before save...";
      const linkCheck = await reconcileEbayLink(editProduct, false);
      renderEditLinkWarning(linkCheck);
      if (isStaleLinkCheck(linkCheck)) {
        throw new Error(`${staleLinkMessage(linkCheck)} Use Relink/Import refresh before saving so you do not edit an old ended listing.`);
      }
    }

    if (editProduct._isGroup) {
      const groupKey   = editProduct.ebay_item_group_key;
      const groupData  = editProduct._groupData || {};
      const variantSKUs = groupData.variantSKUs || [];
      const sharedAspects = { ...aspects };
      delete sharedAspects.Color;

      status.textContent = "Updating item group...";
      const groupResult = await callEdge("ebay-manage-listing", {
        action:               "update_item_group",
        inventoryItemGroupKey: groupKey,
        title, description, imageUrls,
        aspects:              sharedAspects,
        variantSKUs,
        variesBy:             groupData.variesBy || { aspectsImageVariesBy: ["Color"], specifications: [] },
        baseProductCode:      editProduct.code,
      });
      if (!groupResult.success) throw new Error(groupResult.error || "Group update failed");

      status.textContent = `Updating ${variantSKUs.length} variant items...`;
      for (const vSku of variantSKUs) {
        const varResult = await callEdge("ebay-manage-listing", { action: "get_item", sku: vSku });
        if (!varResult.success) continue;

        const varItem   = varResult.item;
        const varAspects = varItem.product?.aspects || {};
        const mergedAspects = { ...sharedAspects };
        if (varAspects.Color) mergedAspects.Color = varAspects.Color;

        const variantImageUrls = [...new Set((editVariantImageOverrides[vSku] || varItem.product?.imageUrls || []).filter(Boolean))].slice(0, 24);

        const resolvedQty          = editVariantQtyOverrides[vSku] ?? varItem.availability?.shipToLocationAvailability?.quantity ?? quantity;
        const variantUpdateProduct = { title, description, condition, imageUrls: variantImageUrls, aspects: mergedAspects,
          quantity: resolvedQty };
        if (editLotSize > 1) variantUpdateProduct.lotSize = editLotSize;

        await callEdge("ebay-manage-listing", {
          action:               "update_item",
          sku:                  vSku,
          product:              variantUpdateProduct,
          packageWeightAndSize: buildPackageWeightAndSize("edit"),
        });
      }

      status.textContent = "Updating variant offers...";
      const priceCents   = Math.round(price * 100);
      const editStoreCat = document.getElementById("editStoreCategory").value;
      const editCategoryId = document.getElementById("editCategoryId").value.trim();
      const offerLookupFailures = [];
      const variantOfferRows = [];
      for (const vSku of variantSKUs) {
        const offersResp = await getOffersForEdit(vSku, "save");
        if (!offersResp.success) {
          offerLookupFailures.push(vSku);
          continue;
        }
        const offerRow   = (offersResp.offers || [])[0];
        variantOfferRows.push({ vSku, offerRow });
      }
      if (offerLookupFailures.length) {
        throw new Error(`Could not load eBay offers for ${offerLookupFailures.join(", ")}. This was cached to avoid repeated failing requests; refresh/relink the listing if it persists.`);
      }
      for (const { vSku, offerRow } of variantOfferRows) {
        if (!offerRow?.offerId) continue;
        const offerResult = await callEdge("ebay-manage-listing", {
          action:           "update_offer",
          offerId:          offerRow.offerId,
          sku:              editProduct.code,
          expectedSku:      vSku,
          listingId:        editProduct.ebay_listing_id,
          priceCents,
          quantity:         editVariantQtyOverrides[vSku] ?? offerRow.availableQuantity ?? quantity,
          categoryId:       editCategoryId || undefined,
          policies:         getSelectedPolicies("edit"),
          // Best Offer not permitted on group (variant) listings (eBay error 25737)
          storeCategoryNames: editStoreCat ? [editStoreCat] : [],
        });
        if (!offerResult.success) throw new Error(offerUpdateErrorMessage(offerResult, `Offer update failed for ${vSku}`));
      }
    } else {
      status.textContent = "Updating item...";
      const editProductPayload = { title, description, condition, quantity, imageUrls, aspects };
      if (editLotSize > 1) editProductPayload.lotSize = editLotSize;

      const itemResult = await callEdge("ebay-manage-listing", {
        action:               "update_item",
        sku,
        product:              editProductPayload,
        packageWeightAndSize: buildPackageWeightAndSize("edit"),
      });
      if (!itemResult.success) throw new Error(itemResult.error || "Item update failed");

      if (editProduct.ebay_offer_id) {
        status.textContent = "Updating offer...";
        const priceCents   = Math.round(price * 100);
        const editStoreCat = document.getElementById("editStoreCategory").value;
        const editCategoryId = document.getElementById("editCategoryId").value.trim();
        const offerResult  = await callEdge("ebay-manage-listing", {
          action:           "update_offer",
          offerId:          editProduct.ebay_offer_id,
          sku, expectedSku: sku, listingId: editProduct.ebay_listing_id, priceCents, quantity,
          categoryId:       editCategoryId || undefined,
          policies:         getSelectedPolicies("edit"),
          bestOfferTerms:   getBestOfferTerms("edit"),
          storeCategoryNames: editStoreCat ? [editStoreCat] : [],
        });
        if (!offerResult.success) throw new Error(offerUpdateErrorMessage(offerResult, "Offer update failed"));
      }
    }

    // Persist store category to local DB
    const savedStoreCat = document.getElementById("editStoreCategory").value;
    await supabase.from("products").update({ ebay_store_category: savedStoreCat || null }).eq("id", editProduct.id);

    // Volume Pricing
    const volEnabled     = document.getElementById("editVolEnabled").checked;
    const volTiers       = volEnabled ? getVolTiers("edit") : [];
    const existingPromoId = editProduct._volPromoId || editProduct.ebay_volume_promo_id;
    const listingId       = editProduct.ebay_listing_id;

    if (volEnabled && volTiers.length && listingId) {
      status.textContent = "Updating volume pricing...";
      if (existingPromoId) {
        const volResult = await callEdge("ebay-manage-listing", { action: "update_volume_discount", promotionId: existingPromoId, listingId, tiers: volTiers });
        if (!volResult.success) console.warn("Volume pricing update failed:", volResult.error);
      } else {
        const volResult = await callEdge("ebay-manage-listing", { action: "create_volume_discount", listingId, tiers: volTiers, productCode: editProduct.code });
        if (!volResult.success) console.warn("Volume pricing create failed:", volResult.error);
      }
    } else if (!volEnabled && existingPromoId) {
      status.textContent = "Removing volume pricing...";
      const volResult = await callEdge("ebay-manage-listing", { action: "delete_volume_discount", promotionId: existingPromoId, productCode: editProduct.code });
      if (!volResult.success) console.warn("Volume pricing delete failed:", volResult.error);
    }

    status.textContent = "✅ Listing updated successfully";
    setTimeout(() => {
      document.getElementById("editModal").classList.add("hidden");
      editProduct = null;
      loadProducts();
    }, 1200);
  } catch (e) {
    status.textContent = "❌ " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Save Changes";
  }
});

// Bulk — checkbox listeners
document.addEventListener("change", (e) => {
  if (e.target.classList.contains("bulk-check")) updateBulkBar();
});
document.getElementById("checkAll").addEventListener("change", (e) => {
  document.querySelectorAll(".bulk-check").forEach(cb => { cb.checked = e.target.checked; });
  updateBulkBar();
});
document.getElementById("btnBulkCancel").addEventListener("click", () => {
  document.querySelectorAll(".bulk-check").forEach(cb => { cb.checked = false; });
  document.getElementById("checkAll").checked = false;
  updateBulkBar();
});

// Bulk — open modal
document.getElementById("btnBulkPrice").addEventListener("click", () => openBulkModal("price"));
document.getElementById("btnBulkQty").addEventListener("click",   () => openBulkModal("qty"));

function openBulkModal(mode) {
  bulkMode = mode;
  const selected = getSelectedItems();
  if (!selected.length) return;
  document.getElementById("bulkModalTitle").textContent = mode === "price" ? "Bulk Update Price" : "Bulk Update Quantity";
  document.getElementById("bulkModalLabel").textContent = mode === "price" ? "New Price ($)" : "New Quantity";
  document.getElementById("bulkModalValue").value       = "";
  document.getElementById("bulkModalValue").step        = mode === "price" ? "0.01" : "1";
  document.getElementById("bulkModalItems").textContent = selected.map(s => s.sku).join(", ");
  document.getElementById("bulkModalStatus").textContent = "";
  document.getElementById("bulkModal").classList.remove("hidden");
}

document.getElementById("btnCloseBulk").addEventListener("click", () => {
  document.getElementById("bulkModal").classList.add("hidden");
});

document.getElementById("btnBulkApply").addEventListener("click", async () => {
  const btn    = document.getElementById("btnBulkApply");
  const status = document.getElementById("bulkModalStatus");
  const value  = parseFloat(document.getElementById("bulkModalValue").value);
  if (isNaN(value) || value < 0) { status.textContent = "❌ Enter a valid number"; return; }

  const selected = getSelectedItems().filter(s => s.offerId);
  if (!selected.length) { status.textContent = "❌ No items with offers selected"; return; }

  btn.disabled = true; btn.textContent = "Updating...";

  try {
    const items = selected.map(s => ({
      sku:     s.sku,
      offerId: s.offerId,
      ...(bulkMode === "price" ? { priceCents: Math.round(value * 100) } : {}),
      ...(bulkMode === "qty"   ? { quantity:   Math.round(value) }       : {}),
    }));

    const result = await callEdge("ebay-manage-listing", { action: "bulk_update", items });
    if (result.success) {
      status.textContent = `✅ Updated ${selected.length} listings`;
      if (bulkMode === "price") {
        const priceCents = Math.round(value * 100);
        for (const s of selected) {
          await supabase.from("products").update({ ebay_price_cents: priceCents, updated_at: new Date().toISOString() }).eq("code", s.code);
        }
      }
      setTimeout(() => {
        document.getElementById("bulkModal").classList.add("hidden");
        document.querySelectorAll(".bulk-check").forEach(cb => { cb.checked = false; });
        document.getElementById("checkAll").checked = false;
        updateBulkBar();
        loadProducts();
      }, 1200);
    } else {
      status.textContent = "❌ " + (result.error || "Bulk update failed");
    }
  } catch (e) {
    status.textContent = "❌ " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Apply to All Selected";
  }
});

// Checkbox toggles — Best Offer
document.getElementById("modalBestOffer").addEventListener("change", (e) => {
  document.getElementById("modalBestOfferFields").classList.toggle("hidden", !e.target.checked);
});
document.getElementById("editBestOffer").addEventListener("change", (e) => {
  document.getElementById("editBestOfferFields").classList.toggle("hidden", !e.target.checked);
});

// Checkbox toggles — Lot
document.getElementById("modalLotEnabled").addEventListener("change", (e) => {
  document.getElementById("modalLotFields").classList.toggle("hidden", !e.target.checked);
});
document.getElementById("editLotEnabled").addEventListener("change", (e) => {
  document.getElementById("editLotFields").classList.toggle("hidden", !e.target.checked);
});

// Checkbox toggles — Volume Pricing
document.getElementById("modalVolEnabled").addEventListener("change", (e) => {
  document.getElementById("modalVolFields").classList.toggle("hidden", !e.target.checked);
  if (e.target.checked && !document.getElementById("modalVolTiers").children.length) addVolTier("modal");
});
document.getElementById("editVolEnabled").addEventListener("change", (e) => {
  document.getElementById("editVolFields").classList.toggle("hidden", !e.target.checked);
  if (e.target.checked && !document.getElementById("editVolTiers").children.length) addVolTier("edit");
});
document.getElementById("modalAddTier").addEventListener("click", () => addVolTier("modal"));
document.getElementById("editAddTier").addEventListener("click",  () => addVolTier("edit"));

// Setup Panel
document.getElementById("btnSetup").addEventListener("click", async () => {
  const panel = document.getElementById("policiesPanel");
  panel.classList.toggle("hidden");
  if (panel.classList.contains("hidden")) return;

  const content = document.getElementById("policiesContent");
  content.textContent = "Loading policies...";
  try {
    const result = await callEdge("ebay-manage-listing", { action: "get_policies" });
    if (result.success) {
      const html = [];
      for (const [type, data] of Object.entries(result.policies)) {
        const policies = (data?.policies || data?.fulfillmentPolicies || data?.returnPolicies || data?.paymentPolicies || []);
        const label    = type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        html.push(`<div class="mb-3"><strong>${label}:</strong>`);
        if (policies.length) {
          for (const p of policies) {
            html.push(`<div class="ml-3 text-gray-600">• ${esc(p.name || p.policyName || "Unnamed")} <span class="text-gray-400">(${p.fulfillmentPolicyId || p.returnPolicyId || p.paymentPolicyId || ""})</span></div>`);
          }
        } else {
          html.push('<div class="ml-3 text-red-500">No policies found — create them in eBay Seller Hub first</div>');
        }
        html.push("</div>");
      }
      content.innerHTML = html.join("");
    } else {
      content.textContent = "❌ " + (result.error || "Failed to load policies");
    }
  } catch (e) { content.textContent = "❌ " + e.message; }
});

document.getElementById("btnSetupLocation").addEventListener("click", async () => {
  const btn    = document.getElementById("btnSetupLocation");
  const status = document.getElementById("locationStatus");
  btn.disabled = true; status.textContent = "Creating location...";
  try {
    const result = await callEdge("ebay-manage-listing", { action: "setup_location", locationKey: "default" });
    status.textContent = result.success ? "✅ Location ready" : "❌ " + (result.error || "Failed");
  } catch (e) { status.textContent = "❌ " + e.message; }
  finally { btn.disabled = false; }
});

// Migrate Panel
document.getElementById("btnMigrate").addEventListener("click", () => {
  document.getElementById("migratePanel").classList.toggle("hidden");
});

document.getElementById("btnScanEbay").addEventListener("click", async () => {
  const btn    = document.getElementById("btnScanEbay");
  const status = document.getElementById("migrateStatus");
  btn.disabled = true; btn.textContent = "Scanning..."; status.textContent = "";
  try {
    const result = await callEdge("ebay-migrate-listings", { action: "scan" });
    if (result.success) {
      status.textContent = `Found ${result.total} items — ${result.matched} matched, ${result.unmatched} unmatched`;
      renderMigrateResults(result.items || []);
    } else {
      status.textContent = "❌ " + (result.error || "Scan failed");
    }
  } catch (e) { status.textContent = "❌ " + e.message; }
  finally { btn.disabled = false; btn.textContent = "🔍 Scan eBay Inventory"; }
});

document.getElementById("btnAutoLink").addEventListener("click", async () => {
  if (!confirm("Auto-link all matchable eBay items to KK products?")) return;
  const btn    = document.getElementById("btnAutoLink");
  const status = document.getElementById("migrateStatus");
  btn.disabled = true; btn.textContent = "Linking..."; status.textContent = "";
  try {
    const result = await callEdge("ebay-migrate-listings", { action: "auto_link" });
    if (result.success) {
      status.textContent = `✅ Linked ${result.linked} of ${result.total} items (${result.skippedNoMatch} unmatched)`;
      renderMigrateResults(result.results || []);
      loadProducts();
    } else {
      status.textContent = "❌ " + (result.error || "Auto-link failed");
    }
  } catch (e) { status.textContent = "❌ " + e.message; }
  finally { btn.disabled = false; btn.textContent = "⚡ Auto-Link All"; }
});

// Refresh
document.getElementById("btnRefresh").addEventListener("click", () => loadProducts());

// ── Init ────────────────────────────────────────────────────────
async function init() {
  await initAdminNav("eBay Listings");
  initFooter();
  await requireAdmin();
  setView(currentView); // sync view toggle buttons on load
  await loadProducts();
  loadPoliciesCache();
}

init();

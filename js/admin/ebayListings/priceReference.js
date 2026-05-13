/**
 * priceReference.js — Phase 5: Internal price reference + pricing guardrails.
 *
 * Read-only pure helpers + one DOM renderer.
 * No edge function calls. No external data. No automatic price setting.
 *
 * ── Data sources ─────────────────────────────────────────────────────────────
 *
 *   Instant (from product loaded at page start):
 *     1. products.price               — KK catalog retail price
 *     2. products.ebay_price_cents    — current eBay listed price
 *
 *   Instant (from p._ws merged by mergeWorkspaceMetrics() at page start):
 *     3. _ws.avg_sold_price_cents_90d — avg internal eBay sold price, last 90 days
 *        NOTE: workspace view uses unit_price_cents (original listed price, not
 *        post-discount). For most eBay sales there is no discount — equal in practice.
 *     4. _ws.sold_qty_90d             — units sold 90d (proxy for sample size)
 *
 *   Async (fetched when modal opens — one small query, non-blocking):
 *     5. v_ebay_product_recent_sales.sold_price_cents
 *        Used to derive min/max of all recorded internal sold prices.
 *        Labeled "internal sales range" in UI. Shows only when ≥ 2 observations.
 *
 * ── Guardrail rules ───────────────────────────────────────────────────────────
 *
 *   1. eBay price below KK catalog price → warning
 *   2. eBay price below recent avg sold price (≥ 2 obs in 90d) → warning
 *   3. eBay price below internal sold range floor (≥ 2 total obs) → warning
 *   4. Sparse sample (< 2 obs in 90d but > 0) → informational note
 *   5. No internal sales history → informational note
 *
 * ── Reference range ───────────────────────────────────────────────────────────
 *
 *   min → max of all v_ebay_product_recent_sales rows for this product.
 *   Factual observation only — no formula, no extrapolation.
 *   Only shown when ≥ 2 distinct sales observations recorded.
 *   Labeled "Internal sales range" in UI.
 *
 * ── Intentional exclusions ────────────────────────────────────────────────────
 *
 *   - External comps (Browse API / competitor lookup)
 *   - AI pricing suggestions
 *   - Auto-pricing / auto-fill
 *   - Realized per-product profit attribution (order proration blocker)
 *   - Performance metrics (impressions, CTR, watchers)
 *   - Promoted listings spend attribution
 *   - Median calculation (marginal value given small N)
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";

const supabase = getSupabaseClient();

// Minimum distinct observations required to show a range or avg-based warning.
const SPARSE_THRESHOLD = 2;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtUsd(cents) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Async data fetch ──────────────────────────────────────────────────────────

/**
 * Fetch min/max sold price and observation count for a product.
 * Queries v_ebay_product_recent_sales with no limit — all recorded sales.
 *
 * @param {string} productCode
 * @returns {Promise<{minSoldCents: number|null, maxSoldCents: number|null, nObs: number}>}
 */
export async function fetchSalesMetrics(productCode) {
  try {
    const { data, error } = await supabase
      .from("v_ebay_product_recent_sales")
      .select("sold_price_cents")
      .eq("product_code", productCode);

    if (error || !data?.length) return { minSoldCents: null, maxSoldCents: null, nObs: 0 };

    const prices = data.map(r => r.sold_price_cents).filter(v => v != null && v > 0);
    if (!prices.length) return { minSoldCents: null, maxSoldCents: null, nObs: 0 };

    return {
      minSoldCents: Math.min(...prices),
      maxSoldCents: Math.max(...prices),
      nObs:         prices.length,
    };
  } catch (e) {
    console.warn("[priceRef] fetchSalesMetrics failed:", e.message);
    return { minSoldCents: null, maxSoldCents: null, nObs: 0 };
  }
}

// ── Build price reference object ──────────────────────────────────────────────

/**
 * Build a pricing reference summary from product and optional sales metrics.
 * Pure function — no DOM access, no side effects.
 *
 * @param {object}      product      — product row (with ._ws if workspace metrics loaded)
 * @param {object|null} sales        — result of fetchSalesMetrics, or null if not yet loaded
 * @param {number|null} [overrideEbayPriceCents] — if set, replaces ebay_price_cents
 *        (used when the modal price input differs from the saved ebay_price_cents)
 * @returns {object} priceMeta
 */
export function buildPriceRef(product, sales = null, overrideEbayPriceCents = null) {
  const kkCents   = product.price != null ? Math.round(Number(product.price) * 100) : null;
  const ebayCents = overrideEbayPriceCents != null
    ? overrideEbayPriceCents
    : (product.ebay_price_cents ?? null);

  const ws         = product._ws ?? null;
  const avgSold90d = ws?.avg_sold_price_cents_90d ?? null;
  const soldQty90d = ws?.sold_qty_90d ?? 0;

  const minSold = sales?.minSoldCents ?? null;
  const maxSold = sales?.maxSoldCents ?? null;
  const nObs    = sales?.nObs ?? null;

  const warnings = [];
  const notes    = [];

  if (ebayCents != null && ebayCents > 0) {
    // 1. Below KK catalog price
    if (kkCents != null && ebayCents < kkCents) {
      warnings.push({
        key:  "below_kk",
        text: `eBay price (${fmtUsd(ebayCents)}) is below KK catalog price (${fmtUsd(kkCents)}).`,
      });
    }

    // 2. Below recent internal avg sold price (only if sufficient data)
    if (avgSold90d != null && soldQty90d >= SPARSE_THRESHOLD && ebayCents < avgSold90d) {
      warnings.push({
        key:  "below_avg_sold",
        text: `eBay price (${fmtUsd(ebayCents)}) is below your recent internal avg sold price (${fmtUsd(avgSold90d)}).`,
      });
    }

    // 3. Below internal sold range floor (only if async data loaded AND sufficient obs)
    if (minSold != null && nObs != null && nObs >= SPARSE_THRESHOLD && ebayCents < minSold) {
      warnings.push({
        key:  "below_sold_floor",
        text: `eBay price (${fmtUsd(ebayCents)}) is below your lowest recorded sold price (${fmtUsd(minSold)}).`,
      });
    }
  }

  // Informational notes (non-blocking)
  if (soldQty90d > 0 && soldQty90d < SPARSE_THRESHOLD) {
    notes.push(`Limited internal data (${soldQty90d} unit${soldQty90d !== 1 ? "s" : ""} sold in 90d) — treat reference prices with caution.`);
  } else if (soldQty90d === 0 && avgSold90d == null) {
    notes.push("No internal eBay sales history for this product. Reference KK catalog price only.");
  }

  // Reference range — factual min → max; shown only when ≥ SPARSE_THRESHOLD observations
  const showRange = minSold != null && maxSold != null && nObs != null && nObs >= SPARSE_THRESHOLD;

  return {
    kkCents,
    ebayCents,
    avgSold90d,
    soldQty90d,
    minSold,
    maxSold,
    nObs,
    showRange,
    warnings,
    notes,
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

/**
 * Render the price reference panel into a container element.
 *
 * @param {string}  containerId — DOM id of the container div
 * @param {object}  ref         — result of buildPriceRef()
 * @param {boolean} loading     — if true, show loading state for async sales range
 */
export function renderPriceRef(containerId, ref, loading = false) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Nothing to show if no meaningful inputs
  if (!ref.kkCents && !ref.ebayCents) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }

  el.classList.remove("hidden");

  // ── Warnings ─────────────────────────────────────────────────────
  const warnHtml = ref.warnings.length
    ? `<div class="pr-warnings">${ref.warnings.map(w =>
        `<div class="pr-warning">&#9888; ${escHtml(w.text)}</div>`
      ).join("")}</div>`
    : "";

  // ── Price rows ────────────────────────────────────────────────────
  const rows = [];

  // KK catalog price
  if (ref.kkCents != null) {
    rows.push(`<div class="pr-row">
      <span class="pr-label">KK catalog price</span>
      <span class="pr-val">${fmtUsd(ref.kkCents)}</span>
    </div>`);
  }

  // Current eBay price (from modal input or saved value)
  if (ref.ebayCents != null) {
    const belowKk = ref.kkCents != null && ref.ebayCents < ref.kkCents;
    rows.push(`<div class="pr-row">
      <span class="pr-label">eBay price being set</span>
      <span class="pr-val ${belowKk ? "pr-warn" : ""}">${fmtUsd(ref.ebayCents)}</span>
    </div>`);
  }

  // Separator before sales data
  if (rows.length > 0 && (ref.avgSold90d != null || ref.soldQty90d === 0 || loading)) {
    rows.push('<div class="pr-hr"></div>');
  }

  // Avg sold 90d (instant from _ws)
  if (ref.avgSold90d != null) {
    const belowAvg = ref.ebayCents != null && ref.soldQty90d >= SPARSE_THRESHOLD && ref.ebayCents < ref.avgSold90d;
    const obsLabel = ref.soldQty90d > 0
      ? ` <span class="pr-obs">(${ref.soldQty90d} unit${ref.soldQty90d !== 1 ? "s" : ""} in 90d)</span>`
      : "";
    rows.push(`<div class="pr-row">
      <span class="pr-label">Avg sold price 90d${obsLabel}</span>
      <span class="pr-val ${belowAvg ? "pr-warn" : ""}">${fmtUsd(ref.avgSold90d)}</span>
    </div>`);
  } else if (!loading) {
    rows.push(`<div class="pr-row"><span class="pr-label pr-dim">No internal eBay sales history</span></div>`);
  }

  // Min/max range — async
  if (loading) {
    rows.push(`<div class="pr-row"><span class="pr-dim">Loading internal sales range\u2026</span></div>`);
  } else if (ref.showRange) {
    const rangeStr = ref.minSold === ref.maxSold
      ? fmtUsd(ref.minSold)
      : `${fmtUsd(ref.minSold)} \u2013 ${fmtUsd(ref.maxSold)}`;
    const belowFloor = ref.ebayCents != null && ref.ebayCents < ref.minSold;
    rows.push(`<div class="pr-row">
      <span class="pr-label">Internal sales range <span class="pr-obs">(${ref.nObs} sale${ref.nObs !== 1 ? "s" : ""})</span></span>
      <span class="pr-val ${belowFloor ? "pr-warn" : ""}">${rangeStr}</span>
    </div>`);
  } else if (ref.nObs != null && ref.nObs === 1) {
    rows.push(`<div class="pr-row"><span class="pr-label pr-dim">1 recorded sale (range not shown)</span></div>`);
  }

  // ── Notes ────────────────────────────────────────────────────────
  const notesHtml = ref.notes.length
    ? `<div class="pr-notes">${ref.notes.map(n =>
        `<div class="pr-note-item">${escHtml(n)}</div>`
      ).join("")}</div>`
    : "";

  el.innerHTML = `
    <div class="pr-header">Internal Price Reference</div>
    ${warnHtml}
    <div class="pr-rows">${rows.join("")}</div>
    ${notesHtml}
    <div class="pr-footer">Internal guidance only &mdash; based on your KK catalog and historical eBay sales data.</div>
  `;
}

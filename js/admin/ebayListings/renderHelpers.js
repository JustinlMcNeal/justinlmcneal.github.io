/**
 * renderHelpers.js — Small reusable HTML/string helpers for product list rendering.
 *
 * Pure presentational helpers only.
 * No DOM queries. No module-level state. No API calls.
 * No imports from index.js (no circular dependency possible).
 *
 * Exports:
 *   formatRelativeDate(dtStr)         — compact human-readable date diff string
 *   wsChips(product, health)          — workspace metric chip HTML
 *   epCls(marginPct)                  — CSS class for estimated-profit badge
 *   rowEstProfitHtml(product, adRatePct) — full estimated-profit cell HTML
 */

import { esc }           from "./utils.js";
import { buildEstimate } from "./profitPreview.js";

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns a compact human-readable relative date string, e.g. "3d ago", "2mo ago".
 * Returns null for falsy input.
 */
export function formatRelativeDate(dtStr) {
  if (!dtStr) return null;
  const dt     = new Date(dtStr);
  const diffMs = Date.now() - dt.getTime();
  const days   = Math.floor(diffMs / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30)  return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ── Workspace chip HTML ───────────────────────────────────────────────────────

/**
 * Builds compact workspace metric chip HTML for a product row or card.
 * Returns "" when _ws is null (workspace view unavailable) — no crash, no badge.
 *
 * @param {object} p      Product row with optional _ws workspace metrics
 * @param {object|null} health  Optional computeHealth() result for richer issue tooltip
 */
export function wsChips(p, health = null) {
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
  // Underpriced vs internal avg sold (only for active/draft, ≥2 obs)
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
    const tooltip = health?.flagLabels?.length
      ? health.flagLabels.join(" | ")
      : ws.issue_flags ? Object.keys(ws.issue_flags).join(", ") : "";
    chips.push(`<span class="ws-chip ws-chip-issue" title="${esc(tooltip)}">⚠ ${issues}</span>`);
  }
  if (!chips.length) return "";
  return `<div class="ws-chips">${chips.join("")}</div>`;
}

// ── Estimated-profit helpers ──────────────────────────────────────────────────

/**
 * Returns the Tailwind/CSS class modifier for an estimated-profit badge.
 * @param {number|null} marginPct
 */
export function epCls(marginPct) {
  if (marginPct == null) return "ep-na";
  if (marginPct < 0)    return "ep-neg";
  if (marginPct < 10)   return "ep-warn";
  if (marginPct < 20)   return "ep-low";
  return "ep-ok";
}

/**
 * Builds the estimated-profit badge HTML for a table row or card.
 *
 * @param {object} p          Product row (ebay_price_cents, price, unit_cost, weight_g, etc.)
 * @param {number} adRatePct  Assumed promoted-listing ad rate (0–100), passed from page state
 */
export function rowEstProfitHtml(p, adRatePct) {
  if (!p.ebay_price_cents) return '<span class="ep-badge ep-na">—</span>';
  const est = buildEstimate({
    priceCents:   p.ebay_price_cents,
    kkPriceCents: p.price     ? Math.round(Number(p.price) * 100) : null,
    unitCostUsd:  p.unit_cost != null ? Number(p.unit_cost) : null,
    weightG:      p.weight_g  ?? null,
    labelWeightG: p.weight_g  ?? null,
    adRatePct,
  });
  if (est.netProfitCents !== null) {
    const sign    = est.netProfitCents >= 0 ? "+" : "";
    const cls     = epCls(est.marginPct);
    const value   = `${sign}$${(Math.abs(est.netProfitCents) / 100).toFixed(2)}`;
    const pctTxt  = est.marginPct !== null ? `${est.marginPct}%` : "";
    const partial = est.complete ? "" : "*";
    const tipBase = `Est. net profit${adRatePct > 0 ? ` (incl. ${adRatePct}% promo ad rate)` : ""}`;
    const tip     = est.complete ? tipBase : `${tipBase} — *partial (label unknown)`;
    return `<span class="ep-badge ep-${cls}" title="${esc(tip)}">~${value}${partial}${pctTxt ? `<br><span class="ep-pct">${pctTxt}</span>` : ""}</span>`;
  }
  if (!p.unit_cost) {
    return '<span class="ep-badge ep-na" title="Set unit cost on product to enable estimate">no cost</span>';
  }
  return '<span class="ep-badge ep-na">—</span>';
}

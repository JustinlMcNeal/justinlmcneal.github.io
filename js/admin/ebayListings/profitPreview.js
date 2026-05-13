/**
 * profitPreview.js — Phase 2: Estimated profit/fee preview for Push and Edit modals.
 *
 * Pure estimation helpers + one DOM renderer.
 * Does not import other modules; does not call Supabase or edge functions.
 *
 * ── Estimator model ──────────────────────────────────────────────────────────
 *
 *   eBay final value fee:
 *     ~13.25% of listing price + $0.30 fixed per-order transaction fee.
 *     Source: eBay US standard seller fee for most categories (fashion, accessories,
 *     jewelry, toys, collectibles) for items priced under $2,500, as of 2025.
 *     Actual fee varies by category and price tier. Always labeled "estimate" in UI.
 *
 *   Supplier shipping (CPI component):
 *     Exactly matches item_costs CTE in v_ebay_order_profit (migration
 *     20260511_ebay_finance_v3_cpi.sql). Standard batch qty = 30 units.
 *     EUB:    totalWeight = weightG * 30 ≤ 2000g → (88 + totalWeight * 0.12) * 0.1437 / 30
 *     HK-UPS: totalWeight > 2000g              → (297 + totalWeight * 0.0523) * 0.1437 / 30
 *     CNY→USD rate: 0.1437 (same constant as profitCalc.js and SQL migration)
 *
 *   Outbound label:
 *     USPS Ground Advantage, Pirate Ship commercial pricing (national average, Oct 2025).
 *     Matches calculateCustomerShipping() in pStorage/profitCalc.js exactly.
 *     Uses packaged weight in grams for lookup.
 *     Labeled clearly as "est. label" — actual cost varies by zone and packaging.
 *
 *   Unit product cost:
 *     products.unit_cost (USD, nullable). Null → incomplete estimate, warning shown.
 *
 * ── Profit calculation order ─────────────────────────────────────────────────
 *
 *   netAfterFee   = price - eBay fee
 *   cpiCents      = unit_cost + supplier_ship_per_unit  [if unit_cost available]
 *   labelCents    = USPS weight-table lookup            [if weight available]
 *   netProfit     = price - fee - cpi - label           [if all available]
 *   margin        = netProfit / price * 100
 *
 * ── What is an estimate vs not ───────────────────────────────────────────────
 *
 *   Estimated (clearly labeled):
 *     - eBay fee (rate approximation)
 *     - Supplier shipping (formula approximation at qty-30)
 *     - Outbound label (national average, zone-varies)
 *     - Net profit / margin (derived from above)
 *
 *   Known / exact:
 *     - eBay listing price (from modal input)
 *     - KK price reference (from product.price)
 *     - unit_cost (from products.unit_cost, when set)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

// eBay US standard FVF rate for most categories (fashion/accessories/toys < $2500).
const EBAY_FVF_RATE = 0.1325;

// eBay per-order transaction fee (fixed, all categories).
const EBAY_FIXED_FEE_CENTS = 30;

// CNY → USD exchange rate. Matches pStorage/profitCalc.js and SQL CPI migration.
const CNY_TO_USD = 0.1437;

// Standard supplier batch quantity used in CPI formula and SQL migration.
const CPI_BATCH_QTY = 30;

// ─── Supplier Shipping (CPI component) ───────────────────────────────────────

/**
 * Estimate per-unit supplier shipping cost in USD.
 * Formula: identical to item_costs CTE in v_ebay_order_profit (migration v3/v4).
 * Uses standard CPI_BATCH_QTY = 30.
 * @param {number|null} weightG — product weight in grams
 * @returns {number} per-unit supplier shipping in USD (0 if no weight)
 */
function supplierShipPerUnit(weightG) {
  if (!weightG || weightG <= 0) return 0;
  const totalWeight = weightG * CPI_BATCH_QTY;
  let totalCNY;
  if (totalWeight <= 2000) {
    totalCNY = 88 + totalWeight * 0.12;       // EUB
  } else {
    totalCNY = 297 + totalWeight * 0.0523;    // HK-UPS
  }
  return (totalCNY * CNY_TO_USD) / CPI_BATCH_QTY;
}

// ─── Outbound Label Estimate (USPS Ground Advantage) ─────────────────────────

/**
 * Estimate outbound label cost in USD using USPS Ground Advantage commercial
 * Pirate Ship pricing (Oct 2025, national average).
 * Mirrors calculateCustomerShipping() in pStorage/profitCalc.js exactly.
 * @param {number|null} weightG — packaged weight in grams
 * @returns {number|null} estimated label cost in USD, or null if weight unavailable/too heavy
 */
function estimateLabelCost(weightG) {
  if (!weightG || weightG <= 0) return null;
  const oz  = weightG / 28.35;
  const lbs = weightG / 453.6;
  if (oz  <= 4)     return 4.85;
  if (oz  <= 8)     return 5.30;
  if (oz  <= 12)    return 5.75;
  if (oz  <= 15.99) return 6.20;
  if (lbs <= 1)     return 6.50;
  if (lbs <= 2)     return 8.50;
  if (lbs <= 3)     return 9.75;
  if (lbs <= 4)     return 10.50;
  if (lbs <= 5)     return 11.25;
  if (lbs <= 10)    return 14.00;
  if (lbs <= 15)    return 18.00;
  if (lbs <= 20)    return 22.00;
  if (lbs <= 70)    return 35.00;
  return null; // exceeds USPS Ground Advantage limit
}

// ─── eBay Fee Estimate ────────────────────────────────────────────────────────

/**
 * Estimate eBay total fee in cents for a given listing price.
 * Model: EBAY_FVF_RATE of listing price + EBAY_FIXED_FEE_CENTS.
 * @param {number} priceCents — listing price in integer cents
 * @returns {number} estimated fee in cents
 */
function estimateEbayFee(priceCents) {
  if (!priceCents || priceCents <= 0) return 0;
  return Math.round(priceCents * EBAY_FVF_RATE) + EBAY_FIXED_FEE_CENTS;
}

// ─── Build Estimate ───────────────────────────────────────────────────────────

/**
 * Build a full estimate object from available inputs.
 *
 * @param {object} inputs
 * @param {number|null}  inputs.priceCents     — eBay listing price in cents (required for any estimate)
 * @param {number|null}  inputs.kkPriceCents   — KK retail price in cents (reference only)
 * @param {number|null}  inputs.unitCostUsd    — products.unit_cost in USD (nullable)
 * @param {number|null}  inputs.weightG        — product weight in grams (for CPI + label)
 * @param {number|null}  inputs.labelWeightG   — actual packaged weight in grams (for label only).
 *                                               Falls back to weightG if null.
 *
 * @returns {object} estimate result with all fields and warnings
 */
export function buildEstimate({ priceCents, kkPriceCents, unitCostUsd, weightG, labelWeightG, adRatePct = 0 }) {
  const est = {
    priceCents:       priceCents  ?? null,
    kkPriceCents:     kkPriceCents ?? null,
    feeCents:         null,
    adFeeCents:       null,   // Phase 6: assumed promotional ad fee (not actual campaign data)
    adRatePct:        adRatePct,
    cpiCents:         null,
    labelCents:       null,
    netAfterFeeCents: null,
    netProfitCents:   null,
    marginPct:        null,
    complete:         false,   // true only when fee + cpi + label are all present
    warnings:         [],
    assumptions:      [],
  };

  // No price → cannot estimate anything
  if (!priceCents || priceCents <= 0) {
    est.warnings.push({ key: "no_price", text: "Enter a listing price to see profit estimate" });
    return est;
  }

  // ── eBay fee ─────────────────────────────────────────────
  est.feeCents         = estimateEbayFee(priceCents);
  est.netAfterFeeCents = priceCents - est.feeCents;
  est.assumptions.push(`eBay fee: ~${(EBAY_FVF_RATE * 100).toFixed(2)}% + $0.30 (standard US rate)`);

  // ── KK price comparison ───────────────────────────────────
  if (kkPriceCents != null && priceCents < kkPriceCents) {
    est.warnings.push({
      key: "price_below_kk",
      text: `eBay price ($${(priceCents / 100).toFixed(2)}) is below KK price ($${(kkPriceCents / 100).toFixed(2)})`,
    });
  }

  // ── CPI (unit_cost + supplier ship) ───────────────────────
  const effectiveWeightG = weightG || 0;

  if (unitCostUsd != null) {
    const shipUsd  = supplierShipPerUnit(effectiveWeightG);
    est.cpiCents   = Math.round((unitCostUsd + shipUsd) * 100);
    if (effectiveWeightG > 0) {
      const carrier = (effectiveWeightG * CPI_BATCH_QTY) <= 2000 ? "EUB" : "HK-UPS";
      est.assumptions.push(`Product cost: unit_cost + ${carrier} supplier ship (qty-${CPI_BATCH_QTY} batch)`);
    } else {
      est.assumptions.push("Product cost: unit_cost only (no weight for supplier ship)");
    }
  } else {
    est.warnings.push({
      key: "missing_cost",
      text: "Unit cost not set on this product — profit estimate incomplete",
    });
  }

  // ── Outbound label ────────────────────────────────────────
  // Use labelWeightG (modal packaged weight) if provided; otherwise fall back to productweightG
  const labelW    = labelWeightG || effectiveWeightG;
  const labelUsd  = estimateLabelCost(labelW);
  if (labelUsd !== null) {
    est.labelCents = Math.round(labelUsd * 100);
    est.assumptions.push("Label: USPS Ground Advantage est. (Pirate Ship avg, zone-varies)");
  } else if (labelW > 0) {
    // Weight too heavy for table (> 70 lbs) or extremely light (shouldn't happen)
    est.warnings.push({ key: "label_unknown", text: "Outbound label cost could not be estimated" });
    est.assumptions.push("Label: could not estimate (check weight)");
  } else {
    est.assumptions.push("Label: not estimated (no weight available)");
  }

  // ── Assumed ad/promotional fee (Phase 6 extension) ─────────
  if (adRatePct > 0 && priceCents > 0) {
    est.adFeeCents = Math.round(priceCents * adRatePct / 100);
    est.assumptions.push(`Assumed promo/ad rate: ${adRatePct}% of price (not actual campaign data)`);
  }
  const adFeeDeduct = est.adFeeCents ?? 0;

  // ── Net profit ────────────────────────────────────────────
  if (est.feeCents != null && est.cpiCents != null && est.labelCents != null) {
    // Full estimate: fee + cpi + label (+optional ad fee) all available
    est.netProfitCents = priceCents - est.feeCents - est.cpiCents - est.labelCents - adFeeDeduct;
    est.marginPct      = Math.round((est.netProfitCents / priceCents) * 100);
    est.complete       = true;
  } else if (est.feeCents != null && est.cpiCents != null) {
    // Partial: cpi available but label unknown
    est.netProfitCents = priceCents - est.feeCents - est.cpiCents - adFeeDeduct;
    est.marginPct      = Math.round((est.netProfitCents / priceCents) * 100);
    // partial — flag below threshold using pre-label numbers (more optimistic, so flag lower)
  } else if (est.feeCents != null && est.labelCents != null) {
    // Fee + label but no CPI
    est.netAfterFeeCents = priceCents - est.feeCents - adFeeDeduct;
    // Don't set netProfitCents — too incomplete without cost
  }
  // If only fee: netAfterFeeCents is already set above, nothing else to compute.

  // ── Profit warnings (only if we have something to warn on) ──
  if (est.netProfitCents != null) {
    if (est.netProfitCents < 0) {
      est.warnings.push({ key: "negative_profit", text: "Estimated profit is negative at this price" });
    } else if (est.marginPct != null && est.marginPct < 10) {
      est.warnings.push({ key: "very_low_margin", text: `Very low margin (~${est.marginPct}%)` });
    } else if (est.marginPct != null && est.marginPct < 20) {
      est.warnings.push({ key: "low_margin", text: `Low margin (~${est.marginPct}%)` });
    }
  }

  return est;
}

// ─── Render Helpers ───────────────────────────────────────────────────────────

/** Format cents as a $X.XX string, or return a dash element if null. */
function fmt(cents) {
  if (cents == null) return '<span class="pp-unknown">—</span>';
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Pick a Tailwind-compatible profit color class based on margin. */
function marginCls(pct) {
  if (pct == null)  return "";
  if (pct < 0)      return "pp-neg";
  if (pct < 10)     return "pp-warn";
  if (pct < 20)     return "pp-low";
  return "pp-ok";
}

/** Minimal HTML escape for user-derived strings inserted into innerHTML. */
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Render Preview ───────────────────────────────────────────────────────────

/**
 * Render the profit preview panel into a container element.
 * Safe to call repeatedly; replaces previous content on each call.
 *
 * @param {string} containerId — id of the target container div
 * @param {object} estimate    — result of buildEstimate()
 */
export function renderPreview(containerId, estimate) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const {
    priceCents, kkPriceCents, feeCents, cpiCents, labelCents,
    adFeeCents, adRatePct: estAdRatePct,
    netAfterFeeCents, netProfitCents, marginPct,
    warnings, assumptions, complete,
  } = estimate;

  // No price entered yet
  if (!priceCents || priceCents <= 0) {
    el.innerHTML = '<div class="pp-empty">Enter a price to see estimated profit</div>';
    el.classList.remove("hidden");
    return;
  }

  // Warnings block (non-blocking)
  const warningHtml = warnings.length ? `
    <div class="pp-warnings">
      ${warnings.map(w => `<div class="pp-warning">${escHtml(w.text)}</div>`).join("")}
    </div>` : "";

  // Determine the "profit" row display
  const hasProfit = netProfitCents != null;
  const isPartial = hasProfit && !complete;
  const profitCls = marginCls(marginPct);
  const partialStar = isPartial ? "*" : "";

  const profitRow = hasProfit ? `
    <div class="pp-row pp-profit-row">
      <span>Est. net profit${partialStar}</span>
      <span class="pp-val ${profitCls}">${fmt(netProfitCents)}</span>
    </div>
    ${marginPct != null ? `
    <div class="pp-row pp-profit-row">
      <span>Est. margin${partialStar}</span>
      <span class="pp-val ${profitCls}">${marginPct}%</span>
    </div>` : ""}` : "";

  const partialNote = isPartial ? `<div class="pp-note">* Before est. label cost (~${fmt(labelCents)})</div>` : "";
  const netOnlyNote = !hasProfit && feeCents != null ? `
    <div class="pp-row pp-profit-row">
      <span>Net after fee</span>
      <span class="pp-val">${fmt(netAfterFeeCents)}</span>
    </div>` : "";

  // Assumptions accordion
  const assumptionsHtml = assumptions.length ? `
    <details class="pp-assumptions">
      <summary>Assumptions</summary>
      <ul>${assumptions.map(a => `<li>${escHtml(a)}</li>`).join("")}</ul>
    </details>` : "";

  el.innerHTML = `
    <div class="pp-header">Estimated Profit Preview</div>
    ${warningHtml}
    <div class="pp-rows">
      <div class="pp-row">
        <span>eBay price</span>
        <span class="pp-val">${fmt(priceCents)}</span>
      </div>
      ${kkPriceCents ? `
      <div class="pp-row">
        <span>KK price (ref)</span>
        <span class="pp-val pp-ref">${fmt(kkPriceCents)}</span>
      </div>` : ""}
      <div class="pp-divider"></div>
      <div class="pp-row pp-deduct-row">
        <span>Est. eBay fee</span>
        <span class="pp-val pp-cost">${fmt(feeCents != null ? -feeCents : null)}</span>
      </div>
      <div class="pp-row pp-deduct-row">
        <span>Est. product cost (CPI)</span>
        <span class="pp-val pp-cost">${fmt(cpiCents != null ? -cpiCents : null)}</span>
      </div>
      <div class="pp-row pp-deduct-row">
        <span>Est. label</span>
        <span class="pp-val pp-cost">${fmt(labelCents != null ? -labelCents : null)}</span>
      </div>
      ${adFeeCents != null && adFeeCents > 0 ? `
      <div class="pp-row pp-deduct-row">
        <span>Assumed ad fee (${estAdRatePct}%)</span>
        <span class="pp-val pp-cost">${fmt(-adFeeCents)}</span>
      </div>` : ""}
      <div class="pp-divider"></div>
      ${profitRow}
      ${netOnlyNote}
    </div>
    ${partialNote}
    ${assumptionsHtml}
  `;
  el.classList.remove("hidden");
}

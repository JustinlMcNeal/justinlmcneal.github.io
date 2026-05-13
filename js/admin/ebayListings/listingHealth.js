/**
 * listingHealth.js — Phase 3: Deterministic listing score and issue flags.
 *
 * Pure function. No DOM access. No side effects. No AI.
 *
 * ── Score model ───────────────────────────────────────────────────────────────
 *
 *   Start at 100, subtract for concrete problems, clamp to 0–100.
 *   Not-listed products: score = null (severity = 'na').
 *
 *   Severity thresholds:
 *     good     — score ≥ 80   (no serious issues)
 *     ok       — score 60–79  (minor gaps)
 *     warn     — score 30–59  (notable problems)
 *     critical — score < 30   (listed but broken or fundamentally incomplete)
 *     na       — not listed   (score not computed)
 *
 * ── Flag sources ──────────────────────────────────────────────────────────────
 *
 *   'ws'  — from p._ws.issue_flags (computed by v_ebay_listing_workspace SQL view)
 *   'js'  — computed here from product fields (supplements the view)
 *
 *   View flags (5):
 *     missing_listing_id  — active + no ebay_listing_id
 *     missing_category    — listed/draft/ended + no ebay_category_id
 *     missing_ebay_price  — listed/draft/ended + no ebay_price_cents
 *     low_image_count     — listed/draft/ended with < 3 gallery images
 *     no_sales_30d        — active + 0 units sold in 30 days
 *
 *   JS-computed flags (2):
 *     draft_no_offer      — status=draft and no ebay_offer_id (stalled push flow)
 *     price_below_kk      — ebay_price_cents < kk retail price (financial risk signal)
 *
 * ── Priority order ────────────────────────────────────────────────────────────
 *
 *   Flags are evaluated in priority order.
 *   primaryIssue = first triggered flag in this list.
 *   Higher penalty = higher priority.
 *
 * ── Intentional exclusions ────────────────────────────────────────────────────
 *
 *   - Title keyword quality: no deterministic basis in local data
 *   - Missing required aspects: requires live eBay fetch per product
 *   - Variant image completeness: requires live eBay fetch
 *   - no_promo penalty: too opinionated
 *   - Stock-out penalty: can be added later using active_variant_stock_total
 *   - ebay_profit_cents_90d: still NULL in view (Phase 1 note)
 */

// ── Flag definitions ───────────────────────────────────────────────────────────
//
// Each entry:
//   key         — flag identifier (matches _ws.issue_flags key or JS-computed key)
//   label       — human-readable issue name for UI display
//   actionLabel — short recommended action text
//   penalty     — score deduction (positive integer)
//   source      — 'ws' (from Supabase view) or 'js' (computed in this function)
//
// Order determines priority (primaryIssue = first triggered entry).

const FLAG_DEFS = [
  {
    key:         "missing_listing_id",
    label:       "Missing listing link",
    actionLabel: "Fix linkage",
    penalty:     30,
    source:      "ws",
  },
  {
    key:         "missing_category",
    label:       "No eBay category",
    actionLabel: "Set category",
    penalty:     25,
    source:      "ws",
  },
  {
    key:         "missing_ebay_price",
    label:       "No eBay price",
    actionLabel: "Set price",
    penalty:     20,
    source:      "ws",
  },
  {
    key:         "low_image_count",
    label:       "Under 3 gallery images",
    actionLabel: "Add images",
    penalty:     20,
    source:      "ws",
  },
  {
    key:         "draft_no_offer",
    label:       "Draft stalled — no offer created",
    actionLabel: "Resume push",
    penalty:     15,
    source:      "js",
  },
  {
    key:         "price_below_kk",
    label:       "eBay price below KK retail",
    actionLabel: "Check price",
    penalty:     10,
    source:      "js",
  },
  {
    key:         "no_sales_30d",
    label:       "No sales in 30 days",
    actionLabel: "Review listing",
    penalty:     10,
    source:      "ws",
  },
];

// ── computeHealth ──────────────────────────────────────────────────────────────
//
// @param {object} p — product row from loadProducts() + mergeWorkspaceMetrics()
//   Required fields: ebay_status, ebay_listing_id, ebay_offer_id,
//                    ebay_price_cents, price (KK), _ws (may be null)
//
// @returns {object}
//   {
//     score:        number|null  — 0–100, or null when not_listed
//     severity:     string       — 'good'|'ok'|'warn'|'critical'|'na'
//     flags:        string[]     — triggered flag keys in priority order
//     flagLabels:   string[]     — human-readable labels for triggered flags
//     primaryIssue: string|null  — top triggered flag key
//     primaryLabel: string|null  — human-readable top issue
//     actionLabel:  string|null  — recommended action for primary issue
//   }

export function computeHealth(p) {
  const status = p.ebay_status || "not_listed";

  // Not listed: health scoring is not applicable.
  if (status === "not_listed") {
    return {
      score:        null,
      severity:     "na",
      flags:        [],
      flagLabels:   [],
      primaryIssue: null,
      primaryLabel: null,
      actionLabel:  null,
    };
  }

  // ── JS-computed flags ──────────────────────────────────────────────────────
  const jsFlags = {};

  // draft_no_offer: push flow was never completed to step 2 (create offer).
  // Safe check: ebay_status is 'draft' and no ebay_offer_id on record.
  if (status === "draft" && !p.ebay_offer_id) {
    jsFlags.draft_no_offer = true;
  }

  // price_below_kk: eBay listing price is below KK retail price.
  // Only triggered when both prices are known and positive.
  if (p.ebay_price_cents > 0 && p.price) {
    const kkCents = Math.round(Number(p.price) * 100);
    if (kkCents > 0 && p.ebay_price_cents < kkCents) {
      jsFlags.price_below_kk = true;
    }
  }

  // ── View flags (from _ws.issue_flags) ─────────────────────────────────────
  // Safe: if _ws is null (view unavailable), wsFlags is empty — no crash.
  const wsFlags = p._ws?.issue_flags || {};

  // ── Compute triggered flags in priority order ──────────────────────────────
  const triggeredFlags  = [];
  const triggeredLabels = [];
  let   totalPenalty    = 0;

  for (const def of FLAG_DEFS) {
    const triggered = def.source === "ws"
      ? !!wsFlags[def.key]
      : !!jsFlags[def.key];

    if (triggered) {
      triggeredFlags.push(def.key);
      triggeredLabels.push(def.label);
      totalPenalty += def.penalty;
    }
  }

  // ── Score + severity ───────────────────────────────────────────────────────
  const score = Math.max(0, 100 - totalPenalty);

  const severity =
    score >= 80 ? "good"
    : score >= 60 ? "ok"
    : score >= 30 ? "warn"
    :               "critical";

  // ── Primary issue (first triggered flag by priority) ──────────────────────
  const primaryDef    = FLAG_DEFS.find(d => triggeredFlags.includes(d.key)) ?? null;
  const primaryIssue  = primaryDef?.key         ?? null;
  const primaryLabel  = primaryDef?.label       ?? null;
  const actionLabel   = primaryDef?.actionLabel ?? null;

  return {
    score,
    severity,
    flags:        triggeredFlags,
    flagLabels:   triggeredLabels,
    primaryIssue,
    primaryLabel,
    actionLabel,
  };
}

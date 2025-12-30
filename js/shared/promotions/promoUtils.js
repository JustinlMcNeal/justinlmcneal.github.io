// /js/shared/promotions/promoUtils.js

export function normalizeUuidArray(arr) {
  return (arr || []).map((x) => String(x));
}

export function isWithinDateWindow(promo) {
  const now = new Date();
  if (promo?.start_date && new Date(promo.start_date) > now) return false;
  if (promo?.end_date && new Date(promo.end_date) < now) return false;
  return true;
}

/**
 * Effective requires_code rule (your desired behavior):
 * - If requires_code is explicitly set, trust it.
 * - Otherwise:
 *    - blank code => auto
 *    - code "AUTO" => auto
 *    - any other code => requires a code
 */
export function effectiveRequiresCode(promo) {
  if (typeof promo?.requires_code === "boolean") return promo.requires_code;

  const code = String(promo?.code || "").trim();
  if (!code) return false;
  if (code.toUpperCase() === "AUTO") return false;

  return true;
}

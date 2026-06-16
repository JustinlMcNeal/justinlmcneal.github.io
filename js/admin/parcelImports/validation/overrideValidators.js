/** Local validation for parcel charge overrides (Phase 2). */

export const OVERRIDE_ERROR_RE = /must be|cannot be negative/i;

/**
 * True only for hard validation failures (not "confirm" warnings on a field).
 * @param {Record<string, string[]>} fieldMessages
 */
export function hasOverrideFieldErrors(fieldMessages) {
  return Object.values(fieldMessages).some((msgs) =>
    msgs.some((m) => OVERRIDE_ERROR_RE.test(m)),
  );
}

/**
 * @param {object | null} overrides
 * @param {object | null} xlsBaseline
 */
export function validateOverrides(overrides, xlsBaseline) {
  /** @type {Record<string, string[]>} */
  const fieldMessages = {};
  /** @type {string[]} */
  const globalWarnings = [];

  if (!overrides) {
    return { fieldMessages, globalWarnings };
  }

  const pw = overrides.parcelWeightGrams;
  const cw = overrides.chargedWeightGrams;
  const ship = overrides.shipmentFeeCny;
  const svc = overrides.serviceFeeCny;
  const insAmt = overrides.insuranceCny;
  const total = overrides.totalParcelChargeCny;
  const fx = overrides.effectiveFxRate;
  const usd = overrides.usdEquivalent;

  if (pw != null && pw <= 0) {
    addMsg(fieldMessages, "parcelWeightGrams", "Parcel weight must be positive.");
  }
  if (cw != null && cw <= 0) {
    addMsg(fieldMessages, "chargedWeightGrams", "Charged weight must be positive.");
  }
  if (ship != null && ship < 0) {
    addMsg(fieldMessages, "shipmentFeeCny", "Shipment fee cannot be negative.");
  }
  if (svc != null && svc < 0) {
    addMsg(fieldMessages, "serviceFeeCny", "Service fee cannot be negative.");
  }
  if (insAmt != null && insAmt < 0) {
    addMsg(fieldMessages, "insuranceCny", "Insurance amount cannot be negative.");
  }
  if (total != null && total < 0) {
    addMsg(fieldMessages, "totalParcelChargeCny", "Total charge cannot be negative.");
  }
  if (fx != null && fx <= 0) {
    addMsg(fieldMessages, "effectiveFxRate", "Exchange rate must be positive.");
  }
  if (usd != null && usd < 0) {
    addMsg(fieldMessages, "usdEquivalent", "USD equivalent cannot be negative.");
  }

  if (cw != null && pw != null && cw > 0 && pw > 0) {
    if (cw < pw) {
      addMsg(
        fieldMessages,
        "chargedWeightGrams",
        "Charged weight is lower than parcel weight. Confirm this is correct.",
      );
    }
  }

  if (total != null && ship != null && total < ship) {
    addMsg(
      fieldMessages,
      "totalParcelChargeCny",
      "Total parcel charge is lower than shipment fee. Confirm this is correct.",
    );
  }

  if (usd != null && usd > 0 && (fx == null || fx <= 0)) {
    globalWarnings.push("USD equivalent is set but effective exchange rate is missing.");
  }
  if (fx != null && fx > 0 && (usd == null || usd <= 0)) {
    globalWarnings.push("Exchange rate is set but USD equivalent is missing.");
  }

  return { fieldMessages, globalWarnings };
}

/**
 * @param {string} key
 * @param {*} current
 * @param {*} baselineValue - XLS baseline for this field (null if absent in export)
 */
export function isOverrideDirty(key, current, baselineValue) {
  const normC = normalizeCompare(key, current);
  const normB = normalizeCompare(key, baselineValue);
  if (normC === null && normB === null) return false;
  if (normC === null || normB === null) return normC !== normB;
  if (typeof normC === "number" && typeof normB === "number") {
    return Math.abs(normC - normB) > 0.0001;
  }
  return normC !== normB;
}

/**
 * @param {string} key
 * @param {*} value
 */
function normalizeCompare(key, value) {
  if (value === undefined) return null;
  if (key === "insuranceYes") {
    if (value === true) return "yes";
    if (value === false) return "no";
    return "unknown";
  }
  if (value === "" || value === "—") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/**
 * @param {Record<string, string[]>} map
 * @param {string} key
 * @param {string} msg
 */
function addMsg(map, key, msg) {
  if (!map[key]) map[key] = [];
  if (!map[key].includes(msg)) map[key].push(msg);
}

/** Static shipping copy constants — synced with checkout / Stripe inline rates. */

export const SHIPPING_RATES = {
  standard: 8.95,
  express: 12.99,
  free: 0,
};

export const TRANSIT_WINDOWS = {
  standard: "5–7 business days",
  express: "2–3 business days",
};

export const SHIP_OUT_WINDOWS = {
  inStock: "1–2 business days",
  backorder: "3–4 weeks",
};

export const DEFAULT_FREE_SHIPPING_THRESHOLD = 50;

export const CARRIER_LABEL = "USPS";

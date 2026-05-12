/**
 * /js/shared/variantUtils.js
 *
 * Phase 1 — Shared utility functions for variant display and identity.
 *
 * Scope:
 *   - Display name helpers (prefer new fields, fall back to legacy field).
 *   - Selected options formatting.
 *   - Cart line key generation (backward-compatible; phase 2 will adopt variant_id key).
 *   - Option type detection (Color vs Size vs other).
 *   - Variant label normalization.
 *
 * This module has zero side effects and no DOM, Supabase, or Stripe dependencies.
 * It is safe to import from any frontend context.
 *
 * All functions safely handle legacy variant rows that lack the new phase-1
 * columns (title, option_values, sku, is_default) — they fall back gracefully
 * to option_value and option_name as before.
 */

// ─── Option type detection ────────────────────────────────────────────────────

/** Canonical known color option name values (lowercase). */
const COLOR_NAMES = new Set(["color", "colour"]);

/** Canonical known size option name values (lowercase). */
const SIZE_NAMES = new Set(["size"]);

/**
 * Returns true if the option_name looks like a color dimension.
 *
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
export function isOptionTypeColor(name) {
  if (!name) return false;
  return COLOR_NAMES.has(name.trim().toLowerCase());
}

/**
 * Returns true if the option_name looks like a size dimension.
 *
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
export function isOptionTypeSize(name) {
  if (!name) return false;
  return SIZE_NAMES.has(name.trim().toLowerCase());
}

// ─── Display name resolution ──────────────────────────────────────────────────

/**
 * Resolve the best human-readable display name for a variant row.
 *
 * Priority order:
 *   1. variant.title       — explicit title set in admin (e.g. "Dark Navy Blue")
 *   2. variant.option_value — existing single-option label (e.g. "Black", "M")
 *   3. formatted option_values — if title and option_value are both absent/empty
 *
 * This function is safe to call on legacy rows that lack title/option_values.
 *
 * @param {object|null|undefined} variant - product_variants row
 * @returns {string}
 */
export function variantDisplayName(variant) {
  if (!variant) return "";

  const title = (variant.title ?? "").trim();
  if (title) return title;

  const optionValue = (variant.option_value ?? "").trim();
  if (optionValue) return optionValue;

  if (variant.option_values && typeof variant.option_values === "object") {
    const formatted = formatSelectedOptions(variant.option_values);
    if (formatted) return formatted;
  }

  return "";
}

// ─── Options formatting ───────────────────────────────────────────────────────

/**
 * Format a selected_options / option_values object into a human-readable string.
 *
 * Input:  { Size: "M", Color: "Black" }
 * Output: "Color: Black · Size: M"
 *
 * Keys are sorted alphabetically for stable, deterministic output.
 * Empty/null values are filtered out.
 *
 * @param {Record<string, string>|null|undefined} options
 * @returns {string}
 */
export function formatSelectedOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return "";

  return Object.keys(options)
    .sort()
    .filter((k) => options[k] != null && String(options[k]).trim() !== "")
    .map((k) => `${k}: ${String(options[k]).trim()}`)
    .join(" · ");
}

// ─── Variant label normalization ──────────────────────────────────────────────

/**
 * Trim and normalize a variant display string.
 * Mirrors the private normVariant() behavior in cartStore.js.
 *
 * @param {string|null|undefined} v
 * @returns {string}
 */
export function normalizeVariantLabel(v) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : "";
}

// ─── Cart line key ────────────────────────────────────────────────────────────

/**
 * Return the cart line key for a cart item.
 *
 * Phase 1 behavior — backward-compatible with current cartStore.js:
 *   - If the item has a variant_id, returns "variant:{variant_id}".
 *     (cartStore does not yet use this; reserved for phase 2.)
 *   - Otherwise, falls back to the legacy "{id}::{normVariant}" key that
 *     cartStore.js currently uses for findLineIndex / removeItem / setQty.
 *
 * Phase 2 will update cartStore.js to persist variant_id and adopt the
 * "variant:{variant_id}" key. Until then, this helper generates the correct
 * key for EITHER shape so it can be used in display/reconciliation code
 * without being tied to the current cartStore implementation.
 *
 * @param {{ id?: string, variant?: string, variant_id?: string|null }} item
 * @returns {string}
 */
export function cartLineKey(item) {
  if (!item) return "";

  // New shape: prefer variant_id when available
  if (item.variant_id) {
    return `variant:${item.variant_id}`;
  }

  // Legacy shape: product UUID + normalized variant text (matches cartStore.lineKey)
  const id = String(item.id ?? "");
  const variant = normalizeVariantLabel(item.variant);
  return `${id}::${variant}`;
}

// ─── Option values builder ────────────────────────────────────────────────────

/**
 * Build an option_values map from a variant's option_name and option_value.
 * Used for constructing structured option maps for legacy rows that have not
 * yet been backfilled, or for building cart snapshots from single-option variants.
 *
 * Example:
 *   buildOptionValues({ option_name: "Size", option_value: "M" })
 *   → { Size: "M" }
 *
 * @param {{ option_name?: string, option_value?: string }} variant
 * @returns {Record<string, string>}
 */
export function buildOptionValues(variant) {
  if (!variant) return {};
  const name = (variant.option_name ?? "").trim();
  const value = (variant.option_value ?? "").trim();
  if (!name || !value) return {};
  return { [name]: value };
}

/**
 * Get the effective option_values for a variant, using stored JSONB if available
 * and falling back to building from option_name / option_value.
 *
 * @param {object|null|undefined} variant
 * @returns {Record<string, string>}
 */
export function effectiveOptionValues(variant) {
  if (!variant) return {};

  // Use stored JSONB if it has at least one key
  if (
    variant.option_values &&
    typeof variant.option_values === "object" &&
    !Array.isArray(variant.option_values) &&
    Object.keys(variant.option_values).length > 0
  ) {
    return variant.option_values;
  }

  // Fall back to building from flat fields
  return buildOptionValues(variant);
}

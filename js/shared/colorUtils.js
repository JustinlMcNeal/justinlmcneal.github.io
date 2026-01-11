// /js/shared/colorUtils.js
// Centralized color utilities for swatch rendering with multi-color support

const COLOR_MAP = {
  // Basic colors
  black: "#000000",
  white: "#ffffff",
  red: "#e11d48",
  blue: "#2563eb",
  green: "#16a34a",
  yellow: "#f59e0b",
  orange: "#f97316",
  purple: "#7c3aed",
  pink: "#ff6ea8",
  hotpink: "#ff3d9a",
  rose: "#ff6ea8",
  
  // Neutrals
  gray: "#6b7280",
  grey: "#6b7280",
  silver: "#c0c0c0",
  
  // Browns/Tans
  brown: "#7c3f2a",
  tan: "#d6c6b2",
  beige: "#d6c6b2",
  khaki: "#c3b091",
  cream: "#fffdd0",
  ivory: "#fffff0",
  
  // Blues
  navy: "#1e3a5f",
  teal: "#0d9488",
  turquoise: "#40e0d0",
  aqua: "#00ffff",
  cyan: "#06b6d4",
  lightblue: "#93c5fd",
  skyblue: "#87ceeb",
  
  // Greens
  olive: "#6b7b3a",
  lime: "#84cc16",
  mint: "#a7f3d0",
  sage: "#9caf88",
  forest: "#228b22",
  
  // Reds/Pinks
  maroon: "#800000",
  burgundy: "#800020",
  coral: "#ff7f50",
  salmon: "#fa8072",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  lavender: "#e6e6fa",
  
  // Yellows/Golds
  gold: "#d4af37",
  mustard: "#ffdb58",
  lemon: "#fff44f",
  
  // Special
  clear: "transparent",
  transparent: "transparent",
  camo: "#4b5320",
  camouflage: "#4b5320",
  rainbow: "linear-gradient(90deg, red, orange, yellow, green, blue, purple)",
  multicolor: "linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3)",
  multi: "linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3)",
};

/**
 * Parse a color name/value and return a CSS color
 * @param {string} colorName - Single color name like "black", "red", etc.
 * @returns {string} CSS color value
 */
function parseSingleColor(colorName) {
  const raw = String(colorName || "").trim().toLowerCase();
  if (!raw) return "#cccccc";
  
  // Direct match
  if (COLOR_MAP[raw]) return COLOR_MAP[raw];
  
  // Already a hex color
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw;
  
  // RGB/RGBA format
  if (/^rgba?\(/.test(raw)) return raw;
  
  // Try partial match (e.g., "light blue" -> "lightblue")
  const normalized = raw.replace(/\s+/g, "").replace(/-/g, "");
  if (COLOR_MAP[normalized]) return COLOR_MAP[normalized];
  
  // Check if any key is contained in the name
  for (const [key, value] of Object.entries(COLOR_MAP)) {
    if (raw.includes(key) || normalized.includes(key)) {
      return value;
    }
  }
  
  // Use canvas to try to parse browser-recognized colors
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = raw;
    if (ctx.fillStyle !== "#000000" || raw === "black") {
      return ctx.fillStyle;
    }
  } catch (e) {}
  
  return "#cccccc"; // fallback gray
}

/**
 * Parse a potentially multi-color value and return swatch styling
 * Supports: "Black/White", "Red-Blue-Green", "Pink & Purple", etc.
 * @param {string} colorValue - Color value which may contain multiple colors
 * @returns {{ background: string, isMultiColor: boolean, colors: string[] }}
 */
export function parseColorValue(colorValue) {
  const raw = String(colorValue || "").trim();
  if (!raw) return { background: "#cccccc", isMultiColor: false, colors: [] };
  
  // Split by common separators: /, -, &, and, +
  const separatorRegex = /[\/\-&+]|\s+and\s+/i;
  const parts = raw.split(separatorRegex).map(p => p.trim()).filter(p => p);
  
  if (parts.length === 1) {
    // Single color
    const color = parseSingleColor(parts[0]);
    return { background: color, isMultiColor: false, colors: [color] };
  }
  
  // Multi-color
  const colors = parts.map(p => parseSingleColor(p));
  
  if (colors.length === 2) {
    // Two colors: diagonal split
    return {
      background: `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`,
      isMultiColor: true,
      colors
    };
  }
  
  if (colors.length === 3) {
    // Three colors: three-way split
    return {
      background: `linear-gradient(135deg, ${colors[0]} 33%, ${colors[1]} 33% 66%, ${colors[2]} 66%)`,
      isMultiColor: true,
      colors
    };
  }
  
  // 4+ colors: gradient
  return {
    background: `linear-gradient(135deg, ${colors.join(", ")})`,
    isMultiColor: true,
    colors
  };
}

/**
 * Generate inline style string for a color swatch
 * @param {string} colorValue - Color value (single or multi)
 * @returns {string} CSS style string for background
 */
export function getSwatchStyle(colorValue) {
  const { background } = parseColorValue(colorValue);
  return `background: ${background};`;
}

/**
 * Guess a single CSS color from a color name (legacy compatibility)
 * @param {string} optionValue - Color option value
 * @returns {string} CSS color
 */
export function guessColor(optionValue) {
  return parseSingleColor(optionValue);
}

/**
 * Convert color name to CSS color (legacy compatibility)
 * @param {string} value - Color value
 * @returns {string} CSS color
 */
export function toSwatchColor(value) {
  return parseSingleColor(value);
}

export { COLOR_MAP };

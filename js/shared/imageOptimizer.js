/**
 * Optimized Image URL Utility
 * Uses Supabase Image Transformation API to resize and compress images on-the-fly
 * Falls back to original URL if transformation fails
 */

const SUPABASE_URL = "https://yxdzvzscufkvewecvagq.supabase.co";

/**
 * Transform a Supabase storage URL to use image optimization
 * @param {string} url - Original image URL
 * @param {Object} options - Transformation options
 * @param {number} options.width - Desired width (default: auto)
 * @param {number} options.height - Desired height (default: auto)
 * @param {number} options.quality - JPEG/WebP quality 1-100 (default: 80)
 * @param {string} options.format - Output format: origin, webp, avif (default: webp)
 * @param {string} options.resize - Resize mode: cover, contain, fill (default: cover)
 * @returns {string} Optimized image URL
 */
export function getOptimizedImageUrl(url, options = {}) {
  if (!url) return "";
  
  const {
    width,
    height,
    quality = 80,
    format = "webp",
    resize = "cover"
  } = options;
  
  // Only transform Supabase storage URLs
  if (!url.includes(SUPABASE_URL) || !url.includes("/storage/v1/object/public/")) {
    return url;
  }
  
  // Convert object/public to render/image/public
  // From: /storage/v1/object/public/bucket/path
  // To:   /storage/v1/render/image/public/bucket/path?width=X&quality=Y
  const transformedUrl = url.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/"
  );
  
  // Build query params
  const params = new URLSearchParams();
  if (width) params.set("width", width.toString());
  if (height) params.set("height", height.toString());
  params.set("quality", quality.toString());
  if (format !== "origin") params.set("format", format);
  params.set("resize", resize);
  
  const separator = transformedUrl.includes("?") ? "&" : "?";
  return `${transformedUrl}${separator}${params.toString()}`;
}

/**
 * Preset sizes for common use cases
 */
export const IMAGE_SIZES = {
  thumbnail: { width: 100, height: 100, quality: 70 },
  card: { width: 400, height: 400, quality: 80 },
  cardHover: { width: 400, height: 400, quality: 75 },
  product: { width: 800, height: 800, quality: 85 },
  productGallery: { width: 1200, height: 1200, quality: 90 },
  banner: { width: 1920, height: 600, quality: 85 },
  categoryStrip: { width: 300, height: 400, quality: 80 },
  socialPreview: { width: 1080, height: 1080, quality: 90 }
};

/**
 * Get optimized image URL with preset size
 * @param {string} url - Original image URL
 * @param {string} preset - Preset name from IMAGE_SIZES
 * @returns {string} Optimized image URL
 */
export function getImageWithPreset(url, preset) {
  const options = IMAGE_SIZES[preset];
  if (!options) {
    console.warn(`Unknown image preset: ${preset}`);
    return url;
  }
  return getOptimizedImageUrl(url, options);
}

/**
 * Generate srcset for responsive images
 * @param {string} url - Original image URL
 * @param {number[]} widths - Array of widths to generate
 * @param {number} quality - Image quality
 * @returns {string} srcset string
 */
export function generateSrcSet(url, widths = [200, 400, 800, 1200], quality = 80) {
  if (!url || !url.includes(SUPABASE_URL)) {
    return "";
  }
  
  return widths
    .map(w => `${getOptimizedImageUrl(url, { width: w, quality })} ${w}w`)
    .join(", ");
}

// /js/admin/social/imageProcessor.js
// Client-side image cropping utilities
// Note: In Phase 2, this will be replaced by server-side processing via Edge Functions

/**
 * Aspect ratio configurations
 */
export const ASPECT_RATIOS = {
  square_1x1: { ratio: 1, width: 1080, height: 1080, platform: "instagram", label: "Square (1:1)" },
  portrait_4x5: { ratio: 4/5, width: 1080, height: 1350, platform: "instagram", label: "Portrait (4:5)" },
  vertical_2x3: { ratio: 2/3, width: 1000, height: 1500, platform: "pinterest", label: "Vertical (2:3)" },
  tall_1x2: { ratio: 1/2.1, width: 1000, height: 2100, platform: "pinterest", label: "Tall (1:2.1)" }
};

/**
 * Load an image from a file
 */
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Crop an image to a specific aspect ratio (center crop)
 */
export function cropToAspectRatio(img, aspectRatio, maxWidth = 1080) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  
  const targetRatio = aspectRatio.width / aspectRatio.height;
  const imgRatio = img.width / img.height;
  
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = img.width;
  let sourceHeight = img.height;
  
  if (imgRatio > targetRatio) {
    // Image is wider than target - crop sides
    sourceWidth = img.height * targetRatio;
    sourceX = (img.width - sourceWidth) / 2;
  } else {
    // Image is taller than target - crop top/bottom
    sourceHeight = img.width / targetRatio;
    sourceY = (img.height - sourceHeight) / 2;
  }
  
  // Calculate output dimensions
  let outputWidth = aspectRatio.width;
  let outputHeight = aspectRatio.height;
  
  if (outputWidth > maxWidth) {
    const scale = maxWidth / outputWidth;
    outputWidth = maxWidth;
    outputHeight = Math.round(outputHeight * scale);
  }
  
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  
  // Draw cropped image
  ctx.drawImage(
    img,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, outputWidth, outputHeight
  );
  
  return canvas;
}

/**
 * Convert canvas to blob
 */
export function canvasToBlob(canvas, type = "image/jpeg", quality = 0.9) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/**
 * Generate all variations for an image
 */
export async function generateVariations(file, selectedFormats = []) {
  const img = await loadImageFromFile(file);
  const variations = [];
  
  for (const [key, config] of Object.entries(ASPECT_RATIOS)) {
    if (selectedFormats.length && !selectedFormats.includes(key)) {
      continue;
    }
    
    const canvas = cropToAspectRatio(img, config);
    const blob = await canvasToBlob(canvas);
    
    variations.push({
      variantType: key,
      aspectRatio: `${config.width}:${config.height}`,
      platform: config.platform,
      width: canvas.width,
      height: canvas.height,
      blob,
      previewUrl: canvas.toDataURL("image/jpeg", 0.8)
    });
  }
  
  return variations;
}

/**
 * Generate a preview URL for a file
 */
export function getFilePreviewUrl(file) {
  return URL.createObjectURL(file);
}

/**
 * Revoke a preview URL to free memory
 */
export function revokePreviewUrl(url) {
  URL.revokeObjectURL(url);
}

/**
 * Generate a unique filename
 */
export function generateFilename(originalName, variantType) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = originalName.split(".").pop() || "jpg";
  const baseName = originalName.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9]/gi, "_");
  
  return `${baseName}_${variantType}_${timestamp}_${random}.${ext}`;
}

/**
 * Get storage path for an asset
 */
export function getAssetPath(filename) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  
  return `originals/${year}/${month}/${filename}`;
}

/**
 * Get storage path for a variation
 */
export function getVariationPath(assetId, variantType, filename) {
  return `variations/${assetId}/${variantType}/${filename}`;
}

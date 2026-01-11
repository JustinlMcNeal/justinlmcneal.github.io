// /js/admin/social/captions.js
// Caption generation and hashtag utilities

import { fetchTemplates, getHashtagsForCategory } from "./api.js";

// Cache templates
let templateCache = null;

/**
 * Load all caption templates
 */
export async function loadTemplates() {
  if (!templateCache) {
    templateCache = await fetchTemplates();
  }
  return templateCache;
}

/**
 * Clear template cache (call after adding/editing templates)
 */
export function clearTemplateCache() {
  templateCache = null;
}

/**
 * Get a random template for a given tone
 */
export async function getRandomTemplate(tone = "casual") {
  const templates = await loadTemplates();
  const filtered = templates.filter(t => t.tone === tone);
  
  if (!filtered.length) {
    // Fallback to any template
    return templates[Math.floor(Math.random() * templates.length)];
  }
  
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Get all templates for a given tone
 */
export async function getTemplatesForTone(tone) {
  const templates = await loadTemplates();
  return templates.filter(t => t.tone === tone);
}

/**
 * Fill template placeholders with product data
 */
export function fillTemplate(template, data = {}) {
  let result = template;
  
  // Support both snake_case and camelCase property names
  const placeholders = {
    "{product_name}": data.product_name || data.productName || "this item",
    "{category}": data.category || "collection",
    "{link}": data.link || "",
    "{price}": data.price ? `$${data.price}` : "",
    "{code}": data.code || ""
  };
  
  Object.entries(placeholders).forEach(([key, value]) => {
    result = result.replace(new RegExp(key, "gi"), value);
  });
  
  return result;
}

/**
 * Generate a caption with a random template
 */
export async function generateCaption(tone, productData = {}) {
  const template = await getRandomTemplate(tone);
  if (!template) {
    return `Check out our latest drop! Shop now at karrykraze.com`;
  }
  
  return fillTemplate(template.template, productData);
}

/**
 * Get hashtags for a product based on its category
 */
export async function getHashtagsForProduct(product) {
  if (!product) {
    return ["#karrykraze", "#fashion", "#style", "#shopnow"];
  }
  
  // Get category name from product
  let categoryName = null;
  let categoryId = product.category_id;
  
  if (product.category?.name) {
    categoryName = product.category.name;
  }
  
  const hashtags = await getHashtagsForCategory(categoryId, categoryName);
  return hashtags;
}

/**
 * Format hashtags as a string
 */
export function formatHashtags(hashtags) {
  if (!hashtags || !hashtags.length) return "";
  return hashtags.join(" ");
}

/**
 * Parse hashtag string back to array
 */
export function parseHashtags(hashtagString) {
  if (!hashtagString) return [];
  
  return hashtagString
    .split(/\s+/)
    .map(tag => tag.trim())
    .filter(tag => tag.startsWith("#"))
    .map(tag => tag.toLowerCase());
}

/**
 * Ensure #karrykraze is always included
 */
export function ensureKarryKrazeTag(hashtags) {
  const tags = Array.isArray(hashtags) ? hashtags : parseHashtags(hashtags);
  
  if (!tags.some(t => t.toLowerCase() === "#karrykraze")) {
    tags.unshift("#karrykraze");
  }
  
  return tags;
}

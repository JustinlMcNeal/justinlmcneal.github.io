/**
 * /js/shared/cart/cartRecommendations.js
 * 
 * Smart cart recommendations:
 * 1. BOGO Hints - "Add a hat and get this charm FREE!"
 * 2. Pairs Well - Products in same category as cart items
 * 3. Best Sellers - Products with bestseller tag
 */

import { getSupabaseClient } from "../supabaseClient.js";
import { checkPromotionApplies } from "../promotions/promoScope.js";

// Cache to avoid refetching
let cachedProducts = null;
let cachedCategories = null;
let cachedBestSellerTagId = null;

/**
 * Fetch all active products (cached)
 */
async function getProducts() {
  if (cachedProducts) return cachedProducts;

  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("products")
    .select(`
      id, slug, name, price, category_id,
      catalog_image_url, primary_image_url,
      product_tags(tag_id)
    `)
    .eq("is_active", true);

  if (error) {
    console.warn("Failed to fetch products for recommendations:", error);
    return [];
  }

  cachedProducts = data || [];
  return cachedProducts;
}

/**
 * Fetch categories (cached)
 */
async function getCategories() {
  if (cachedCategories) return cachedCategories;

  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("categories")
    .select("id, name");

  if (error) {
    console.warn("Failed to fetch categories:", error);
    return [];
  }

  cachedCategories = data || [];
  return cachedCategories;
}

/**
 * Get bestseller tag ID (cached)
 */
async function getBestSellerTagId() {
  if (cachedBestSellerTagId !== null) return cachedBestSellerTagId;

  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("tags")
    .select("id")
    .or("name.ilike.%bestseller%,name.ilike.%best seller%")
    .limit(1)
    .single();

  if (error || !data) {
    cachedBestSellerTagId = "";
    return "";
  }

  cachedBestSellerTagId = data.id;
  return data.id;
}

/**
 * Normalize item keys for matching
 */
function itemKeys(item = {}) {
  const keys = new Set();
  [item.id, item.product_id, item.slug, item.sku].forEach((v) => {
    const s = String(v || "").trim();
    if (s) keys.add(s);
  });
  return keys;
}

/**
 * Check if a product is already in the cart
 */
function isInCart(product, cartItems) {
  const productKeys = itemKeys(product);
  return cartItems.some((cartItem) => {
    const cartKeys = itemKeys(cartItem);
    return [...productKeys].some((k) => cartKeys.has(k));
  });
}

/**
 * Analyze BOGO promotions and generate hints
 * 
 * Returns array of hints like:
 * {
 *   type: "bogo_add_trigger" | "bogo_add_reward",
 *   promo: {...},
 *   message: "Add a hat and get this charm FREE!",
 *   products: [...] // recommended products to add
 * }
 */
async function analyzeBogos(bogoPromos, cartItems) {
  if (!bogoPromos?.length || !cartItems?.length) return [];

  const products = await getProducts();
  const categories = await getCategories();
  const hints = [];

  for (const promo of bogoPromos) {
    if (promo.type !== "bogo") continue;

    const rewardType = promo.bogo_reward_type;
    const rewardId = promo.bogo_reward_id;
    if (!rewardType || !rewardId) continue;

    // Count qualifying "buy" items in cart
    let buyQty = 0;
    for (const item of cartItems) {
      if (checkPromotionApplies(promo, item)) {
        buyQty += Math.max(1, Number(item.qty || 1));
      }
    }

    // Check if reward items are in cart
    let rewardQty = 0;
    for (const item of cartItems) {
      if (matchesReward(item, rewardType, rewardId)) {
        rewardQty += Math.max(1, Number(item.qty || 1));
      }
    }

    // Get category/tag names for nice messages
    const rewardName = await getRewardName(rewardType, rewardId, categories);
    const scopeName = await getScopeName(promo, categories);

    // SCENARIO 1: Has buy items but no reward items
    // "You qualify for a FREE charm! Add one to your cart."
    if (buyQty >= 1 && rewardQty === 0) {
      const rewardProducts = products.filter(
        (p) => matchesReward(p, rewardType, rewardId) && !isInCart(p, cartItems)
      );

      if (rewardProducts.length > 0) {
        hints.push({
          type: "bogo_add_reward",
          promo,
          priority: 10, // High priority - they qualify!
          title: "🎁 FREE Item Available!",
          message: `Add a ${rewardName} and get it FREE with your ${scopeName}!`,
          products: rewardProducts.slice(0, 4),
        });
      }
    }

    // SCENARIO 2: Has reward items but no buy items (or not enough)
    // "Add a hat and get your charm FREE!"
    if (rewardQty >= 1 && buyQty === 0) {
      const triggerProducts = products.filter(
        (p) => checkPromotionApplies(promo, p) && !isInCart(p, cartItems)
      );

      if (triggerProducts.length > 0) {
        hints.push({
          type: "bogo_add_trigger",
          promo,
          priority: 9, // High priority
          title: "💡 Unlock a FREE Item!",
          message: `Add a ${scopeName} and get your ${rewardName} FREE!`,
          products: triggerProducts.slice(0, 4),
        });
      }
    }

    // SCENARIO 3: Has buy items but could get more free items
    // (only if they have fewer rewards than they could get free)
    const maxFree = Math.floor(buyQty / 2);
    if (buyQty >= 2 && rewardQty < maxFree) {
      const moreRewards = products.filter(
        (p) => matchesReward(p, rewardType, rewardId) && !isInCart(p, cartItems)
      );

      if (moreRewards.length > 0) {
        const canGetFree = maxFree - rewardQty;
        hints.push({
          type: "bogo_get_more",
          promo,
          priority: 8,
          title: "🎁 Get More FREE!",
          message: `You can get ${canGetFree} more ${rewardName}${canGetFree > 1 ? "s" : ""} FREE!`,
          products: moreRewards.slice(0, 4),
        });
      }
    }
  }

  return hints;
}

/**
 * Check if item matches the reward criteria
 */
function matchesReward(item, rewardType, rewardId) {
  if (!rewardType || !rewardId) return false;

  const keys = itemKeys(item);

  if (rewardType === "product") {
    return keys.has(rewardId);
  }

  if (rewardType === "category") {
    const cats = [item.category_id, ...(item.category_ids || [])].filter(Boolean).map(String);
    return cats.includes(rewardId);
  }

  if (rewardType === "tag") {
    const tags = (item.product_tags || item.tags || item.tag_ids || [])
      .map((t) => (typeof t === "object" ? t.tag_id : t))
      .filter(Boolean)
      .map(String);
    return tags.includes(rewardId);
  }

  return false;
}

/**
 * Get human-readable name for reward
 */
async function getRewardName(rewardType, rewardId, categories) {
  if (rewardType === "category") {
    const cat = categories.find((c) => c.id === rewardId);
    return cat?.name || "item";
  }
  if (rewardType === "tag") {
    // Could fetch tag name, but for now just return generic
    return "qualifying item";
  }
  if (rewardType === "product") {
    const products = await getProducts();
    const prod = products.find((p) => p.id === rewardId || p.slug === rewardId);
    return prod?.name || "item";
  }
  return "item";
}

/**
 * Get human-readable name for promo scope
 */
async function getScopeName(promo, categories) {
  const scopeType = promo.scope_type || "all";
  const scopeData = promo.scope_data || [];

  if (scopeType === "all") return "purchase";
  if (scopeType === "category" && scopeData.length) {
    const cat = categories.find((c) => c.id === scopeData[0]);
    return cat?.name || "qualifying item";
  }
  if (scopeType === "tag") return "qualifying item";
  if (scopeType === "product") return "qualifying item";

  return "purchase";
}

/**
 * Get "Pairs Well With" recommendations
 * Products in the same category as cart items
 */
async function getPairsWellWith(cartItems, limit = 4) {
  if (!cartItems?.length) return [];

  const products = await getProducts();

  // Get category IDs from cart
  const cartCategoryIds = new Set();
  for (const item of cartItems) {
    if (item.category_id) cartCategoryIds.add(item.category_id);
  }

  if (cartCategoryIds.size === 0) return [];

  // Find products in same categories, not in cart
  const pairs = products.filter(
    (p) => cartCategoryIds.has(p.category_id) && !isInCart(p, cartItems)
  );

  // Shuffle and limit
  const shuffled = pairs.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

/**
 * Get Best Sellers
 */
async function getBestSellers(cartItems, limit = 4) {
  const products = await getProducts();
  const bestSellerTagId = await getBestSellerTagId();

  if (!bestSellerTagId) return [];

  const bestSellers = products.filter((p) => {
    if (isInCart(p, cartItems)) return false;

    const tags = (p.product_tags || []).map((t) =>
      typeof t === "object" ? t.tag_id : t
    );
    return tags.includes(bestSellerTagId);
  });

  // Shuffle and limit
  const shuffled = bestSellers.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

/**
 * Main function: Get all recommendations for cart
 */
export async function getCartRecommendations(cartItems = [], activePromos = []) {
  try {
    // Filter BOGO promos
    const bogoPromos = (activePromos || []).filter((p) => p.type === "bogo");

    // Get all recommendation types in parallel
    const [bogoHints, pairsWell, bestSellers] = await Promise.all([
      analyzeBogos(bogoPromos, cartItems),
      getPairsWellWith(cartItems, 4),
      getBestSellers(cartItems, 4),
    ]);

    // Sort BOGO hints by priority
    const sortedHints = bogoHints.sort((a, b) => b.priority - a.priority);

    return {
      bogoHints: sortedHints,
      pairsWell,
      bestSellers,
    };
  } catch (err) {
    console.error("Error getting cart recommendations:", err);
    return { bogoHints: [], pairsWell: [], bestSellers: [] };
  }
}

/**
 * Render recommendations HTML
 */
export function renderRecommendations(recommendations, containerEl) {
  if (!containerEl) return;

  const { bogoHints = [], pairsWell = [], bestSellers = [] } = recommendations;

  // Check if there's anything to show
  const hasContent = bogoHints.length > 0 || pairsWell.length > 0 || bestSellers.length > 0;

  if (!hasContent) {
    containerEl.innerHTML = "";
    containerEl.style.display = "none";
    return;
  }

  containerEl.style.display = "block";

  let html = "";

  // BOGO Hints (highest priority)
  for (const hint of bogoHints.slice(0, 1)) {
    // Show only top hint
    html += renderBogoHint(hint);
  }

  // Pairs Well or Best Sellers (pick one to avoid clutter)
  if (pairsWell.length > 0) {
    html += renderProductSection("Pairs Well With", pairsWell);
  } else if (bestSellers.length > 0) {
    html += renderProductSection("Best Sellers", bestSellers);
  }

  containerEl.innerHTML = html;

  // Attach click handlers
  attachProductClickHandlers(containerEl);
}

function renderBogoHint(hint) {
  const { title, message, products } = hint;

  return `
    <div class="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-3 mb-3">
      <div class="font-bold text-sm text-green-800 mb-1">${escHtml(title)}</div>
      <p class="text-xs text-green-700 mb-2">${escHtml(message)}</p>
      ${products?.length ? renderMiniProducts(products.slice(0, 3)) : ""}
    </div>
  `;
}

function renderProductSection(title, products) {
  if (!products?.length) return "";

  return `
    <div class="mt-3">
      <div class="font-bold text-xs text-black/60 uppercase tracking-wide mb-2">${escHtml(title)}</div>
      ${renderMiniProducts(products)}
    </div>
  `;
}

function renderMiniProducts(products) {
  return `
    <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      ${products
        .map((p) => {
          const img = p.catalog_image_url || p.primary_image_url || "/imgs/placeholder.png";
          const price = Number(p.price || 0).toFixed(2);
          const href = `/pages/product.html?slug=${encodeURIComponent(p.slug || p.id)}`;

          return `
            <a href="${href}" 
               class="flex-shrink-0 w-20 group cursor-pointer no-underline"
               data-rec-product="${escAttr(p.id)}">
              <div class="w-20 h-20 rounded-md overflow-hidden bg-black/5 mb-1">
                <img src="${escAttr(img)}" alt="${escAttr(p.name)}" 
                     class="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                     loading="lazy" />
              </div>
              <div class="text-[10px] font-medium text-black truncate">${escHtml(p.name)}</div>
              <div class="text-[10px] font-bold text-black/70">$${price}</div>
            </a>
          `;
        })
        .join("")}
    </div>
  `;
}

function attachProductClickHandlers(containerEl) {
  // Product links are already <a> tags, so they'll work naturally
  // But we could add "quick add" buttons in the future
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Clear cache (call when promotions change)
 */
export function clearRecommendationsCache() {
  cachedProducts = null;
  cachedCategories = null;
  cachedBestSellerTagId = null;
}

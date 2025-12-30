/**
 * Promotion Helper
 * Utilities for checking promotion applicability to cart items
 */

/**
 * Check if a promotion applies to a set of cart items
 * @param {Object} promotion - Promotion object with scope_type and scope_data
 * @param {Array} cartItems - Array of cart items, each with product data (categories, tags, product_id)
 * @returns {boolean} - Whether the promotion applies to at least one item
 */
export function checkPromotionApplies(promotion, cartItems = []) {
  if (!promotion) return false;

  const scopeType = promotion.scope_type || "all";
  const scopeData = (promotion.scope_data || []).map(String); // Normalize to strings

  // "all" scope applies to everything
  if (scopeType === "all") {
    return true;
  }

  // No items means no match (except for "all" scope)
  if (!cartItems || cartItems.length === 0) {
    return false;
  }

  // Check if any item matches the scope
  return cartItems.some((item) => {
    switch (scopeType) {
      case "category":
        // Check if item's category is in scope_data
        return item.category_id && scopeData.includes(String(item.category_id));

      case "tag":
        // Check if item has any tag in scope_data
        if (!item.tags || !Array.isArray(item.tags)) return false;
        return item.tags.some((tag) => scopeData.includes(String(tag.id || tag)));

      case "product":
        // Check if item's product ID is in scope_data
        return item.product_id && scopeData.includes(String(item.product_id));

      default:
        return false;
    }
  });
}

/**
 * Get applicable promotions for a cart
 * @param {Array} promotions - Array of all promotions
 * @param {Array} cartItems - Array of cart items
 * @returns {Array} - Applicable promotions
 */
export function getApplicablePromotions(promotions, cartItems) {
  return (promotions || [])
    .filter((promo) => {
      // Must be active
      if (!promo.is_active) return false;

      // Must be within date range if dates are set
      const now = new Date();
      if (promo.start_date && new Date(promo.start_date) > now) return false;
      if (promo.end_date && new Date(promo.end_date) < now) return false;

      // Must apply to at least one cart item
      return checkPromotionApplies(promo, cartItems);
    });
}

/**
 * Check if cart qualifies for a BOGO promotion
 * For BOGO: scope_type defines which items trigger the promotion (e.g., "category")
 *           scope_data contains category IDs to trigger on
 *           bogo_reward_type defines what they get free (product/category/tag)
 *           bogo_reward_id is the specific product/category/tag ID
 * 
 * @param {Object} promotion - BOGO promotion with bogo_reward_type and bogo_reward_id
 * @param {Array} cartItems - Array of cart items
 * @returns {Object} - { qualifies: boolean, rewardType: string, rewardId: string, triggerItems: Array }
 */
export function checkBOGOQualifies(promotion, cartItems = []) {
  if (!promotion || promotion.type !== "bogo") {
    return { qualifies: false, rewardType: null, rewardId: null, triggerItems: [] };
  }

  // Check if any item in cart matches the trigger criteria (scope_type/scope_data)
  const triggerItems = cartItems.filter((item) => {
    switch (promotion.scope_type) {
      case "category":
        return item.category_id && promotion.scope_data.includes(item.category_id);
      case "tag":
        if (!item.tags || !Array.isArray(item.tags)) return false;
        return item.tags.some((tag) => promotion.scope_data.includes(tag.id || tag));
      case "product":
        return item.product_id && promotion.scope_data.includes(item.product_id);
      case "all":
        return true;
      default:
        return false;
    }
  });

  const qualifies = triggerItems.length > 0;
  const rewardType = promotion.bogo_reward_type || "product";
  const rewardId = promotion.bogo_reward_id;

  return { qualifies, rewardType, rewardId, triggerItems };
}

/**
 * Calculate discount for a promotion
 * @param {Object} promotion - Promotion object with type and value
 * @param {number} subtotal - Cart subtotal
 * @returns {number} - Discount amount
 */
export function calculateDiscount(promotion, subtotal) {
  if (!promotion || subtotal <= 0) return 0;

  const type = promotion.type || "percentage";
  const value = promotion.value || 0;

  switch (type) {
    case "percentage":
      return (subtotal * value) / 100;
    case "fixed":
      return value;
    case "free_shipping":
      // Handled separately in checkout; return 0 here
      return 0;
    case "bogo":
      // Buy one get one - handled by checkBOGOQualifies
      // Price of free item is calculated separately in checkout
      return 0;
    default:
      return 0;
  }
}

/**
 * Validate promotion code and minimum order amount
 * @param {Object} promotion - Promotion to validate
 * @param {number} subtotal - Current cart subtotal
 * @returns {Object} - { isValid: boolean, message: string }
 */
export function validatePromotion(promotion, subtotal) {
  if (!promotion) {
    return { isValid: false, message: "Promotion not found" };
  }

  if (!promotion.is_active) {
    return { isValid: false, message: "Promotion is not active" };
  }

  const now = new Date();
  if (promotion.start_date && new Date(promotion.start_date) > now) {
    return { isValid: false, message: "Promotion has not started yet" };
  }

  if (promotion.end_date && new Date(promotion.end_date) < now) {
    return { isValid: false, message: "Promotion has expired" };
  }

  const minOrder = promotion.min_order_amount || 0;
  if (subtotal < minOrder) {
    return {
      isValid: false,
      message: `Minimum order amount of $${minOrder.toFixed(2)} required`,
    };
  }

  return { isValid: true, message: "" };
}
